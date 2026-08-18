import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const legacyBrand = "Doco" + "mator";
const expectedBrand = "Оформлятор";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function trackedFiles() {
  return execFileSync("git", ["ls-files", "-z"], { cwd: root })
    .toString("utf8")
    .split("\0")
    .filter(Boolean);
}

async function inspectText(relativePath) {
  const absolutePath = path.join(root, relativePath);
  const buffer = await fs.readFile(absolutePath);
  if (buffer.includes(0)) return null;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    return null;
  }
}

function requireFragment(findings, text, relativePath, fragment) {
  if (!text?.includes(fragment)) findings.push(`${relativePath}: отсутствует ${fragment}`);
}

function forbidFragment(findings, text, relativePath, fragment) {
  if (text?.includes(fragment)) findings.push(`${relativePath}: найден запрещённый фрагмент ${fragment}`);
}

function requireOrderedFragments(findings, text, relativePath, fragments) {
  let cursor = 0;
  for (const fragment of fragments) {
    const position = text?.indexOf(fragment, cursor) ?? -1;
    if (position < 0) {
      findings.push(`${relativePath}: нарушен порядок каскада, не найден ${fragment}`);
      return;
    }
    cursor = position + fragment.length;
  }
}

export async function checkBranding() {
  const findings = [];
  for (const relativePath of trackedFiles()) {
    const text = await inspectText(relativePath);
    if (text?.includes(legacyBrand)) findings.push(relativePath);
  }

  const required = [
    "README.md",
    "docs/BRANDING.md",
    "docs/BRAND_DESIGN_STUDY.md",
    "apps/api/ui/index.html",
    "apps/api/ui/help-center.js",
    "apps/api/src/password-gate.ts",
    "apps/api/ui/brand-tokens.css"
  ];
  for (const relativePath of required) {
    const text = await inspectText(relativePath);
    if (!text?.includes(expectedBrand)) {
      findings.push(`${relativePath}: отсутствует пользовательское имя ${expectedBrand}`);
    }
  }

  const tokensPath = "apps/api/ui/brand-tokens.css";
  const tokens = await inspectText(tokensPath);
  const canonicalTokens = [
    "--background: #f3f1eb;",
    "--sidebar-surface: #ebe9e2;",
    "--surface: #fffefa;",
    "--text: #20262b;",
    "--accent: #176b78;",
    "--success: #1f6b4f;",
    "--warning: #8a5a00;",
    "--danger: #a33b3f;",
    "--space-1: 4px;",
    "--space-2: 8px;",
    "--space-3: 12px;",
    "--space-4: 16px;",
    "--space-6: 24px;",
    "--space-8: 32px;",
    "--space-12: 48px;",
    "--radius-control: 7px;",
    "--radius-panel: 10px;",
    "--radius-dialog: 14px;",
    "--touch-target: 44px;"
  ];
  for (const token of canonicalTokens) requireFragment(findings, tokens, tokensPath, token);

  for (const relativePath of [
    "apps/api/ui/styles.css",
    "apps/api/ui/interface-hierarchy.css",
    "apps/api/ui/interface-stability.css",
    "apps/api/ui/navigation-contract.css"
  ]) {
    const text = await inspectText(relativePath);
    if (text?.includes("--accent:")) {
      findings.push(`${relativePath}: палитра должна жить только в brand-tokens.css`);
    }
  }

  const baseStylesPath = "apps/api/ui/styles.css";
  const baseStyles = await inspectText(baseStylesPath);
  for (const forbidden of [
    "backdrop-filter: blur",
    "rgba(57, 121, 246",
    ".hero-visual",
    ".live-sheet",
    "linear-gradient(to bottom, var(--background)"
  ]) {
    if (baseStyles?.includes(forbidden)) findings.push(`${baseStylesPath}: найден устаревший эффект ${forbidden}`);
  }

  const stabilityPath = "apps/api/ui/interface-stability.css";
  const stability = await inspectText(stabilityPath);
  for (const fragment of [
    "min-height: var(--touch-target);",
    "width: var(--touch-target);",
    "height: var(--touch-target);",
    "backdrop-filter: none;",
    "box-shadow: none;"
  ]) {
    requireFragment(findings, stability, stabilityPath, fragment);
  }
  for (const forbidden of [
    ".hero-visual",
    "linear-gradient(",
    "radial-gradient(",
    "backdrop-filter: blur",
    "border-radius: 999px;",
    "width: 38px;\n    height: 38px;\n    min-height: 38px;",
    "width: 36px;\n    height: 36px;\n    min-height: 36px;"
  ]) {
    forbidFragment(findings, stability, stabilityPath, forbidden);
  }

  const runtimeContractPath = "apps/api/ui/navigation-contract.css";
  const runtimeContract = await inspectText(runtimeContractPath);
  for (const fragment of [
    "background-image: none;",
    "backdrop-filter: none;",
    ".workspace-list-panel,\n.workspace-content > .space-pane,\n.workspace-summary,\n.audience-builder,\n.plan-card {",
    "border-radius: var(--radius-panel);",
    "border-radius: var(--radius-control);",
    "box-shadow: none;",
    "min-height: var(--touch-target);",
    "color-mix(in srgb, var(--accent) 30%, var(--border))"
  ]) {
    requireFragment(findings, runtimeContract, runtimeContractPath, fragment);
  }
  for (const forbidden of [
    "linear-gradient(",
    "radial-gradient(",
    "backdrop-filter: blur",
    "border-radius: 999px;",
    "box-shadow: var(--shadow);",
    "box-shadow: var(--shadow-soft);",
    "rgba(57, 121, 246",
    "#6ea8ff",
    "#6f6ce8"
  ]) {
    forbidFragment(findings, runtimeContract, runtimeContractPath, forbidden);
  }

  const routesPath = "apps/api/src/ui-routes.ts";
  const routes = await inspectText(routesPath);
  requireFragment(findings, routes, routesPath, '"brand-tokens.css"');
  requireOrderedFragments(findings, routes, routesPath, [
    '"interface-hierarchy.css"',
    '"interface-stability.css"',
    '"brand-tokens.css"'
  ]);

  const navigationContractPath = "apps/api/ui/navigation-contract.js";
  const navigationContract = await inspectText(navigationContractPath);
  requireFragment(
    findings,
    navigationContract,
    navigationContractPath,
    'link.href = "/ui/navigation-contract.css";'
  );

  const indexPath = "apps/api/ui/index.html";
  const index = await inspectText(indexPath);
  requireFragment(findings, index, indexPath, 'content="#f3f1eb" media="(prefers-color-scheme: light)"');
  requireFragment(findings, index, indexPath, 'content="#151817" media="(prefers-color-scheme: dark)"');
  if (index?.includes('class="hero-visual"')) findings.push(`${indexPath}: декоративная hero-иллюстрация не должна возвращаться`);

  const faviconPath = "apps/api/ui/favicon.svg";
  const favicon = (await inspectText(faviconPath))?.toLowerCase() ?? "";
  if (favicon.includes("lineargradient") || favicon.includes("#6ea8ff") || favicon.includes("#6f6ce8")) {
    findings.push(`${faviconPath}: найден старый gradient/blue brand`);
  }
  if (!favicon.includes("#176b78") || !favicon.includes("#fffefa")) {
    findings.push(`${faviconPath}: знак не использует канонические бумагу и чернила`);
  }

  const loginPath = "apps/api/src/password-gate.ts";
  const login = (await inspectText(loginPath))?.toLowerCase() ?? "";
  for (const fragment of ["#f3f1eb", "#fffefa", "#176b78", "#151817"]) {
    if (!login.includes(fragment)) findings.push(`${loginPath}: login surface не содержит ${fragment}`);
  }
  if (login.includes("font-family:inter")) findings.push(`${loginPath}: login не должен вводить отдельный шрифт Inter`);

  const brandingPath = "docs/BRANDING.md";
  const branding = await inspectText(brandingPath);
  for (const fragment of ["Документный рабочий стол", "4 · 8 · 12 · 16 · 24 · 32 · 48", "44 × 44 CSS px", "brand-tokens.css"]) {
    requireFragment(findings, branding, brandingPath, fragment);
  }

  if (findings.length > 0) {
    throw new Error(`Проверка бренда не пройдена:\n- ${findings.join("\n- ")}`);
  }
}

const invokedPath = process.argv[1] === undefined ? "" : path.resolve(process.argv[1]);
if (invokedPath === fileURLToPath(import.meta.url)) {
  checkBranding().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
