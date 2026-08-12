#!/usr/bin/env python3
from pathlib import Path
import re
import sys

if len(sys.argv) != 2:
    raise SystemExit("usage: import-error-localization-hotfix.py PATCHER")

patcher = Path(sys.argv[1])
text = patcher.read_text(encoding="utf-8")

old = r'''  constructor(\n    readonly code: XlsxImportParseErrorCode,\n    message: string,\n    readonly suggestedAction: string\n  ) {\n    super(message);\n  }'''
new = r'''  readonly code: XlsxImportParseErrorCode;\n  readonly suggestedAction: string;\n\n  constructor(\n    codeOrMessage: XlsxImportParseErrorCode | string,\n    message?: string,\n    suggestedAction?: string\n  ) {\n    const typed = message !== undefined;\n    super(typed ? message : codeOrMessage);\n    this.code = typed\n      ? (codeOrMessage as XlsxImportParseErrorCode)\n      : "xlsx_structure_invalid";\n    this.suggestedAction = typed\n      ? (suggestedAction ?? "Откройте книгу в Excel/LibreOffice, сохраните обычный XLSX и повторите импорт.")\n      : "Откройте книгу в Excel/LibreOffice, сохраните обычный XLSX и повторите импорт.";\n  }'''
if old not in text:
    raise SystemExit("xlsx constructor patch target not found")
text = text.replace(old, new, 1)

guard = '''# Guard against forgotten old constructor calls.\nif re.search(r'new XlsxImportParseError\\(\\s*["`]', text):\n    raise SystemExit('unconverted XlsxImportParseError constructor remains')\n'''
if guard not in text:
    raise SystemExit("xlsx constructor guard not found")
text = text.replace(
    guard,
    "# Remaining one-argument XLSX errors use the typed generic fallback.\n",
    1,
)

old_marker = r'''marker = 'Физический номер исходной строки сохраняется и показывается в отчёте ошибок.\n' '''.rstrip()
new_marker = r'''marker = 'В предварительном просмотре отображается колонка **Строка файла** и предупреждения парсера. Это позволяет сверить разреженную таблицу до изменения базы.\n' '''.rstrip()
if old_marker not in text:
    raise SystemExit("import docs source marker target not found")
text = text.replace(old_marker, new_marker, 1)

parser_step = r"""# 7. Parser wraps CSV/XLSX failures into structured file-level issues and detects legacy XLS.
parser_path = Path("apps/api/src/data-import-parser.ts")
text = read(parser_path)
text = replace_once(
    text,
    'import { createHash } from "node:crypto";\n\n',
    'import { createHash } from "node:crypto";\n\nimport type { DataImportOperationIssue } from "@docomator/storage";\n\n'
)
text = replace_once(
    text,
    'import { parseCsvImportRows, type ParsedCsvImportRow } from "./csv-import-parser.js";',
    'import { CsvImportParseError, parseCsvImportRows, type ParsedCsvImportRow } from "./csv-import-parser.js";'
)
text = replace_once(
    text,
    'import { parseXlsxImportRows, type ParsedXlsxImportRow } from "./xlsx-import-parser.js";',
    'import { XlsxImportParseError, parseXlsxImportRows, type ParsedXlsxImportRow } from "./xlsx-import-parser.js";'
)
old_class = '''export class DataImportParseError extends Error {
  override readonly name = "DataImportParseError";
}
'''
new_class = '''export class DataImportParseError extends Error {
  override readonly name = "DataImportParseError";
  readonly issue: DataImportOperationIssue;

  constructor(issueOrMessage: DataImportOperationIssue | string) {
    const issue = typeof issueOrMessage === "string"
      ? ({
          code: "data_import_parse_failed",
          scope: "file",
          blockingEffect: "file",
          severity: "error",
          rowNumber: null,
          column: null,
          propertyKey: null,
          rawValue: null,
          message: issueOrMessage,
          suggestedAction: "Исправьте файл по описанию ошибки и повторите проверку; выбранные настройки импорта сохранены."
        } as DataImportOperationIssue)
      : issueOrMessage;
    super(issue.message);
    this.issue = issue;
  }
}

function parseFailure(
  code: string,
  message: string,
  suggestedAction: string
): DataImportParseError {
  return new DataImportParseError({
    code,
    scope: "file",
    blockingEffect: "file",
    severity: "error",
    rowNumber: null,
    column: null,
    propertyKey: null,
    rawValue: null,
    message,
    suggestedAction
  } as DataImportOperationIssue);
}
'''
text = replace_once(text, old_class, new_class)
start = text.index('export async function parseDataImportBuffer(input: {')
new_parse = '''export async function parseDataImportBuffer(input: {
  buffer: Uint8Array;
  fileName: string;
}): Promise<ParsedDataImportTable> {
  const buffer = Buffer.from(input.buffer);
  if (buffer.length < 1 || buffer.length > MAX_FILE_BYTES) {
    throw parseFailure(
      "data_import_file_size_invalid",
      "Файл импорта должен иметь размер от 1 байта до 8 МБ.",
      "Выберите непустой CSV/XLSX размером не более 8 МБ."
    );
  }
  const fileName = input.fileName.normalize("NFKC").trim();
  const extension = /\\.([^.]+)$/u.exec(fileName)?.[1]?.toLowerCase();
  const sourceSha256 = createHash("sha256").update(buffer).digest("hex");
  const oleSignature =
    buffer.length >= 8 &&
    buffer.subarray(0, 8).equals(
      Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])
    );

  if (extension === "xls" || oleSignature) {
    throw parseFailure(
      "unsupported_legacy_xls",
      "Этот файл сохранён в старом формате Excel 97–2003 (.xls).",
      "Откройте таблицу в Excel или LibreOffice, сохраните её как XLSX или CSV и загрузите снова. Сопоставления и введённые настройки не сбрасываются."
    );
  }

  if (extension === "csv") {
    try {
      const parsed = parseCsvImportRows(buffer);
      return buildTable({
        fileName,
        fileFormat: "csv",
        sourceSha256,
        sourceRows: parsed.rows,
        warnings: [
          `Разделитель CSV: ${parsed.delimiter === "\\t" ? "табуляция" : parsed.delimiter}`
        ]
      });
    } catch (error) {
      if (error instanceof CsvImportParseError) {
        throw parseFailure(error.code, error.message, error.suggestedAction);
      }
      throw error;
    }
  }

  if (extension === "xlsx") {
    if (buffer[0] !== 0x50 || buffer[1] !== 0x4b) {
      throw parseFailure(
        "xlsx_invalid_container",
        "Файл с расширением .xlsx не является книгой XLSX.",
        "Откройте исходный файл в Excel или LibreOffice и сохраните его как обычный XLSX."
      );
    }
    try {
      const parsed = await parseXlsxImportRows(buffer);
      return buildTable({
        fileName,
        fileFormat: "xlsx",
        sourceSha256,
        sourceRows: parsed.rows,
        warnings: parsed.warnings
      });
    } catch (error) {
      if (error instanceof XlsxImportParseError) {
        throw parseFailure(error.code, error.message, error.suggestedAction);
      }
      throw error;
    }
  }

  throw parseFailure(
    "data_import_format_unsupported",
    "Поддерживаются файлы CSV и XLSX.",
    "Выберите CSV/XLSX. Для старого .xls сначала сохраните таблицу как XLSX или CSV."
  );
}
'''
text = text[:start] + new_parse
write(parser_path, text)

"""
match = re.search(r"# 7\.[\s\S]*?(?=# 8\.)", text)
if match is None:
    raise SystemExit("parser patch section not found")
text = text[: match.start()] + parser_step + text[match.end() :]
patcher.write_text(text, encoding="utf-8")
