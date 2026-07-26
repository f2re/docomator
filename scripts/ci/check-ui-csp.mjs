import fs from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");
const uiDirectory = path.join(root, "apps/api/ui");
const entries = await fs.readdir(uiDirectory, { withFileTypes: true });
const files = entries
  .filter((entry) => entry.isFile() && /\.(?:js|html)$/u.test(entry.name))
  .map((entry) => path.join(uiDirectory, entry.name));

const forbidden = [
  { pattern: /\sstyle\s*=\s*["']/giu, label: "встроенный атрибут style" },
  { pattern: /\.setAttribute\(\s*["']style["']/gu, label: "setAttribute('style')" },
  { pattern: /\.style(?:\.|\[|\s*=)/gu, label: "изменение element.style" }
];

const failures = [];
for (const file of files) {
  const source = await fs.readFile(file, "utf8");
  for (const rule of forbidden) {
    rule.pattern.lastIndex = 0;
    for (const match of source.matchAll(rule.pattern)) {
      const line = source.slice(0, match.index).split("\n").length;
      failures.push(
        `${path.relative(root, file)}:${line}: ${rule.label} нарушает локальную Content-Security-Policy`
      );
    }
  }
}

if (failures.length > 0) {
  process.stderr.write(
    "Найдены встроенные стили, которые браузер блокирует политикой безопасности:\n" +
      failures.map((failure) => `- ${failure}`).join("\n") +
      "\nИспользуйте классы, атрибуты состояния или нативный элемент progress.\n"
  );
  process.exitCode = 1;
} else {
  process.stdout.write("UI не содержит встроенных стилей, запрещённых CSP.\n");
}
