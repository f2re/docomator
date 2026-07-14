#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const repositoryRoot = path.resolve(import.meta.dirname, "../..");

const files = [
  "apps/api/ui/index.html",
  "apps/api/ui/app.js",
  "apps/api/ui/document-intake.js",
  "apps/api/ui/document-structure.js",
  "apps/api/ui/template-trial.js",
  "apps/api/ui/template-multi-trial.js",
  "apps/api/ui/template-activation.js",
  "apps/api/ui/document-generation.js",
  "apps/api/ui/document-generation-preflight.js",
  "apps/api/ui/document-data-correction.js",
  "apps/api/ui/document-generation-retry.js",
  "apps/api/ui/document-delivery.js",
  "apps/api/ui/document-email-delivery.js",
  "apps/api/ui/email-recipients.js",
  "apps/api/src/user-message.ts",
  "scripts/offline/first-run.sh"
];

const forbidden = [
  [/(?:^|[^\p{L}])Backend(?:$|[^\p{L}])/giu, "серверная часть"],
  [/Template Compiler/giu, "компилятор шаблонов"],
  [/(?:^|[^\p{L}])renderer(?:$|[^\p{L}])/giu, "модуль формирования"],
  [/Snapshot ID/giu, "идентификатор снимка"],
  [/Correlation ID/giu, "идентификатор операции"],
  [/guided flow/giu, "пошаговый процесс"],
  [/(?:^|[^\p{L}])spinner(?:$|[^\p{L}])/giu, "индикатор ожидания"],
  [/(?:^|[^\p{L}])Owner(?:$|[^\p{L}])/gu, "владелец"],
  [/(?:^|[^\p{L}])Manager(?:$|[^\p{L}])/gu, "руководитель"],
  [/(?:^|[^\p{L}])Editor(?:$|[^\p{L}])/gu, "редактор"],
  [/(?:^|[^\p{L}])Viewer(?:$|[^\p{L}])/gu, "наблюдатель"],
  [/Usage:/gu, "Использование:"],
  [/Options:/gu, "Параметры:"]
];

const failures = [];
for (const relativePath of files) {
  const absolutePath = path.join(repositoryRoot, relativePath);
  const text = fs.readFileSync(absolutePath, "utf8");
  for (const [pattern, replacement] of forbidden) {
    pattern.lastIndex = 0;
    const match = pattern.exec(text);
    if (match !== null) {
      const line = text.slice(0, match.index).split("\n").length;
      failures.push(
        `${relativePath}:${line}: «${match[0].trim()}» → используйте «${replacement}»`
      );
    }
  }
}

if (failures.length > 0) {
  process.stderr.write(
    "Найдены нежелательные англоязычные слова в пользовательских текстах:\n" +
      failures.map((failure) => `- ${failure}`).join("\n") +
      "\n"
  );
  process.exitCode = 1;
} else {
  process.stdout.write("Пользовательские тексты прошли проверку русской терминологии.\n");
}
