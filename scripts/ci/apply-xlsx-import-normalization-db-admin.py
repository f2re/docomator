from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def read(relative: str) -> str:
    return (ROOT / relative).read_text(encoding="utf-8")


def write(relative: str, value: str) -> None:
    path = ROOT / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(value, encoding="utf-8")
    print(f"updated {relative}")


def replace_once(relative: str, old: str, new: str) -> None:
    value = read(relative)
    count = value.count(old)
    if count != 1:
        raise RuntimeError(
            f"{relative}: ожидалось одно вхождение, найдено {count}: {old[:180]!r}"
        )
    write(relative, value.replace(old, new, 1))


def insert_before_once(relative: str, marker: str, addition: str) -> None:
    value = read(relative)
    if addition.strip() in value:
        return
    count = value.count(marker)
    if count != 1:
        raise RuntimeError(
            f"{relative}: маркер найден {count} раз: {marker[:180]!r}"
        )
    write(relative, value.replace(marker, addition + marker, 1))


def insert_after_once(relative: str, marker: str, addition: str) -> None:
    value = read(relative)
    if addition.strip() in value:
        return
    count = value.count(marker)
    if count != 1:
        raise RuntimeError(
            f"{relative}: маркер найден {count} раз: {marker[:180]!r}"
        )
    write(relative, value.replace(marker, marker + addition, 1))


def find_matching_brace(source: str, opening: int) -> int:
    depth = 0
    quote: str | None = None
    escaped = False
    line_comment = False
    block_comment = False
    index = opening
    while index < len(source):
        current = source[index]
        following = source[index + 1] if index + 1 < len(source) else ""
        if line_comment:
            if current == "\n":
                line_comment = False
            index += 1
            continue
        if block_comment:
            if current == "*" and following == "/":
                block_comment = False
                index += 2
                continue
            index += 1
            continue
        if quote:
            if escaped:
                escaped = False
            elif current == "\\":
                escaped = True
            elif current == quote:
                quote = None
            index += 1
            continue
        if current == "/" and following == "/":
            line_comment = True
            index += 2
            continue
        if current == "/" and following == "*":
            block_comment = True
            index += 2
            continue
        if current in ('"', "'", "`"):
            quote = current
            index += 1
            continue
        if current == "{":
            depth += 1
        elif current == "}":
            depth -= 1
            if depth == 0:
                return index
        index += 1
    raise RuntimeError("Не найдена закрывающая фигурная скобка")


# Remove temporary markers from earlier audit attempts.
for relative in [
    "_probe_should_not_exist",
    "scripts/ci/.keep-import-audit",
    "scripts/ci/start-import-audit.txt",
]:
    path = ROOT / relative
    if path.exists():
        path.unlink()
        print(f"removed {relative}")

# Storage dependency and exports.
storage_package_path = ROOT / "packages/storage/package.json"
storage_package = json.loads(storage_package_path.read_text(encoding="utf-8"))
dependencies = storage_package.setdefault("dependencies", {})
dependencies.setdefault("fflate", "0.8.2")
storage_package_path.write_text(
    json.dumps(storage_package, ensure_ascii=False, indent=2) + "\n",
    encoding="utf-8",
)
print("updated packages/storage/package.json")

storage_index = read("packages/storage/src/index.ts")
for export_line in [
    'export * from "./aligned-xlsx-import.js";\n',
    'export * from "./import-normalization.js";\n',
]:
    if export_line not in storage_index:
        storage_index += export_line
write("packages/storage/src/index.ts", storage_index)

# Replace the old XLSX reader with coordinate-aware parsing while preserving the
# public function signature used by the preview registry.
candidates: list[Path] = []
for path in (ROOT / "packages/storage/src").glob("*.ts"):
    if path.name in {"aligned-xlsx-import.ts", "aligned-xlsx-import.test.ts"}:
        continue
    source = path.read_text(encoding="utf-8")
    if "sharedStrings.xml" in source and "worksheet" in source.lower():
        candidates.append(path)
if len(candidates) != 1:
    raise RuntimeError(
        f"Ожидался один прежний XLSX-парсер, найдено: {[str(path) for path in candidates]}"
    )
parser_path = candidates[0]
parser_source = parser_path.read_text(encoding="utf-8")
marker_index = parser_source.index("sharedStrings.xml")
function_pattern = re.compile(
    r"(?P<prefix>(?:export\s+)?(?:async\s+)?function\s+(?P<name>[A-Za-z_$][\w$]*)\s*\([^)]*\)\s*(?::\s*[^\{]+)?)(?P<brace>\{)",
    re.M,
)
functions = [match for match in function_pattern.finditer(parser_source, 0, marker_index)]
selected = None
for match in reversed(functions):
    closing = find_matching_brace(parser_source, match.start("brace"))
    if closing > marker_index:
        selected = (match, closing)
        break
if selected is None:
    raise RuntimeError(f"Не найдена функция XLSX-парсера в {parser_path}")
match, closing = selected
old_body = parser_source[match.start("brace") : closing + 1]
if "headers" not in old_body or "rows" not in old_body:
    raise RuntimeError(
        f"Функция {match.group('name')} не возвращает ожидаемую таблицу headers/rows"
    )
new_body = '''{
  const sourceCandidate = arguments[0] as unknown;
  const alignedSource =
    Buffer.isBuffer(sourceCandidate) || sourceCandidate instanceof Uint8Array
      ? sourceCandidate
      : (sourceCandidate as { buffer?: Buffer | Uint8Array })?.buffer;
  if (!alignedSource) {
    throw new Error("Не получено содержимое XLSX для импорта.");
  }
  return parseAlignedXlsxImport(alignedSource);
}'''
parser_source = (
    parser_source[: match.start("brace")]
    + new_body
    + parser_source[closing + 1 :]
)
import_line = 'import { parseAlignedXlsxImport } from "./aligned-xlsx-import.js";\n'
if import_line not in parser_source:
    last_import = list(re.finditer(r"^import[\s\S]*?;\n", parser_source, re.M))
    if not last_import:
        parser_source = import_line + parser_source
    else:
        position = last_import[-1].end()
        parser_source = parser_source[:position] + import_line + parser_source[position:]
parser_path.write_text(parser_source, encoding="utf-8")
print(f"replaced XLSX parser in {parser_path.relative_to(ROOT)}")

# Extend data-import input types and normalize rows before assisted mapping.
assist_path = "packages/storage/src/data-import-assist.ts"
assist = read(assist_path)
normalization_import = '''import {
  type ImportCellNormalization,
  type PersonNameSplitOptions,
  normalizeImportRow,
  splitRussianPersonName
} from "./import-normalization.js";
'''
if normalization_import not in assist:
    imports = list(re.finditer(r"^import[\s\S]*?;\n", assist, re.M))
    if not imports:
        assist = normalization_import + assist
    else:
        position = imports[-1].end()
        assist = assist[:position] + normalization_import + assist[position:]

# Mapping interface: locate the interface containing column and createIfMissing.
interface_pattern = re.compile(
    r"export interface (?P<name>[A-Za-z_$][\w$]*)\s*\{(?P<body>[\s\S]*?)\n\}",
    re.M,
)
mapping_match = next(
    (
        match
        for match in interface_pattern.finditer(assist)
        if "column:" in match.group("body") and "createIfMissing" in match.group("body")
    ),
    None,
)
if mapping_match is None:
    raise RuntimeError("Не найден интерфейс сопоставления assisted import")
if "normalization?: ImportCellNormalization;" not in mapping_match.group("body"):
    body = mapping_match.group("body")
    column_line = re.search(r"\n\s*column:\s*string;", body)
    if not column_line:
        raise RuntimeError("Не найдена колонка в интерфейсе mapping")
    insert_at = mapping_match.start("body") + column_line.end()
    assist = (
        assist[:insert_at]
        + "\n  normalization?: ImportCellNormalization;"
        + assist[insert_at:]
    )

# Main input interface contains headers, rows, identity/display names and mappings.
input_match = next(
    (
        match
        for match in interface_pattern.finditer(assist)
        if all(
            token in match.group("body")
            for token in ["identityColumn", "displayNameColumn", "headers", "rows", "mappings"]
        )
    ),
    None,
)
if input_match is None:
    raise RuntimeError("Не найден основной интерфейс assisted import")
input_options = '''
  identityCaseInsensitive?: boolean;
  identityNormalization?: ImportCellNormalization;
  displayNameNormalization?: ImportCellNormalization;
  personNameSplit?: PersonNameSplitOptions;'''
if "personNameSplit?: PersonNameSplitOptions;" not in input_match.group("body"):
    line = re.search(r"\n\s*displayNameColumn:\s*string;", input_match.group("body"))
    if not line:
        raise RuntimeError("Не найден displayNameColumn в assisted input")
    insert_at = input_match.start("body") + line.end()
    assist = assist[:insert_at] + input_options + assist[insert_at:]

helper = r'''
const SPLIT_FAMILY_COLUMN = "__docomator_family_name";
const SPLIT_GIVEN_COLUMN = "__docomator_given_name";
const SPLIT_PATRONYMIC_COLUMN = "__docomator_patronymic";

function prepareNormalizedAssistedInput<T extends {
  headers: string[];
  rows: Array<Record<string, unknown>>;
  mappings: Array<{
    column: string;
    normalization?: ImportCellNormalization;
    [key: string]: unknown;
  }>;
  identityColumn: string;
  displayNameColumn: string;
  identityNormalization?: ImportCellNormalization;
  displayNameNormalization?: ImportCellNormalization;
  personNameSplit?: PersonNameSplitOptions;
}>(input: T, entityTypeKey: string): T {
  const mappings = input.mappings.map((mapping) => ({ ...mapping }));
  const rows = input.rows.map((row) =>
    normalizeImportRow(row, mappings, input)
  );
  const headers = [...input.headers];
  const split = entityTypeKey === "person" && input.personNameSplit?.enabled === true;
  if (split) {
    for (const column of [
      SPLIT_FAMILY_COLUMN,
      SPLIT_GIVEN_COLUMN,
      SPLIT_PATRONYMIC_COLUMN
    ]) {
      if (!headers.includes(column)) headers.push(column);
    }
    for (const row of rows) {
      const parsed = splitRussianPersonName(
        row[input.personNameSplit?.sourceColumn || input.displayNameColumn],
        input.personNameSplit
      );
      row[input.displayNameColumn] = parsed.normalizedDisplayName;
      row[SPLIT_FAMILY_COLUMN] = parsed.familyName;
      row[SPLIT_GIVEN_COLUMN] = parsed.givenName;
      row[SPLIT_PATRONYMIC_COLUMN] = parsed.patronymic;
    }
    const definitions = [
      [SPLIT_FAMILY_COLUMN, "Фамилия", ["Фамилия участника", "Surname"]],
      [SPLIT_GIVEN_COLUMN, "Имя", ["Имя участника", "Given name"]],
      [SPLIT_PATRONYMIC_COLUMN, "Отчество", ["Отчество участника", "Patronymic"]]
    ] as const;
    for (const [column, label, aliases] of definitions) {
      if (mappings.some((mapping) => mapping.column === column)) continue;
      mappings.push({
        column,
        createIfMissing: true,
        label,
        aliases: [...aliases],
        valueType: "string",
        sensitivity: "personal",
        normalization: { case: "name", trim: true, collapseWhitespace: true }
      });
    }
  }
  return {
    ...input,
    headers,
    rows,
    mappings
  };
}

'''
class_marker = "export class AssistedDataImportRegistry"
if helper.strip() not in assist:
    if class_marker not in assist:
        raise RuntimeError("Не найден AssistedDataImportRegistry")
    assist = assist.replace(class_marker, helper + class_marker, 1)

entity_key_pattern = re.compile(
    r"(?P<indent>\s*)const entityTypeKey = \(input\.entityTypeKey \?\? \"person\"\)\.trim\(\)\.toLowerCase\(\);"
)
entity_key_matches = list(entity_key_pattern.finditer(assist))
if not entity_key_matches:
    raise RuntimeError("Не найдена инициализация entityTypeKey в assisted import")
# Only the preparation path needs row normalization; the first occurrence is the
# shared resolver used by both plan and execute.
first = entity_key_matches[0]
statement = first.group(0)
if "prepareNormalizedAssistedInput" not in assist[first.end() : first.end() + 220]:
    replacement = (
        statement
        + f"\n{first.group('indent')}input = prepareNormalizedAssistedInput(input, entityTypeKey);"
    )
    assist = assist[: first.start()] + replacement + assist[first.end() :]
write(assist_path, assist)

# DataImportRegistry compares identity strings case-insensitively while still
# storing the operator-selected representation.
import_path = "packages/storage/src/data-import.ts"
source = read(import_path)
normalization_import_line = 'import { normalizeIdentityForComparison } from "./import-normalization.js";\n'
if normalization_import_line not in source:
    imports = list(re.finditer(r"^import[\s\S]*?;\n", source, re.M))
    if not imports:
        source = normalization_import_line + source
    else:
        position = imports[-1].end()
        source = source[:position] + normalization_import_line + source[position:]

# Extend mapping and execution interfaces when they exist in the lower registry.
for match in list(interface_pattern.finditer(source)):
    body = match.group("body")
    if "column:" in body and "propertyKey" in body and "normalization?:" not in body:
        column_line = re.search(r"\n\s*column:\s*string;", body)
        if column_line:
            insert_at = match.start("body") + column_line.end()
            source = source[:insert_at] + "\n  normalization?: ImportCellNormalization;" + source[insert_at:]
            break
# Type-only import is only needed if the lower interface was extended.
if "normalization?: ImportCellNormalization;" in source and "type ImportCellNormalization" not in source:
    source = source.replace(
        normalization_import_line,
        'import {\n  type ImportCellNormalization,\n  normalizeIdentityForComparison\n} from "./import-normalization.js";\n',
        1,
    )

normalize_function = re.search(
    r"function normalizeIdentity\s*\([^)]*\)\s*(?::\s*[^\{]+)?\{",
    source,
)
if normalize_function is None:
    raise RuntimeError("В data-import.ts не найдена normalizeIdentity")
normalize_close = find_matching_brace(source, normalize_function.end() - 1)
source = (
    source[: normalize_function.end()]
    + "\n  return normalizeIdentityForComparison(value);\n"
    + source[normalize_close:]
)
write(import_path, source)

# API validation accepts the new optional controls.
routes_path = "apps/api/src/data-import-routes.ts"
routes = read(routes_path)
normalization_schema = '''const importCellNormalizationSchema = z.object({
  trim: z.boolean().optional(),
  collapseWhitespace: z.boolean().optional(),
  unicode: z.enum(["NFC", "NFKC"]).optional(),
  case: z.enum(["preserve", "lower", "upper", "title", "name"]).optional()
});

const personNameSplitSchema = z.object({
  enabled: z.boolean().optional(),
  sourceColumn: z.string().min(1).max(500).optional(),
  order: z
    .enum(["family-given-patronymic", "given-patronymic-family"])
    .optional(),
  normalization: importCellNormalizationSchema.optional()
});

'''
if "const importCellNormalizationSchema" not in routes:
    mapping_marker = re.search(r"const\s+\w*[Mm]apping\w*Schema\s*=\s*z\.object\(\{", routes)
    if mapping_marker is None:
        raise RuntimeError("Не найдена Zod-схема сопоставления импорта")
    routes = routes[: mapping_marker.start()] + normalization_schema + routes[mapping_marker.start() :]

# Locate mapping z.object and inject normalization before its closing brace.
mapping_marker = re.search(r"const\s+\w*[Mm]apping\w*Schema\s*=\s*z\.object\(\{", routes)
if mapping_marker is None:
    raise RuntimeError("Не найдена mapping schema после вставки")
mapping_open = routes.index("{", mapping_marker.start())
mapping_close = find_matching_brace(routes, mapping_open)
mapping_body = routes[mapping_open:mapping_close]
if "normalization:" not in mapping_body:
    routes = (
        routes[:mapping_close]
        + "  normalization: importCellNormalizationSchema.optional(),\n"
        + routes[mapping_close:]
    )

# Main input schema: the object containing identityColumn/displayNameColumn/mappings.
object_matches = list(re.finditer(r"z\.object\(\{", routes))
main_object = None
for object_match in object_matches:
    opening = routes.index("{", object_match.start())
    closing = find_matching_brace(routes, opening)
    body = routes[opening:closing]
    if all(token in body for token in ["identityColumn", "displayNameColumn", "mappings"]):
        main_object = (opening, closing)
        break
if main_object is None:
    raise RuntimeError("Не найдена основная схема plan/execute")
opening, closing = main_object
body = routes[opening:closing]
if "personNameSplit:" not in body:
    addition = '''  identityCaseInsensitive: z.boolean().optional(),
  identityNormalization: importCellNormalizationSchema.optional(),
  displayNameNormalization: importCellNormalizationSchema.optional(),
  personNameSplit: personNameSplitSchema.optional(),
'''
    display_line = re.search(r"\n\s*displayNameColumn:[^\n]+\n", body)
    if display_line is None:
        raise RuntimeError("Не найден displayNameColumn в Zod-схеме")
    insert_at = opening + display_line.end()
    routes = routes[:insert_at] + addition + routes[insert_at:]
write(routes_path, routes)

# UI bundle and syntax checks.
replace_once(
    "apps/api/src/ui-routes.ts",
    '      "entity-workspace.css",\n',
    '      "entity-workspace.css",\n      "import-normalization.css",\n',
)
# The import enhancer must run after both employee and generic import modules.
ui_routes = read("apps/api/src/ui-routes.ts")
if '      "import-normalization.js"' not in ui_routes:
    marker = '      "operations-readiness.js"'
    if marker not in ui_routes:
        raise RuntimeError("Не найден конец document-intake UI bundle")
    ui_routes = ui_routes.replace(
        marker,
        marker + ',\n      "import-normalization.js"',
        1,
    )
    write("apps/api/src/ui-routes.ts", ui_routes)

bundle_check = read("scripts/ci/check-ui-bundles.mjs")
if '    "import-normalization.js"' not in bundle_check:
    marker = '    "operations-readiness.js"'
    if marker not in bundle_check:
        raise RuntimeError("Не найден список document-intake bundle")
    bundle_check = bundle_check.replace(
        marker,
        marker + ',\n    "import-normalization.js"',
        1,
    )
    write("scripts/ci/check-ui-bundles.mjs", bundle_check)

root_package_path = ROOT / "package.json"
root_package = json.loads(root_package_path.read_text(encoding="utf-8"))
scripts = root_package.setdefault("scripts", {})
scripts["admin:db"] = "node scripts/runtime/db-admin.mjs"
check_ui = scripts.get("check:ui", "")
if "apps/api/ui/import-normalization.js" not in check_ui:
    check_ui = check_ui.replace(
        "node scripts/ci/check-ui-bundles.mjs",
        "node --check apps/api/ui/import-normalization.js && node scripts/ci/check-ui-bundles.mjs",
    )
    scripts["check:ui"] = check_ui
check_runtime = scripts.get("check:runtime", "")
if "scripts/runtime/db-admin.mjs" not in check_runtime:
    check_runtime += " && node --check scripts/runtime/db-admin.mjs"
    scripts["check:runtime"] = check_runtime
root_package_path.write_text(
    json.dumps(root_package, ensure_ascii=False, indent=2) + "\n",
    encoding="utf-8",
)
print("updated package.json")

language = read("scripts/ci/check-user-facing-language.mjs")
if '  "apps/api/ui/import-normalization.js",\n' not in language:
    marker = '  "apps/api/ui/entity-workspace.js",\n'
    if marker not in language:
        marker = '  "apps/api/ui/document-intake.js",\n'
    language = language.replace(
        marker,
        marker + '  "apps/api/ui/import-normalization.js",\n',
        1,
    )
    write("scripts/ci/check-user-facing-language.mjs", language)

# Offline verifier must guarantee that the new runtime/admin and UI assets ship.
verify = read("scripts/offline/verify-bundle.sh")
checks_marker = '[[ -f "$BUNDLE_ROOT/payload/app/apps/api/ui/entity-workspace.js" ]] || die "В комплекте отсутствует интерфейс произвольных объектов"\n'
checks_addition = '''[[ -f "$BUNDLE_ROOT/payload/app/apps/api/ui/import-normalization.js" ]] || die "В комплекте отсутствуют параметры нормализации импорта"
[[ -f "$BUNDLE_ROOT/payload/app/scripts/runtime/db-admin.mjs" ]] || die "В комплекте отсутствует административный инструмент SQLite"
'''
if checks_addition.strip() not in verify:
    if checks_marker not in verify:
        raise RuntimeError("Не найден блок проверки интерфейса объектов в verify-bundle.sh")
    verify = verify.replace(checks_marker, checks_marker + checks_addition, 1)
    write("scripts/offline/verify-bundle.sh", verify)

# Documentation.
entity_doc = read("docs/ENTITY_MODEL_AND_IMPORT.md")
normalization_section = '''
## Пустые ячейки, регистр и ФИО

XLSX читается по координатам ячеек (`A1`, `B1`, `C1`), а не по порядку непустых значений в XML. Поэтому пустая ячейка в середине или конце строки остаётся в своей колонке и не сдвигает значения справа. Полностью пустая строка пропускается как разделитель, но следующая строка разбирается независимо и не наследует значения предыдущей.

Перед проверкой импорта можно настроить обработку текста:

- сохранить исходный регистр;
- привести к строчным или прописным буквам;
- сделать каждое слово с заглавной буквы;
- применить именной регистр для ФИО;
- не учитывать регистр устойчивого идентификатора при поиске существующего объекта.

Нормализация всегда сохраняет пустое значение пустым. Она удаляет только внешние и повторяющиеся пробелы, приводит Unicode к `NFKC` и меняет регистр согласно явной настройке.

Для типа **«Человек»** доступна опция разделения исходной колонки ФИО. Значение `Иванов Иван Иванович` сохраняется как отображаемое имя и одновременно записывается в отдельные переиспользуемые поля **Фамилия**, **Имя** и **Отчество**. Можно выбрать порядок `Фамилия Имя Отчество` или `Имя Отчество Фамилия`. Для двух частей отчество остаётся пустым, а исходное ФИО не теряется.
'''
if "## Пустые ячейки, регистр и ФИО" not in entity_doc:
    marker = "## Правила сопоставления\n"
    if marker not in entity_doc:
        raise RuntimeError("Не найден раздел правил сопоставления")
    entity_doc = entity_doc.replace(marker, normalization_section + "\n" + marker, 1)
    write("docs/ENTITY_MODEL_AND_IMPORT.md", entity_doc)

offline = read("docs/OFFLINE_DEPLOYMENT.md")
update_section = '''
## Безопасное обновление существующей установки

Обновление не требует создания новой базы. Миграции выполняются над прежним `DOCOMATOR_DATA_DIR`, а установщик переключает версию приложения отдельно от данных.

1. Проверьте архив до распаковки и после неё:

```bash
sha256sum --check docomator-*.tar.gz.sha256
mkdir -m 0700 /tmp/docomator-update
 tar -xzf docomator-*.tar.gz -C /tmp/docomator-update
cd /tmp/docomator-update/docomator-*
./verify-bundle.sh "$PWD"
```

2. Создайте и проверьте резервную копию до остановки служб:

```bash
sudo systemctl start docomator-backup.service
sudo journalctl -u docomator-backup.service -n 100 --no-pager
sudo systemctl status docomator-backup.service --no-pager
```

Не продолжайте, если служба резервирования завершилась ошибкой. Каталог копий задаётся `DOCOMATOR_DATA_DIR` и обычно находится в `/var/lib/docomator/backups`.

3. Остановите запись данных и выполните штатную установку новой версии:

```bash
sudo systemctl stop docomator-worker.service docomator-api.service
sudo ./install.sh
```

Установщик проверяет комплект до изменения системы, сохраняет прежний каталог данных, применяет только версионированные миграции и переключает `/opt/docomator/current` после подготовки новой версии. Не удаляйте `/var/lib/docomator` и `/etc/docomator/docomator.env`.

4. Проверьте запуск и миграции:

```bash
sudo systemctl status docomator-api.service docomator-worker.service --no-pager
curl --fail --silent http://127.0.0.1:8080/readyz
sudo journalctl -u docomator-api.service -u docomator-worker.service -n 150 --no-pager
```

Если проверка неуспешна, не запускайте ручные SQL-команды. Остановите службы, верните предыдущий release-ссылочный каталог либо используйте штатный `restore.sh` с последней проверенной копией, затем повторно проверьте `/readyz`.

## Административный просмотр и экспорт SQLite

В установленную поставку входит безопасный инструмент без произвольного SQL:

```bash
sudo -u docomator /opt/docomator/current/runtime/node/bin/node \\
  /opt/docomator/current/app/scripts/runtime/db-admin.mjs tables

sudo -u docomator /opt/docomator/current/runtime/node/bin/node \\
  /opt/docomator/current/app/scripts/runtime/db-admin.mjs \\
  rows entities --order-by display_name --limit 100

sudo -u docomator /opt/docomator/current/runtime/node/bin/node \\
  /opt/docomator/current/app/scripts/runtime/db-admin.mjs \\
  export entities --order-by display_name \\
  --output /var/lib/docomator/admin-exports/entities.csv
```

Команды `tables`, `describe`, `rows` и `export` работают только с существующими таблицами и колонками. CSV по умолчанию нейтрализует значения, похожие на формулы Excel. Команда `add-property` создаёт параметр объектной модели, требует `--confirm-write` и перед транзакцией делает согласованную SQLite-копию:

```bash
sudo -u docomator /opt/docomator/current/runtime/node/bin/node \\
  /opt/docomator/current/app/scripts/runtime/db-admin.mjs \\
  add-property --label "Вместимость" --entity-type room \\
  --value-type integer --unit "мест" --confirm-write
```

Инструмент намеренно не поддерживает `DROP`, произвольный `ALTER TABLE` и выполнение пользовательского SQL: такие изменения обходят миграции и могут сделать следующую версию несовместимой.
'''
if "## Безопасное обновление существующей установки" not in offline:
    offline += "\n" + update_section
    write("docs/OFFLINE_DEPLOYMENT.md", offline)

user_guide = read("docs/USER_GUIDE.md")
if "Не учитывать регистр идентификатора" not in user_guide:
    marker = "## 6. Карточки людей\n"
    addition = '''### Нормализация при импорте

В мастере импорта настройте регистр отображаемого названия и отдельных текстовых колонок. Опция **«Не учитывать регистр идентификатора»** предотвращает создание дублей вида `ROOM-101`/`room-101`. Для людей можно включить **«Разделить ФИО»**, выбрать порядок частей и получить отдельные поля «Фамилия», «Имя», «Отчество» для шаблонов.

Пустые ячейки XLSX не заполняются значениями соседних колонок. Если значение отсутствует, оно остаётся пустым; пустая строка не сдвигает следующую запись.

'''
    if marker not in user_guide:
        raise RuntimeError("Не найден раздел карточек людей в USER_GUIDE")
    user_guide = user_guide.replace(marker, addition + marker, 1)
    write("docs/USER_GUIDE.md", user_guide)

release = read("docs/RELEASE_NOTES.md")
release_section = '''## 2026-07-30 — устойчивый XLSX-импорт, нормализация и администрирование данных

- XLSX разбирается по координатам ячеек: пропущенные и пустые ячейки больше не сдвигают значения в соседние колонки, а новые строки обрабатываются независимо.
- Добавлены явные режимы регистра, нечувствительное к регистру сопоставление устойчивых идентификаторов и сохранение пустых значений.
- ФИО можно нормализовать и разделить на поля «Фамилия», «Имя», «Отчество» без потери исходного отображаемого имени.
- В автономную поставку включён безопасный инструмент просмотра, сортировки, экспорта и добавления параметров SQLite с обязательной резервной копией перед записью.
- Руководство автономной установки дополнено последовательностью обновления без удаления базы данных.

'''
if "## 2026-07-30 — устойчивый XLSX-импорт" not in release:
    first_heading = re.search(r"^## 20", release, re.M)
    if first_heading:
        release = release[: first_heading.start()] + release_section + release[first_heading.start() :]
    else:
        release += "\n" + release_section
    write("docs/RELEASE_NOTES.md", release)

readme = read("README.md")
if "пустые ячейки XLSX" not in readme:
    marker = "Колонка обновления используется для повторного сопоставления:"
    addition = "Пустые ячейки XLSX сохраняют координаты и не сдвигают значения. Для текстовых колонок доступны режимы регистра, а ФИО можно разделить на фамилию, имя и отчество.\n\n"
    if marker not in readme:
        raise RuntimeError("Не найдено описание повторного импорта в README")
    readme = readme.replace(marker, addition + marker, 1)
    write("README.md", readme)

print("XLSX import, normalization, FIO split and DB admin integration applied")
