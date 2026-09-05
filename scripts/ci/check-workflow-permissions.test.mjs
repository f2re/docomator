import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  checkWorkflowPermissions,
  inspectWorkflow
} from "./check-workflow-permissions.mjs";

const checkoutAction = "actions/checkout@11d5960a326750d5838078e36cf38b85af677262";
const setupNodeAction = "actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020";

const safeCi = `name: CI
on:
  pull_request:
  push:
    branches:
      - main
permissions:
  contents: read
jobs:
  essential:
    steps:
      - uses: ${checkoutAction}
      - uses: ${setupNodeAction}
`;

test("разрешает единственный read-only CI с двумя закреплёнными bootstrap actions", () => {
  assert.deepEqual(inspectWorkflow("ci.yml", safeCi), []);
});

test("запрещает любое право записи", () => {
  assert.deepEqual(
    inspectWorkflow(
      "ci.yml",
      safeCi.replace("contents: read", "contents: write")
    ),
    ["GitHub Actions должны быть read-only; найдены права записи: contents"]
  );
});

test("запрещает permissions: write-all", () => {
  assert.deepEqual(
    inspectWorkflow(
      "ci.yml",
      safeCi.replace("permissions:\n  contents: read", "permissions: write-all")
    ),
    ["запрещено общее право permissions: write-all"]
  );
});

test("запрещает автоматические release и workflow chaining triggers", () => {
  const releaseTriggered = safeCi.replace(
    "on:\n  pull_request:\n  push:\n    branches:\n      - main",
    "on:\n  workflow_run:\n    workflows: [CI]\n    types: [completed]"
  );
  assert.deepEqual(inspectWorkflow("ci.yml", releaseTriggered), [
    "запрещён триггер workflow_run"
  ]);
});

test("запрещает дополнительные и плавающие actions", () => {
  assert.deepEqual(
    inspectWorkflow(
      "ci.yml",
      safeCi.replace(checkoutAction, "actions/checkout@v4")
    ),
    ["неразрешённый action: actions/checkout@v4"]
  );

  assert.deepEqual(
    inspectWorkflow(
      "ci.yml",
      safeCi.replace(
        `      - uses: ${setupNodeAction}`,
        `      - uses: ${setupNodeAction}\n      - uses: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02`
      )
    ),
    [
      "неразрешённый action: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02"
    ]
  );
});

test("игнорирует запрещённые слова в комментариях", () => {
  assert.deepEqual(
    inspectWorkflow("ci.yml", `${safeCi}\n# workflow_run:\n# permissions: write-all\n`),
    []
  );
});

test("каталог workflow содержит только ci.yml", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "docomator-workflows-"));
  const workflows = path.join(root, ".github", "workflows");
  await fs.mkdir(workflows, { recursive: true });
  await fs.writeFile(path.join(workflows, "ci.yml"), safeCi);

  await assert.doesNotReject(checkWorkflowPermissions(root));

  await fs.writeFile(
    path.join(workflows, "release.yml"),
    "name: Release\non:\n  push:\npermissions:\n  contents: read\n"
  );
  await assert.rejects(
    checkWorkflowPermissions(root),
    /release\.yml: лишний workflow: разрешён только ci\.yml/u
  );
});
