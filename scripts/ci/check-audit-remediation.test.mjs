import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { collectAuditRemediationFindings } from "./check-audit-remediation.mjs";

async function write(root, relativePath, content) {
  const target = path.join(root, relativePath);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, content, "utf8");
}

async function cleanFixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "docomator-audit-check-"));
  await write(root, "apps/api/ui/app.js", "const help = {};\n");
  await write(
    root,
    "apps/api/src/document-intake-routes.ts",
    "export function registerDocumentIntakeRoutes() {}\n"
  );
  await write(
    root,
    "apps/api/src/app.ts",
    [
      'import { registerDataImportRoutes } from "./data-import-routes.js";',
      "registerDataImportRoutes(app, spaceRegistry);"
    ].join("\n")
  );
  await write(root, "config/docomator.env.example", "DOCOMATOR_HOST=127.0.0.1\n");
  await write(root, "scripts/offline/install.sh", "#!/usr/bin/env bash\nset -Eeuo pipefail\n");
  await write(root, "scripts/offline/lib.sh", "#!/usr/bin/env bash\nset -Eeuo pipefail\n");
  await write(
    root,
    "packages/document-intake/src/intake.ts",
    [
      "validateEntrySizes: false",
      "readVerifiedEntry(",
      "verifiedUncompressedBytes",
      "package_size_mismatch",
      "Суммарный фактически распакованный размер"
    ].join("\n")
  );
  await write(
    root,
    "package.json",
    JSON.stringify(
      {
        scripts: {
          "check:audit": "node scripts/ci/check-audit-remediation.mjs",
          check: "npm run check:audit",
          "test:e2e:real-stack": "echo real"
        }
      },
      null,
      2
    )
  );
  await write(
    root,
    "tests/e2e/playwright.config.mjs",
    'const mode = process.env.DOCOMATOR_E2E_REAL_STACK;\nconst file = "real-stack-document-flow.spec.mjs";\n'
  );
  await write(
    root,
    "scripts/ci/check-workflow-permissions.mjs",
    [
      "permissions: write-all",
      "runBlockLines(",
      "APPROVED_CHECKOUT_ACTION",
      "repository_dispatch"
    ].join("\n")
  );
  await write(
    root,
    "tests/e2e/real-stack-document-flow.spec.mjs",
    [
      "personal-card.docx",
      "/api/v1/operations/readiness",
      "#generationSubmit",
      "Скачать документ"
    ].join("\n")
  );
  await write(
    root,
    ".github/workflows/ci.yml",
    "run: npm run start:worker\nrun: npm run test:e2e:real-stack\n"
  );
  return root;
}

test("полностью исправленное дерево проходит", async (t) => {
  const root = await cleanFixture();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  assert.deepEqual(await collectAuditRemediationFindings(root), []);
});

test("находит устаревшие подсказки и скрытую регистрацию", async (t) => {
  const root = await cleanFixture();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await write(
    root,
    "apps/api/ui/app.js",
    'const help = "Почему общий документ пока не скачивается?";\n'
  );
  await write(
    root,
    "apps/api/src/document-intake-routes.ts",
    "registerDataImportRoutes(app, spaceRegistry);\n"
  );
  const findings = await collectAuditRemediationFindings(root);
  assert.ok(findings.some((finding) => finding.includes("устаревшая подсказка")));
  assert.ok(findings.some((finding) => finding.includes("скрыто регистрируется")));
});

test("не допускает возврат секрета сессии и его генератора", async (t) => {
  const root = await cleanFixture();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await write(
    root,
    "config/docomator.env.example",
    "DOCOMATOR_SESSION_SECRET=CHANGE_ME_DURING_INSTALL\n"
  );
  await write(
    root,
    "scripts/offline/lib.sh",
    "random_secret() { printf secret; }\n"
  );
  const findings = await collectAuditRemediationFindings(root);
  assert.ok(findings.some((finding) => finding.includes("DOCOMATOR_SESSION_SECRET")));
  assert.ok(findings.some((finding) => finding.includes("генератор секрета")));
});

test("находит отсутствие фактического лимита и настоящего браузерного контура", async (t) => {
  const root = await cleanFixture();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await write(
    root,
    "packages/document-intake/src/intake.ts",
    "validateEntrySizes: true\n"
  );
  await write(root, ".github/workflows/ci.yml", "run: npm run start:api\n");
  await write(
    root,
    "tests/e2e/real-stack-document-flow.spec.mjs",
    "installDocomatorApiMock(page);\n"
  );
  await write(
    root,
    "scripts/ci/check-workflow-permissions.mjs",
    "const weak = true;\n"
  );
  const findings = await collectAuditRemediationFindings(root);
  assert.ok(findings.some((finding) => finding.includes("фактического потока")));
  assert.ok(findings.some((finding) => finding.includes("не запускает worker")));
  assert.ok(findings.some((finding) => finding.includes("не запускается")));
  assert.ok(findings.some((finding) => finding.includes("сценарий неполон")));
  assert.ok(findings.some((finding) => finding.includes("не должен подменять API")));
  assert.ok(findings.some((finding) => finding.includes("неполная защита workflow")));
});
