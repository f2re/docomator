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

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "docomator-audit-check-"));
  await write(root, "apps/api/ui/app.js", "Новая подсказка без устаревших обещаний\n");
  await write(root, "apps/api/src/document-intake-routes.ts", "export const route = true;\n");
  await write(root, "apps/api/src/app.ts", 'import { registerDataImportRoutes } from "./data-import-routes.js";\nregisterDataImportRoutes(app, spaceRegistry);\n');
  await write(root, "apps/api/src/access-code-gate.ts", [
    "DOCOMATOR_ACCESS_CODE_HASH",
    "DOCOMATOR_SESSION_SECRET",
    "scryptSync(",
    "timingSafeEqual(",
    "HttpOnly",
    "SameSite=Strict",
    "access_code_temporarily_blocked",
    "/api/v1/access/unlock",
    "/access"
  ].join("\n"));
  await write(root, "config/docomator.env.example", "DOCOMATOR_ACCESS_CODE_HASH=\nDOCOMATOR_SESSION_SECRET=\nDOCOMATOR_SESSION_TTL_SECONDS=28800\n");
  await write(root, "scripts/offline/set-access-code.sh", "^[0-9]{4}$\nscryptSync\nrandomBytes(48)\nDOCOMATOR_ACCESS_CODE_HASH\nDOCOMATOR_SESSION_SECRET\nsystemctl restart docomator-api.service\n");
  await write(root, "packages/document-intake/src/intake.ts", "readVerifiedEntry(\nverifiedUncompressedBytes\npackage_size_mismatch\nСуммарный фактически распакованный размер\n");
  await write(root, "package.json", JSON.stringify({ scripts: { "check:audit": "node scripts/ci/check-audit-remediation.mjs", check: "npm run check:audit", "test:e2e:real-stack": "playwright test" } }));
  await write(root, "scripts/ci/check-workflow-permissions.mjs", "permissions: write-all\nrunBlockLines(\nAPPROVED_CHECKOUT_ACTION\nrepository_dispatch\n");
  await write(root, "tests/e2e/playwright.config.mjs", "DOCOMATOR_E2E_REAL_STACK\nreal-stack-document-flow.spec.mjs\n");
  await write(root, "tests/e2e/real-stack-document-flow.spec.mjs", "personal-card.docx\n/api/v1/operations/readiness\n#generationSubmit\nСкачать документ\n");
  await write(root, ".github/workflows/ci.yml", "npm run start:worker\nnpm run test:e2e:real-stack\n");
  return root;
}

test("проверка принимает полный access-code remediation contract", async () => {
  const root = await fixture();
  try {
    assert.deepEqual(await collectAuditRemediationFindings(root), []);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("проверка ловит возврат password/login модели", async () => {
  const root = await fixture();
  try {
    await write(root, "apps/api/src/access-code-gate.ts", "DOCOMATOR_ACCESS_CODE_HASH\nDOCOMATOR_SESSION_SECRET\nscryptSync(\ntimingSafeEqual(\nHttpOnly\nSameSite=Strict\naccess_code_temporarily_blocked\n/api/v1/access/unlock\n/access\ntype=\"password\"\n");
    const findings = await collectAuditRemediationFindings(root);
    assert.ok(findings.some((item) => item.includes("password")), findings.join("\n"));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("проверка ловит legacy password key в fresh config", async () => {
  const root = await fixture();
  try {
    await write(root, "config/docomator.env.example", "DOCOMATOR_ACCESS_CODE_HASH=\nDOCOMATOR_ACCESS_PASSWORD_HASH=\nDOCOMATOR_SESSION_SECRET=\nDOCOMATOR_SESSION_TTL_SECONDS=28800\n");
    const findings = await collectAuditRemediationFindings(root);
    assert.ok(findings.some((item) => item.includes("legacy password key")), findings.join("\n"));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
