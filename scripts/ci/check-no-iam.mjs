#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const repositoryRoot = path.resolve(import.meta.dirname, "../..");
const runtimeRoots = ["apps/api/src", "apps/api/ui", "packages/storage/src"];
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
const requiredAccessCodeTokens = [
  "DOCOMATOR_ACCESS_CODE_HASH",
  "DOCOMATOR_SESSION_SECRET",
  "HttpOnly",
  "SameSite=Strict",
  "^[0-9]{4}$"
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

const files = runtimeRoots.flatMap(runtimeFiles);
const failures = [];
for (const relativePath of files) {
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

const gatePath = path.join(repositoryRoot, "apps/api/src/access-code-gate.ts");
if (!fs.existsSync(gatePath)) {
  failures.push("apps/api/src/access-code-gate.ts: отсутствует общий 4-значный code gate из ADR-0011");
} else {
  const gate = fs.readFileSync(gatePath, "utf8");
  for (const token of requiredAccessCodeTokens) {
    if (!gate.includes(token)) {
      failures.push(`apps/api/src/access-code-gate.ts: отсутствует обязательный инвариант code gate (${token})`);
    }
  }
  for (const forbiddenToken of ["WWW-Authenticate", 'name="username"', 'type="password"']) {
    if (gate.includes(forbiddenToken)) {
      failures.push(`apps/api/src/access-code-gate.ts: запрещён остаток login/password модели (${forbiddenToken})`);
    }
  }
}

if (failures.length > 0) {
  process.stderr.write(
    "Исполнимая модель доступа противоречит ADR-0006/ADR-0011:\n" +
      failures.map((failure) => `- ${failure}`).join("\n") +
      "\nРазрешён один общий 4-значный код; пользователи, логины, роли и ACL требуют отдельного архитектурного решения.\n"
  );
  process.exitCode = 1;
} else {
  process.stdout.write(
    "Общий 4-значный code gate присутствует; исполнимая модель пользователей, логинов, ролей и ACL отсутствует.\n"
  );
}
