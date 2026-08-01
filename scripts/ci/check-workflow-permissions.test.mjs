import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  checkWorkflowPermissions,
  inspectWorkflow
} from "./check-workflow-permissions.mjs";

const safeWriteWorkflow = `name: Delete merged work branch
on:
  pull_request:
    types: [closed]
permissions:
  contents: write
jobs:
  delete-merged-branch:
    if: >-
      github.event.pull_request.merged == true &&
      github.event.pull_request.head.repo.full_name == github.repository &&
      github.event.pull_request.head.ref != github.event.repository.default_branch &&
      (
        startsWith(github.event.pull_request.head.ref, 'agent/') ||
        startsWith(github.event.pull_request.head.ref, 'ci/') ||
        startsWith(github.event.pull_request.head.ref, 'feature/') ||
        startsWith(github.event.pull_request.head.ref, 'fix/') ||
        startsWith(github.event.pull_request.head.ref, 'temp/') ||
        startsWith(github.event.pull_request.head.ref, 'verify/')
      )
    runs-on: ubuntu-24.04
    steps:
      - uses: actions/checkout@v4
      - name: Delete merged work branch
        env:
          HEAD_BRANCH: \${{ github.event.pull_request.head.ref }}
          DEFAULT_BRANCH: \${{ github.event.repository.default_branch }}
        shell: bash
        run: |
          set -Eeuo pipefail
          [[ -n "$HEAD_BRANCH" ]]
          [[ "$HEAD_BRANCH" != "$DEFAULT_BRANCH" ]]
          case "$HEAD_BRANCH" in
            agent/*|ci/*|feature/*|fix/*|temp/*|verify/*)
              ;;
            *)
              echo "Branch $HEAD_BRANCH is not eligible for automatic deletion." >&2
              exit 1
              ;;
          esac
          if git ls-remote --exit-code --heads origin "refs/heads/$HEAD_BRANCH" >/dev/null 2>&1; then
            git push origin --delete "$HEAD_BRANCH"
          else
            echo "Branch $HEAD_BRANCH is already absent."
          fi
`;

test("разрешает обычный workflow только для чтения", () => {
  assert.deepEqual(
    inspectWorkflow(
      "ci.yml",
      "name: CI\non:\n  push:\npermissions:\n  contents: read\n"
    ),
    []
  );
});

test("разрешает точный защищённый workflow удаления слитой рабочей ветки", () => {
  assert.deepEqual(
    inspectWorkflow("delete-merged-work-branch.yml", safeWriteWorkflow),
    []
  );
});

test("запрещает новый workflow с блочным правом записи", () => {
  assert.deepEqual(
    inspectWorkflow(
      "apply-patch.yml",
      "name: Apply\non:\n  push:\npermissions:\n  contents: write\n"
    ),
    ["неразрешённые права записи: contents"]
  );
});

test("запрещает встроенное право записи", () => {
  assert.deepEqual(
    inspectWorkflow(
      "inline.yml",
      "name: Inline\non: push\npermissions: { contents: write, issues: read }\n"
    ),
    ["неразрешённые права записи: contents"]
  );
});

test("запрещает permissions: write-all", () => {
  assert.deepEqual(
    inspectWorkflow(
      "write-all.yml",
      "name: All\non: push\npermissions: write-all\n"
    ),
    ["запрещено общее право permissions: write-all"]
  );
});

test("запрещает блочный и скалярный запуск из комментария", () => {
  assert.deepEqual(
    inspectWorkflow(
      "comment-block.yml",
      "name: Command\non:\n  issue_comment:\n    types: [created]\npermissions:\n  contents: read\n"
    ),
    ["запрещён триггер issue_comment"]
  );
  assert.deepEqual(
    inspectWorkflow(
      "comment-scalar.yml",
      "name: Command\non: issue_comment\npermissions:\n  contents: read\n"
    ),
    ["запрещён триггер issue_comment"]
  );
});

test("не принимает защитные строки, оставленные только в комментариях", () => {
  const unsafe = safeWriteWorkflow.replace(
    '          [[ "$HEAD_BRANCH" != "$DEFAULT_BRANCH" ]]',
    '          # [[ "$HEAD_BRANCH" != "$DEFAULT_BRANCH" ]]'
  );
  assert.match(
    inspectWorkflow("delete-merged-work-branch.yml", unsafe).join("\n"),
    /утратил обязательное защитное условие/u
  );
});

test("не принимает workflow без одного из разрешённых префиксов", () => {
  const unsafe = safeWriteWorkflow.replace(
    "        startsWith(github.event.pull_request.head.ref, 'verify/')",
    "        false"
  );
  assert.match(
    inspectWorkflow("delete-merged-work-branch.yml", unsafe).join("\n"),
    /утратил обязательное защитное условие/u
  );
});

test("запрещает дополнительную команду в разрешённом write-workflow", () => {
  const unsafe = safeWriteWorkflow.replace(
    "          set -Eeuo pipefail",
    "          set -Eeuo pipefail\n          git commit -am 'неразрешённое изменение'"
  );
  assert.match(
    inspectWorkflow("delete-merged-work-branch.yml", unsafe).join("\n"),
    /неразрешённую команду: git commit/u
  );
});

test("запрещает дополнительное стороннее action в разрешённом write-workflow", () => {
  const unsafe = safeWriteWorkflow.replace(
    "      - uses: actions/checkout@v4",
    "      - uses: actions/checkout@v4\n      - uses: example/untrusted-action@v1"
  );
  assert.match(
    inspectWorkflow("delete-merged-work-branch.yml", unsafe).join("\n"),
    /может использовать только actions\/checkout@v4/u
  );
});

test("проверяет весь каталог workflow", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "docomator-workflows-"));
  const workflows = path.join(root, ".github", "workflows");
  await fs.mkdir(workflows, { recursive: true });
  await fs.writeFile(path.join(workflows, "ci.yml"), "permissions:\n  contents: read\n");
  await fs.writeFile(
    path.join(workflows, "delete-merged-work-branch.yml"),
    safeWriteWorkflow
  );

  await assert.doesNotReject(checkWorkflowPermissions(root));

  await fs.writeFile(
    path.join(workflows, "unsafe.yml"),
    "on:\n  pull_request_target:\npermissions:\n  contents: write\n"
  );
  await assert.rejects(
    checkWorkflowPermissions(root),
    /unsafe\.yml: запрещён триггер pull_request_target/u
  );
});
