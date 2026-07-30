import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ALLOWED_WRITE_WORKFLOWS = new Map([
  [
    "delete-merged-agent-branch.yml",
    [
      /\bpull_request:\s*$/mu,
      /\btypes:\s*\[closed\]\s*$/mu,
      /github\.event\.pull_request\.merged\s*==\s*true/u,
      /github\.event\.pull_request\.head\.repo\.full_name\s*==\s*github\.repository/u,
      /startsWith\(github\.event\.pull_request\.head\.ref,\s*['"]agent\//u
    ]
  ]
]);

const WRITE_PERMISSION_PATTERN = /^\s*([a-z][a-z-]*):\s*write\s*(?:#.*)?$/gmu;
const FORBIDDEN_TRIGGER_PATTERNS = [
  ["issue_comment", /^\s*issue_comment:\s*$/mu],
  ["pull_request_target", /^\s*pull_request_target:\s*$/mu]
];

function writePermissions(source) {
  return [...source.matchAll(WRITE_PERMISSION_PATTERN)].map((match) => match[1]);
}

export function inspectWorkflow(fileName, source) {
  const findings = [];

  for (const [trigger, pattern] of FORBIDDEN_TRIGGER_PATTERNS) {
    if (pattern.test(source)) {
      findings.push(`запрещён триггер ${trigger}`);
    }
  }

  const permissions = writePermissions(source);
  if (permissions.length === 0) return findings;

  const requiredPatterns = ALLOWED_WRITE_WORKFLOWS.get(fileName);
  if (requiredPatterns === undefined) {
    findings.push(
      `неразрешённые права записи: ${[...new Set(permissions)].sort().join(", ")}`
    );
    return findings;
  }

  for (const requiredPattern of requiredPatterns) {
    if (!requiredPattern.test(source)) {
      findings.push("разрешённый workflow утратил обязательное защитное условие");
      break;
    }
  }

  const unexpectedPermissions = permissions.filter((permission) => permission !== "contents");
  if (unexpectedPermissions.length > 0) {
    findings.push(
      `лишние права записи: ${[...new Set(unexpectedPermissions)].sort().join(", ")}`
    );
  }

  return findings;
}

export async function checkWorkflowPermissions(rootDirectory = process.cwd()) {
  const workflowDirectory = path.join(rootDirectory, ".github", "workflows");
  const entries = await fs.readdir(workflowDirectory, { withFileTypes: true });
  const findings = [];

  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (!entry.isFile() || !/\.ya?ml$/u.test(entry.name)) continue;
    const source = await fs.readFile(path.join(workflowDirectory, entry.name), "utf8");
    for (const finding of inspectWorkflow(entry.name, source)) {
      findings.push(`${entry.name}: ${finding}`);
    }
  }

  if (findings.length > 0) {
    throw new Error(
      `Проверка прав GitHub Actions не пройдена:\n- ${findings.join("\n- ")}`
    );
  }
}

const invokedPath = process.argv[1] === undefined ? "" : path.resolve(process.argv[1]);
if (invokedPath === fileURLToPath(import.meta.url)) {
  checkWorkflowPermissions().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
