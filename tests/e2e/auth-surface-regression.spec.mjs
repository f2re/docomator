import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { randomBytes, scryptSync } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { CANONICAL_UI_STATES } from "./ui-regression-inventory.mjs";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(testDirectory, "../..");
const password = "Общий-пароль-Оформлятор-2026";
const WCAG_TAGS = [
  "wcag2a",
  "wcag2aa",
  "wcag21a",
  "wcag21aa",
  "wcag22aa"
];
const authStates = CANONICAL_UI_STATES.filter((state) => state.mode === "auth");

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

async function injectTextZoom(page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("DOM.enable");
  await cdp.send("CSS.enable");
  const { frameTree } = await cdp.send("Page.getFrameTree");
  const { styleSheetId } = await cdp.send("CSS.createStyleSheet", {
    frameId: frameTree.frame.id
  });
  await cdp.send("CSS.setStyleSheetText", {
    styleSheetId,
    text: "html { font-size: 200% !important; }"
  });
}

async function interactionViolations(page, rootSelector) {
  return page.locator(rootSelector).evaluate((root) =>
    [...root.querySelectorAll("button, input, a")]
      .filter((element) => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return (
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          rect.width > 0 &&
          rect.height > 0
        );
      })
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          element: `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ""}`,
          width: Math.round(rect.width * 10) / 10,
          height: Math.round(rect.height * 10) / 10
        };
      })
      .filter((item) => item.width < 43.5 || item.height < 43.5)
  );
}

for (const state of authStates) {
  test(`auth-поверхность «${state.label}» входит в единую UI regression matrix`, async ({
    page
  }, testInfo) => {
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), `docomator-${state.id}-`));
    const port = await freePort();
    const origin = `http://127.0.0.1:${port}`;
    const env = {
      ...process.env,
      DOCOMATOR_DATA_DIR: dataDir,
      DOCOMATOR_HOST: "127.0.0.1",
      DOCOMATOR_PORT: String(port),
      DOCOMATOR_ACCESS_PASSWORD_HASH: state.configured ? passwordHash(password) : "",
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
      await page.emulateMedia({
        colorScheme: testInfo.project.name === "chromium-1440" ? "dark" : "light",
        reducedMotion: "reduce"
      });
      await page.goto(`${origin}/`);
      await expect(page.getByRole("heading", { name: state.heading })).toBeVisible();
      await expect(page.locator(state.root)).toBeVisible();
      await expect(page.locator(state.focusSelector)).toBeFocused();

      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth - window.innerWidth
        )
      ).toBeLessThanOrEqual(0);

      expect(await interactionViolations(page, state.root)).toEqual([]);

      const axe = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
      expect(
        axe.violations,
        `нарушения WCAG на auth-поверхности «${state.label}»`
      ).toEqual([]);

      const width = page.viewportSize()?.width || 0;
      if (width <= 768) {
        await injectTextZoom(page);
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth - window.innerWidth
          )
        ).toBeLessThanOrEqual(0);
      }

      if (width === 320 || width === 1440) {
        await testInfo.attach(`${state.id}-${width}px.png`, {
          body: await page.screenshot({
            animations: "disabled",
            caret: "hide",
            fullPage: true
          }),
          contentType: "image/png"
        });
      }
    } catch (error) {
      throw new Error(
        `${error instanceof Error ? error.message : String(error)}\nAuth API output:\n${output.join("").slice(-12_000)}`
      );
    } finally {
      await stop(api);
      await fs.rm(dataDir, { recursive: true, force: true });
    }
  });
}
