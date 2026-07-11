#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const roots = ["README.md", "CONTRIBUTING.md", "SECURITY.md", "AGENTS.md", "docs"];
const markdownFiles = [];

function collect(target) {
  if (!fs.existsSync(target)) {
    return;
  }
  const stat = fs.statSync(target);
  if (stat.isFile() && target.endsWith(".md")) {
    markdownFiles.push(target);
    return;
  }
  if (!stat.isDirectory()) {
    return;
  }
  for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
    collect(path.join(target, entry.name));
  }
}

for (const root of roots) {
  collect(root);
}

const failures = [];
const linkPattern = /\[[^\]]*\]\(([^)]+)\)/g;

for (const file of markdownFiles) {
  const content = fs.readFileSync(file, "utf8");
  for (const match of content.matchAll(linkPattern)) {
    let link = match[1]?.trim();
    if (!link || /^(?:https?:|mailto:|#)/.test(link)) {
      continue;
    }
    link = link.split("#", 1)[0];
    if (!link || link.includes("{{")) {
      continue;
    }
    const decoded = decodeURIComponent(link.replace(/^<|>$/g, ""));
    const resolved = path.resolve(path.dirname(file), decoded);
    if (!fs.existsSync(resolved)) {
      failures.push(`${file}: missing ${decoded}`);
    }
  }
}

if (failures.length > 0) {
  process.stderr.write(`${failures.join("\n")}\n`);
  process.exit(1);
}

process.stdout.write(`Checked ${markdownFiles.length} Markdown files.\n`);
