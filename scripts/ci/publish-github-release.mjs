import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u;
const SHA = /^[a-f0-9]{40}$/u;
const HASH = /^[a-f0-9]{64}$/u;
const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u;
const RUN_ID = /^[1-9]\d*$/u;
const SUM = /^([a-f0-9]{64})\s+\*?([^\r\n]+)$/u;
const PAYLOAD = /^payload\/(docomator-(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)-linux-(?:x64|arm64)\.tar\.gz)$/u;
const READ_ZIP = "import sys,zipfile;sys.stdout.buffer.write(zipfile.ZipFile(sys.argv[1],'r').read(sys.argv[2]))";
const EXTRACT_ZIP = "import shutil,sys,zipfile;z=zipfile.ZipFile(sys.argv[1],'r');i=z.getinfo(sys.argv[2]);f=open(sys.argv[3],'xb');shutil.copyfileobj(z.open(i,'r'),f);f.close();z.close()";

function fail(message) { throw new Error(message); }
function json(source, label) { try { return JSON.parse(source); } catch { fail(`${label} вернул некорректный JSON.`); } }

export function parseReleaseIdentity(source) {
  const value = json(source, "RELEASE_IDENTITY.json");
  const { version, status, channel } = value ?? {};
  if (typeof version !== "string" || !SEMVER.test(version)) fail("Некорректный product SemVer.");
  if (`${status}/${channel}` !== "candidate/pilot" && `${status}/${channel}` !== "stable/production") {
    fail("GitHub Release разрешён только для candidate/pilot или stable/production.");
  }
  return { version, status, channel };
}

export function releaseDescriptor(identity) {
  return identity.status === "candidate"
    ? { tag: `v${identity.version}-candidate`, title: `Оформлятор ${identity.version} — кандидат · pilot`, prerelease: false }
    : { tag: `v${identity.version}`, title: `Оформлятор ${identity.version}`, prerelease: false };
}

function workflowInputs(env) {
  const repository = env.GITHUB_REPOSITORY ?? "";
  const sourceSha = env.DOCOMATOR_SOURCE_SHA ?? "";
  const runId = env.DOCOMATOR_WORKFLOW_RUN_ID ?? "";
  if (!REPO.test(repository)) fail("GITHUB_REPOSITORY должен иметь вид owner/repository.");
  if (!SHA.test(sourceSha)) fail("DOCOMATOR_SOURCE_SHA должен быть полным SHA.");
  if (!RUN_ID.test(runId)) fail("DOCOMATOR_WORKFLOW_RUN_ID должен быть числовым run id.");
  if (!env.GH_TOKEN) fail("GH_TOKEN обязателен.");
  return { repository, sourceSha, runId };
}

async function runDefault(command, args, options = {}) {
  try {
    const r = await execFileAsync(command, args, { cwd: options.cwd, env: options.env, encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
    return { code: 0, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
  } catch (e) {
    return { code: typeof e?.code === "number" ? e.code : 1, stdout: typeof e?.stdout === "string" ? e.stdout : "", stderr: typeof e?.stderr === "string" ? e.stderr : String(e) };
  }
}

function ok(result, label) {
  if (result.code !== 0) fail(`${label}: ${result.stderr.trim() || result.stdout.trim() || `exit ${result.code}`}`);
  return result.stdout.trim();
}

async function sha256(file) {
  const h = createHash("sha256");
  const handle = await fs.open(file, "r");
  try {
    const b = Buffer.allocUnsafe(1024 * 1024); let p = 0;
    while (true) { const { bytesRead } = await handle.read(b, 0, b.length, p); if (!bytesRead) break; h.update(b.subarray(0, bytesRead)); p += bytesRead; }
  } finally { await handle.close(); }
  return h.digest("hex");
}

async function regular(file) {
  const s = await fs.lstat(file);
  if (!s.isFile() || s.isSymbolicLink()) fail(`Release asset должен быть обычным файлом: ${path.basename(file)}`);
}

export async function verifyChecksum(file, checksum) {
  await regular(file); await regular(checksum);
  const match = SUM.exec((await fs.readFile(checksum, "utf8")).trim());
  if (!match || match[2] !== path.basename(file)) fail(`Некорректный SHA-256 файл: ${path.basename(checksum)}`);
  const actual = await sha256(file);
  if (actual !== match[1]) fail(`SHA-256 не совпадает для ${path.basename(file)}.`);
  return actual;
}

function missingRelease(result) { return result.code !== 0 && /(?:HTTP\s+404|not found|release not found)/iu.test(result.stderr); }

async function releaseView(ctx, tag) {
  const r = await ctx.run("gh", ["release", "view", tag, "--repo", ctx.repository, "--json", "url,databaseId,tagName,isDraft,isPrerelease,targetCommitish"], ctx.opts);
  if (r.code === 0) return json(r.stdout, `GitHub Release ${tag}`);
  if (missingRelease(r)) return null;
  ok(r, `Не удалось проверить GitHub Release ${tag}`);
}

async function tagSha(ctx, tag) {
  const r = await ctx.run("git", ["ls-remote", "--exit-code", "--tags", "origin", `refs/tags/${tag}`], ctx.opts);
  if (r.code === 2) return null;
  ok(r, `Не удалось проверить tag ${tag}`);
  ok(await ctx.run("git", ["fetch", "--no-tags", "--force", "--depth=1", "origin", `refs/tags/${tag}:refs/tags/${tag}`], ctx.opts), `Не удалось получить tag ${tag}`);
  const sha = ok(await ctx.run("git", ["rev-list", "-n", "1", `refs/tags/${tag}`], ctx.opts), `Не удалось определить commit tag ${tag}`);
  if (!SHA.test(sha)) fail(`Tag ${tag} не разрешился в полный SHA.`);
  return sha;
}

async function show(ctx, sha, file) { return ok(await ctx.run("git", ["show", `${sha}:${file}`], ctx.opts), `Не удалось прочитать ${file} из ${sha}`); }

async function historicalRun(ctx, sha) {
  const branch = ok(await ctx.run("gh", ["repo", "view", ctx.repository, "--json", "defaultBranchRef", "--jq", ".defaultBranchRef.name"], ctx.opts), "Не удалось определить default branch");
  const runs = json(ok(await ctx.run("gh", ["run", "list", "--repo", ctx.repository, "--workflow", "CI", "--commit", sha, "--event", "push", "--limit", "20", "--json", "databaseId,headSha,conclusion,event,headBranch"], ctx.opts), `Не удалось найти CI для ${sha}`), "GitHub Actions runs");
  const found = Array.isArray(runs) && runs.find((x) => x?.headSha === sha && x?.conclusion === "success" && x?.event === "push" && x?.headBranch === branch && Number.isSafeInteger(x?.databaseId) && x.databaseId > 0);
  if (!found) fail(`Для orphan tag ${sha} не найден успешный push-CI default branch.`);
  return String(found.databaseId);
}

async function prepareAssets(ctx, identity, sha, runId, dir) {
  const artifact = `docomator-project-control-${sha}`;
  ok(await ctx.run("gh", ["run", "download", runId, "--repo", ctx.repository, "--name", artifact, "--dir", dir], ctx.opts), `Не удалось скачать verified artifact ${artifact}`);
  const project = path.join(dir, `docomator-${identity.version}-project-control.f2re.zip`);
  const projectSum = `${project}.sha256`;
  const projectHash = await verifyChecksum(project, projectSum);
  const manifest = json(ok(await ctx.run("python3", ["-c", READ_ZIP, project, "f2re-service.json"], ctx.opts), "Не удалось прочитать f2re-service.json"), "f2re-service.json");
  if (manifest?.schema !== "f2re-managed-service/v1" || manifest?.controllerApi !== 1 || manifest?.projectId !== "docomator" || manifest?.adapter !== "docomator-v1" || manifest?.nativeBundleFormat !== "docomator-offline-v2" || manifest?.version !== identity.version || manifest?.sourceCommit !== sha) fail("Project Control manifest не совпадает с release identity/exact CI commit.");
  const m = typeof manifest?.payload?.path === "string" ? PAYLOAD.exec(manifest.payload.path) : null;
  if (!m || !m[1].startsWith(`docomator-${identity.version}-linux-`) || !HASH.test(manifest?.payload?.sha256 ?? "") || !Number.isSafeInteger(manifest?.payload?.size) || manifest.payload.size <= 0) fail("Некорректное описание native bundle.");
  const native = path.join(dir, m[1]);
  ok(await ctx.run("python3", ["-c", EXTRACT_ZIP, project, manifest.payload.path, native], ctx.opts), "Не удалось извлечь native bundle");
  await regular(native);
  const stat = await fs.stat(native); const nativeHash = await sha256(native);
  if (stat.size !== manifest.payload.size || nativeHash !== manifest.payload.sha256) fail("Native bundle не совпадает с manifest.");
  const nativeSum = `${native}.sha256`;
  await fs.writeFile(nativeSum, `${nativeHash}  ${path.basename(native)}\n`, { mode: 0o600 });
  const sums = path.join(dir, "SHA256SUMS.txt");
  await fs.writeFile(sums, `${nativeHash}  ${path.basename(native)}\n${projectHash}  ${path.basename(project)}\n`, { mode: 0o600 });
  return { native, nativeSum, project, projectSum, sums };
}

async function releaseBody(dir, identity, sha, assets, notes) {
  const file = path.join(dir, "release-body.md");
  const warning = identity.status === "candidate" ? "> [!WARNING]\n> **candidate / pilot**, не stable/production. CI-сборка готова к скачиванию, но target/Office/recovery/P5 acceptance ещё обязательна.\n\n" : "";
  await fs.writeFile(file, `# Оформлятор ${identity.version}\n\n${warning}## Скачать\n\n- \`${path.basename(assets.native)}\` — автономный application bundle;\n- \`${path.basename(assets.project)}\` — пакет F2RE Project Control;\n- рядом опубликованы .sha256 и SHA256SUMS.txt.\n\n## Установка\n\n\`\`\`bash\nsha256sum -c ${path.basename(assets.nativeSum)}\ntar -xzf ${path.basename(assets.native)}\ncd ${path.basename(assets.native, ".tar.gz")}\nsudo ./install.sh\n\`\`\`\n\nSource commit: \`${sha}\`\n\n---\n\n${notes.trim()}\n`, { mode: 0o600 });
  return file;
}

async function makeVisible(ctx, descriptor, sha, metadata) {
  if (metadata?.isDraft === true) fail(`Release ${descriptor.tag} остался draft.`);
  if (!Number.isSafeInteger(metadata?.databaseId) || metadata.databaseId <= 0) fail(`Release ${descriptor.tag} не содержит databaseId.`);
  if (metadata.isPrerelease !== false || metadata.targetCommitish !== sha) {
    ok(await ctx.run("gh", ["api", "--method", "PATCH", `repos/${ctx.repository}/releases/${metadata.databaseId}`, "-F", "prerelease=false", "-f", `target_commitish=${sha}`, "-f", "make_latest=true"], ctx.opts), `Не удалось сделать Release ${descriptor.tag} видимым`);
    metadata = await releaseView(ctx, descriptor.tag);
  }
  if (!metadata || metadata.isDraft !== false || metadata.isPrerelease !== false || metadata.targetCommitish !== sha) fail(`Release ${descriptor.tag} не прошёл published/visible verification.`);
  return metadata;
}

export async function publishGitHubRelease({ cwd = process.cwd(), environment = process.env, commandRunner = runDefault, makeTempDirectory = async () => fs.mkdtemp(path.join(os.tmpdir(), "docomator-release-")) } = {}) {
  const input = workflowInputs(environment);
  const identity = parseReleaseIdentity(await fs.readFile(path.join(cwd, "RELEASE_IDENTITY.json"), "utf8"));
  if ((await fs.readFile(path.join(cwd, "VERSION"), "utf8")).trim() !== identity.version) fail("VERSION не совпадает с release identity.");
  const descriptor = releaseDescriptor(identity);
  const ctx = { run: commandRunner, repository: input.repository, opts: { cwd, env: environment } };
  const head = ok(await ctx.run("git", ["rev-parse", "HEAD"], ctx.opts), "Не удалось определить Git HEAD");
  if (head !== input.sourceSha) fail(`Checkout ${head} не совпадает с verified CI ${input.sourceSha}.`);

  let existing = await releaseView(ctx, descriptor.tag);
  if (existing) {
    const sha = await tagSha(ctx, descriptor.tag);
    if (!sha) fail(`Release ${descriptor.tag} существует без tag.`);
    existing = await makeVisible(ctx, descriptor, sha, existing);
    return { published: false, tag: descriptor.tag, url: existing.url, reason: "already-published-visible" };
  }

  let sha = input.sourceSha; let runId = input.runId; let notes = await fs.readFile(path.join(cwd, "docs", "RELEASE_NOTES.md"), "utf8"); let verifyTag = false;
  const orphan = await tagSha(ctx, descriptor.tag);
  if (orphan) {
    const oldIdentity = parseReleaseIdentity(await show(ctx, orphan, "RELEASE_IDENTITY.json"));
    const oldVersion = (await show(ctx, orphan, "VERSION")).trim();
    if (JSON.stringify(oldIdentity) !== JSON.stringify(identity) || oldVersion !== identity.version) fail("Orphan tag относится к другой release identity.");
    sha = orphan; runId = await historicalRun(ctx, sha); notes = await show(ctx, sha, "docs/RELEASE_NOTES.md"); verifyTag = true;
  }

  const dir = await makeTempDirectory();
  try {
    const assets = await prepareAssets(ctx, identity, sha, runId, dir);
    const body = await releaseBody(dir, identity, sha, assets, notes);
    const args = ["release", "create", descriptor.tag, assets.native, assets.nativeSum, assets.project, assets.projectSum, assets.sums, "--repo", ctx.repository, "--target", sha, "--title", descriptor.title, "--notes-file", body];
    if (verifyTag) args.push("--verify-tag");
    ok(await ctx.run("gh", args, ctx.opts), `Не удалось создать Release ${descriptor.tag}`);
    let metadata = await releaseView(ctx, descriptor.tag);
    if (!metadata) fail(`Release ${descriptor.tag} создан, но не читается обратно.`);
    metadata = await makeVisible(ctx, descriptor, sha, metadata);
    return { published: true, tag: descriptor.tag, url: metadata.url, sourceSha: sha };
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
}

const invoked = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invoked === fileURLToPath(import.meta.url)) {
  publishGitHubRelease().then((r) => {
    console.log(r.published ? `Опубликован ${r.tag}: ${r.url}\nRelease source commit: ${r.sourceSha}` : `Release ${r.tag} уже опубликован и видим: ${r.url}`);
  }).catch((e) => { console.error(e instanceof Error ? e.message : String(e)); process.exitCode = 1; });
}
