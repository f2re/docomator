import assert from "node:assert/strict";
import test from "node:test";

import Fastify from "fastify";

import {
  hashAccessPassword,
  installPasswordGate,
  loadPasswordGateConfig,
  type PasswordCredentialStore,
  verifyAccessPassword
} from "./password-gate.js";

test("пароль хранится как scrypt-хэш и проверяется без открытого значения", () => {
  const password = "Очень-надежный-пароль-2026";
  const encoded = hashAccessPassword(password);
  assert.match(encoded, /^scrypt-v1:16384:8:1:/u);
  assert.equal(encoded.includes(password), false);
  assert.equal(verifyAccessPassword(password, encoded), true);
  assert.equal(verifyAccessPassword("неверный-пароль", encoded), false);
});

test("отсутствующие переменные оставляют source/test режим без gate, а пустые объявленные требуют настройки", () => {
  assert.equal(loadPasswordGateConfig({}).mode, "disabled");
  const required = loadPasswordGateConfig({
    DOCOMATOR_ACCESS_PASSWORD_HASH: "",
    DOCOMATOR_SESSION_SECRET: ""
  });
  assert.equal(required.mode, "required");
  assert.equal(required.passwordHash, null);
  assert.equal(required.sessionSecret, null);
});

test("общий password gate защищает уже зарегистрированные API-маршруты", async () => {
  const app = Fastify({ logger: false });
  app.get("/api/v1/private", async () => ({ data: "secret" }));
  app.get("/private-page", async (_request, reply) =>
    reply.type("text/html").send("private")
  );

  const password = "Надежный-общий-пароль-2026";
  installPasswordGate(app, {
    mode: "required",
    passwordHash: hashAccessPassword(password),
    sessionSecret: "a".repeat(64),
    sessionTtlSeconds: 3600
  });

  const deniedApi = await app.inject({ method: "GET", url: "/api/v1/private" });
  assert.equal(deniedApi.statusCode, 401);
  assert.equal(deniedApi.json().error.code, "authentication_required");

  const deniedPage = await app.inject({ method: "GET", url: "/private-page" });
  assert.equal(deniedPage.statusCode, 302);
  assert.match(String(deniedPage.headers.location), /^\/login\?next=/u);

  const invalid = await app.inject({
    method: "POST",
    url: "/api/v1/auth/login",
    payload: { password: "неверный-пароль" }
  });
  assert.equal(invalid.statusCode, 401);
  assert.equal(invalid.json().error.code, "invalid_password");

  const loggedIn = await app.inject({
    method: "POST",
    url: "/api/v1/auth/login",
    headers: { "x-forwarded-proto": "https" },
    payload: { password }
  });
  assert.equal(loggedIn.statusCode, 200);
  const setCookie = String(loggedIn.headers["set-cookie"] ?? "");
  assert.match(setCookie, /docomator_session=/u);
  assert.match(setCookie, /HttpOnly/u);
  assert.match(setCookie, /SameSite=Strict/u);
  assert.match(setCookie, /Secure/u);
  const cookie = setCookie.split(";", 1)[0] ?? "";

  const allowed = await app.inject({
    method: "GET",
    url: "/api/v1/private",
    headers: { cookie }
  });
  assert.equal(allowed.statusCode, 200);
  assert.equal(allowed.json().data, "secret");

  const status = await app.inject({
    method: "GET",
    url: "/api/v1/auth/status",
    headers: { cookie }
  });
  assert.equal(status.statusCode, 200);
  assert.equal(status.json().data.authenticated, true);

  const logout = await app.inject({
    method: "POST",
    url: "/api/v1/auth/logout",
    headers: { cookie }
  });
  assert.equal(logout.statusCode, 200);
  assert.match(String(logout.headers["set-cookie"]), /Max-Age=0/u);

  await app.close();
});

test("gate отклоняет cross-origin mutation и временно блокирует перебор", async () => {
  const app = Fastify({ logger: false });
  app.post("/api/v1/change", async () => ({ ok: true }));
  const password = "Еще-один-надежный-пароль-2026";
  installPasswordGate(app, {
    mode: "required",
    passwordHash: hashAccessPassword(password),
    sessionSecret: "b".repeat(64),
    sessionTtlSeconds: 3600
  });

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      remoteAddress: "192.0.2.10",
      payload: { password: `ошибка-${attempt}` }
    });
    assert.equal(response.statusCode, 401);
  }
  const blocked = await app.inject({
    method: "POST",
    url: "/api/v1/auth/login",
    remoteAddress: "192.0.2.10",
    payload: { password }
  });
  assert.equal(blocked.statusCode, 429);
  assert.ok(Number(blocked.headers["retry-after"]) >= 1);

  const login = await app.inject({
    method: "POST",
    url: "/api/v1/auth/login",
    remoteAddress: "192.0.2.11",
    payload: { password }
  });
  const cookie = String(login.headers["set-cookie"]).split(";", 1)[0] ?? "";
  const rejected = await app.inject({
    method: "POST",
    url: "/api/v1/change",
    headers: {
      cookie,
      host: "docomator.local",
      origin: "https://evil.example"
    }
  });
  assert.equal(rejected.statusCode, 403);
  assert.equal(rejected.json().error.code, "cross_origin_request_rejected");
  await app.close();
});


test("первый запуск позволяет один раз создать общий пароль из браузера и сразу войти", async () => {
  let storedHash: string | null = null;
  const credentials: PasswordCredentialStore = {
    readPasswordHash: () => storedHash,
    configurePasswordHash: (passwordHash) => {
      if (storedHash !== null) return false;
      storedHash = passwordHash;
      return true;
    }
  };
  const config = loadPasswordGateConfig({
    DOCOMATOR_ACCESS_PASSWORD_HASH: "",
    DOCOMATOR_SESSION_SECRET: "s".repeat(64)
  });
  const app = Fastify({ logger: false });
  app.get("/api/v1/private", async () => ({ data: "secret" }));
  installPasswordGate(app, config, credentials);

  const page = await app.inject({ method: "GET", url: "/login" });
  assert.equal(page.statusCode, 200);
  assert.match(page.body, /Первый запуск/u);
  assert.match(page.body, /Сохранить пароль и продолжить/u);
  assert.doesNotMatch(page.body, /set-password\.sh/u);

  const mismatch = await app.inject({
    method: "POST",
    url: "/api/v1/auth/setup",
    headers: { host: "docomator.local", origin: "http://docomator.local" },
    payload: { password: "Надежный-пароль-2026", confirmation: "другой-пароль-2026" }
  });
  assert.equal(mismatch.statusCode, 400);
  assert.equal(mismatch.json().error.code, "password_confirmation_mismatch");
  assert.equal(storedHash, null);

  const setup = await app.inject({
    method: "POST",
    url: "/api/v1/auth/setup",
    headers: { host: "docomator.local", origin: "http://docomator.local" },
    payload: { password: "Надежный-пароль-2026", confirmation: "Надежный-пароль-2026" }
  });
  assert.equal(setup.statusCode, 200);
  assert.ok(storedHash !== null);
  assert.equal(verifyAccessPassword("Надежный-пароль-2026", storedHash), true);
  const cookie = String(setup.headers["set-cookie"] ?? "").split(";", 1)[0] ?? "";
  const allowed = await app.inject({ method: "GET", url: "/api/v1/private", headers: { cookie } });
  assert.equal(allowed.statusCode, 200);

  const second = await app.inject({
    method: "POST",
    url: "/api/v1/auth/setup",
    payload: { password: "Второй-надежный-пароль", confirmation: "Второй-надежный-пароль" }
  });
  assert.equal(second.statusCode, 409);
  assert.equal(second.json().error.code, "password_already_configured");
  await app.close();

  const restartedConfig = loadPasswordGateConfig({
    DOCOMATOR_ACCESS_PASSWORD_HASH: "",
    DOCOMATOR_SESSION_SECRET: "s".repeat(64)
  });
  const restarted = Fastify({ logger: false });
  installPasswordGate(restarted, restartedConfig, credentials);
  const loginPage = await restarted.inject({ method: "GET", url: "/login" });
  assert.match(loginPage.body, /<h1>Вход<\/h1>/u);
  const login = await restarted.inject({
    method: "POST",
    url: "/api/v1/auth/login",
    payload: { password: "Надежный-пароль-2026" }
  });
  assert.equal(login.statusCode, 200);
  await restarted.close();
});

test("первичная настройка пароля отклоняет cross-origin запрос", async () => {
  let storedHash: string | null = null;
  const credentials: PasswordCredentialStore = {
    readPasswordHash: () => storedHash,
    configurePasswordHash: (passwordHash) => {
      if (storedHash !== null) return false;
      storedHash = passwordHash;
      return true;
    }
  };
  const app = Fastify({ logger: false });
  installPasswordGate(app, {
    mode: "required",
    passwordHash: null,
    sessionSecret: "z".repeat(64),
    sessionTtlSeconds: 3600
  }, credentials);
  const rejected = await app.inject({
    method: "POST",
    url: "/api/v1/auth/setup",
    headers: { host: "docomator.local", origin: "https://evil.example" },
    payload: { password: "Надежный-пароль-2026", confirmation: "Надежный-пароль-2026" }
  });
  assert.equal(rejected.statusCode, 403);
  assert.equal(storedHash, null);
  await app.close();
});
