const XLSX_MAX_ROWS = 1_048_576;
const XLSX_MAX_COLUMNS = 16_384;
const XLSX_MAX_CELL_CHARACTERS = 32_767;
const ZIP_UTF8_FLAG = 0x0800;
const DOS_DATE_1980_01_01 = 0x0021;

interface ZipEntry {
  name: string;
  body: Buffer;
}

export class XlsxExportLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "XlsxExportLimitError";
  }
}

function crc32Table(): Uint32Array {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) !== 0 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
}

const CRC32_TABLE = crc32Table();

function crc32(body: Buffer): number {
  let value = 0xffffffff;
  for (const byte of body) {
    value = (value >>> 8) ^ (CRC32_TABLE[(value ^ byte) & 0xff] ?? 0);
  }
  return (value ^ 0xffffffff) >>> 0;
}

function storedZip(entries: readonly ZipEntry[]): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const checksum = crc32(entry.body);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(ZIP_UTF8_FLAG, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(DOS_DATE_1980_01_01, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(entry.body.length, 18);
    local.writeUInt32LE(entry.body.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, name, entry.body);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(ZIP_UTF8_FLAG, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(DOS_DATE_1980_01_01, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(entry.body.length, 20);
    central.writeUInt32LE(entry.body.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);
    offset += local.length + name.length + entry.body.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...localParts, centralDirectory, end]);
}

function xmlText(value: string): string {
  const valid = value.replace(
    /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/gu,
    "�"
  );
  return valid.replace(/[&<>]/gu, (character) => {
    if (character === "&") return "&amp;";
    if (character === "<") return "&lt;";
    return "&gt;";
  });
}

function columnName(index: number): string {
  let value = index + 1;
  let result = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    value = Math.floor((value - 1) / 26);
  }
  return result;
}

function cell(reference: string, value: string, style: number): string {
  if ([...value].length > XLSX_MAX_CELL_CHARACTERS) {
    throw new XlsxExportLimitError(
      `Ячейка ${reference} длиннее ${XLSX_MAX_CELL_CHARACTERS} символов и не помещается в XLSX.`
    );
  }
  return `<c r="${reference}" t="inlineStr" s="${style}"><is><t xml:space="preserve">${xmlText(value)}</t></is></c>`;
}

function worksheetXml(headers: readonly string[], rows: readonly (readonly string[])[]): string {
  if (headers.length === 0 || headers.length > XLSX_MAX_COLUMNS) {
    throw new XlsxExportLimitError(
      `XLSX поддерживает не более ${XLSX_MAX_COLUMNS} колонок.`
    );
  }
  if (rows.length + 1 > XLSX_MAX_ROWS) {
    throw new XlsxExportLimitError(
      `XLSX поддерживает не более ${XLSX_MAX_ROWS - 1} строк данных за один экспорт.`
    );
  }
  const sheetRows: string[] = [];
  const headerCells = headers.map((value, index) => cell(`${columnName(index)}1`, value, 1));
  sheetRows.push(`<row r="1">${headerCells.join("")}</row>`);
  rows.forEach((row, rowIndex) => {
    const number = rowIndex + 2;
    const cells = headers.map((_header, columnIndex) =>
      cell(`${columnName(columnIndex)}${number}`, row[columnIndex] ?? "", 0)
    );
    sheetRows.push(`<row r="${number}">${cells.join("")}</row>`);
  });
  const lastColumn = columnName(headers.length - 1);
  const lastRow = rows.length + 1;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:${lastColumn}${lastRow}"/><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="15"/><sheetData>${sheetRows.join("")}</sheetData><autoFilter ref="A1:${lastColumn}${lastRow}"/></worksheet>`;
}

const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`;

const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;

const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView/></bookViews><sheets><sheet name="Данные" sheetId="1" r:id="rId1"/></sheets></workbook>`;

const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;

const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/><family val="2"/></font><font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Обычный" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

export function buildDataExportXlsx(
  headers: readonly string[],
  rows: readonly (readonly string[])[]
): Buffer {
  const entries: ZipEntry[] = [
    { name: "[Content_Types].xml", body: Buffer.from(contentTypes, "utf8") },
    { name: "_rels/.rels", body: Buffer.from(rootRels, "utf8") },
    { name: "xl/workbook.xml", body: Buffer.from(workbook, "utf8") },
    { name: "xl/_rels/workbook.xml.rels", body: Buffer.from(workbookRels, "utf8") },
    { name: "xl/styles.xml", body: Buffer.from(styles, "utf8") },
    {
      name: "xl/worksheets/sheet1.xml",
      body: Buffer.from(worksheetXml(headers, rows), "utf8")
    }
  ];
  return storedZip(entries);
}
