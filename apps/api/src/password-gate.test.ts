import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";

import {
  hashAccessCode,
  installPasswordGate,
  loadPasswordGateConfig,
  type PasswordCredentialStore,
  verifyAccessCode
} from "./password-gate.js";

test("код доступа хранится как scrypt-хэш и проверяется без открытого значения", () => {
  const encoded = hashAccessCode("4821");
  assert.match(encoded, /^scrypt-v1:16384:8:1:/u);
  assert.equal(encoded.includes("4821"), false);
  assert.equal(verifyAccessCode("4821", encoded), true);
  assert.equal(verifyAccessCode("4822", encoded), false);
});

test("gate читает новый и legacy hash, но не допускает расходящиеся значения", () => {
  assert.equal(loadPasswordGateConfig({}).mode, "disabled");
  const legacyHash = hashAccessCode("7314");
  assert.equal(
    loadPasswordGateConfig({
      DOCOMATOR_ACCESS_PASSWORD_HASH: legacyHash,
      DOCOMATOR_SESSION_SECRET: "s".repeat(64)
    }).passwordHash,
    legacyHash
  );
  assert.throws(
    () =>
      loadPasswordGateConfig({
        DOCOMATOR_ACCESS_CODE_HASH: hashAccessCode("1111"),
        DOCOMATOR_ACCESS_PASSWORD_HASH: hashAccessCode("2222"),
        DOCOMATOR_SESSION_SECRET: "s".repeat(64)
      }),
    /не совпадают/u
  );
});

test("экран требует только 4 цифры, не использует Basic Auth и показывает рабочий сброс", async () => {
  const app = Fastify({ logger: false });
  app.get("/api/v1/private", async () => ({ data: "secret" }));
  app.get("/private-page", async (_request, reply) => reply.type("text/html").send("private"));
  installPasswordGate(app, {
    mode: "required",
    passwordHash: hashAccessCode("4821"),
    sessionSecret: "a".repeat(64),
    sessionTtlSeconds: 3600
  });

  const deniedApi = await app.inject({ method: "GET", url: "/api/v1/private" });
  assert.equal(deniedApi.statusCode, 401);
  assert.equal(deniedApi.json().error.code, "authentication_required");
  assert.equal(deniedApi.headers["www-authenticate"], undefined);

  const deniedPage = await app.inject({ method: "GET", url: "/private-page" });
  assert.equal(deniedPage.statusCode, 302);
  assert.match(String(deniedPage.headers.location), /^\/login\?next=/u);

  const page = await app.inject({ method: "GET", url: "/login" });
  assert.match(page.body, /<h1>Код доступа<\/h1>/u);
  assert.match(page.body, /name="code"/u);
  assert.match(page.body, /inputmode="numeric"/u);
  assert.match(page.body, /pattern="\[0-9\]\{4\}"/u);
  assert.match(page.body, /Логин не нужен/u);
  assert.match(page.body, /Не помню код/u);
  assert.match(page.body, /first-run\.sh --reset-code/u);
  assert.doesNotMatch(page.body, /name="username"/u);
  assert.doesNotMatch(page.body, /type="password"/u);
  assert.doesNotMatch(page.body, />Пароль</u);

  const wrong = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { code: "4822" } });
  assert.equal(wrong.statusCode, 401);
  assert.equal(wrong.json().error.code, "invalid_access_code");

  const login = await app.inject({
    method: "POST",
    url: "/api/v1/auth/login",
    headers: { "x-forwarded-proto": "https" },
    payload: { code: "4821" }
  });
  assert.equal(login.statusCode, 200);
  assert.equal(login.json().data.accessMode, "code");
  const setCookie = String(login.headers["set-cookie"] ?? "");
  assert.match(setCookie, /HttpOnly/u);
  assert.match(setCookie, /SameSite=Strict/u);
  assert.match(setCookie, /Secure/u);
  const cookie = setCookie.split(";", 1)[0] ?? "";
  assert.equal((await app.inject({ method: "GET", url: "/api/v1/private", headers: { cookie } })).statusCode, 200);

  const logout = await app.inject({ method: "POST", url: "/api/v1/auth/logout", headers: { cookie } });
  assert.match(String(logout.headers["set-cookie"]), /Max-Age=0/u);
  await app.close();
});

test("перебор кода блокируется, cross-origin mutation отклоняется", async () => {
  const app = Fastify({ logger: false });
  app.post("/api/v1/change", async () => ({ ok: true }));
  installPasswordGate(app, {
    mode: "required",
    passwordHash: hashAccessCode("7314"),
    sessionSecret: "b".repeat(64),
    sessionTtlSeconds: 3600
  });
  for (const code of ["0000", "0001", "0002", "0003", "0004"]) {
    assert.equal(
      (await app.inject({ method: "POST", url: "/api/v1/auth/login", remoteAddress: "192.0.2.10", payload: { code } })).statusCode,
      401
    );
  }
  const blocked = await app.inject({ method: "POST", url: "/api/v1/auth/login", remoteAddress: "192.0.2.10", payload: { code: "7314" } });
  assert.equal(blocked.statusCode, 429);
  assert.ok(Number(blocked.headers["retry-after"]) >= 1);

  const login = await app.inject({ method: "POST", url: "/api/v1/auth/login", remoteAddress: "192.0.2.11", payload: { code: "7314" } });
  const cookie = String(login.headers["set-cookie"]).split(";", 1)[0] ?? "";
  const rejected = await app.inject({
    method: "POST",
    url: "/api/v1/change",
    headers: { cookie, host: "docomator.local", origin: "https://evil.example" }
  });
  assert.equal(rejected.statusCode, 403);
  assert.equal(rejected.json().error.code, "cross_origin_request_rejected");
  await app.close();
});

test("первый запуск один раз задаёт код без подтверждения и сохраняет его в существующем credential store", async () => {
  let storedHash: string | null = null;
  const credentials: PasswordCredentialStore = {
    readPasswordHash: () => storedHash,
    configurePasswordHash: (hash) => {
      if (storedHash !== null) return false;
      storedHash = hash;
      return true;
    }
  };
  const config = loadPasswordGateConfig({
    DOCOMATOR_ACCESS_CODE_HASH: "",
    DOCOMATOR_SESSION_SECRET: "s".repeat(64)
  });
  const app = Fastify({ logger: false });
  installPasswordGate(app, config, credentials);

  const page = await app.inject({ method: "GET", url: "/login" });
  assert.match(page.body, /Первый запуск/u);
  assert.match(page.body, /Сохранить код/u);
  assert.doesNotMatch(page.body, /confirmation/u);

  const setup = await app.inject({ method: "POST", url: "/api/v1/auth/setup", payload: { code: "7314" } });
  assert.equal(setup.statusCode, 200);
  assert.ok(storedHash !== null);
  assert.equal(verifyAccessCode("7314", storedHash), true);
  const second = await app.inject({ method: "POST", url: "/api/v1/auth/setup", payload: { code: "1111" } });
  assert.equal(second.statusCode, 409);
  await app.close();
});
