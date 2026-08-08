import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const migrationsDirectory = path.join(root, "migrations");
const historicalAllowedDuplicates = new Set(["0026"]);

const files = fs
  .readdirSync(migrationsDirectory)
  .filter((name) => /^\d{4}_.+\.sql$/u.test(name))
  .sort();

const byPrefix = new Map();
for (const file of files) {
  const prefix = file.slice(0, 4);
  const values = byPrefix.get(prefix) ?? [];
  values.push(file);
  byPrefix.set(prefix, values);
}

const invalid = [...byPrefix.entries()].filter(
  ([prefix, values]) => values.length > 1 && !historicalAllowedDuplicates.has(prefix)
);

if (invalid.length > 0) {
  const details = invalid
    .map(([prefix, values]) => `${prefix}: ${values.join(", ")}`)
    .join("\n");
  process.stderr.write(
    `Повторный numeric prefix миграции запрещён. Добавьте новый следующий номер, не переписывая историю:\n${details}\n`
  );
  process.exitCode = 1;
} else {
  process.stdout.write(
    `Migration prefixes are unique; historical exception: ${[...historicalAllowedDuplicates].join(", ")}.\n`
  );
}
