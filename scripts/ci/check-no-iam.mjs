#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const repositoryRoot = path.resolve(import.meta.dirname, "../..");
const runtimeRoots = [
  "apps/api/src",
  "apps/api/ui",
  "packages/storage/src"
];
const runtimeExtensions = new Set([".html", ".js", ".ts"]);
const forbidden = [
  ["access-members", "маршруты управления доступом к разделам"],
  ["space_actor_memberships", "использование устаревшей таблицы ролей"],
  ["SpaceActorRole", "доменную роль раздела"],
  ["SpaceMembershipStatus", "статус членства в разделе"],
  ["upsertActorMembership", "изменение членства в разделе"],
  ["listActorMemberships", "чтение членства в разделе"]
];

function runtimeFiles(relativeDirectory) {
  const absoluteDirectory = path.join(repositoryRoot, relativeDirectory);
  return fs.readdirSync(absoluteDirectory, { withFileTypes: true }).flatMap((entry) => {
    const relativePath = path.join(relativeDirectory, entry.name);
    if (entry.isDirectory()) return runtimeFiles(relativePath);
    if (!runtimeExtensions.has(path.extname(entry.name))) return [];
    if (/\.(?:test|spec)\.[cm]?[jt]s$/u.test(entry.name)) return [];
    return [relativePath];
  });
}

const failures = [];
for (const relativePath of runtimeRoots.flatMap(runtimeFiles)) {
  const text = fs.readFileSync(path.join(repositoryRoot, relativePath), "utf8");
  for (const [token, description] of forbidden) {
    const index = text.indexOf(token);
    if (index === -1) continue;
    const line = text.slice(0, index).split("\n").length;
    failures.push(`${relativePath}:${line}: найдено ${description} (${token})`);
  }
}

if (failures.length > 0) {
  process.stderr.write(
    "Исполнимая модель IAM противоречит ADR-0006:\n" +
      failures.map((failure) => `- ${failure}`).join("\n") +
      "\nИзменение продуктовой границы требует нового ADR, а не скрытого возврата ролей.\n"
  );
  process.exitCode = 1;
} else {
  process.stdout.write("Исполнимая модель IAM отсутствует; разделы остаются общей организационной структурой.\n");
}
