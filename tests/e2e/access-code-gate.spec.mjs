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
const accessCode = "0427";

function accessCodeHash(value) {
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
      throw new Error(`API с кодом доступа завершился с кодом ${child.exitCode}`);
    }
    try {
      const response = await fetch(`${origin}/readyz`);
      if (response.ok) return;
    } catch {
      // Server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("API с кодом доступа не стал готов за 15 секунд");
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

test("4-значный PIN закрывает и открывает рабочую область без старого окна", async ({ page }) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "docomator-access-code-e2e-"));
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const env = {
    ...process.env,
    DOCOMATOR_DATA_DIR: dataDir,
    DOCOMATOR_HOST: "127.0.0.1",
    DOCOMATOR_PORT: String(port),
    DOCOMATOR_ACCESS_CODE_HASH: accessCodeHash(accessCode),
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

    const locked = await page.request.get(`${origin}/api/v1/spaces`);
    expect(locked.status()).toBe(401);
    expect(locked.headers()["www-authenticate"]).toBeUndefined();

    // Старые закладки больше не приводят на прежний login/password экран.
    await page.goto(`${origin}/login?next=%2F`);
    await expect(page).toHaveURL(`${origin}/access?next=%2F`);
    await expect(page.getByRole("heading", { name: "Введите код доступа" })).toBeVisible();
    await expect(page.locator("#accessCode")).toBeFocused();
    await expect(page.locator('input[name="username"]')).toHaveCount(0);
    await expect(page.locator('input[type="password"]')).toHaveCount(0);
    await expect(page.locator('[data-access-digit="1"]')).toBeVisible();
    await expect(page.locator("[data-access-backspace]")).toBeVisible();

    for (let index = 0; index < 4; index += 1) {
      await page.locator('[data-access-digit="9"]').click();
    }
    await expect(page.locator("#codeProgress")).toHaveText("Введено 4 из 4");
    await page.getByRole("button", { name: "Открыть Оформлятор" }).click();
    await expect(page.locator("#accessError")).toContainText("Код не подошёл");
    await expect(page.locator("#accessError")).toContainText("Данные не изменены");
    await expect(page.locator("#accessCode")).toHaveValue("");

    for (const digit of accessCode) {
      await page.locator(`[data-access-digit="${digit}"]`).click();
    }
    await page.getByRole("button", { name: "Открыть Оформлятор" }).click();
    await expect(page).toHaveURL(`${origin}/#overview`);
    await expect(page.locator("#main-content")).toBeVisible();

    const unlocked = await page.request.get(`${origin}/api/v1/spaces`);
    expect(unlocked.status()).toBe(200);

    // Открытая сессия не должна снова показывать PIN-экран.
    await page.goto(`${origin}/access?next=%2F`);
    await expect(page).toHaveURL(`${origin}/#overview`);
    await expect(page.getByRole("heading", { name: "Введите код доступа" })).toHaveCount(0);

    const settingsNavigation = page.locator('[data-view-target="settings"]:visible').first();
    await settingsNavigation.click();
    await expect(page.locator("#settings-heading")).toBeVisible();
    const lock = page.locator('[data-access-lock][data-access-location="settings"]');
    await expect(lock).toBeVisible();
    await lock.click();
    await expect(page).toHaveURL(`${origin}/access`);
    expect((await page.request.get(`${origin}/api/v1/spaces`)).status()).toBe(401);
  } catch (error) {
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}\nAccess API output:\n${output.join("").slice(-12_000)}`
    );
  } finally {
    await stop(api);
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("первый запуск задаёт PIN в браузере и остаётся удобным на 320 px", async ({ page }) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "docomator-first-access-code-e2e-"));
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const env = {
    ...process.env,
    DOCOMATOR_DATA_DIR: dataDir,
    DOCOMATOR_HOST: "127.0.0.1",
    DOCOMATOR_PORT: String(port),
    DOCOMATOR_ACCESS_CODE_HASH: "",
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
    await page.setViewportSize({ width: 320, height: 720 });
    await page.goto(`${origin}/`);
    await expect(page.getByText("Первый запуск", { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Придумайте код доступа" })).toBeVisible();
    await expect(page.locator("#accessCode")).toBeFocused();
    await expect(page.locator("#confirmation")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Сохранить и открыть" })).toBeDisabled();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
    ).toBe(true);

    for (const digit of "2468") {
      await page.locator(`[data-access-digit="${digit}"]`).click();
    }
    await expect(page.locator("#codeProgress")).toHaveText("Введено 4 из 4");
    await expect(page.getByRole("button", { name: "Сохранить и открыть" })).toBeEnabled();
    await page.getByRole("button", { name: "Сохранить и открыть" }).click();
    await expect(page).toHaveURL(`${origin}/#overview`);
    const status = await page.request.get(`${origin}/api/v1/access/status`);
    expect(status.status()).toBe(200);
    expect((await status.json()).data).toMatchObject({ configured: true, unlocked: true });

    await page.context().clearCookies();
    await page.goto(`${origin}/`);
    await expect(page.getByRole("heading", { name: "Введите код доступа" })).toBeVisible();
    // Физическая клавиатура/вставка остаются полноценной альтернативой экранной клавиатуре.
    await page.locator("#accessCode").fill("2468");
    await page.getByRole("button", { name: "Открыть Оформлятор" }).click();
    await expect(page).toHaveURL(`${origin}/#overview`);
  } catch (error) {
    throw new Error(`${error instanceof Error ? error.message : String(error)}\nFirst-run API output:\n${output.join("").slice(-12_000)}`);
  } finally {
    await stop(api);
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});
