import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const skillsRoot = path.join(repositoryRoot, ".agents", "skills");
const claudeSkillsRoot = path.join(repositoryRoot, ".claude", "skills");

const expectedSkills = [
  "anti-slop-ui-direction",
  "document-extraction-and-import-review",
  "document-generation-flow",
  "document-template-canvas-and-binding",
  "document-workstation-ux",
  "motion-feedback-and-microinteractions",
  "offline-web-interface-engineering",
  "skill-agent-orchestrator",
  "ui-audit-and-acceptance",
  "ui-skill-router"
].sort();

const forbiddenSkills = [
  "qt-cpp-design-system",
  "meteorologist-workstation-ux",
  "radar-timeline-and-playback",
  "time-data-navigation",
  "viewport-map-interactions",
  "meteorological-visualization"
];

async function skillDirectories(root) {
  const entries = await fs.readdir(root, { withFileTypes: true });
  return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
}

async function exists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

test("project UI skill set is pinned, Docomator-specific and mirrored for Claude", async () => {
  const manifest = JSON.parse(await fs.readFile(path.join(skillsRoot, "VENDOR.json"), "utf8"));
  assert.equal(manifest.schema, "docomator-ai-agent-skills/v1");
  assert.equal(manifest.source.repository, "f2re/ai-agents-skills");
  assert.equal(manifest.source.commit, "c0d03d68771e93a17098cc4bc815e8b9374a15f2");
  assert.deepEqual(manifest.skills.map((item) => item.name).sort(), expectedSkills);
  assert.deepEqual(await skillDirectories(skillsRoot), expectedSkills);
  assert.deepEqual(await skillDirectories(claudeSkillsRoot), expectedSkills);

  for (const name of expectedSkills) {
    const codexContent = await fs.readFile(path.join(skillsRoot, name, "SKILL.md"), "utf8");
    const claudeContent = await fs.readFile(path.join(claudeSkillsRoot, name, "SKILL.md"), "utf8");
    assert.match(codexContent, new RegExp(`^---\\nname: ${name}\\n`, "u"));
    assert.equal(claudeContent, codexContent, `Claude mirror differs for ${name}`);
    assert.match(codexContent, /Anti-pattern/iu, `${name} must document anti-patterns`);
  }

  for (const name of forbiddenSkills) {
    assert.equal(await exists(path.join(skillsRoot, name)), false, `${name} must not be vendored into Docomator`);
    assert.equal(await exists(path.join(claudeSkillsRoot, name)), false, `${name} must not be mirrored into Docomator`);
  }
});

test("existing project agents are augmented instead of replaced", async () => {
  const expectations = new Map([
    ["product-designer.toml", ["$ui-skill-router", "$anti-slop-ui-direction", "$document-workstation-ux", "$ui-audit-and-acceptance"]],
    ["frontend-engineer.toml", ["$offline-web-interface-engineering", "$motion-feedback-and-microinteractions", "$ui-audit-and-acceptance"]],
    ["document-engineer.toml", ["$document-template-canvas-and-binding", "$document-extraction-and-import-review"]],
    ["test-engineer.toml", ["$ui-audit-and-acceptance"]]
  ]);

  for (const [file, tokens] of expectations) {
    const content = await fs.readFile(path.join(repositoryRoot, ".codex", "agents", file), "utf8");
    for (const token of tokens) assert.match(content, new RegExp(token.replaceAll("$", "\\$"), "u"), `${file} missing ${token}`);
  }

  const agentEntries = (await fs.readdir(path.join(repositoryRoot, ".codex", "agents"))).sort();
  assert.ok(agentEntries.includes("product-designer.toml"));
  assert.ok(agentEntries.includes("frontend-engineer.toml"));
  assert.ok(agentEntries.includes("document-engineer.toml"));
  assert.ok(agentEntries.includes("test-engineer.toml"));
  assert.equal(agentEntries.some((name) => /meteo|qt-interface|ui-methodology-director/u.test(name)), false);
});

test("Docomator routing keeps project authority and document truth explicit", async () => {
  const router = await fs.readFile(path.join(skillsRoot, "ui-skill-router", "SKILL.md"), "utf8");
  const template = await fs.readFile(path.join(skillsRoot, "document-template-canvas-and-binding", "SKILL.md"), "utf8");
  const generation = await fs.readFile(path.join(skillsRoot, "document-generation-flow", "SKILL.md"), "utf8");
  const extraction = await fs.readFile(path.join(skillsRoot, "document-extraction-and-import-review", "SKILL.md"), "utf8");
  const web = await fs.readFile(path.join(skillsRoot, "offline-web-interface-engineering", "SKILL.md"), "utf8");

  assert.match(router, /Project-local authority always wins/u);
  assert.match(router, /Do not route Docomator UI to Qt\/QML\/Qwt or meteorological skills/u);
  assert.match(template, /browser DOM.*never.*authoritative binding contract/iu);
  assert.match(generation, /mark old preflight stale immediately/iu);
  assert.match(extraction, /Never recover row\/field semantics by regexp parsing localized error text/iu);
  assert.match(web, /brand-tokens\.css/u);
  assert.match(web, /page-level horizontal overflow at zero at 320 px and 200% text zoom/iu);
});
