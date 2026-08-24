import assert from "node:assert/strict";
import test from "node:test";

import Fastify from "fastify";

import {
  hashAccessCode,
  installAccessCodeGate,
  loadAccessCodeGateConfig,
  type AccessCodeCredentialStore,
  verifyAccessCode
} from "./access-code-gate.js";

test("код доступа хранится как scrypt-хэш и допускает только четыре цифры", () => {
  const encoded = hashAccessCode("0427");
  assert.match(encoded, /^scrypt-v1:16384:8:1:/u);
  assert.equal(encoded.includes("0427"), false);
  assert.equal(verifyAccessCode("0427", encoded), true);
  assert.equal(verifyAccessCode("0428", encoded), false);
  assert.equal(verifyAccessCode("427", encoded), false);
  assert.throws(() => hashAccessCode("123"), /4 цифр/u);
  assert.throws(() => hashAccessCode("12345"), /4 цифр/u);
  assert.throws(() => hashAccessCode("12a4"), /4 цифр/u);
});

test("новый env-ключ канонический, legacy-ключ читается только для upgrade", () => {
  assert.equal(loadAccessCodeGateConfig({}).mode, "disabled");

  const required = loadAccessCodeGateConfig({
    DOCOMATOR_ACCESS_CODE_HASH: "",
    DOCOMATOR_SESSION_SECRET: ""
  });
  assert.equal(required.mode, "required");
  assert.equal(required.credentialHash, null);
  assert.equal(required.sessionSecret, null);

  const legacyHash = hashAccessCode("0123");
  const legacy = loadAccessCodeGateConfig({
    DOCOMATOR_ACCESS_PASSWORD_HASH: legacyHash,
    DOCOMATOR_SESSION_SECRET: "s".repeat(64)
  });
  assert.equal(legacy.credentialHash, legacyHash);

  assert.throws(
    () =>
      loadAccessCodeGateConfig({
        DOCOMATOR_ACCESS_CODE_HASH: hashAccessCode("0123"),
        DOCOMATOR_ACCESS_PASSWORD_HASH: hashAccessCode("9876"),
        DOCOMATOR_SESSION_SECRET: "s".repeat(64)
      }),
    /не совпадает/u
  );
});

test("общий код закрывает рабочие API без HTTP Basic Auth и старого окна", async () => {
  const app = Fastify({ logger: false });
  app.get("/api/v1/private", async () => ({ data: "secret" }));
  app.get("/private-page", async (_request, reply) =>
    reply.type("text/html").send("private")
  );

  const code = "0427";
  installAccessCodeGate(app, {
    mode: "required",
    credentialHash: hashAccessCode(code),
    sessionSecret: "a".repeat(64),
    sessionTtlSeconds: 3600
  });

  const deniedApi = await app.inject({ method: "GET", url: "/api/v1/private" });
  assert.equal(deniedApi.statusCode, 401);
  assert.equal(deniedApi.json().error.code, "access_code_required");
  assert.equal(deniedApi.headers["www-authenticate"], undefined);

  const deniedPage = await app.inject({ method: "GET", url: "/private-page" });
  assert.equal(deniedPage.statusCode, 302);
  assert.match(String(deniedPage.headers.location), /^\/access\?next=/u);

  const legacyPage = await app.inject({
    method: "GET",
    url: "/login?next=%2Fprivate-page"
  });
  assert.equal(legacyPage.statusCode, 302);
  assert.equal(legacyPage.headers.location, "/access?next=%2Fprivate-page");

  const legacyLoop = await app.inject({
    method: "GET",
    url: "/login?next=%2Flogin"
  });
  assert.equal(legacyLoop.statusCode, 302);
  assert.equal(legacyLoop.headers.location, "/access?next=%2F");

  const accessPage = await app.inject({ method: "GET", url: "/access" });
  assert.equal(accessPage.statusCode, 200);
  assert.match(accessPage.body, /Введите код доступа/u);
  assert.match(accessPage.body, /inputmode="numeric"/u);
  assert.match(accessPage.body, /name="code"/u);
  assert.match(accessPage.body, /data-access-digit="1"/u);
  assert.match(accessPage.body, /data-access-backspace/u);
  assert.match(accessPage.body, /Введите 4 цифры/u);
  assert.doesNotMatch(accessPage.body, /name="username"/u);
  assert.doesNotMatch(accessPage.body, /type="password"/u);
  assert.doesNotMatch(accessPage.body, />Пароль</u);
  assert.match(accessPage.body, /reset-access-code\.sh/u);

  const invalid = await app.inject({
    method: "POST",
    url: "/api/v1/access/unlock",
    payload: { code: "9999" }
  });
  assert.equal(invalid.statusCode, 401);
  assert.equal(invalid.json().error.code, "invalid_access_code");
  assert.match(invalid.json().error.message, /Данные не изменены/u);

  const unlocked = await app.inject({
    method: "POST",
    url: "/api/v1/access/unlock",
    headers: { "x-forwarded-proto": "https" },
    payload: { code }
  });
  assert.equal(unlocked.statusCode, 200);
  const setCookie = String(unlocked.headers["set-cookie"] ?? "");
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

  const redundantAccess = await app.inject({
    method: "GET",
    url: "/access?next=%2Fprivate-page",
    headers: { cookie }
  });
  assert.equal(redundantAccess.statusCode, 302);
  assert.equal(redundantAccess.headers.location, "/private-page");

  const status = await app.inject({
    method: "GET",
    url: "/api/v1/access/status",
    headers: { cookie }
  });
  assert.equal(status.statusCode, 200);
  assert.equal(status.json().data.unlocked, true);

  const lock = await app.inject({
    method: "POST",
    url: "/api/v1/access/lock",
    headers: { cookie }
  });
  assert.equal(lock.statusCode, 200);
  assert.match(String(lock.headers["set-cookie"]), /Max-Age=0/u);

  await app.close();
});

test("gate отклоняет cross-origin mutation и ограничивает перебор кода", async () => {
  const app = Fastify({ logger: false });
  app.post("/api/v1/change", async () => ({ ok: true }));
  const code = "1357";
  installAccessCodeGate(app, {
    mode: "required",
    credentialHash: hashAccessCode(code),
    sessionSecret: "b".repeat(64),
    sessionTtlSeconds: 3600
  });

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/access/unlock",
      remoteAddress: "192.0.2.10",
      payload: { code: String(9000 + attempt) }
    });
    assert.equal(response.statusCode, 401);
  }
  const blocked = await app.inject({
    method: "POST",
    url: "/api/v1/access/unlock",
    remoteAddress: "192.0.2.10",
    payload: { code }
  });
  assert.equal(blocked.statusCode, 429);
  assert.ok(Number(blocked.headers["retry-after"]) >= 1);
  assert.match(blocked.json().error.message, /Данные не изменены/u);

  const unlock = await app.inject({
    method: "POST",
    url: "/api/v1/access/unlock",
    remoteAddress: "192.0.2.11",
    payload: { code }
  });
  const cookie = String(unlock.headers["set-cookie"]).split(";", 1)[0] ?? "";
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

test("первый запуск один раз задаёт четыре цифры и сразу открывает рабочую область", async () => {
  let storedHash: string | null = null;
  const credentials: AccessCodeCredentialStore = {
    readCredentialHash: () => storedHash,
    configureCredentialHash: (credentialHash) => {
      if (storedHash !== null) return false;
      storedHash = credentialHash;
      return true;
    }
  };
  const config = loadAccessCodeGateConfig({
    DOCOMATOR_ACCESS_CODE_HASH: "",
    DOCOMATOR_SESSION_SECRET: "s".repeat(64)
  });
  const app = Fastify({ logger: false });
  app.get("/api/v1/private", async () => ({ data: "secret" }));
  installAccessCodeGate(app, config, credentials);

  const page = await app.inject({ method: "GET", url: "/access" });
  assert.equal(page.statusCode, 200);
  assert.match(page.body, /Первый запуск/u);
  assert.match(page.body, /Придумайте код доступа/u);
  assert.match(page.body, /Сохранить и открыть/u);
  assert.match(page.body, /Цифровая клавиатура/u);
  assert.doesNotMatch(page.body, /confirmation/u);

  const setup = await app.inject({
    method: "POST",
    url: "/api/v1/access/setup",
    headers: { host: "docomator.local", origin: "http://docomator.local" },
    payload: { code: "2468" }
  });
  assert.equal(setup.statusCode, 200);
  assert.ok(storedHash !== null);
  assert.equal(verifyAccessCode("2468", storedHash), true);
  const cookie = String(setup.headers["set-cookie"] ?? "").split(";", 1)[0] ?? "";
  const allowed = await app.inject({ method: "GET", url: "/api/v1/private", headers: { cookie } });
  assert.equal(allowed.statusCode, 200);

  const second = await app.inject({
    method: "POST",
    url: "/api/v1/access/setup",
    payload: { code: "8642" }
  });
  assert.equal(second.statusCode, 409);
  assert.equal(second.json().error.code, "access_code_already_configured");
  assert.match(second.json().error.message, /Ничего не изменено/u);
  await app.close();

  const restartedConfig = loadAccessCodeGateConfig({
    DOCOMATOR_ACCESS_CODE_HASH: "",
    DOCOMATOR_SESSION_SECRET: "s".repeat(64)
  });
  const restarted = Fastify({ logger: false });
  installAccessCodeGate(restarted, restartedConfig, credentials);
  const unlock = await restarted.inject({
    method: "POST",
    url: "/api/v1/access/unlock",
    payload: { code: "2468" }
  });
  assert.equal(unlock.statusCode, 200);
  await restarted.close();
});

test("первичная настройка кода отклоняет cross-origin запрос", async () => {
  let storedHash: string | null = null;
  const credentials: AccessCodeCredentialStore = {
    readCredentialHash: () => storedHash,
    configureCredentialHash: (credentialHash) => {
      if (storedHash !== null) return false;
      storedHash = credentialHash;
      return true;
    }
  };
  const app = Fastify({ logger: false });
  installAccessCodeGate(
    app,
    {
      mode: "required",
      credentialHash: null,
      sessionSecret: "z".repeat(64),
      sessionTtlSeconds: 3600
    },
    credentials
  );
  const rejected = await app.inject({
    method: "POST",
    url: "/api/v1/access/setup",
    headers: { host: "docomator.local", origin: "https://evil.example" },
    payload: { code: "1234" }
  });
  assert.equal(rejected.statusCode, 403);
  assert.equal(storedHash, null);
  await app.close();
});
