import { expect, test } from "@playwright/test";
import { randomBytes, scryptSync } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(testDirectory, "../..");
const password = "Общий-пароль-Docomator-2026";

function passwordHash(value) {
  const salt = randomBytes(16);
  const digest = scryptSync(value, salt, 32, {
    N: 16_384,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024
  });
  return [
    "scrypt-v1",
    "16384",
    "8",
    "1",
    salt.toString("base64url"),
    digest.toString("base64url")
  ].join(":");
}

async function freePort() {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Не удалось получить свободный порт"));
        return;
      }
      const port = address.port;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

async function waitUntilReady(origin, child) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Auth-enabled API завершился с кодом ${child.exitCode}`);
    }
    try {
      const response = await fetch(`${origin}/readyz`);
      if (response.ok) return;
    } catch {
      // Server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Auth-enabled API не стал готов за 15 секунд");
}

async function stop(child) {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 5_000))
  ]);
  if (child.exitCode === null) child.kill("SIGKILL");
}

test("общий пароль закрывает приложение, открывает сессию и выход снова закрывает доступ", async ({ page }) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "docomator-password-e2e-"));
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const env = {
    ...process.env,
    DOCOMATOR_DATA_DIR: dataDir,
    DOCOMATOR_HOST: "127.0.0.1",
    DOCOMATOR_PORT: String(port),
    DOCOMATOR_ACCESS_PASSWORD_HASH: passwordHash(password),
    DOCOMATOR_SESSION_SECRET: randomBytes(48).toString("base64url"),
    DOCOMATOR_SESSION_TTL_SECONDS: "3600",
    DOCOMATOR_PREVIEW_ENABLED: "false"
  };

  const migrate = spawnSync(process.execPath, ["scripts/runtime/migrate.mjs"], {
    cwd: repositoryRoot,
    env,
    encoding: "utf8"
  });
  expect(migrate.status, migrate.stderr || migrate.stdout).toBe(0);

  const api = spawn(process.execPath, ["apps/api/dist/server.js"], {
    cwd: repositoryRoot,
    env,
    stdio: ["ignore", "pipe", "pipe"]
  });
  const output = [];
  api.stdout.on("data", (chunk) => output.push(chunk.toString("utf8")));
  api.stderr.on("data", (chunk) => output.push(chunk.toString("utf8")));

  try {
    await waitUntilReady(origin, api);

    const unauthenticated = await page.request.get(`${origin}/api/v1/spaces`);
    expect(unauthenticated.status()).toBe(401);

    await page.goto(`${origin}/`);
    await expect(page).toHaveURL(new RegExp(`^${origin.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}/login\\?next=`));
    await expect(page.getByRole("heading", { name: "Вход" })).toBeVisible();
    await expect(page.locator("#password")).toBeFocused();

    await page.locator("#password").fill("неверный-пароль");
    await page.getByRole("button", { name: "Войти" }).click();
    await expect(page.locator("#loginError")).toContainText("Неверный пароль");

    await page.locator("#password").fill(password);
    await page.getByRole("button", { name: "Войти" }).click();
    await expect(page).toHaveURL(`${origin}/#overview`);
    await expect(page.locator("#main-content")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Главная", level: 1 })).toBeVisible();

    const authenticated = await page.request.get(`${origin}/api/v1/spaces`);
    expect(authenticated.status()).toBe(200);

    const settingsNavigation = page.locator('[data-view-target="settings"]:visible').first();
    await expect(settingsNavigation).toBeVisible();
    await settingsNavigation.click();
    await expect(page.locator("#settings-heading")).toBeVisible();
    const logout = page.locator('[data-auth-logout][data-auth-location="settings"]');
    await expect(logout).toBeVisible();

    await logout.click();
    await expect(page).toHaveURL(`${origin}/login`);
    const deniedAgain = await page.request.get(`${origin}/api/v1/spaces`);
    expect(deniedAgain.status()).toBe(401);
  } catch (error) {
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}\nAuth API output:\n${output.join("").slice(-12_000)}`
    );
  } finally {
    await stop(api);
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});
