import { analyzeOoxmlBuffer } from "./structure.js";
import {
  analyzeOoxmlVisualLayout as analyzeRawOoxmlVisualLayout,
  type AnalyzeVisualOoxmlInput,
  type DocumentVisualLayoutReport,
  type VisualXlsxSheet
} from "./visual-layout.js";

const MAX_RICH_ROWS = 200;
const MAX_RICH_COLUMNS = 80;
const MAX_MERGE_ROW_SPAN = 200;
const MAX_MERGE_COLUMN_SPAN = 80;
const MAX_MERGE_AREA = 4_096;

interface CellCoordinate {
  row: number;
  column: number;
}

interface MergeCoordinate {
  startRow: number;
  startColumn: number;
  endRow: number;
  endColumn: number;
}

function xlsxColumnNumber(letters: string): number {
  let value = 0;
  for (const character of letters) {
    value = value * 26 + character.charCodeAt(0) - 64;
  }
  return value;
}

function mergeCoordinate(ref: string): MergeCoordinate | null {
  const match = /^([A-Z]{1,3})([1-9][0-9]{0,6}):([A-Z]{1,3})([1-9][0-9]{0,6})$/u.exec(
    String(ref || "").toUpperCase()
  );
  if (!match) return null;
  const startColumn = xlsxColumnNumber(match[1] ?? "");
  const startRow = Number(match[2]);
  const endColumn = xlsxColumnNumber(match[3] ?? "");
  const endRow = Number(match[4]);
  if (endRow < startRow || endColumn < startColumn) return null;
  return { startRow, startColumn, endRow, endColumn };
}

function safeMerge(ref: string, visible: ReadonlySet<string>): boolean {
  const merge = mergeCoordinate(ref);
  if (!merge) return false;
  const rowSpan = merge.endRow - merge.startRow + 1;
  const columnSpan = merge.endColumn - merge.startColumn + 1;
  if (
    rowSpan > MAX_MERGE_ROW_SPAN ||
    columnSpan > MAX_MERGE_COLUMN_SPAN ||
    rowSpan * columnSpan > MAX_MERGE_AREA
  ) {
    return false;
  }
  for (const key of visible) {
    const [rowValue, columnValue] = key.split(":");
    const row = Number(rowValue);
    const column = Number(columnValue);
    if (
      row >= merge.startRow &&
      row <= merge.endRow &&
      column >= merge.startColumn &&
      column <= merge.endColumn
    ) {
      return true;
    }
  }
  return false;
}

function imageCoordinate(anchor: string | null): CellCoordinate | null {
  const match = /^R([1-9][0-9]*)C([1-9][0-9]*)$/u.exec(String(anchor || ""));
  return match ? { row: Number(match[1]), column: Number(match[2]) } : null;
}

function boundedSheet(
  sheet: VisualXlsxSheet,
  allowedElementIds: ReadonlySet<string>,
  warnings: string[]
): VisualXlsxSheet {
  const allowedCells = sheet.cells.filter((cell) => allowedElementIds.has(cell.elementId));
  const allRows = [...new Set(allowedCells.map((cell) => cell.row))].sort((a, b) => a - b);
  const allColumns = [...new Set(allowedCells.map((cell) => cell.column))].sort((a, b) => a - b);
  const rows = new Set(allRows.slice(0, MAX_RICH_ROWS));
  const columns = new Set(allColumns.slice(0, MAX_RICH_COLUMNS));
  if (rows.size < allRows.length || columns.size < allColumns.length) {
    warnings.push(
      `Лист «${sheet.name}» слишком разреженный для полной браузерной сетки: показана безопасная выборка до ${MAX_RICH_ROWS} строк и ${MAX_RICH_COLUMNS} колонок. Все доступные ячейки остаются в резервном списке.`
    );
  }
  const cells = allowedCells.filter((cell) => rows.has(cell.row) && columns.has(cell.column));
  const visible = new Set(cells.map((cell) => `${cell.row}:${cell.column}`));
  const merges = sheet.merges.filter((ref) => safeMerge(ref, visible));
  if (merges.length < sheet.merges.length) {
    warnings.push(
      `На листе «${sheet.name}» часть слишком крупных или нерелевантных объединений не разворачивается в браузере; исходный XLSX не изменён.`
    );
  }
  const images = sheet.images.filter((image) => {
    const coordinate = imageCoordinate(image.anchor);
    return coordinate !== null && rows.has(coordinate.row) && columns.has(coordinate.column);
  });
  return {
    ...sheet,
    rows: sheet.rows.filter((row) => rows.has(row.row)),
    columns: sheet.columns.filter((column) => columns.has(column.column)),
    merges,
    cells,
    images
  };
}

export async function analyzeOoxmlVisualLayout(
  input: AnalyzeVisualOoxmlInput
): Promise<DocumentVisualLayoutReport> {
  const structure = await analyzeOoxmlBuffer(input);
  const visual = await analyzeRawOoxmlVisualLayout(input);
  const allowedElementIds = new Set(structure.elements.map((element) => element.id));
  const warnings = [...visual.warnings];
  if (structure.truncated) {
    warnings.push(
      "Для тяжёлого документа браузерная проекция ограничена безопасной выборкой; остальные доступные места остаются в резервном списке структуры."
    );
  }

  const tableKeys = new Set(
    structure.elements.flatMap((element) => {
      if (element.kind !== "paragraph" || !element.tableLocation) return [];
      return [`${element.part}\u0000${element.tableLocation.tableIndex}`];
    })
  );

  return {
    ...visual,
    warnings,
    docx: visual.docx
      ? {
          ...visual.docx,
          paragraphs: visual.docx.paragraphs.filter((paragraph) =>
            allowedElementIds.has(paragraph.elementId)
          ),
          tables: visual.docx.tables.filter((table) =>
            tableKeys.has(`${table.part}\u0000${table.tableIndex}`)
          )
        }
      : null,
    xlsx: visual.xlsx
      ? {
          sheets: visual.xlsx.sheets
            .map((sheet) => boundedSheet(sheet, allowedElementIds, warnings))
            .filter((sheet) => sheet.cells.length > 0 || sheet.images.length > 0)
        }
      : null
  };
}
