import { createHash } from "node:crypto";

import { writeOoxmlPackage } from "@docomator/template-compiler";

const FIXED_CREATED_AT = "2026-07-19T00:00:00Z";

function xmlEscape(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function packageEntries(entries) {
  return entries.map((entry) => ({
    name: entry.name,
    content: Buffer.from(entry.content, "utf8"),
    isDirectory: false
  }));
}

function coreProperties(title) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>${xmlEscape(title)}</dc:title>
  <dc:creator>Docomator</dc:creator>
  <cp:lastModifiedBy>Docomator</cp:lastModifiedBy>
  <dcterms:created xsi:type="dcterms:W3CDTF">${FIXED_CREATED_AT}</dcterms:created>
  <dcterms:modified xsi:type="dcterms:W3CDTF">${FIXED_CREATED_AT}</dcterms:modified>
</cp:coreProperties>`;
}

function appProperties(application) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <Application>${xmlEscape(application)}</Application>
  <AppVersion>1.0</AppVersion>
</Properties>`;
}

function docxDocument(values) {
  const rows = [
    ["ФИО", values.fullName],
    ["Должность", values.position],
    ["Подразделение", values.department],
    ["Дата приёма", values.hiredAt]
  ]
    .map(
      ([label, value]) => `
      <w:tr>
        <w:tc><w:tcPr><w:tcW w:w="3200" w:type="dxa"/></w:tcPr><w:p><w:r><w:rPr><w:b/></w:rPr><w:t>${xmlEscape(label)}</w:t></w:r></w:p></w:tc>
        <w:tc><w:tcPr><w:tcW w:w="6000" w:type="dxa"/></w:tcPr><w:p><w:r><w:t>${xmlEscape(value)}</w:t></w:r></w:p></w:tc>
      </w:tr>`
    )
    .join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr><w:r><w:t>Личная карточка сотрудника</w:t></w:r></w:p>
    <w:p><w:r><w:t>Учебный шаблон Docomator. Выберите значения во втором столбце и сопоставьте их с полями карточки.</w:t></w:r></w:p>
    <w:tbl>
      <w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="9200" w:type="dxa"/></w:tblPr>
      <w:tblGrid><w:gridCol w:w="3200"/><w:gridCol w:w="6000"/></w:tblGrid>${rows}
    </w:tbl>
    <w:p><w:r><w:rPr><w:i/></w:rPr><w:t>Все имена и сведения в примере вымышлены.</w:t></w:r></w:p>
    <w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>
  </w:body>
</w:document>`;
}

function docxBuffer(values) {
  return writeOoxmlPackage(
    packageEntries([
      {
        name: "[Content_Types].xml",
        content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`
      },
      {
        name: "_rels/.rels",
        content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`
      },
      {
        name: "docProps/core.xml",
        content: coreProperties("Личная карточка сотрудника")
      },
      {
        name: "docProps/app.xml",
        content: appProperties("Docomator DOCX example")
      },
      { name: "word/document.xml", content: docxDocument(values) },
      {
        name: "word/styles.xml",
        content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Обычный"/><w:qFormat/></w:style>
  <w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Заголовок"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:rPr><w:b/><w:sz w:val="32"/></w:rPr></w:style>
  <w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Сетка таблицы"/><w:tblPr><w:tblBorders><w:top w:val="single" w:sz="4" w:color="808080"/><w:left w:val="single" w:sz="4" w:color="808080"/><w:bottom w:val="single" w:sz="4" w:color="808080"/><w:right w:val="single" w:sz="4" w:color="808080"/><w:insideH w:val="single" w:sz="4" w:color="808080"/><w:insideV w:val="single" w:sz="4" w:color="808080"/></w:tblBorders></w:tblPr></w:style>
</w:styles>`
      },
      {
        name: "word/_rels/document.xml.rels",
        content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`
      }
    ])
  );
}

function inlineCell(address, value, style = 0) {
  return `<c r="${address}" s="${style}" t="inlineStr"><is><t>${xmlEscape(value)}</t></is></c>`;
}

function xlsxWorksheet(rows) {
  const dataRows = rows
    .map(
      (row, index) =>
        `<row r="${index + 4}">${row
          .map((value, column) =>
            inlineCell(`${String.fromCharCode(65 + column)}${index + 4}`, value, 2)
          )
          .join("")}</row>`
    )
    .join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <dimension ref="A1:D${rows.length + 3}"/>
  <sheetViews><sheetView workbookViewId="0"/></sheetViews>
  <sheetFormatPr defaultRowHeight="15"/>
  <cols><col min="1" max="1" width="8" customWidth="1"/><col min="2" max="2" width="34" customWidth="1"/><col min="3" max="4" width="24" customWidth="1"/></cols>
  <sheetData>
    <row r="1" ht="24" customHeight="1">${inlineCell("A1", "Реестр сотрудников", 1)}</row>
    <row r="2">${inlineCell("A2", "Учебный пример Docomator; все сведения вымышлены.")}</row>
    <row r="3">${["№", "ФИО", "Должность", "Подразделение"].map((value, index) => inlineCell(`${String.fromCharCode(65 + index)}3`, value, 1)).join("")}</row>
    ${dataRows}
  </sheetData>
  <mergeCells count="2"><mergeCell ref="A1:D1"/><mergeCell ref="A2:D2"/></mergeCells>
  <pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>
</worksheet>`;
}

function xlsxBuffer(rows) {
  return writeOoxmlPackage(
    packageEntries([
      {
        name: "[Content_Types].xml",
        content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`
      },
      {
        name: "_rels/.rels",
        content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`
      },
      {
        name: "docProps/core.xml",
        content: coreProperties("Реестр сотрудников")
      },
      {
        name: "docProps/app.xml",
        content: appProperties("Docomator XLSX example")
      },
      {
        name: "xl/workbook.xml",
        content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <bookViews><workbookView xWindow="0" yWindow="0" windowWidth="22000" windowHeight="12000"/></bookViews>
  <sheets><sheet name="Реестр" sheetId="1" r:id="rId1"/></sheets>
  <calcPr calcId="0" fullCalcOnLoad="1"/>
</workbook>`
      },
      {
        name: "xl/_rels/workbook.xml.rels",
        content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`
      },
      { name: "xl/worksheets/sheet1.xml", content: xlsxWorksheet(rows) },
      {
        name: "xl/styles.xml",
        content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="2"><font><sz val="11"/><name val="Liberation Sans"/></font><font><b/><sz val="11"/><name val="Liberation Sans"/></font></fonts>
  <fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>
  <borders count="2"><border/><border><left style="thin"><color rgb="FF808080"/></left><right style="thin"><color rgb="FF808080"/></right><top style="thin"><color rgb="FF808080"/></top><bottom style="thin"><color rgb="FF808080"/></bottom><diagonal/></border></borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1"/><xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1"/></cellXfs>
  <cellStyles count="1"><cellStyle name="Обычный" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`
      }
    ])
  );
}

const personalTemplateValues = {
  fullName: "ФИО сотрудника",
  position: "Должность сотрудника",
  department: "Подразделение сотрудника",
  hiredAt: "Дата приёма сотрудника"
};
const personalFilledValues = {
  fullName: "Иванов Алексей Сергеевич",
  position: "Инженер",
  department: "Производственный отдел",
  hiredAt: "15.03.2024"
};
const registerTemplateRows = [
  ["Номер сотрудника", "ФИО сотрудника", "Должность сотрудника", "Подразделение сотрудника"]
];
const registerFilledRows = [
  ["1", "Иванов Алексей Сергеевич", "Инженер", "Производственный отдел"],
  ["2", "Петрова Анна Викторовна", "Бухгалтер", "Финансовый отдел"],
  ["3", "Сидоров Максим Олегович", "Специалист", "Отдел снабжения"]
];

const csv = `Табельный номер,ФИО,Должность,Подразделение,Дата приёма
0001,Иванов Алексей Сергеевич,Инженер,Производственный отдел,2024-03-15
0002,Петрова Анна Викторовна,Бухгалтер,Финансовый отдел,2023-11-01
0003,Сидоров Максим Олегович,Специалист,Отдел снабжения,2025-02-10
`;

export function createExampleAssets() {
  return [
    {
      path: "data/employees.csv",
      kind: "csv",
      content: Buffer.from(csv, "utf8")
    },
    {
      path: "templates/personal-card.docx",
      kind: "docx-template",
      content: docxBuffer(personalTemplateValues)
    },
    {
      path: "templates/team-register.xlsx",
      kind: "xlsx-template",
      content: xlsxBuffer(registerTemplateRows)
    },
    {
      path: "expected/personal-card-filled.docx",
      kind: "docx-filled",
      content: docxBuffer(personalFilledValues)
    },
    {
      path: "expected/team-register-filled.xlsx",
      kind: "xlsx-filled",
      content: xlsxBuffer(registerFilledRows)
    }
  ];
}

export function exampleManifest(assets) {
  return `${[...assets]
    .sort((left, right) => left.path.localeCompare(right.path, "en"))
    .map(
      (asset) =>
        `${createHash("sha256").update(asset.content).digest("hex")}  ${asset.path}`
    )
    .join("\n")}\n`;
}

export const EXAMPLE_ASSETS = Object.freeze(createExampleAssets());
