from pathlib import Path
import json
import subprocess

legacy = "Doco" + "mator"
brand = "Оформлятор"
tracked = subprocess.check_output(["git", "ls-files", "-z"]).split(b"\0")


def text_files():
    for raw in tracked:
        if not raw:
            continue
        path = Path(raw.decode("utf-8"))
        if not path.exists():
            continue
        data = path.read_bytes()
        if b"\0" in data:
            continue
        try:
            text = data.decode("utf-8")
        except UnicodeDecodeError:
            continue
        yield path, text


for path, text in text_files():
    if legacy in text:
        path.write_text(text.replace(legacy, brand), encoding="utf-8")

phrase_replacements = {
    "# Требования к Оформлятор": "# Требования к продукту «Оформлятор»",
    "# Архитектура Оформлятор": "# Архитектура продукта «Оформлятор»",
    "# План развития Оформлятор": "# План развития продукта «Оформлятор»",
    "# План реализации Оформлятор": "# План реализации продукта «Оформлятор»",
    "# Финализация стабильного выпуска Оформлятор": "# Финализация стабильного выпуска «Оформлятора»",
    "# 🧩 Техническое задание Оформлятор": "# 🧩 Техническое задание «Оформлятор»",
    "# Руководство оператора Оформлятор": "# Руководство оператора «Оформлятора»",
    "# Каталог пользовательских кейсов Оформлятор": "# Каталог пользовательских кейсов «Оформлятора»",
    "# Локальный E2E-контур Оформлятор": "# Локальный E2E-контур «Оформлятора»",
    "# Документация Оформлятор": "# Документация «Оформлятора»",
    "# Оформлятор agent instructions": "# Оформлятор: инструкции для агентов",
    "общим паролем Оформлятор": "общим паролем приложения «Оформлятор»",
    "общий пароль Оформлятор": "общий пароль приложения «Оформлятор»",
    "Введите общий пароль Оформлятор.": "Введите общий пароль «Оформлятора».",
    "Откройте Оформлятор напрямую.": "Откройте «Оформлятор» напрямую.",
    "Войдите в Оформлятор снова.": "Войдите в «Оформлятор» снова.",
    "Рабочий поток Оформлятор": "Рабочий поток «Оформлятора»",
    "Интерфейс Оформлятор должен": "Интерфейс «Оформлятора» должен",
}

for path, text in text_files():
    updated = text
    for source, target in phrase_replacements.items():
        updated = updated.replace(source, target)
    if updated != text:
        path.write_text(updated, encoding="utf-8")

Path("docs/BRANDING.md").write_text(
    '''# Название продукта

Пользовательское название продукта — **«Оформлятор»**.

Это имя используется в веб-интерфейсе, экране входа, встроенной помощи, руководствах, нормативной и эксплуатационной документации.

## Технические идентификаторы совместимости

Исторический технический namespace `docomator` сохраняется без переименования. К нему относятся:

- репозиторий `f2re/docomator`;
- npm-пакеты `@docomator/*` и имя корневого пакета `docomator`;
- переменные окружения `DOCOMATOR_*`;
- systemd-службы и служебные имена `docomator-*`;
- пути `/opt/docomator`, `/etc/docomator` и служебные каталоги с этим именем;
- имена автономных архивов `docomator-<version>-...`;
- cookie `docomator_session`;
- внутренние OOXML-префиксы и маркеры `_DOCOMATOR_*`.

Эти значения являются машинными контрактами установки, обновления, восстановления, API/пакетов или совместимости уже созданных документов, а не отображаемым брендом. Их переименование требует отдельной миграционной итерации и не входит в смену пользовательского названия.

## Правило для новых изменений

Новый пользовательский текст не должен вводить второе название продукта. Для человека продукт называется **«Оформлятор»**; техническое слово `docomator` допустимо только там, где показан реальный путь, команда, пакет, переменная, служба, внутренний маркер или иной неизменяемый идентификатор.
''',
    encoding="utf-8",
)

docs_index = Path("docs/README.md")
text = docs_index.read_text(encoding="utf-8")
branding_row = "| [BRANDING.md](BRANDING.md) | пользовательское название продукта и неизменяемые технические идентификаторы совместимости |\n"
if branding_row not in text:
    marker = "| [INTERFACE_HIERARCHY.md](INTERFACE_HIERARCHY.md) |"
    position = text.find(marker)
    if position >= 0:
        line_end = text.find("\n", position)
        text = text[: line_end + 1] + branding_row + text[line_end + 1 :]
    else:
        text += "\n" + branding_row
    docs_index.write_text(text, encoding="utf-8")

readme = Path("README.md")
text = readme.read_text(encoding="utf-8")
note = "> [!NOTE]\n> Пользовательское название продукта — **«Оформлятор»**. Технические идентификаторы `docomator`, `@docomator/*`, `DOCOMATOR_*`, systemd-службы, пути и имена автономных архивов сохранены для совместимости; см. [BRANDING](docs/BRANDING.md).\n\n"
if note not in text:
    paragraph_end = text.find("\n\n", text.find("\n") + 1)
    text = text[: paragraph_end + 2] + note + text[paragraph_end + 2 :]
    readme.write_text(text, encoding="utf-8")

notes = Path("docs/RELEASE_NOTES.md")
text = notes.read_text(encoding="utf-8")
section = '''## 2026-08-11 — пользовательское имя «Оформлятор»

- Пользовательское название продукта изменено на **«Оформлятор»** во всех пользовательских экранах, экране входа, встроенной помощи, руководствах и нормативной документации.
- Исторические технические идентификаторы `docomator`, `@docomator/*`, `DOCOMATOR_*`, systemd-службы, пути, cookie, имена автономных архивов и OOXML-маркеры сохранены без миграции для совместимости установки, обновления, восстановления и уже созданных документов.
- Добавлена автоматическая проверка бренда: старое отображаемое название не может незаметно вернуться в отслеживаемые текстовые файлы.
- Версия и статус выпуска не меняются: `0.1.0 / candidate / pilot`.

'''
if section not in text:
    marker = "## 2026-08-08"
    position = text.find(marker)
    if position < 0:
        raise SystemExit("release notes insertion marker not found")
    text = text[:position] + section + text[position:]
    notes.write_text(text, encoding="utf-8")

checker = '''import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const legacyBrand = "Doco" + "mator";
const expectedBrand = "Оформлятор";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function trackedFiles() {
  return execFileSync("git", ["ls-files", "-z"], { cwd: root })
    .toString("utf8")
    .split("\\0")
    .filter(Boolean);
}

async function inspectText(relativePath) {
  const absolutePath = path.join(root, relativePath);
  const buffer = await fs.readFile(absolutePath);
  if (buffer.includes(0)) return null;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    return null;
  }
}

export async function checkBranding() {
  const findings = [];
  for (const relativePath of trackedFiles()) {
    const text = await inspectText(relativePath);
    if (text?.includes(legacyBrand)) findings.push(relativePath);
  }

  const required = [
    "README.md",
    "docs/BRANDING.md",
    "apps/api/ui/index.html",
    "apps/api/ui/help-center.js",
    "apps/api/src/password-gate.ts"
  ];
  for (const relativePath of required) {
    const text = await inspectText(relativePath);
    if (!text?.includes(expectedBrand)) {
      findings.push(`${relativePath}: отсутствует пользовательское имя ${expectedBrand}`);
    }
  }

  if (findings.length > 0) {
    throw new Error(`Проверка бренда не пройдена:\\n- ${findings.join("\\n- ")}`);
  }
}

const invokedPath = process.argv[1] === undefined ? "" : path.resolve(process.argv[1]);
if (invokedPath === fileURLToPath(import.meta.url)) {
  checkBranding().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
'''
Path("scripts/ci/check-branding.mjs").write_text(checker, encoding="utf-8")

package_path = Path("package.json")
package = json.loads(package_path.read_text(encoding="utf-8"))
scripts = package["scripts"]
scripts["check:branding"] = "node scripts/ci/check-branding.mjs"
if "npm run check:branding" not in scripts["check"]:
    scripts["check"] += " && npm run check:branding"
package_path.write_text(json.dumps(package, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
