import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const helper = path.join(root, "scripts/offline/preserve-llm-runtime.sh");
async function fixture() {
  const temp = await mkdtemp(path.join(os.tmpdir(), "docomator-llm-preserve-"));
  const releases = path.join(temp, "releases");
  const oldRelease = path.join(releases, "old");
  const newRelease = path.join(releases, "new");
  await mkdir(path.join(oldRelease, "runtime/llama"), { recursive: true });
  await mkdir(path.join(newRelease, "runtime/llama"), { recursive: true });
  const oldServer = path.join(oldRelease, "runtime/llama/llama-server");
  await writeFile(oldServer, "old-runtime\n");
  await chmod(oldServer, 0o755);
  return { temp, releases, oldRelease, newRelease };
}
test("app-only upgrade preserves trusted llama runtime", async (t) => {
  const f = await fixture(); t.after(() => rm(f.temp, { recursive: true, force: true }));
  assert.equal(execFileSync("bash", [helper, f.oldRelease, f.newRelease, f.releases], { encoding: "utf8" }).trim(), "preserved");
  assert.equal(await readFile(path.join(f.newRelease, "runtime/llama/llama-server"), "utf8"), "old-runtime\n");
});
test("bundle runtime has priority", async (t) => {
  const f = await fixture(); t.after(() => rm(f.temp, { recursive: true, force: true }));
  const server = path.join(f.newRelease, "runtime/llama/llama-server"); await writeFile(server, "new-runtime\n"); await chmod(server, 0o755);
  assert.equal(execFileSync("bash", [helper, f.oldRelease, f.newRelease, f.releases], { encoding: "utf8" }), "");
  assert.equal(await readFile(server, "utf8"), "new-runtime\n");
});
test("outside managed releases is rejected", async (t) => {
  const f = await fixture(); t.after(() => rm(f.temp, { recursive: true, force: true }));
  const outside = path.join(f.temp, "outside"); await mkdir(path.join(outside, "runtime/llama"), { recursive: true });
  const server = path.join(outside, "runtime/llama/llama-server"); await writeFile(server, "outside\n"); await chmod(server, 0o755);
  assert.equal(execFileSync("bash", [helper, outside, f.newRelease, f.releases], { encoding: "utf8" }), "");
  await assert.rejects(readFile(path.join(f.newRelease, "runtime/llama/llama-server")));
});
test("fresh install inherits nothing", async (t) => {
  const f = await fixture(); t.after(() => rm(f.temp, { recursive: true, force: true }));
  assert.equal(execFileSync("bash", [helper, "", f.newRelease, f.releases], { encoding: "utf8" }), "");
  await assert.rejects(readFile(path.join(f.newRelease, "runtime/llama/llama-server")));
});
