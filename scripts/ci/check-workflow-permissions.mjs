import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ONLY_WORKFLOW = "ci.yml";
const ALLOWED_ACTIONS = new Set([
  "actions/checkout@11d5960a326750d5838078e36cf38b85af677262",
  "actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020"
]);
const FORBIDDEN_TRIGGERS = [
  "issue_comment",
  "pull_request_target",
  "repository_dispatch",
  "workflow_run",
  "workflow_dispatch",
  "release",
  "schedule"
];
const WRITE_PERMISSION_LINE = /^\s*([a-z][a-z0-9-]*):\s*write\s*$/gimu;
const INLINE_WRITE_PERMISSION = /\b([a-z][a-z0-9-]*)\s*:\s*write(?!-all)\b/gimu;
const WRITE_ALL_PERMISSION = /^\s*permissions\s*:\s*write-all\s*$/imu;

function stripInlineComment(line) {
  let singleQuoted = false;
  let doubleQuoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === "'" && !doubleQuoted) {
      singleQuoted = !singleQuoted;
      continue;
    }
    if (character === '"' && !singleQuoted) {
      const escaped = index > 0 && line[index - 1] === "\\";
      if (!escaped) doubleQuoted = !doubleQuoted;
      continue;
    }
    if (
      character === "#" &&
      !singleQuoted &&
      !doubleQuoted &&
      (index === 0 || /\s/u.test(line[index - 1]))
    ) {
      return line.slice(0, index).trimEnd();
    }
  }
  return line;
}

function activeSource(source) {
  return source
    .split(/\r?\n/u)
    .map(stripInlineComment)
    .filter((line) => line.trim() !== "")
    .join("\n");
}

function triggerPattern(trigger) {
  return new RegExp(
    `(?:^|\\n)\\s*${trigger}\\s*:|\\bon\\s*:\\s*${trigger}\\b|\\bon\\s*:\\s*\\[[^\\]]*\\b${trigger}\\b|\\bon\\s*:\\s*\\{[^}]*\\b${trigger}\\s*:`,
    "iu"
  );
}

function workflowUses(source) {
  return [...source.matchAll(/^\s*(?:-\s*)?uses:\s*([^\s]+)\s*$/gimu)].map(
    (match) => match[1]
  );
}

function writePermissions(source) {
  const permissions = [];
  for (const match of source.matchAll(WRITE_PERMISSION_LINE)) {
    permissions.push(match[1].toLowerCase());
  }
  for (const match of source.matchAll(INLINE_WRITE_PERMISSION)) {
    permissions.push(match[1].toLowerCase());
  }
  return [...new Set(permissions)].sort((left, right) =>
    left.localeCompare(right, "en")
  );
}

export function inspectWorkflow(fileName, source) {
  const findings = [];
  const effective = activeSource(source);

  if (fileName !== ONLY_WORKFLOW) {
    findings.push(`лишний workflow: разрешён только ${ONLY_WORKFLOW}`);
  }

  for (const trigger of FORBIDDEN_TRIGGERS) {
    if (triggerPattern(trigger).test(effective)) {
      findings.push(`запрещён триггер ${trigger}`);
    }
  }

  if (WRITE_ALL_PERMISSION.test(effective)) {
    findings.push("запрещено общее право permissions: write-all");
  }

  const permissions = writePermissions(effective);
  if (permissions.length > 0) {
    findings.push(`GitHub Actions должны быть read-only; найдены права записи: ${permissions.join(", ")}`);
  }

  for (const action of workflowUses(effective)) {
    if (!ALLOWED_ACTIONS.has(action)) {
      findings.push(`неразрешённый action: ${action}`);
    }
  }

  return [...new Set(findings)];
}

export async function checkWorkflowPermissions(rootDirectory = process.cwd()) {
  const workflowDirectory = path.join(rootDirectory, ".github", "workflows");
  const entries = await fs.readdir(workflowDirectory, { withFileTypes: true });
  const workflowEntries = entries
    .filter((entry) => entry.isFile() && /\.ya?ml$/u.test(entry.name))
    .sort((left, right) => left.name.localeCompare(right.name, "en"));
  const findings = [];

  if (!workflowEntries.some((entry) => entry.name === ONLY_WORKFLOW)) {
    findings.push(`отсутствует обязательный ${ONLY_WORKFLOW}`);
  }

  for (const entry of workflowEntries) {
    const source = await fs.readFile(path.join(workflowDirectory, entry.name), "utf8");
    for (const finding of inspectWorkflow(entry.name, source)) {
      findings.push(`${entry.name}: ${finding}`);
    }
  }

  if (findings.length > 0) {
    throw new Error(
      `Проверка GitHub Actions не пройдена:\n- ${findings.join("\n- ")}`
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
