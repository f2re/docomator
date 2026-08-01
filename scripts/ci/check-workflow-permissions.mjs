import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const APPROVED_WRITE_WORKFLOW = "delete-merged-work-branch.yml";
const APPROVED_CHECKOUT_ACTION = "actions/checkout@11d5960a326750d5838078e36cf38b85af677262";
const WRITE_PERMISSION_LINE = /^\s*([a-z][a-z0-9-]*):\s*write\s*$/gimu;
const INLINE_WRITE_PERMISSION = /\b([a-z][a-z0-9-]*)\s*:\s*write(?!-all)\b/gimu;
const WRITE_ALL_PERMISSION = /^\s*permissions\s*:\s*write-all\s*$/imu;
const PINNED_ACTION = /^[^@\s]+@[a-f0-9]{40}$/u;
const PINNED_DOCKER_IMAGE = /^docker:\/\/[^@\s]+@sha256:[a-f0-9]{64}$/u;
const ELIGIBLE_BRANCH_PREFIXES = [
  "agent/",
  "ci/",
  "feature/",
  "fix/",
  "temp/",
  "verify/"
];

const FORBIDDEN_TRIGGERS = [
  "issue_comment",
  "pull_request_target",
  "repository_dispatch"
];

const APPROVED_REQUIRED_PATTERNS = [
  /^\s*pull_request:\s*$/mu,
  /^\s*types:\s*\[closed\]\s*$/mu,
  /^\s*contents:\s*write\s*$/mu,
  /github\.event\.pull_request\.merged\s*==\s*true/u,
  /github\.event\.pull_request\.head\.repo\.full_name\s*==\s*github\.repository/u,
  /github\.event\.pull_request\.head\.ref\s*!=\s*github\.event\.repository\.default_branch/u,
  /^\s*HEAD_BRANCH:\s*\$\{\{\s*github\.event\.pull_request\.head\.ref\s*\}\}\s*$/mu,
  /^\s*DEFAULT_BRANCH:\s*\$\{\{\s*github\.event\.repository\.default_branch\s*\}\}\s*$/mu,
  /\[\[\s*-n\s*"\$HEAD_BRANCH"\s*\]\]/u,
  /\[\[\s*"\$HEAD_BRANCH"\s*!=\s*"\$DEFAULT_BRANCH"\s*\]\]/u,
  /git\s+ls-remote\s+--exit-code\s+--heads\s+origin\s+"refs\/heads\/\$HEAD_BRANCH"/u,
  /git\s+push\s+origin\s+--delete\s+"\$HEAD_BRANCH"/u
];

for (const prefix of ELIGIBLE_BRANCH_PREFIXES) {
  APPROVED_REQUIRED_PATTERNS.push(
    new RegExp(
      `startsWith\\(github\\.event\\.pull_request\\.head\\.ref,\\s*['"]${prefix.replace("/", "\\/")}['"]\\)`,
      "u"
    )
  );
}

const APPROVED_RUN_LINES = new Set([
  "set -Eeuo pipefail",
  '[[ -n "$HEAD_BRANCH" ]]',
  '[[ "$HEAD_BRANCH" != "$DEFAULT_BRANCH" ]]',
  'case "$HEAD_BRANCH" in',
  "agent/*|ci/*|feature/*|fix/*|temp/*|verify/*)",
  ";;",
  "*)",
  'echo "Branch $HEAD_BRANCH is not eligible for automatic deletion." >&2',
  "exit 1",
  "esac",
  'if git ls-remote --exit-code --heads origin "refs/heads/$HEAD_BRANCH" >/dev/null 2>&1; then',
  'git push origin --delete "$HEAD_BRANCH"',
  "else",
  'echo "Branch $HEAD_BRANCH is already absent."',
  "fi"
]);

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

function workflowUses(source) {
  return [...source.matchAll(/^\s*(?:-\s*)?uses:\s*([^\s]+)\s*$/gimu)].map(
    (match) => match[1]
  );
}

function actionPinFindings(source) {
  const findings = [];
  for (const action of workflowUses(source)) {
    if (action.startsWith("./")) continue;
    if (PINNED_ACTION.test(action) || PINNED_DOCKER_IMAGE.test(action)) continue;
    findings.push(
      `внешний action не закреплён полным commit SHA или digest: ${action}`
    );
  }
  return findings;
}

function workflowShells(source) {
  return [...source.matchAll(/^\s*shell:\s*([^\s]+)\s*$/gimu)].map(
    (match) => match[1]
  );
}

function runBlockLines(source) {
  const lines = source.split(/\r?\n/u);
  const commands = [];
  for (let index = 0; index < lines.length; index += 1) {
    const match = /^(\s*)run:\s*\|[-+]?\s*$/u.exec(lines[index]);
    if (!match) continue;
    const indentation = match[1].length;
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      const raw = lines[cursor];
      if (raw.trim() === "") continue;
      const leading = /^\s*/u.exec(raw)?.[0].length ?? 0;
      if (leading <= indentation) break;
      const command = stripInlineComment(raw).trim();
      if (command !== "") commands.push(command);
      index = cursor;
    }
  }
  return commands;
}

function inspectApprovedWriteWorkflow(source, permissions) {
  const findings = [];
  if (permissions.length !== 1 || permissions[0] !== "contents") {
    findings.push(
      `разрешённый workflow может иметь только contents: write; найдено: ${permissions.join(", ") || "нет"}`
    );
  }

  for (const requiredPattern of APPROVED_REQUIRED_PATTERNS) {
    if (!requiredPattern.test(source)) {
      findings.push("workflow удаления ветки утратил обязательное защитное условие");
      break;
    }
  }

  const uses = workflowUses(source);
  if (uses.length !== 1 || uses[0] !== APPROVED_CHECKOUT_ACTION) {
    findings.push(
      `workflow удаления ветки может использовать только ${APPROVED_CHECKOUT_ACTION}; найдено: ${uses.join(", ") || "нет"}`
    );
  }

  const shells = workflowShells(source);
  if (shells.some((shell) => shell !== "bash")) {
    findings.push(
      `workflow удаления ветки может использовать только shell bash; найдено: ${shells.join(", ")}`
    );
  }

  const commands = runBlockLines(source);
  if (commands.length === 0) {
    findings.push("workflow удаления ветки не содержит проверяемого run-блока");
  }
  for (const command of commands) {
    if (!APPROVED_RUN_LINES.has(command)) {
      findings.push(
        `workflow удаления ветки содержит неразрешённую команду: ${command}`
      );
    }
  }
  for (const requiredCommand of APPROVED_RUN_LINES) {
    if (!commands.includes(requiredCommand)) {
      findings.push(
        `workflow удаления ветки не содержит обязательную команду: ${requiredCommand}`
      );
    }
  }

  return findings;
}

export function inspectWorkflow(fileName, source) {
  const findings = [];
  const effective = activeSource(source);

  for (const trigger of FORBIDDEN_TRIGGERS) {
    if (triggerPattern(trigger).test(effective)) {
      findings.push(`запрещён триггер ${trigger}`);
    }
  }

  findings.push(...actionPinFindings(effective));

  const writeAll = WRITE_ALL_PERMISSION.test(effective);
  if (writeAll) {
    findings.push("запрещено общее право permissions: write-all");
  }

  const permissions = writePermissions(effective);
  if (permissions.length === 0 && !writeAll) return [...new Set(findings)];

  if (fileName !== APPROVED_WRITE_WORKFLOW) {
    if (permissions.length > 0) {
      findings.push(`неразрешённые права записи: ${permissions.join(", ")}`);
    }
    return [...new Set(findings)];
  }

  findings.push(...inspectApprovedWriteWorkflow(effective, permissions));
  return [...new Set(findings)];
}

export async function checkWorkflowPermissions(rootDirectory = process.cwd()) {
  const workflowDirectory = path.join(rootDirectory, ".github", "workflows");
  const entries = await fs.readdir(workflowDirectory, { withFileTypes: true });
  const findings = [];

  for (const entry of entries.sort((left, right) =>
    left.name.localeCompare(right.name, "en")
  )) {
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
