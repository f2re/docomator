import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { constants } from "node:fs";
import {
  access,
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
  unlink,
  writeFile
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../.."
);
const VERIFY = path.join(ROOT, "scripts/offline/verify-bundle.sh");
const INSTALL = path.join(ROOT, "scripts/offline/install.sh");
const UPDATE = path.join(ROOT, "scripts/offline/update.sh");
const EXAMPLE_FILES = [
  "README.md",
  "manifest.sha256",
  "data/employees.csv",
  "expected/personal-card-filled.docx",
  "expected/team-register-filled.xlsx",
  "templates/personal-card.docx",
  "templates/team-register.xlsx"
];

async function executable(name) {
  for (const directory of (process.env.PATH ?? "").split(path.delimiter)) {
    const candidate = path.join(directory, name);
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Ищем следующий каталог PATH.
    }
  }
  return null;
}

const testTools = await mkdtemp(path.join(os.tmpdir(), "docomator-test-tools-"));
await writeFile(
  path.join(testTools, "stat"),
  `#!/usr/bin/env bash
set -Eeuo pipefail
format="\${2:-}"
target="\${4:-}"
if [[ "$format" == "%u:%g" ]]; then
  if [[ -n "\${FAKE_BAD_OWNER:-}" && "$target" == "$FAKE_BAD_OWNER" ]]; then
    printf '1000:1000\\n'
  else
    printf '0:0\\n'
  fi
elif [[ "$format" == "%a" ]]; then
  if [[ -n "\${FAKE_BAD_MODE:-}" && "$target" == "$FAKE_BAD_MODE" ]]; then
    printf '777\\n'
  elif [[ "$target" == "/tmp" || "$target" == "/private/tmp" ]]; then
    printf '1777\\n'
  else
    printf '755\\n'
  fi
else
  exit 2
fi
`
);
await chmod(path.join(testTools, "stat"), 0o755);
const sha256sum = await executable("sha256sum");
if (sha256sum === null) {
  const compatible = await executable("gsha256sum");
  assert.ok(compatible, "Для offline-теста требуется sha256sum или gsha256sum.");
  await symlink(compatible, path.join(testTools, "sha256sum"));
}
const TEST_PATH = `${testTools}${path.delimiter}${process.env.PATH ?? ""}`;

after(async () => {
  await rm(testTools, { recursive: true, force: true });
});

async function files(directory, prefix = "") {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = path.posix.join(prefix, entry.name);
    if (entry.isDirectory()) {
      result.push(...(await files(path.join(directory, entry.name), relative)));
    } else if (entry.isFile()) {
      result.push(relative);
    }
  }
  return result.sort((left, right) => left.localeCompare(right, "en"));
}

async function writeOuterManifest(bundle) {
  const lines = [];
  for (const relative of await files(bundle)) {
    if (relative === "manifest.sha256") continue;
    const content = await readFile(path.join(bundle, relative));
    lines.push(
      `${createHash("sha256").update(content).digest("hex")}  ./${relative}`
    );
  }
  await writeFile(path.join(bundle, "manifest.sha256"), `${lines.join("\n")}\n`);
}

async function fixture() {
  const bundle = await mkdtemp(path.join(os.tmpdir(), "docomator-bundle-verify-"));
  const required = [
    "payload/app/scripts/runtime/automatic-backup.mjs",
    "payload/app/scripts/runtime/pilot-readiness.mjs",
    "payload/app/scripts/runtime/pilot-check.sh",
    "payload/runtime/node/bin/node",
    "payload/deploy/systemd/docomator-backup.service.in",
    "payload/deploy/systemd/docomator-backup.timer.in"
  ];
  for (const relative of required) {
    const target = path.join(bundle, relative);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, `${relative}\n`);
  }
  await chmod(path.join(bundle, "payload/runtime/node/bin/node"), 0o755);
  for (const relative of EXAMPLE_FILES) {
    const target = path.join(bundle, "payload/app/examples", relative);
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(path.join(ROOT, "examples", relative), target);
  }
  await Promise.all([
    writeFile(path.join(bundle, "VERSION"), "0.1.0-test\n"),
    writeFile(path.join(bundle, "manifest.symlinks"), "")
  ]);
  await writeOuterManifest(bundle);
  return bundle;
}

function runBash(arguments_, extraEnvironment = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn("bash", arguments_, {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, PATH: TEST_PATH, ...extraEnvironment }
    });
    let output = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      output += chunk;
    });
    child.stderr.on("data", (chunk) => {
      output += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, output }));
  });
}

function verify(bundle, extraEnvironment = {}) {
  return runBash([VERIFY, bundle], extraEnvironment);
}

function verifyTrust(bundle, extraEnvironment = {}) {
  return runBash(
    [
      "-c",
      'source "$1"; require_trusted_bundle "$2"',
      "docomator-trust-test",
      path.join(ROOT, "scripts/offline/lib.sh"),
      bundle
    ],
    extraEnvironment
  );
}

test("offline verifier accepts the exact bundle inventory", async () => {
  const bundle = await fixture();
  try {
    const result = await verify(bundle);
    assert.equal(result.code, 0, result.output);
    assert.match(result.output, /комплект корректен/iu);
  } finally {
    await rm(bundle, { recursive: true, force: true });
  }
});

test("offline verifier rejects an unlisted extra file", async () => {
  const bundle = await fixture();
  try {
    await writeFile(path.join(bundle, "payload/app/unlisted.txt"), "extra\n");
    const result = await verify(bundle);
    assert.equal(result.code, 1);
    assert.match(result.output, /состав обычных файлов/iu);
  } finally {
    await rm(bundle, { recursive: true, force: true });
  }
});

test("offline verifier rejects changed example bytes and nested manifest", async () => {
  for (const relative of [
    "data/employees.csv",
    "manifest.sha256"
  ]) {
    const bundle = await fixture();
    try {
      await writeFile(
        path.join(bundle, "payload/app/examples", relative),
        "изменено\n"
      );
      const result = await verify(bundle);
      assert.equal(result.code, 1);
      assert.match(result.output, /контрольн|FAILED|не совпадает/iu);
    } finally {
      await rm(bundle, { recursive: true, force: true });
    }
  }
});

test("offline verifier rejects absolute and parent paths in the nested manifest", async () => {
  for (const injectedPath of ["/etc/passwd", "../../../../etc/passwd"]) {
    const bundle = await fixture();
    try {
      await writeFile(
        path.join(bundle, "payload/app/examples/manifest.sha256"),
        `${"0".repeat(64)}  ${injectedPath}\n`
      );
      await writeOuterManifest(bundle);
      const result = await verify(bundle);
      assert.equal(result.code, 1);
      assert.match(result.output, /пути в manifest/iu);
      assert.doesNotMatch(result.output, /контрольные суммы учебных/iu);
    } finally {
      await rm(bundle, { recursive: true, force: true });
    }
  }
});

test("offline verifier ignores an inherited TMPDIR", async () => {
  const bundle = await fixture();
  const attackerDirectory = await mkdtemp(
    path.join(os.tmpdir(), "docomator-attacker-tmp-")
  );
  try {
    const result = await verify(bundle, { TMPDIR: attackerDirectory });
    assert.equal(result.code, 0, result.output);
    assert.deepEqual(await readdir(attackerDirectory), []);
  } finally {
    await rm(bundle, { recursive: true, force: true });
    await rm(attackerDirectory, { recursive: true, force: true });
  }
});

test("offline verifier rejects a symlink escaping the bundle", async () => {
  const bundle = await fixture();
  try {
    await symlink(
      "../../../../../../etc/passwd",
      path.join(bundle, "payload/runtime/node/bin/unsafe")
    );
    const result = await verify(bundle);
    assert.equal(result.code, 1);
    assert.match(result.output, /ссылк.*предел|недействительн.*ссылк/iu);
  } finally {
    await rm(bundle, { recursive: true, force: true });
  }
});

test("offline verifier rejects a changed internal symlink target", async () => {
  const bundle = await fixture();
  try {
    const link = path.join(bundle, "payload/runtime/node/bin/npm");
    await symlink("node", link);
    await writeFile(
      path.join(bundle, "manifest.symlinks"),
      "payload/runtime/node/bin/npm\tnode\n"
    );
    await writeOuterManifest(bundle);
    const valid = await verify(bundle);
    assert.equal(valid.code, 0, valid.output);

    await symlink("node", path.join(bundle, "payload/runtime/node/bin/npx"));
    const added = await verify(bundle);
    assert.equal(added.code, 1);
    assert.match(added.output, /состав или цели символических ссылок/iu);
    await unlink(path.join(bundle, "payload/runtime/node/bin/npx"));

    await unlink(link);
    await symlink("../../../app/scripts/runtime/pilot-check.sh", link);
    const changed = await verify(bundle);
    assert.equal(changed.code, 1);
    assert.match(changed.output, /состав или цели символических ссылок/iu);
  } finally {
    await rm(bundle, { recursive: true, force: true });
  }
});

test("offline verifier rejects a symlink inside examples", async () => {
  const bundle = await fixture();
  try {
    await symlink(
      "README.md",
      path.join(bundle, "payload/app/examples/example-link")
    );
    const result = await verify(bundle);
    assert.equal(result.code, 1);
    assert.match(result.output, /ссыл/iu);
  } finally {
    await rm(bundle, { recursive: true, force: true });
  }
});

test("install and update verify the bundle before target mutations", async () => {
  const installSource = await readFile(INSTALL, "utf8");
  const installTrust = installSource.indexOf(
    'require_trusted_bundle "$SCRIPT_DIR"'
  );
  const installVerification = installSource.indexOf(
    '"$BUNDLE_ROOT/verify-bundle.sh" "$BUNDLE_ROOT"'
  );
  const installMutation = installSource.indexOf(
    'INSTALL_ROOT="$(mkdir -p "$INSTALL_ROOT"'
  );
  assert.ok(installTrust >= 0);
  assert.ok(installVerification > installTrust);
  assert.ok(installMutation >= 0);
  assert.ok(installVerification < installMutation);

  const updateSource = await readFile(UPDATE, "utf8");
  const updateTrust = updateSource.indexOf(
    'require_trusted_bundle "$SCRIPT_DIR"'
  );
  const updateVerification = updateSource.indexOf(
    '"$BUNDLE_ROOT/verify-bundle.sh" "$BUNDLE_ROOT"'
  );
  const updateMutation = updateSource.indexOf(
    'mkdir -p "$(dirname "$LOCK_FILE")"'
  );
  assert.ok(updateTrust >= 0);
  assert.ok(updateVerification > updateTrust);
  assert.ok(updateMutation >= 0);
  assert.ok(updateVerification < updateMutation);
});

test("trusted bundle guard rejects unsafe ownership, modes and ancestors", async () => {
  const createdParent = await mkdtemp(
    path.join(os.tmpdir(), "docomator-trust-parent-")
  );
  const parent = await realpath(createdParent);
  const bundle = path.join(parent, "bundle");
  const entry = path.join(bundle, "payload", "file.txt");
  await mkdir(path.dirname(entry), { recursive: true });
  await writeFile(entry, "trusted\n");
  try {
    const accepted = await verifyTrust(bundle);
    assert.equal(accepted.code, 0, accepted.output);

    const badOwner = await verifyTrust(bundle, { FAKE_BAD_OWNER: entry });
    assert.equal(badOwner.code, 1);
    assert.match(badOwner.output, /принадлежать root:root/iu);

    const badMode = await verifyTrust(bundle, { FAKE_BAD_MODE: entry });
    assert.equal(badMode.code, 1);
    assert.match(badMode.output, /записи группе или остальным/iu);

    const badAncestor = await verifyTrust(bundle, { FAKE_BAD_MODE: parent });
    assert.equal(badAncestor.code, 1);
    assert.match(badAncestor.output, /доступен для подмены/iu);
  } finally {
    await rm(createdParent, { recursive: true, force: true });
  }
});
