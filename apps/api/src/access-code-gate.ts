import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { SqliteStore } from "@docomator/storage";
import { correlationId } from "./request-context.js";

const COOKIE_NAME = "docomator_session";
const HASH_PREFIX = "scrypt-v1";
const SCRYPT_N = 16_384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const CREDENTIAL_KEY_BYTES = 32;
const SESSION_SECRET_MIN_LENGTH = 32;
const DEFAULT_SESSION_TTL_SECONDS = 8 * 60 * 60;
const MAX_SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;
const ACCESS_CODE_PATTERN = /^[0-9]{4}$/u;
const FAILURE_THRESHOLD = 5;
const FAILURE_MAX_DELAY_MS = 5 * 60 * 1000;

// Migration 0031 is immutable. Its historical table/column names are therefore
// intentionally hidden behind this adapter rather than renamed in-place.
const LEGACY_CREDENTIAL_TABLE = "shared_access_password";
const LEGACY_CREDENTIAL_COLUMN = "password_hash";

export interface AccessCodeGateConfig {
  mode: "disabled" | "required";
  credentialHash: string | null;
  sessionSecret: string | null;
  sessionTtlSeconds: number;
}

interface AccessCodeBody {
  code: string;
}

export interface AccessCodeCredentialStore {
  readCredentialHash(): string | null;
  configureCredentialHash(credentialHash: string): boolean;
}

interface FailureState {
  count: number;
  blockedUntil: number;
}

interface ParsedHash {
  salt: Buffer;
  expected: Buffer;
}

export function createSqliteAccessCodeCredentialStore(store: SqliteStore): AccessCodeCredentialStore {
  return {
    readCredentialHash() {
      return store.execute((executor) => {
        const row = executor
          .prepare(
            `SELECT ${LEGACY_CREDENTIAL_COLUMN} AS credential_hash FROM ${LEGACY_CREDENTIAL_TABLE} WHERE singleton = 1`
          )
          .get() as { credential_hash?: unknown } | undefined;
        if (row === undefined) return null;
        if (typeof row.credential_hash !== "string" || row.credential_hash.length === 0) {
          throw new Error("Состояние кода доступа повреждено.");
        }
        return row.credential_hash;
      });
    },
    configureCredentialHash(credentialHash) {
      return store.transaction(
        (executor) =>
          Number(
            executor
              .prepare(
                `INSERT OR IGNORE INTO ${LEGACY_CREDENTIAL_TABLE} (singleton, ${LEGACY_CREDENTIAL_COLUMN}, configured_at) VALUES (1, ?, ?)`
              )
              .run(credentialHash, new Date().toISOString()).changes
          ) === 1
      );
    }
  };
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

function parseCredentialHash(encoded: string): ParsedHash {
  const parts = encoded.split(":");
  if (parts.length !== 6 || parts[0] !== HASH_PREFIX) {
    throw new Error("Хэш кода доступа имеет неподдерживаемый формат.");
  }
  const n = Number.parseInt(parts[1] ?? "", 10);
  const r = Number.parseInt(parts[2] ?? "", 10);
  const p = Number.parseInt(parts[3] ?? "", 10);
  if (n !== SCRYPT_N || r !== SCRYPT_R || p !== SCRYPT_P) {
    throw new Error("Хэш кода доступа использует неподдерживаемые параметры scrypt.");
  }
  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(parts[4] ?? "", "base64url");
    expected = Buffer.from(parts[5] ?? "", "base64url");
  } catch {
    throw new Error("Хэш кода доступа повреждён.");
  }
  if (salt.length !== 16 || expected.length !== CREDENTIAL_KEY_BYTES) {
    throw new Error("Хэш кода доступа содержит некорректную соль или производный ключ.");
  }
  return { salt, expected };
}

function validateAccessCode(code: string): void {
  if (!ACCESS_CODE_PATTERN.test(code)) {
    throw new Error("Код доступа должен состоять ровно из 4 цифр.");
  }
}

export function hashAccessCode(code: string): string {
  validateAccessCode(code);
  const salt = randomBytes(16);
  const digest = scryptSync(code, salt, CREDENTIAL_KEY_BYTES, {
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

export function verifyAccessCode(code: string, encoded: string): boolean {
  if (!ACCESS_CODE_PATTERN.test(code)) return false;
  const parsed = parseCredentialHash(encoded);
  const actual = scryptSync(code, parsed.salt, parsed.expected.length, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: 64 * 1024 * 1024
  });
  return timingSafeEqual(actual, parsed.expected);
}

export function loadAccessCodeGateConfig(
  env: NodeJS.ProcessEnv = process.env
): AccessCodeGateConfig {
  const declared =
    env.DOCOMATOR_ACCESS_CODE_HASH !== undefined ||
    env.DOCOMATOR_ACCESS_PASSWORD_HASH !== undefined ||
    env.DOCOMATOR_SESSION_SECRET !== undefined;
  if (!declared) {
    return {
      mode: "disabled",
      credentialHash: null,
      sessionSecret: null,
      sessionTtlSeconds: parseTtl(env.DOCOMATOR_SESSION_TTL_SECONDS)
    };
  }

  const canonicalHash = optionalRaw(env.DOCOMATOR_ACCESS_CODE_HASH);
  const legacyHash = optionalRaw(env.DOCOMATOR_ACCESS_PASSWORD_HASH);
  if (canonicalHash !== null && legacyHash !== null && canonicalHash !== legacyHash) {
    throw new Error(
      "DOCOMATOR_ACCESS_CODE_HASH не совпадает с legacy DOCOMATOR_ACCESS_PASSWORD_HASH. Выполните штатный сброс кода доступа."
    );
  }
  const credentialHash = canonicalHash ?? legacyHash;
  const sessionSecret = optionalRaw(env.DOCOMATOR_SESSION_SECRET);
  if (credentialHash !== null) parseCredentialHash(credentialHash);
  if (
    sessionSecret !== null &&
    Buffer.byteLength(sessionSecret, "utf8") < SESSION_SECRET_MIN_LENGTH
  ) {
    throw new Error(
      `DOCOMATOR_SESSION_SECRET must contain at least ${SESSION_SECRET_MIN_LENGTH} bytes`
    );
  }
  if (credentialHash !== null && sessionSecret === null) {
    throw new Error("DOCOMATOR_SESSION_SECRET обязателен при настроенном коде доступа.");
  }
  return {
    mode: "required",
    credentialHash,
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
    if (key) result.set(key, value);
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
  if (parts.length !== 4 || parts[0] !== "v1") return { valid: false, expiresAt: null };
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

function sessionFromRequest(request: FastifyRequest, config: AccessCodeGateConfig) {
  if (config.mode === "disabled") return { valid: true, expiresAt: null };
  return verifySessionToken(
    parseCookies(request.headers.cookie).get(COOKIE_NAME),
    config.sessionSecret
  );
}

function requestUsesHttps(request: FastifyRequest): boolean {
  if (request.protocol === "https") return true;
  const forwarded = request.headers["x-forwarded-proto"];
  const first = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  return first?.split(",", 1)[0]?.trim().toLowerCase() === "https";
}

function sessionCookie(request: FastifyRequest, value: string, maxAge: number): string {
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
    "/access",
    "/access.js",
    "/favicon.svg",
    "/gost",
    "/gost.js",
    "/gost.css",
    "/api/v1/access/status",
    "/api/v1/access/setup",
    "/api/v1/access/unlock",
    "/api/v1/access/lock",
    "/api/v1/public/document-formatting/profiles",
    "/api/v1/public/document-formatting/analyze",
    "/api/v1/public/document-formatting/format"
  ]).has(pathname);
}

function apiError(
  request: FastifyRequest,
  reply: FastifyReply,
  statusCode: number,
  code: string,
  message: string
) {
  return reply
    .code(statusCode)
    .header("cache-control", "no-store")
    .send({ error: { code, message }, correlationId: correlationId(request) });
}

function accessHtml(configured: boolean): string {
  const lead = configured
    ? "Введите четыре цифры. Имя пользователя не требуется."
    : "Задайте четыре цифры — этого достаточно для защиты рабочей области от случайного доступа.";
  const button = configured ? "Открыть Оформлятор" : "Сохранить код";
  const recovery = configured
    ? `<details class="recovery"><summary>Не помню код</summary><p>На сервере Оформлятора выполните:</p><code>sudo /opt/docomator/current/reset-access-code.sh</code><p>Документы и данные не изменятся. Открытые сессии завершатся.</p></details>`
    : "";
  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>Код доступа — Оформлятор</title>
<style>
:root{font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans","Liberation Sans","DejaVu Sans",sans-serif;color-scheme:light dark;--bg:#f3f1eb;--surface:#fffefa;--text:#20262b;--muted:#59636b;--border:rgba(32,38,43,.18);--border-strong:rgba(32,38,43,.30);--accent:#176b78;--danger:#a33b3f}*{box-sizing:border-box}html,body{max-width:100%;min-width:0}body{margin:0;min-height:100dvh;display:grid;grid-template-columns:minmax(0,1fr);place-items:center;padding:24px;background:var(--bg);color:var(--text)}.card{width:min(420px,100%);min-width:0;max-width:100%;background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:28px;box-shadow:0 8px 24px rgba(32,38,43,.07)}form,input,button,details,code,.public-link{min-width:0;max-width:100%}.brand{margin-bottom:18px;color:var(--muted);font-size:13px;font-weight:650}.eyebrow{margin-bottom:6px;color:var(--muted);font-size:13px;font-weight:650}h1{margin:0 0 8px;font-size:28px;line-height:1.15}p{margin:0 0 18px;color:var(--muted);line-height:1.5}h1,p,label,.error,.hint,.brand,.recovery,code,.public-link{overflow-wrap:anywhere;word-break:normal}label{display:block;font-weight:650;margin:14px 0 8px}.code-input{display:block;width:min(220px,100%);min-height:56px;margin:0 auto;padding:10px 16px;border:1px solid var(--border-strong);border-radius:9px;background:var(--surface);color:var(--text);font:700 28px/1.2 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;letter-spacing:.34em;text-align:center;font-variant-numeric:tabular-nums}.code-input:focus-visible,button:focus-visible,summary:focus-visible,.public-link:focus-visible{outline:3px solid color-mix(in srgb,var(--accent) 35%,transparent);outline-offset:2px}button{width:100%;min-height:46px;margin-top:18px;border:1px solid var(--accent);border-radius:7px;background:var(--accent);color:#fff;font:inherit;font-weight:700;cursor:pointer;white-space:normal}button:disabled{cursor:default;opacity:.6}.error{margin-top:14px;color:var(--danger);font-size:14px}.hint{margin-top:12px;color:var(--muted);font-size:13px;line-height:1.45;text-align:center}.recovery{margin-top:20px;border-top:1px solid var(--border);padding-top:10px;color:var(--muted);font-size:13px;line-height:1.45}.recovery summary{min-height:44px;display:flex;align-items:center;color:var(--text);font-weight:650;cursor:pointer}.recovery p{margin:8px 0}.recovery code{display:block;padding:10px;border:1px solid var(--border);border-radius:7px;background:color-mix(in srgb,var(--surface) 80%,var(--bg));color:var(--text);font-size:12px;user-select:all}.public-link{display:flex;min-height:46px;margin-top:12px;align-items:center;justify-content:center;border:1px solid var(--border-strong);border-radius:7px;color:var(--text);text-decoration:none;font-weight:650;text-align:center}@media(max-width:420px){body{padding:12px}.card{padding:20px 16px}}@media(prefers-color-scheme:dark){:root{--bg:#151817;--surface:#1e2220;--text:#f3f2ed;--muted:#bdc4bf;--border:rgba(243,242,237,.14);--border-strong:rgba(243,242,237,.28);--accent:#1f7184;--danger:#ef8a8e}}@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto!important}}
</style>
<script src="/access.js" defer></script>
</head>
<body>
<main class="card">
<div class="brand">Оформлятор · локальный контур</div>
${configured ? "" : '<div class="eyebrow">Первый запуск</div>'}
<h1>Код доступа</h1>
<p>${lead}</p>
<form id="accessForm" data-mode="${configured ? "unlock" : "setup"}">
<label for="accessCode">Код доступа</label>
<input id="accessCode" name="code" class="code-input" type="text" inputmode="numeric" autocomplete="off" pattern="[0-9]{4}" minlength="4" maxlength="4" aria-describedby="codeHint" required autofocus>
<button id="accessButton" type="submit">${button}</button>
<div class="hint" id="codeHint">Общий код локального контура. Это не учётная запись пользователя.</div>
<div class="error" id="accessError" role="alert" hidden></div>
</form>
<a class="public-link" href="/gost">Оформить DOCX по ГОСТ без открытия рабочей области</a>
${recovery}
</main>
</body>
</html>`;
}

const accessScript = `(() => {
  const form = document.querySelector("#accessForm");
  if (!form) return;
  const code = document.querySelector("#accessCode");
  const button = document.querySelector("#accessButton");
  const error = document.querySelector("#accessError");
  const normalize = () => {
    const next = String(code.value || "").replace(/[^0-9]/gu, "").slice(0, 4);
    if (code.value !== next) code.value = next;
  };
  code.addEventListener("input", normalize);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    normalize();
    error.hidden = true;
    if (!/^[0-9]{4}$/u.test(code.value)) {
      error.textContent = "Введите ровно 4 цифры кода доступа.";
      error.hidden = false;
      code.focus();
      return;
    }
    button.disabled = true;
    try {
      const setup = form.dataset.mode === "setup";
      const endpoint = setup ? "/api/v1/access/setup" : "/api/v1/access/unlock";
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: code.value })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          body?.error?.message ||
            (setup ? "Не удалось сохранить код доступа." : "Не удалось открыть Оформлятор.")
        );
      }
      const next = new URLSearchParams(location.search).get("next") || "/";
      location.replace(next.startsWith("/") && !next.startsWith("//") ? next : "/");
    } catch (cause) {
      error.textContent = cause instanceof Error ? cause.message : "Операция не выполнена.";
      error.hidden = false;
      code.select();
    } finally {
      button.disabled = false;
    }
  });
})();
`;

function accessDelayMs(count: number): number {
  if (count < FAILURE_THRESHOLD) return 0;
  return Math.min(
    FAILURE_MAX_DELAY_MS,
    1_000 * 2 ** Math.min(8, count - FAILURE_THRESHOLD)
  );
}

function gateConfigured(config: AccessCodeGateConfig): boolean {
  return config.credentialHash !== null && config.sessionSecret !== null;
}

function sameOriginMutation(request: FastifyRequest): boolean {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return true;
  const origin = request.headers.origin;
  if (origin === undefined) return true;
  try {
    return new URL(origin).host === request.headers.host;
  } catch {
    return false;
  }
}

export function installAccessCodeGate(
  app: FastifyInstance,
  config: AccessCodeGateConfig,
  credentials?: AccessCodeCredentialStore
): void {
  if (config.mode === "required" && config.credentialHash === null && credentials !== undefined) {
    const storedHash = credentials.readCredentialHash();
    if (storedHash !== null) {
      parseCredentialHash(storedHash);
      config.credentialHash = storedHash;
    }
  }

  const failures = new Map<string, FailureState>();

  app.addHook("onRequest", async (request, reply) => {
    if (config.mode === "disabled") return;
    if (!sameOriginMutation(request)) {
      return apiError(
        request,
        reply,
        403,
        "cross_origin_request_rejected",
        "Запрос с другого сайта отклонён. Откройте «Оформлятор» напрямую."
      );
    }
    if (publicPath(request.url) || sessionFromRequest(request, config).valid) return;
    if (request.url.startsWith("/api/")) {
      return apiError(
        request,
        reply,
        401,
        "access_code_required",
        "Рабочая область закрыта или сессия истекла. Введите код доступа снова."
      );
    }
    const next =
      request.url.startsWith("/") && !request.url.startsWith("//") ? request.url : "/";
    return reply.redirect(`/access?next=${encodeURIComponent(next)}`);
  });

  app.get("/access", async (_request, reply) =>
    reply
      .header("cache-control", "no-store")
      .header(
        "content-security-policy",
        "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'"
      )
      .header("referrer-policy", "no-referrer")
      .type("text/html; charset=utf-8")
      .send(accessHtml(gateConfigured(config)))
  );

  app.get("/access.js", async (_request, reply) =>
    reply
      .header("cache-control", "no-store")
      .header("x-content-type-options", "nosniff")
      .type("text/javascript; charset=utf-8")
      .send(accessScript)
  );

  app.get("/api/v1/access/status", async (request, reply) => {
    reply.header("cache-control", "no-store");
    const session = sessionFromRequest(request, config);
    return {
      data: {
        enabled: config.mode === "required",
        configured: config.mode === "disabled" || gateConfigured(config),
        unlocked: session.valid,
        expiresAt:
          session.expiresAt === null ? null : new Date(session.expiresAt * 1000).toISOString()
      },
      correlationId: correlationId(request)
    };
  });

  app.post<{ Body: AccessCodeBody }>(
    "/api/v1/access/setup",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["code"],
          properties: {
            code: { type: "string", minLength: 4, maxLength: 4, pattern: "^[0-9]{4}$" }
          }
        }
      }
    },
    async (request, reply) => {
      reply.header("cache-control", "no-store");
      if (config.mode !== "required" || gateConfigured(config)) {
        return apiError(
          request,
          reply,
          409,
          "access_code_already_configured",
          "Код доступа уже настроен. Обновите страницу и введите его."
        );
      }
      if (credentials === undefined) {
        return apiError(
          request,
          reply,
          503,
          "access_code_setup_unavailable",
          "Первичная настройка кода доступа недоступна в этом режиме запуска."
        );
      }
      if (config.sessionSecret === null) {
        return apiError(
          request,
          reply,
          503,
          "session_secret_not_configured",
          "Секрет сеансов не создан установщиком. Повторите штатное обновление или установку."
        );
      }
      let credentialHash: string;
      try {
        credentialHash = hashAccessCode(request.body.code);
      } catch (error) {
        return apiError(
          request,
          reply,
          400,
          "invalid_access_code",
          error instanceof Error ? error.message : "Код доступа должен состоять из 4 цифр."
        );
      }
      if (!credentials.configureCredentialHash(credentialHash)) {
        const storedHash = credentials.readCredentialHash();
        if (storedHash !== null) {
          parseCredentialHash(storedHash);
          config.credentialHash = storedHash;
        }
        return apiError(
          request,
          reply,
          409,
          "access_code_already_configured",
          "Код доступа уже был настроен в другом запросе. Обновите страницу и введите его."
        );
      }
      config.credentialHash = credentialHash;
      const token = createSessionToken(config.sessionSecret, config.sessionTtlSeconds);
      reply.header("set-cookie", sessionCookie(request, token, config.sessionTtlSeconds));
      return {
        data: { unlocked: true, configured: true },
        correlationId: correlationId(request)
      };
    }
  );

  app.post<{ Body: AccessCodeBody }>(
    "/api/v1/access/unlock",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["code"],
          properties: {
            code: { type: "string", minLength: 4, maxLength: 4, pattern: "^[0-9]{4}$" }
          }
        }
      }
    },
    async (request, reply) => {
      reply.header("cache-control", "no-store");
      if (config.mode === "disabled") {
        return { data: { unlocked: true }, correlationId: correlationId(request) };
      }
      if (!gateConfigured(config)) {
        return apiError(
          request,
          reply,
          503,
          "access_code_not_configured",
          "Код доступа «Оформлятора» ещё не настроен на сервере."
        );
      }
      const key = request.ip;
      const now = Date.now();
      const existing = failures.get(key);
      if (existing !== undefined && existing.blockedUntil > now) {
        const retrySeconds = Math.max(
          1,
          Math.ceil((existing.blockedUntil - now) / 1000)
        );
        reply.header("retry-after", String(retrySeconds));
        return apiError(
          request,
          reply,
          429,
          "access_code_temporarily_blocked",
          `Слишком много неверных попыток. Повторите через ${retrySeconds} сек.`
        );
      }
      const valid = verifyAccessCode(request.body.code, config.credentialHash!);
      if (!valid) {
        const count = (existing?.count ?? 0) + 1;
        const delay = accessDelayMs(count);
        failures.set(key, { count, blockedUntil: now + delay });
        return apiError(
          request,
          reply,
          401,
          "invalid_access_code",
          "Неверный код доступа. Проверьте 4 цифры и попробуйте ещё раз."
        );
      }
      failures.delete(key);
      const token = createSessionToken(config.sessionSecret!, config.sessionTtlSeconds);
      reply.header("set-cookie", sessionCookie(request, token, config.sessionTtlSeconds));
      return { data: { unlocked: true }, correlationId: correlationId(request) };
    }
  );

  app.post("/api/v1/access/lock", async (request, reply) => {
    reply
      .header("cache-control", "no-store")
      .header("set-cookie", sessionCookie(request, "", 0));
    return { data: { unlocked: false }, correlationId: correlationId(request) };
  });
}
