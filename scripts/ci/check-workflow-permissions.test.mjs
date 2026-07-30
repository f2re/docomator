import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  checkWorkflowPermissions,
  inspectWorkflow
} from "./check-workflow-permissions.mjs";

const safeWriteWorkflow = `name: Delete merged agent branch
on:
  pull_request:
    types: [closed]
permissions:
  contents: write
jobs:
  delete:
    if: >-
      github.event.pull_request.merged == true &&
      github.event.pull_request.head.repo.full_name == github.repository &&
      startsWith(github.event.pull_request.head.ref, 'agent/')
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

test("разрешает только защищённое удаление слитой agent-ветки", () => {
  assert.deepEqual(
    inspectWorkflow("delete-merged-agent-branch.yml", safeWriteWorkflow),
    []
  );
});

test("запрещает новый workflow с записью в репозиторий", () => {
  assert.deepEqual(
    inspectWorkflow(
      "apply-patch.yml",
      "name: Apply\non:\n  push:\npermissions:\n  contents: write\n"
    ),
    ["неразрешённые права записи: contents"]
  );
});

test("запрещает запуск workflow из комментария", () => {
  const findings = inspectWorkflow(
    "comment-command.yml",
    "name: Command\non:\n  issue_comment:\n    types: [created]\npermissions:\n  contents: read\n"
  );
  assert.deepEqual(findings, ["запрещён триггер issue_comment"]);
});

test("проверяет весь каталог workflow", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "docomator-workflows-"));
  const workflows = path.join(root, ".github", "workflows");
  await fs.mkdir(workflows, { recursive: true });
  await fs.writeFile(path.join(workflows, "ci.yml"), "permissions:\n  contents: read\n");
  await fs.writeFile(
    path.join(workflows, "delete-merged-agent-branch.yml"),
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
