import { writeOoxmlPackage, type OoxmlPackageEntry } from "./ooxml-package.js";
import type { ScalarValueType } from "./scalar-render.js";

export interface AudienceAggregateField {
  key: string;
  label: string;
  valueType: ScalarValueType;
}

export interface AudienceAggregateMember {
  entityId: string;
  displayName: string;
  values: readonly unknown[];
}

export interface RenderAudienceAggregateInput {
  format: "docx" | "xlsx";
  title: string;
  fields: readonly AudienceAggregateField[];
  members: readonly AudienceAggregateMember[];
}

function xmlText(value: unknown): string {
  return String(value ?? "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, "")
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;")
    .replace(/'/gu, "&apos;");
}

function displayValue(type: ScalarValueType, value: unknown): string {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.map((item) => displayValue(type, item)).join(", ");
  if (type === "boolean") {
    if (value === true || value === 1 || value === "true" || value === "1") return "Да";
    if (value === false || value === 0 || value === "false" || value === "0") return "Нет";
  }
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function validate(input: RenderAudienceAggregateInput): void {
  if (input.members.length < 1 || input.members.length > 1_000) {
    throw new RangeError("Aggregate audience must contain from 1 to 1000 members");
  }
  if (input.fields.length < 1 || input.fields.length > 100) {
    throw new RangeError("Aggregate audience must contain from 1 to 100 fields");
  }
  for (const member of input.members) {
    if (member.values.length !== input.fields.length) {
      throw new RangeError("Aggregate audience row does not match the field count");
    }
  }
}

function docxParagraph(text: string, bold = false): string {
  return `<w:p><w:r>${bold ? "<w:rPr><w:b/></w:rPr>" : ""}<w:t xml:space="preserve">${xmlText(text)}</w:t></w:r></w:p>`;
}

function docxCell(text: string, bold = false): string {
  return `<w:tc><w:tcPr><w:tcW w:w="2400" w:type="dxa"/></w:tcPr>${docxParagraph(text, bold)}</w:tc>`;
}

function renderDocx(input: RenderAudienceAggregateInput): Buffer {
  const headers = ["№", "Участник", ...input.fields.map((field) => field.label)];
  const headerRow = `<w:tr>${headers.map((header) => docxCell(header, true)).join("")}</w:tr>`;
  const rows = input.members
    .map((member, index) => {
      const values = input.fields.map((field, fieldIndex) =>
        displayValue(field.valueType, member.values[fieldIndex])
      );
      return `<w:tr>${[
        String(index + 1),
        member.displayName,
        ...values
      ]
        .map((value) => docxCell(value))
        .join("")}</w:tr>`;
    })
    .join("");
  const table = `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblLayout w:type="autofit"/><w:tblBorders><w:top w:val="single" w:sz="4" w:color="B7BDC6"/><w:left w:val="single" w:sz="4" w:color="B7BDC6"/><w:bottom w:val="single" w:sz="4" w:color="B7BDC6"/><w:right w:val="single" w:sz="4" w:color="B7BDC6"/><w:insideH w:val="single" w:sz="4" w:color="D5D9DF"/><w:insideV w:val="single" w:sz="4" w:color="D5D9DF"/></w:tblBorders></w:tblPr>${headerRow}${rows}</w:tbl>`;
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${docxParagraph(input.title, true)}${docxParagraph(`Участников: ${input.members.length}`)}${table}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="850" w:bottom="1134" w:left="850" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`;
  const entries: OoxmlPackageEntry[] = [
    {
      name: "[Content_Types].xml",
      isDirectory: false,
      content: Buffer.from(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
      )
    },
    {
      name: "_rels/.rels",
      isDirectory: false,
      content: Buffer.from(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'
      )
    },
    {
      name: "word/document.xml",
      isDirectory: false,
      content: Buffer.from(documentXml)
    }
  ];
  return writeOoxmlPackage(entries);
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

function xlsxCell(reference: string, value: unknown, type: ScalarValueType | "text"): string {
  if (value === null || value === undefined || value === "") {
    return `<c r="${reference}" t="inlineStr"><is><t></t></is></c>`;
  }
  if (type === "number" || type === "integer") {
    const number = typeof value === "number" ? value : Number(String(value).replace(",", "."));
    if (Number.isFinite(number)) return `<c r="${reference}"><v>${number}</v></c>`;
  }
  if (type === "boolean") {
    const flag = value === true || value === 1 || value === "true" || value === "1";
    return `<c r="${reference}" t="b"><v>${flag ? 1 : 0}</v></c>`;
  }
  return `<c r="${reference}" t="inlineStr"><is><t xml:space="preserve">${xmlText(displayValue(type === "text" ? "string" : type, value))}</t></is></c>`;
}

function renderXlsx(input: RenderAudienceAggregateInput): Buffer {
  const headers = ["№", "Участник", ...input.fields.map((field) => field.label)];
  const headerCells = headers
    .map((header, index) => xlsxCell(`${columnName(index)}1`, header, "text"))
    .join("");
  const dataRows = input.members
    .map((member, memberIndex) => {
      const rowNumber = memberIndex + 2;
      const cells = [
        xlsxCell(`A${rowNumber}`, memberIndex + 1, "integer"),
        xlsxCell(`B${rowNumber}`, member.displayName, "text"),
        ...input.fields.map((field, fieldIndex) =>
          xlsxCell(
            `${columnName(fieldIndex + 2)}${rowNumber}`,
            member.values[fieldIndex],
            field.valueType
          )
        )
      ];
      return `<row r="${rowNumber}">${cells.join("")}</row>`;
    })
    .join("");
  const lastColumn = columnName(headers.length - 1);
  const sheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols><col min="1" max="1" width="8" customWidth="1"/><col min="2" max="${headers.length}" width="24" customWidth="1"/></cols><sheetData><row r="1">${headerCells}</row>${dataRows}</sheetData><autoFilter ref="A1:${lastColumn}${input.members.length + 1}"/></worksheet>`;
  const entries: OoxmlPackageEntry[] = [
    {
      name: "[Content_Types].xml",
      isDirectory: false,
      content: Buffer.from(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>'
      )
    },
    {
      name: "_rels/.rels",
      isDirectory: false,
      content: Buffer.from(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'
      )
    },
    {
      name: "xl/workbook.xml",
      isDirectory: false,
      content: Buffer.from(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Участники" sheetId="1" r:id="rId1"/></sheets></workbook>'
      )
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      isDirectory: false,
      content: Buffer.from(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>'
      )
    },
    {
      name: "xl/worksheets/sheet1.xml",
      isDirectory: false,
      content: Buffer.from(sheetXml)
    }
  ];
  return writeOoxmlPackage(entries);
}

export function renderAudienceAggregate(input: RenderAudienceAggregateInput): Buffer {
  validate(input);
  return input.format === "docx" ? renderDocx(input) : renderXlsx(input);
}
