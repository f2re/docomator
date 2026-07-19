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
const forbiddenUiCopy = [
  [/будущий класс доступа/iu, "ложное обещание класса доступа"],
  [/провер(?:ка|ять|яем|ит)\s+прав/iu, "ложное обещание проверки прав"],
  [/настройк[аиу]\s+доступа/iu, "настройки пользовательского доступа"],
  [/(?:изолир|изоляц)\p{L}*/iu, "пользовательскую семантику изоляции данных"],
  [/доступ\p{L}*\s+только\s+в\s+(?:этом|выбранном)\s+пространств/iu, "ограничение доступа пространством"],
  [/доступ\p{L}*\s+пользовател\p{L}*\s+пространств/iu, "доступ пользователей пространства"],
  [/организац\p{L}*\s+данных,\s*доступ\s+и\s+диагностик/iu, "настройки доступа"]
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
  if (!relativePath.startsWith("apps/api/ui")) continue;
  for (const [pattern, description] of forbiddenUiCopy) {
    const match = text.match(pattern);
    if (!match || match.index === undefined) continue;
    const line = text.slice(0, match.index).split("\n").length;
    failures.push(`${relativePath}:${line}: найдено ${description} (${match[0]})`);
  }
}

if (failures.length > 0) {
  process.stderr.write(
    "Исполнимая модель или пользовательская семантика IAM противоречит ADR-0006:\n" +
      failures.map((failure) => `- ${failure}`).join("\n") +
      "\nИзменение продуктовой границы требует нового ADR, а не скрытого возврата ролей.\n"
  );
  process.exitCode = 1;
} else {
  process.stdout.write("Исполнимая и пользовательская модель IAM отсутствует; разделы остаются общей организационной структурой.\n");
}
