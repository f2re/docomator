import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("./http-check.mjs", import.meta.url));

function check(url, sessionFile) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, url, "ready"], {
      env: { ...process.env, DOCOMATOR_HTTP_SESSION_FILE: sessionFile },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { output += chunk; });
    child.once("error", reject);
    child.once("close", (code) => resolve({ code, output }));
  });
}

test("HTTP check binds a private regular session file to one origin and never follows redirects", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "docomator-http-session-"));
  const requests = [];
  const server = http.createServer((request, response) => {
    requests.push({ path: request.url, cookie: request.headers.cookie });
    if (request.url === "/redirect") {
      response.writeHead(302, { location: "/leak" });
      response.end();
    } else response.end("ready");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const sessionFile = path.join(directory, "session.json");
  const cookie = "docomator_session=synthetic-check-only";
  try {
    await fs.writeFile(sessionFile, JSON.stringify({ origin, cookie }), { mode: 0o600 });
    assert.equal((await check(`${origin}/`, sessionFile)).code, 0);
    assert.deepEqual(requests, [{ path: "/", cookie }]);
    const failedRedirect = await check(`${origin}/redirect`, sessionFile);
    assert.equal(failedRedirect.code, 1);
    assert.ok(!failedRedirect.output.includes(cookie), "credentials must not appear in diagnostics");
    assert.ok(!requests.some((request) => request.path === "/leak"));
    const count = requests.length;
    await fs.chmod(sessionFile, 0o644);
    assert.equal((await check(`${origin}/`, sessionFile)).code, 1);
    await fs.chmod(sessionFile, 0o600);
    const link = path.join(directory, "session-link");
    await fs.symlink(sessionFile, link);
    assert.equal((await check(`${origin}/`, link)).code, 1);
    await fs.writeFile(sessionFile, JSON.stringify({ origin: "http://127.0.0.1:1", cookie }));
    assert.equal((await check(`${origin}/`, sessionFile)).code, 1);
    assert.equal(requests.length, count, "unsafe credentials must be rejected before a request");
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(directory, { recursive: true, force: true });
  }
});
