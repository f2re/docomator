import {
  createHmac,
  randomBytes,
  scryptSync,
  timingSafeEqual
} from "node:crypto";

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import { correlationId } from "./request-context.js";

const COOKIE_NAME = "docomator_session";
const HASH_PREFIX = "scrypt-v1";
const SCRYPT_N = 16_384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const PASSWORD_KEY_BYTES = 32;
const SESSION_SECRET_MIN_LENGTH = 32;
const DEFAULT_SESSION_TTL_SECONDS = 8 * 60 * 60;
const MIN_PASSWORD_LENGTH = 12;
const MAX_PASSWORD_LENGTH = 512;
const MAX_SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;
const LOGIN_FAILURE_THRESHOLD = 5;
const LOGIN_FAILURE_MAX_DELAY_MS = 5 * 60 * 1000;

export interface PasswordGateConfig {
  mode: "disabled" | "required";
  passwordHash: string | null;
  sessionSecret: string | null;
  sessionTtlSeconds: number;
}

interface LoginBody {
  password: string;
}

interface FailureState {
  count: number;
  blockedUntil: number;
  lastFailureAt: number;
}

interface ParsedHash {
  salt: Buffer;
  expected: Buffer;
}

function optionalRaw(value: string | undefined): string | null {
  if (value === undefined) return null;
  const normalized = value.trim();
  return normalized.length === 0 ? null : normalized;
}

function parseTtl(value: string | undefined): number {
  if (value === undefined || value.trim() === "") return DEFAULT_SESSION_TTL_SECONDS;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 300 || parsed > MAX_SESSION_TTL_SECONDS) {
    throw new Error(
      `DOCOMATOR_SESSION_TTL_SECONDS must be an integer in range 300..${MAX_SESSION_TTL_SECONDS}`
    );
  }
  return parsed;
}

function parsePasswordHash(encoded: string): ParsedHash {
  const parts = encoded.split(":");
  if (parts.length !== 6 || parts[0] !== HASH_PREFIX) {
    throw new Error("DOCOMATOR_ACCESS_PASSWORD_HASH has unsupported format");
  }
  const n = Number.parseInt(parts[1] ?? "", 10);
  const r = Number.parseInt(parts[2] ?? "", 10);
  const p = Number.parseInt(parts[3] ?? "", 10);
  if (n !== SCRYPT_N || r !== SCRYPT_R || p !== SCRYPT_P) {
    throw new Error("DOCOMATOR_ACCESS_PASSWORD_HASH has unsupported scrypt parameters");
  }
  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(parts[4] ?? "", "base64url");
    expected = Buffer.from(parts[5] ?? "", "base64url");
  } catch {
    throw new Error("DOCOMATOR_ACCESS_PASSWORD_HASH is not valid base64url");
  }
  if (salt.length !== 16 || expected.length !== PASSWORD_KEY_BYTES) {
    throw new Error("DOCOMATOR_ACCESS_PASSWORD_HASH has invalid salt or digest length");
  }
  return { salt, expected };
}

function passwordLength(password: string): number {
  return [...password].length;
}

export function hashAccessPassword(password: string): string {
  const length = passwordLength(password);
  if (length < MIN_PASSWORD_LENGTH || length > MAX_PASSWORD_LENGTH) {
    throw new Error(`Пароль должен содержать от ${MIN_PASSWORD_LENGTH} до ${MAX_PASSWORD_LENGTH} символов.`);
  }
  const salt = randomBytes(16);
  const digest = scryptSync(password, salt, PASSWORD_KEY_BYTES, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: 64 * 1024 * 1024
  });
  return [
    HASH_PREFIX,
    String(SCRYPT_N),
    String(SCRYPT_R),
    String(SCRYPT_P),
    salt.toString("base64url"),
    digest.toString("base64url")
  ].join(":");
}

export function verifyAccessPassword(password: string, encoded: string): boolean {
  if (passwordLength(password) > MAX_PASSWORD_LENGTH) return false;
  const parsed = parsePasswordHash(encoded);
  const actual = scryptSync(password, parsed.salt, parsed.expected.length, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: 64 * 1024 * 1024
  });
  return timingSafeEqual(actual, parsed.expected);
}

export function loadPasswordGateConfig(
  env: NodeJS.ProcessEnv = process.env
): PasswordGateConfig {
  const declared =
    env.DOCOMATOR_ACCESS_PASSWORD_HASH !== undefined ||
    env.DOCOMATOR_SESSION_SECRET !== undefined;
  if (!declared) {
    return {
      mode: "disabled",
      passwordHash: null,
      sessionSecret: null,
      sessionTtlSeconds: parseTtl(env.DOCOMATOR_SESSION_TTL_SECONDS)
    };
  }

  const passwordHash = optionalRaw(env.DOCOMATOR_ACCESS_PASSWORD_HASH);
  const sessionSecret = optionalRaw(env.DOCOMATOR_SESSION_SECRET);
  if (passwordHash !== null) parsePasswordHash(passwordHash);
  if (
    sessionSecret !== null &&
    Buffer.byteLength(sessionSecret, "utf8") < SESSION_SECRET_MIN_LENGTH
  ) {
    throw new Error(
      `DOCOMATOR_SESSION_SECRET must contain at least ${SESSION_SECRET_MIN_LENGTH} bytes`
    );
  }
  if (passwordHash !== null && sessionSecret === null) {
    throw new Error("DOCOMATOR_SESSION_SECRET is required when the access password is configured");
  }
  return {
    mode: "required",
    passwordHash,
    sessionSecret,
    sessionTtlSeconds: parseTtl(env.DOCOMATOR_SESSION_TTL_SECONDS)
  };
}

function parseCookies(header: string | undefined): Map<string, string> {
  const result = new Map<string, string>();
  if (!header) return result;
  for (const segment of header.split(";")) {
    const separator = segment.indexOf("=");
    if (separator <= 0) continue;
    const key = segment.slice(0, separator).trim();
    const value = segment.slice(separator + 1).trim();
    if (key.length > 0) result.set(key, value);
  }
  return result;
}

function sessionSignature(secret: string, unsigned: string): Buffer {
  return createHmac("sha256", secret).update(unsigned).digest();
}

function createSessionToken(secret: string, ttlSeconds: number): string {
  const expiresAt = Math.floor(Date.now() / 1000) + ttlSeconds;
  const nonce = randomBytes(18).toString("base64url");
  const unsigned = `v1.${expiresAt}.${nonce}`;
  return `${unsigned}.${sessionSignature(secret, unsigned).toString("base64url")}`;
}

function verifySessionToken(
  token: string | undefined,
  secret: string | null
): { valid: boolean; expiresAt: number | null } {
  if (!token || !secret) return { valid: false, expiresAt: null };
  const parts = token.split(".");
  if (parts.length !== 4 || parts[0] !== "v1") {
    return { valid: false, expiresAt: null };
  }
  const expiresAt = Number.parseInt(parts[1] ?? "", 10);
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= Math.floor(Date.now() / 1000)) {
    return { valid: false, expiresAt: null };
  }
  const unsigned = parts.slice(0, 3).join(".");
  const expected = sessionSignature(secret, unsigned);
  let actual: Buffer;
  try {
    actual = Buffer.from(parts[3] ?? "", "base64url");
  } catch {
    return { valid: false, expiresAt: null };
  }
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    return { valid: false, expiresAt: null };
  }
  return { valid: true, expiresAt };
}

function sessionFromRequest(
  request: FastifyRequest,
  config: PasswordGateConfig
): { valid: boolean; expiresAt: number | null } {
  if (config.mode === "disabled") {
    return { valid: true, expiresAt: null };
  }
  const cookie = parseCookies(request.headers.cookie).get(COOKIE_NAME);
  return verifySessionToken(cookie, config.sessionSecret);
}

function requestUsesHttps(request: FastifyRequest): boolean {
  if (request.protocol === "https") return true;
  const forwarded = request.headers["x-forwarded-proto"];
  const first = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  return first?.split(",", 1)[0]?.trim().toLowerCase() === "https";
}

function sessionCookie(
  request: FastifyRequest,
  value: string,
  maxAge: number
): string {
  return [
    `${COOKIE_NAME}=${value}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    requestUsesHttps(request) ? "Secure" : null,
    `Max-Age=${maxAge}`
  ]
    .filter((part): part is string => part !== null)
    .join("; ");
}

function publicPath(url: string): boolean {
  const pathname = url.split("?", 1)[0] ?? url;
  return new Set([
    "/healthz",
    "/readyz",
    "/login",
    "/auth.js",
    "/favicon.svg",
    "/api/v1/auth/status",
    "/api/v1/auth/login",
    "/api/v1/auth/logout"
  ]).has(pathname);
}

function apiError(
  request: FastifyRequest,
  reply: FastifyReply,
  statusCode: number,
  code: string,
  message: string
) {
  return reply.code(statusCode).header("cache-control", "no-store").send({
    error: { code, message },
    correlationId: correlationId(request)
  });
}

function loginHtml(configured: boolean): string {
  const setup = configured
    ? "Введите общий пароль приложения «Оформлятор»."
    : "Пароль ещё не настроен. На сервере выполните scripts/offline/set-password.sh, затем обновите эту страницу.";
  return `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><meta name="theme-color" content="#f3f1eb" media="(prefers-color-scheme: light)"><meta name="theme-color" content="#151817" media="(prefers-color-scheme: dark)"><title>Вход — Оформлятор</title><style>
:root{font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans","Liberation Sans","DejaVu Sans",sans-serif;color-scheme:light dark;--bg:#f3f1eb;--surface:#fffefa;--surface-2:#eeece5;--text:#20262b;--muted:#59636b;--border:rgba(32,38,43,.18);--border-strong:rgba(32,38,43,.30);--accent:#176b78;--accent-strong:#105763;--danger:#a33b3f;--focus:rgba(23,107,120,.32)}*{box-sizing:border-box}body{margin:0;min-height:100dvh;display:grid;place-items:center;padding:24px;background:var(--bg);color:var(--text)}.card{width:min(420px,100%);background:var(--surface);border:1px solid var(--border);border-left:4px solid var(--accent);border-radius:14px;padding:28px;box-shadow:0 8px 24px rgba(32,38,43,.07)}h1{margin:0 0 8px;font-size:28px;line-height:1.15;letter-spacing:-.02em}p{margin:0 0 22px;color:var(--muted);line-height:1.5}label{display:block;font-weight:650;margin-bottom:8px}input{width:100%;min-height:46px;padding:10px 12px;border:1px solid var(--border-strong);border-radius:7px;background:var(--surface);color:var(--text);font:inherit}button{width:100%;min-height:46px;margin-top:14px;border:1px solid var(--accent);border-radius:7px;background:var(--accent);color:#fff;font:inherit;font-weight:700;cursor:pointer}button:hover{background:var(--accent-strong);border-color:var(--accent-strong)}input:focus-visible,button:focus-visible{outline:3px solid var(--accent-strong);outline-offset:2px}button:disabled{opacity:.55;cursor:default}.error{margin-top:14px;color:var(--danger);font-size:14px;line-height:1.45}.brand{margin-bottom:18px;color:var(--muted);font-size:13px;font-weight:650}@media(prefers-color-scheme:dark){:root{--bg:#151817;--surface:#1e2220;--surface-2:#272c29;--text:#f3f2ed;--muted:#bdc4bf;--border:rgba(243,242,237,.14);--border-strong:rgba(243,242,237,.28);--accent:#1f7184;--accent-strong:#286174;--danger:#ef8a8e;--focus:rgba(121,198,209,.34)}.card{box-shadow:0 10px 28px rgba(0,0,0,.25)}}</style><script src="/auth.js" defer></script></head>
<body><main class="card"><div class="brand">Оформлятор · локальный контур</div><h1>Вход</h1><p>${setup}</p><form id="loginForm"${configured ? "" : " hidden"}><label for="password">Пароль</label><input id="password" name="password" type="password" autocomplete="current-password" required autofocus><button id="loginButton" type="submit">Войти</button><div class="error" id="loginError" role="alert" hidden></div></form></main></body></html>`;
}

const authScript = `(() => {\n  const form = document.querySelector("#loginForm");\n  if (!form) return;\n  const password = document.querySelector("#password");\n  const button = document.querySelector("#loginButton");\n  const error = document.querySelector("#loginError");\n  form.addEventListener("submit", async (event) => {\n    event.preventDefault();\n    error.hidden = true;\n    button.disabled = true;\n    try {\n      const response = await fetch("/api/v1/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: password.value }) });\n      const body = await response.json().catch(() => ({}));\n      if (!response.ok) throw new Error(body?.error?.message || "Не удалось войти.");\n      const next = new URLSearchParams(location.search).get("next") || "/";\n      location.replace(next.startsWith("/") && !next.startsWith("//") ? next : "/");\n    } catch (cause) {\n      error.textContent = cause instanceof Error ? cause.message : "Не удалось войти.";\n      error.hidden = false;\n      password.select();\n    } finally { button.disabled = false; }\n  });\n})();\n`;

function loginDelayMs(count: number): number {
  if (count < LOGIN_FAILURE_THRESHOLD) return 0;
  const exponent = Math.min(8, count - LOGIN_FAILURE_THRESHOLD);
  return Math.min(LOGIN_FAILURE_MAX_DELAY_MS, 1_000 * 2 ** exponent);
}

function sessionConfigured(config: PasswordGateConfig): boolean {
  return config.passwordHash !== null && config.sessionSecret !== null;
}

function sameOriginMutation(request: FastifyRequest): boolean {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return true;
  const origin = request.headers.origin;
  if (origin === undefined) return true;
  try {
    const parsed = new URL(origin);
    return parsed.host === request.headers.host;
  } catch {
    return false;
  }
}

export function installPasswordGate(
  app: FastifyInstance,
  config: PasswordGateConfig
): void {
  const failures = new Map<string, FailureState>();

  app.addHook("onRequest", async (request, reply) => {
    if (config.mode === "disabled" || publicPath(request.url)) return;
    if (!sameOriginMutation(request)) {
      return apiError(
        request,
        reply,
        403,
        "cross_origin_request_rejected",
        "Запрос с другого сайта отклонён. Откройте «Оформлятор» напрямую."
      );
    }
    if (sessionFromRequest(request, config).valid) return;
    if (request.url.startsWith("/api/")) {
      return apiError(
        request,
        reply,
        401,
        "authentication_required",
        "Сессия входа отсутствует или истекла. Войдите в «Оформлятор» снова."
      );
    }
    const next = request.url.startsWith("/") && !request.url.startsWith("//")
      ? request.url
      : "/";
    return reply.redirect(`/login?next=${encodeURIComponent(next)}`);
  });

  app.get("/login", async (_request, reply) =>
    reply
      .header("cache-control", "no-store")
      .header(
        "content-security-policy",
        "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'"
      )
      .header("referrer-policy", "no-referrer")
      .type("text/html; charset=utf-8")
      .send(loginHtml(sessionConfigured(config)))
  );

  app.get("/auth.js", async (_request, reply) =>
    reply
      .header("cache-control", "no-store")
      .header("x-content-type-options", "nosniff")
      .type("text/javascript; charset=utf-8")
      .send(authScript)
  );

  app.get("/api/v1/auth/status", async (request, reply) => {
    reply.header("cache-control", "no-store");
    const session = sessionFromRequest(request, config);
    return {
      data: {
        enabled: config.mode === "required",
        configured: config.mode === "disabled" || sessionConfigured(config),
        authenticated: session.valid,
        expiresAt:
          session.expiresAt === null
            ? null
            : new Date(session.expiresAt * 1000).toISOString()
      },
      correlationId: correlationId(request)
    };
  });

  app.post<{ Body: LoginBody }>(
    "/api/v1/auth/login",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["password"],
          properties: {
            password: { type: "string", minLength: 1, maxLength: MAX_PASSWORD_LENGTH }
          }
        }
      }
    },
    async (request, reply) => {
      reply.header("cache-control", "no-store");
      if (config.mode === "disabled") {
        return { data: { authenticated: true }, correlationId: correlationId(request) };
      }
      if (!sessionConfigured(config)) {
        return apiError(
          request,
          reply,
          503,
          "password_not_configured",
          "Пароль «Оформлятора» ещё не настроен на сервере."
        );
      }
      const key = request.ip;
      const now = Date.now();
      const existing = failures.get(key);
      if (existing !== undefined && existing.blockedUntil > now) {
        const retrySeconds = Math.max(1, Math.ceil((existing.blockedUntil - now) / 1000));
        reply.header("retry-after", String(retrySeconds));
        return apiError(
          request,
          reply,
          429,
          "login_temporarily_blocked",
          `Слишком много неверных попыток. Повторите через ${retrySeconds} сек.`
        );
      }

      const valid = verifyAccessPassword(request.body.password, config.passwordHash!);
      if (!valid) {
        const count = (existing?.count ?? 0) + 1;
        const delay = loginDelayMs(count);
        failures.set(key, {
          count,
          blockedUntil: now + delay,
          lastFailureAt: now
        });
        return apiError(
          request,
          reply,
          401,
          "invalid_password",
          "Неверный пароль. Проверьте ввод и попробуйте ещё раз."
        );
      }

      failures.delete(key);
      const token = createSessionToken(config.sessionSecret!, config.sessionTtlSeconds);
      reply.header(
        "set-cookie",
        sessionCookie(request, token, config.sessionTtlSeconds)
      );
      return {
        data: { authenticated: true },
        correlationId: correlationId(request)
      };
    }
  );

  app.post("/api/v1/auth/logout", async (request, reply) => {
    reply
      .header("cache-control", "no-store")
      .header("set-cookie", sessionCookie(request, "", 0));
    return {
      data: { authenticated: false },
      correlationId: correlationId(request)
    };
  });
}
