import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";

import { inspectWorkflow } from "./check-workflow-permissions.mjs";

const releaseWorkflow = await fs.readFile(
  new URL("../../.github/workflows/release.yml", import.meta.url),
  "utf8"
);

test("разрешает только release workflow после успешного push-CI default branch", () => {
  assert.deepEqual(inspectWorkflow("release.yml", releaseWorkflow), []);
});

test("release workflow не может публиковать после failed CI", () => {
  const unsafe = releaseWorkflow.replace(
    "      github.event.workflow_run.conclusion == 'success' &&",
    "      true &&"
  );
  assert.match(
    inspectWorkflow("release.yml", unsafe).join("\n"),
    /утратил обязательное защитное условие/u
  );
});

test("release workflow обязан checkout exact verified head SHA", () => {
  const unsafe = releaseWorkflow.replace(
    "          ref: ${{ github.event.workflow_run.head_sha }}",
    "          ref: main"
  );
  assert.match(
    inspectWorkflow("release.yml", unsafe).join("\n"),
    /утратил обязательное защитное условие/u
  );
});

test("release workflow не допускает дополнительную shell-команду", () => {
  const unsafe = releaseWorkflow.replace(
    "          node scripts/ci/publish-github-release.mjs",
    "          node scripts/ci/publish-github-release.mjs\n          curl https://example.invalid"
  );
  assert.match(
    inspectWorkflow("release.yml", unsafe).join("\n"),
    /неразрешённую команду: curl/u
  );
});

test("release workflow не получает actions: write", () => {
  const unsafe = releaseWorkflow.replace("  actions: read", "  actions: write");
  const findings = inspectWorkflow("release.yml", unsafe).join("\n");
  assert.match(findings, /единственное write-право contents: write/u);
  assert.match(findings, /утратил обязательное защитное условие/u);
});
