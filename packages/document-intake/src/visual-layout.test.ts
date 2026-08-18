import assert from "node:assert/strict";
import test from "node:test";

import { analyzeOoxmlVisualLayout } from "./visual-layout.js";
import { buildZipFixture, type ZipFixtureEntry } from "./zip-fixture.js";

const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6pQAAAABJRU5ErkJggg==",
  "base64"
);

function richDocxEntries(): ZipFixtureEntry[] {
  return [
    {
      name: "[Content_Types].xml",
      content: `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
        <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
        <Default Extension="xml" ContentType="application/xml"/>
        <Default Extension="png" ContentType="image/png"/>
        <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
        <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
        <Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>
      </Types>`
    },
    {
      name: "_rels/.rels",
      content: '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'
    },
    {
      name: "word/document.xml",
      content: `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing">
        <w:body>
          <w:p><w:pPr><w:pStyle w:val="Accent"/><w:jc w:val="center"/><w:ind w:left="720"/></w:pPr>
            <w:r><w:rPr><w:u w:val="single"/><w:color w:val="FF0000"/><w:sz w:val="28"/><w:rFonts w:ascii="Liberation Serif"/></w:rPr><w:t>Цветной текст</w:t></w:r>
            <w:r><w:drawing><wp:inline><wp:extent cx="1270000" cy="635000"/><wp:docPr id="1" name="Логотип" descr="Логотип организации"/><a:graphic><a:graphicData><a:blip r:embed="rId3"/></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>
          </w:p>
          <w:tbl><w:tblPr><w:tblW w:w="6000" w:type="dxa"/></w:tblPr><w:tblGrid><w:gridCol w:w="3000"/><w:gridCol w:w="3000"/></w:tblGrid><w:tr><w:tc><w:tcPr><w:gridSpan w:val="2"/><w:shd w:fill="FFE699"/><w:tcW w:w="6000" w:type="dxa"/></w:tcPr><w:p><w:r><w:t>Объединённая ячейка</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
          <w:sectPr><w:headerReference w:type="default" r:id="rId2"/><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="850" w:bottom="1134" w:left="850" w:header="708" w:footer="708"/></w:sectPr>
        </w:body></w:document>`
    },
    {
      name: "word/styles.xml",
      content: `<?xml version="1.0"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:default="1" w:styleId="Normal"/><w:style w:type="paragraph" w:styleId="Accent"><w:basedOn w:val="Normal"/><w:rPr><w:b/><w:i/></w:rPr></w:style></w:styles>`
    },
    {
      name: "word/header1.xml",
      content: '<?xml version="1.0"?><w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:r><w:rPr><w:i/></w:rPr><w:t>Верхний колонтитул</w:t></w:r></w:p></w:hdr>'
    },
    {
      name: "word/_rels/document.xml.rels",
      content: `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/logo.png"/></Relationships>`
    },
    { name: "word/media/logo.png", content: ONE_PIXEL_PNG }
  ];
}

function richXlsxEntries(): ZipFixtureEntry[] {
  return [
    {
      name: "[Content_Types].xml",
      content: `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/></Types>`
    },
    {
      name: "_rels/.rels",
      content: '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'
    },
    {
      name: "xl/workbook.xml",
      content: '<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Лист 1" sheetId="1" r:id="rId1"/></sheets></workbook>'
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      content: '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'
    },
    {
      name: "xl/styles.xml",
      content: `<?xml version="1.0"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Liberation Sans"/></font><font><b/><i/><u/><color rgb="FFFF0000"/><sz val="14"/><name val="Liberation Serif"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFFF00"/></patternFill></fill></fills><borders count="2"><border/><border><left style="thin"><color rgb="FF0000FF"/></left><right style="thin"><color rgb="FF0000FF"/></right><top style="thin"><color rgb="FF0000FF"/></top><bottom style="thin"><color rgb="FF0000FF"/></bottom></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf><xf numFmtId="10" fontId="0" fillId="0" borderId="1"/></cellXfs></styleSheet>`
    },
    {
      name: "xl/worksheets/sheet1.xml",
      content: `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><cols><col min="1" max="1" width="28" customWidth="1"/><col min="2" max="2" width="18" customWidth="1"/></cols><sheetData><row r="1" ht="30" customHeight="1"><c r="A1" s="1" t="inlineStr"><is><t>Цветной заголовок</t></is></c></row><row r="2"><c r="A2" s="2"><v>0.25</v></c><c r="B2" t="inlineStr"><is><t>Поле</t></is></c></row></sheetData><mergeCells count="1"><mergeCell ref="A1:B1"/></mergeCells><headerFooter><oddHeader>&amp;LЛевая&amp;CЦентр&amp;RПравая</oddHeader><oddFooter>&amp;CСтраница</oddFooter></headerFooter><drawing r:id="rIdDraw"/></worksheet>`
    },
    {
      name: "xl/worksheets/_rels/sheet1.xml.rels",
      content: '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdDraw" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/></Relationships>'
    },
    {
      name: "xl/drawings/drawing1.xml",
      content: `<?xml version="1.0"?><xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><xdr:oneCellAnchor><xdr:from><xdr:col>1</xdr:col><xdr:row>1</xdr:row></xdr:from><xdr:ext cx="635000" cy="635000"/><xdr:pic><xdr:nvPicPr><xdr:cNvPr id="1" name="Эмблема" descr="Эмблема листа"/></xdr:nvPicPr><xdr:blipFill><a:blip r:embed="rIdImage"/></xdr:blipFill></xdr:pic><xdr:clientData/></xdr:oneCellAnchor></xdr:wsDr>`
    },
    {
      name: "xl/drawings/_rels/drawing1.xml.rels",
      content: '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdImage" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/logo.png"/></Relationships>'
    },
    { name: "xl/media/logo.png", content: ONE_PIXEL_PNG }
  ];
}

test("visual DOCX projection resolves formatting, page geometry, table cells, header and raster image", async () => {
  const report = await analyzeOoxmlVisualLayout({
    buffer: buildZipFixture(richDocxEntries()),
    fileName: "rich.docx"
  });
  assert.equal(report.format, "docx");
  assert.ok(report.docx);
  assert.equal(report.docx.page.orientation, "portrait");
  assert.equal(report.docx.page.margins.leftPt, 42.5);
  const styled = report.docx.paragraphs.find((paragraph) => paragraph.images.length === 1);
  assert.ok(styled);
  assert.equal(styled.paragraphStyle.alignment, "center");
  assert.equal(styled.paragraphStyle.marginLeftPt, 36);
  assert.equal(styled.runs[0]?.bold, true);
  assert.equal(styled.runs[0]?.italic, true);
  assert.equal(styled.runs[0]?.underline, true);
  assert.equal(styled.runs[0]?.color, "#FF0000");
  assert.equal(styled.runs[0]?.fontFamily, "Liberation Serif");
  assert.equal(styled.runs[0]?.fontSizePt, 14);
  assert.match(styled.images[0]?.dataUri ?? "", /^data:image\/png;base64,/u);
  assert.equal(styled.images[0]?.altText, "Логотип организации");
  const table = report.docx.tables[0];
  assert.ok(table);
  assert.equal(table.widthPt, 300);
  assert.equal(table.cells[0]?.columnSpan, 2);
  assert.equal(table.cells[0]?.style.backgroundColor, "#FFE699");
  assert.equal(report.docx.paragraphs.length, 3);
});

test("visual XLSX projection resolves grid geometry, merge, font/fill/border, number format, headers and image anchor", async () => {
  const report = await analyzeOoxmlVisualLayout({
    buffer: buildZipFixture(richXlsxEntries()),
    fileName: "rich.xlsx"
  });
  assert.equal(report.format, "xlsx");
  assert.ok(report.xlsx);
  const sheet = report.xlsx.sheets[0];
  assert.ok(sheet);
  assert.deepEqual(sheet.merges, ["A1:B1"]);
  assert.equal(sheet.columns[0]?.widthChars, 28);
  assert.equal(sheet.rows[0]?.heightPt, 30);
  assert.equal(sheet.header.left, "Левая");
  assert.equal(sheet.header.center, "Центр");
  assert.equal(sheet.header.right, "Правая");
  const title = sheet.cells.find((cell) => cell.address === "A1");
  assert.ok(title);
  assert.equal(title.style.font.bold, true);
  assert.equal(title.style.font.italic, true);
  assert.equal(title.style.font.underline, true);
  assert.equal(title.style.font.color, "#FF0000");
  assert.equal(title.style.fillColor, "#FFFF00");
  assert.equal(title.style.horizontalAlign, "center");
  assert.equal(title.style.wrapText, true);
  const percent = sheet.cells.find((cell) => cell.address === "A2");
  assert.equal(percent?.displayValue, "25,00%");
  assert.equal(sheet.images[0]?.anchor, "R2C2");
  assert.match(sheet.images[0]?.dataUri ?? "", /^data:image\/png;base64,/u);
});
