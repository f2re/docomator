import { createHash } from "node:crypto";
import { access, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, "../..");
const OUTPUT = path.join(ROOT, "apps/api/ui/generated-documentation.js");
const CHECK = process.argv.includes("--check");
const ROOT_DOCUMENTS = ["README.md", "CHANGELOG.md", "SECURITY.md", "CONTRIBUTING.md"];
const CATEGORY_ORDER = [
  "Начало работы",
  "Работа оператора",
  "Установка и эксплуатация",
  "API и интеграция",
  "Архитектура и разработка",
  "Архитектурные решения",
  "Прочее"
];

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function markdownFiles(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      result.push(...(await markdownFiles(absolute)));
    } else if (entry.isFile() && entry.name.toLocaleLowerCase("en-US").endsWith(".md")) {
      result.push(absolute);
    }
  }
  return result;
}

function normalizePath(value) {
  return value.split(path.sep).join("/");
}

function normalizeText(value) {
  return value.replace(/\r\n?/gu, "\n").normalize("NFKC");
}

function slug(value) {
  const result = value
    .normalize("NFKC")
    .toLocaleLowerCase("ru-RU")
    .replace(/ё/gu, "е")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 120);
  return result || "document";
}

function stripInlineMarkdown(value) {
  return value
    .replace(/!\[([^\]]*)\]\([^)]*\)/gu, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/gu, "$1")
    .replace(/`([^`]+)`/gu, "$1")
    .replace(/[*_~>#|]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function titleFor(relativePath, markdown) {
  const heading = /^#\s+(.+)$/mu.exec(markdown)?.[1];
  if (heading) return stripInlineMarkdown(heading);
  return path.basename(relativePath, ".md").replace(/[-_]+/gu, " ");
}

function descriptionFor(markdown, title) {
  const lines = markdown.split("\n");
  let inFence = false;
  const paragraph = [];
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (/^```/u.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence || line === "" || /^#{1,6}\s/u.test(line)) {
      if (paragraph.length > 0) break;
      continue;
    }
    if (/^(?:[-*+]\s|\d+[.)]\s|\||>|---+$)/u.test(line)) {
      if (paragraph.length > 0) break;
      continue;
    }
    paragraph.push(line);
    if (paragraph.join(" ").length >= 260) break;
  }
  const result = stripInlineMarkdown(paragraph.join(" "));
  return (result || `Документ «${title}».`).slice(0, 320);
}

function headingsFor(markdown) {
  const headings = [];
  const used = new Map();
  let inFence = false;
  for (const rawLine of markdown.split("\n")) {
    if (/^```/u.test(rawLine.trim())) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const match = /^(#{1,4})\s+(.+?)\s*#*\s*$/u.exec(rawLine);
    if (!match) continue;
    const text = stripInlineMarkdown(match[2] ?? "");
    if (!text) continue;
    const base = slug(text);
    const count = (used.get(base) ?? 0) + 1;
    used.set(base, count);
    headings.push({
      level: match[1]?.length ?? 1,
      text,
      anchor: count === 1 ? base : `${base}-${count}`
    });
  }
  return headings;
}

function categoryFor(relativePath) {
  const normalized = relativePath.toLocaleLowerCase("en-US");
  const name = path.basename(normalized);
  if (normalized.startsWith("docs/adr/")) return "Архитектурные решения";
  if (
    name === "readme.md" ||
    /quick[_-]?start|user[_-]?guide|getting[_-]?started/u.test(name)
  ) {
    return "Начало работы";
  }
  if (
    /import|operator|workflow|flow[_-]?catalog|template|generation|schedule|document|roster|employee|user[_-]?message/u.test(name)
  ) {
    return "Работа оператора";
  }
  if (
    /deploy|installation|offline|operation|backup|restore|maintenance|release|security|pilot|runbook|troubleshoot/u.test(name)
  ) {
    return "Установка и эксплуатация";
  }
  if (/api|contract|integration|provider|registry/u.test(name)) {
    return "API и интеграция";
  }
  if (
    /architecture|requirement|implementation|roadmap|persistence|compiler|design|development|contributing/u.test(name)
  ) {
    return "Архитектура и разработка";
  }
  return "Прочее";
}

function searchTextFor(markdown) {
  return stripInlineMarkdown(
    markdown
      .replace(/```[\s\S]*?```/gu, " ")
      .replace(/https?:\/\/\S+/gu, " ")
  ).slice(0, 200_000);
}

async function collectDocuments() {
  const files = [];
  for (const file of ROOT_DOCUMENTS) {
    const absolute = path.join(ROOT, file);
    if (await exists(absolute)) files.push(absolute);
  }
  const docsRoot = path.join(ROOT, "docs");
  if (await exists(docsRoot)) files.push(...(await markdownFiles(docsRoot)));
  files.sort((left, right) => normalizePath(left).localeCompare(normalizePath(right), "ru-RU"));

  const usedIds = new Map();
  const documents = [];
  for (const absolute of files) {
    const relativePath = normalizePath(path.relative(ROOT, absolute));
    const markdown = normalizeText(await readFile(absolute, "utf8"));
    const title = titleFor(relativePath, markdown);
    const baseId = slug(relativePath.replace(/\.md$/iu, ""));
    const count = (usedIds.get(baseId) ?? 0) + 1;
    usedIds.set(baseId, count);
    const id = count === 1 ? baseId : `${baseId}-${count}`;
    const headings = headingsFor(markdown);
    documents.push({
      id,
      path: relativePath,
      title,
      description: descriptionFor(markdown, title),
      category: categoryFor(relativePath),
      headings,
      searchText: searchTextFor(markdown),
      markdown
    });
  }

  documents.sort((left, right) => {
    const category = CATEGORY_ORDER.indexOf(left.category) - CATEGORY_ORDER.indexOf(right.category);
    if (category !== 0) return category;
    const priority = (document) => {
      if (document.path === "docs/QUICK_START.md") return 0;
      if (document.path === "docs/USER_GUIDE.md") return 1;
      if (document.path === "docs/IMPORT_AND_WORD_ROSTERS.md") return 2;
      if (document.path === "docs/FLOW_CATALOG.md") return 3;
      if (document.path === "README.md") return 4;
      return 10;
    };
    const rank = priority(left) - priority(right);
    return rank || left.title.localeCompare(right.title, "ru-RU");
  });
  return documents;
}

function generatedSource(documents) {
  const sourceHash = createHash("sha256");
  for (const document of documents) {
    sourceHash.update(document.path);
    sourceHash.update("\u0000");
    sourceHash.update(document.markdown);
    sourceHash.update("\u0000");
  }
  const catalog = {
    schemaVersion: 1,
    sourceSha256: sourceHash.digest("hex"),
    categoryOrder: CATEGORY_ORDER,
    documents
  };
  const json = JSON.stringify(catalog, null, 2)
    .replace(/\u2028/gu, "\\u2028")
    .replace(/\u2029/gu, "\\u2029");
  return `// Сгенерировано scripts/docs/build-web-docs.mjs. Не редактировать вручную.\n` +
    `globalThis.docomatorDocumentationCatalog = Object.freeze(${json});\n`;
}

const documents = await collectDocuments();
if (documents.length === 0) {
  throw new Error("Не найдено ни одного Markdown-документа для веб-справки.");
}
const expected = generatedSource(documents);

if (CHECK) {
  const actual = (await exists(OUTPUT)) ? await readFile(OUTPUT, "utf8") : "";
  if (actual !== expected) {
    console.error("Веб-каталог документации устарел.");
    console.error("Выполните: npm run docs:web:build");
    process.exitCode = 1;
  } else {
    console.log(`Веб-каталог документации актуален: ${documents.length} документов.`);
  }
} else {
  await mkdir(path.dirname(OUTPUT), { recursive: true });
  await writeFile(OUTPUT, expected, "utf8");
  console.log(`Собран веб-каталог: ${documents.length} документов -> ${path.relative(ROOT, OUTPUT)}`);
}
