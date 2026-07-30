import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const modulePath = fileURLToPath(import.meta.url);
const moduleDirectory = path.dirname(modulePath);
const defaultRepositoryRoot = path.resolve(moduleDirectory, "../..");

const STALE_HELP = [
  "Почему общий документ пока не скачивается?",
  "Запись списка в DOCX/XLSX появится",
  "Сохранение версии шаблона появится",
  "Оно будет привязано к пространству",
  "Система создаст задачу оператору"
];

async function readRequired(root, relativePath, findings) {
  try {
    return await fs.readFile(path.join(root, relativePath), "utf8");
  } catch (error) {
    findings.push(
      `${relativePath}: обязательный файл недоступен: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    return "";
  }
}

export async function collectAuditRemediationFindings(
  repositoryRoot = defaultRepositoryRoot
) {
  const root = path.resolve(repositoryRoot);
  const findings = [];

  const appUi = await readRequired(root, "apps/api/ui/app.js", findings);
  for (const fragment of STALE_HELP) {
    if (appUi.includes(fragment)) {
      findings.push(`apps/api/ui/app.js: устаревшая подсказка: «${fragment}»`);
    }
  }

  const intakeRoutes = await readRequired(
    root,
    "apps/api/src/document-intake-routes.ts",
    findings
  );
  if (intakeRoutes.includes("registerDataImportRoutes")) {
    findings.push(
      "apps/api/src/document-intake-routes.ts: импорт данных скрыто регистрируется внутри document intake"
    );
  }

  const app = await readRequired(root, "apps/api/src/app.ts", findings);
  if (!app.includes('from "./data-import-routes.js"')) {
    findings.push("apps/api/src/app.ts: отсутствует явный импорт маршрутов данных");
  }
  if (!app.includes("registerDataImportRoutes(app, spaceRegistry);")) {
    findings.push("apps/api/src/app.ts: отсутствует явная регистрация импорта данных");
  }

  const intake = await readRequired(
    root,
    "packages/document-intake/src/intake.ts",
    findings
  );
  for (const required of [
    "readVerifiedEntry(",
    "verifiedUncompressedBytes",
    "package_size_mismatch",
    "Суммарный фактически распакованный размер"
  ]) {
    if (!intake.includes(required)) {
      findings.push(
        `packages/document-intake/src/intake.ts: отсутствует защита фактического потока: «${required}»`
      );
    }
  }
  if (intake.includes("validateEntrySizes: true")) {
    findings.push(
      "packages/document-intake/src/intake.ts: проверка всё ещё полагается только на заявленные ZIP-размеры"
    );
  }

  const packageText = await readRequired(root, "package.json", findings);
  try {
    const packageJson = JSON.parse(packageText);
    if (
      packageJson?.scripts?.["check:audit"] !==
      "node scripts/ci/check-audit-remediation.mjs"
    ) {
      findings.push("package.json: отсутствует script check:audit");
    }
    if (!String(packageJson?.scripts?.check ?? "").includes("check:audit")) {
      findings.push("package.json: общий check не запускает check:audit");
    }
    if (typeof packageJson?.scripts?.["test:e2e:real-stack"] !== "string") {
      findings.push("package.json: отсутствует настоящий браузерный сценарий");
    }
  } catch (error) {
    findings.push(
      `package.json: недопустимый JSON: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }

  const workflowGuard = await readRequired(
    root,
    "scripts/ci/check-workflow-permissions.mjs",
    findings
  );
  for (const required of [
    "permissions: write-all",
    "runBlockLines(",
    "actions/checkout@v4",
    "repository_dispatch"
  ]) {
    if (!workflowGuard.includes(required)) {
      findings.push(
        `scripts/ci/check-workflow-permissions.mjs: неполная защита workflow: «${required}»`
      );
    }
  }

  const playwright = await readRequired(
    root,
    "tests/e2e/playwright.config.mjs",
    findings
  );
  if (!playwright.includes("DOCOMATOR_E2E_REAL_STACK")) {
    findings.push("tests/e2e/playwright.config.mjs: нет отдельного real-stack режима");
  }
  if (!playwright.includes("real-stack-document-flow.spec.mjs")) {
    findings.push("tests/e2e/playwright.config.mjs: real-stack файл не изолирован от P5 inventory");
  }

  const realStack = await readRequired(
    root,
    "tests/e2e/real-stack-document-flow.spec.mjs",
    findings
  );
  for (const required of [
    "personal-card.docx",
    "/api/v1/operations/readiness",
    "#generationSubmit",
    "Скачать документ"
  ]) {
    if (!realStack.includes(required)) {
      findings.push(
        `tests/e2e/real-stack-document-flow.spec.mjs: сценарий неполон: «${required}»`
      );
    }
  }
  if (realStack.includes("installDocomatorApiMock")) {
    findings.push(
      "tests/e2e/real-stack-document-flow.spec.mjs: настоящий сценарий не должен подменять API"
    );
  }

  const ci = await readRequired(root, ".github/workflows/ci.yml", findings);
  if (!ci.includes("npm run start:worker")) {
    findings.push(".github/workflows/ci.yml: Chromium-контур не запускает worker");
  }
  if (!ci.includes("npm run test:e2e:real-stack")) {
    findings.push(".github/workflows/ci.yml: настоящий браузерный сценарий не запускается");
  }

  return findings;
}

export async function checkAuditRemediation(repositoryRoot) {
  const findings = await collectAuditRemediationFindings(repositoryRoot);
  if (findings.length > 0) {
    throw new Error(
      `Проверка устранения замечаний аудита не пройдена:\n- ${findings.join("\n- ")}`
    );
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === modulePath) {
  checkAuditRemediation().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
