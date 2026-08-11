from pathlib import Path


def replace_once(path: Path, old: str, new: str) -> None:
    text = path.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected one replacement, found {count}: {old[:120]!r}")
    path.write_text(text.replace(old, new, 1), encoding="utf-8")


gate = Path("apps/api/src/password-gate.ts")
replace_once(gate, 'const error = document.querySelector("#authError");', 'const error = document.querySelector("#loginError");')
replace_once(gate, '<div class="error" id="authError" role="alert" hidden></div>', '<div class="error" id="loginError" role="alert" hidden></div>')

prepare = Path("scripts/offline/prepare-bundle.sh")
replace_once(prepare, '  "$SCRIPT_DIR/set-password.sh" \\\n  "$SCRIPT_DIR/set-password.mjs" \\\n', '  "$SCRIPT_DIR/set-password.sh" \\\n')

install = Path("scripts/offline/install.sh")
replace_once(
    install,
    '  if [[ -x "$BUNDLE_ROOT/set-password.sh" && -f "$BUNDLE_ROOT/set-password.mjs" ]]; then\n    cp "$BUNDLE_ROOT/set-password.sh" "$TEMP_RELEASE/set-password.sh"\n    cp "$BUNDLE_ROOT/set-password.mjs" "$TEMP_RELEASE/set-password.mjs"\n    chmod 0755 "$TEMP_RELEASE/set-password.sh" "$TEMP_RELEASE/set-password.mjs"\n  fi\n',
    '  if [[ -x "$BUNDLE_ROOT/set-password.sh" && -f "$BUNDLE_ROOT/lib.sh" ]]; then\n    cp "$BUNDLE_ROOT/set-password.sh" "$TEMP_RELEASE/set-password.sh"\n    cp "$BUNDLE_ROOT/lib.sh" "$TEMP_RELEASE/lib.sh"\n    chmod 0755 "$TEMP_RELEASE/set-password.sh"\n    chmod 0644 "$TEMP_RELEASE/lib.sh"\n  fi\n',
)

offline_test = Path("scripts/offline/password-bootstrap.test.mjs")
text = offline_test.read_text(encoding="utf-8")
text = text.replace('  assert.equal(fs.existsSync(new URL("./set-password.mjs", import.meta.url)), true);\n', '')
text = text.replace('  assert.match(prepare, /set-password\\.mjs/u);\n', '')
text = text.replace('  assert.match(installer, /randomBytes\\(48\\)/u);', '  assert.match(installer, /randomBytes\\(48\\)/u);\n  assert.match(installer, /TEMP_RELEASE\\/set-password\\.sh/u);\n  assert.match(installer, /TEMP_RELEASE\\/lib\\.sh/u);')
offline_test.write_text(text, encoding="utf-8")

replacements = {
    "docs/adr/0009-shared-password-gate.md": [
        (
            "CLI `set-password.sh` является запасным локальным интерфейсом к тому же bootstrap API, а не отдельным способом хранения секрета.",
            "CLI `set-password.sh` остаётся локальным recovery-интерфейсом и способом смены общего пароля: он применяет ту же scrypt-политику, синхронизирует хэш в конфигурации и SQLite и ротирует session secret.",
        )
    ],
    "docs/OFFLINE_DEPLOYMENT.md": [
        (
            "Скрипт не хранит пароль и не редактирует базу самостоятельно: он вызывает тот же локальный bootstrap API.",
            "Скрипт не хранит пароль открытым текстом: он формирует scrypt-хэш, синхронизирует его с SQLite/конфигурацией и ротирует session secret, завершая старые сессии.",
        )
    ],
    "docs/REQUIREMENTS.md": [
        (
            "для headless/recovery установки поставляется локальный `set-password.sh`, использующий тот же bootstrap API.",
            "для headless/recovery установки и последующей смены пароля поставляется локальный `set-password.sh`, использующий ту же scrypt-политику и синхронизирующий состояние пароля.",
        )
    ],
    "docs/RELEASE_NOTES.md": [
        (
            "В offline bundle возвращён реальный `set-password.sh` как headless fallback; он вызывает тот же локальный bootstrap API.",
            "В offline bundle реально включён `set-password.sh`: он остаётся headless/recovery-способом и поддерживает последующую смену пароля с ротацией сессий.",
        )
    ],
}
for relative, pairs in replacements.items():
    path = Path(relative)
    text = path.read_text(encoding="utf-8")
    for old, new in pairs:
        if old in text:
            text = text.replace(old, new, 1)
    path.write_text(text, encoding="utf-8")

e2e = Path("tests/e2e/password-gate.spec.mjs")
text = e2e.read_text(encoding="utf-8")
if "первый запуск создаёт общий пароль прямо в браузере" not in text:
    text += r'''

test("первый запуск создаёт общий пароль прямо в браузере", async ({ page }) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "docomator-first-password-e2e-"));
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const firstPassword = "Первый-общий-пароль-2026";
  const env = {
    ...process.env,
    DOCOMATOR_DATA_DIR: dataDir,
    DOCOMATOR_HOST: "127.0.0.1",
    DOCOMATOR_PORT: String(port),
    DOCOMATOR_ACCESS_PASSWORD_HASH: "",
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
    await page.goto(`${origin}/`);
    await expect(page.getByRole("heading", { name: "Первый запуск" })).toBeVisible();
    await page.locator("#password").fill(firstPassword);
    await page.locator("#confirmation").fill(firstPassword);
    await page.getByRole("button", { name: "Сохранить пароль и продолжить" }).click();
    await expect(page).toHaveURL(`${origin}/#overview`);
    const status = await page.request.get(`${origin}/api/v1/auth/status`);
    expect(status.status()).toBe(200);
    expect((await status.json()).data).toMatchObject({ configured: true, authenticated: true });

    await page.context().clearCookies();
    await page.goto(`${origin}/`);
    await expect(page.getByRole("heading", { name: "Вход" })).toBeVisible();
    await page.locator("#password").fill(firstPassword);
    await page.getByRole("button", { name: "Войти" }).click();
    await expect(page).toHaveURL(`${origin}/#overview`);
  } catch (error) {
    throw new Error(`${error instanceof Error ? error.message : String(error)}\nFirst-run API output:\n${output.join("").slice(-12_000)}`);
  } finally {
    await stop(api);
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});
'''
e2e.write_text(text, encoding="utf-8")

Path("scripts/offline/set-password.mjs").unlink(missing_ok=True)
