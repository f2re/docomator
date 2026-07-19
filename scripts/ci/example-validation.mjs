import path from "node:path";

import { inspectOoxmlBuffer } from "@docomator/document-intake";
import { readOoxmlPackage } from "@docomator/template-compiler";

import { parseDataImportBuffer } from "../../apps/api/dist/data-import-parser.js";

const RELATIONSHIPS_NAMESPACE =
  "http://schemas.openxmlformats.org/package/2006/relationships";
const OFFICE_RELATIONSHIPS =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

const DOCX_PARTS = [
  "[Content_Types].xml",
  "_rels/.rels",
  "docProps/app.xml",
  "docProps/core.xml",
  "word/_rels/document.xml.rels",
  "word/document.xml",
  "word/styles.xml"
];
const XLSX_PARTS = [
  "[Content_Types].xml",
  "_rels/.rels",
  "docProps/app.xml",
  "docProps/core.xml",
  "xl/_rels/workbook.xml.rels",
  "xl/styles.xml",
  "xl/workbook.xml",
  "xl/worksheets/sheet1.xml"
];

const EXPECTED_RELATIONSHIPS = {
  docx: new Map([
    [
      "_rels/.rels",
      [
        ["rId1", `${OFFICE_RELATIONSHIPS}/officeDocument`, "word/document.xml"],
        [
          "rId2",
          "http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties",
          "docProps/core.xml"
        ],
        [
          "rId3",
          `${OFFICE_RELATIONSHIPS}/extended-properties`,
          "docProps/app.xml"
        ]
      ]
    ],
    [
      "word/_rels/document.xml.rels",
      [["rId1", `${OFFICE_RELATIONSHIPS}/styles`, "styles.xml"]]
    ]
  ]),
  xlsx: new Map([
    [
      "_rels/.rels",
      [
        ["rId1", `${OFFICE_RELATIONSHIPS}/officeDocument`, "xl/workbook.xml"],
        [
          "rId2",
          "http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties",
          "docProps/core.xml"
        ],
        [
          "rId3",
          `${OFFICE_RELATIONSHIPS}/extended-properties`,
          "docProps/app.xml"
        ]
      ]
    ],
    [
      "xl/_rels/workbook.xml.rels",
      [
        ["rId1", `${OFFICE_RELATIONSHIPS}/worksheet`, "worksheets/sheet1.xml"],
        ["rId2", `${OFFICE_RELATIONSHIPS}/styles`, "styles.xml"]
      ]
    ]
  ])
};

function fail(assetPath, message) {
  throw new Error(`Небезопасный учебный пример «${assetPath}»: ${message}`);
}

function documentKind(asset) {
  if (asset.kind.startsWith("docx")) return "docx";
  if (asset.kind.startsWith("xlsx")) return "xlsx";
  fail(asset.path, `неизвестный тип ${asset.kind}.`);
}

function parseRelationshipAttributes(assetPath, source) {
  const attributes = new Map();
  const pattern = /\s+([A-Za-z_][\w.-]*)="([^"<>&]*)"/gy;
  let cursor = 0;
  while (cursor < source.length) {
    pattern.lastIndex = cursor;
    const match = pattern.exec(source);
    if (match === null || match.index !== cursor) {
      fail(assetPath, "relationship содержит неподдерживаемый атрибут.");
    }
    const name = match[1];
    const value = match[2];
    if (name === undefined || value === undefined || attributes.has(name)) {
      fail(assetPath, "relationship содержит повторяющийся атрибут.");
    }
    attributes.set(name, value);
    cursor = pattern.lastIndex;
  }
  if (
    attributes.size !== 3 ||
    !attributes.has("Id") ||
    !attributes.has("Type") ||
    !attributes.has("Target")
  ) {
    fail(assetPath, "relationship должен содержать только Id, Type и Target.");
  }
  return [attributes.get("Id"), attributes.get("Type"), attributes.get("Target")];
}

function parseRelationships(assetPath, xml) {
  const withoutDeclaration = xml.replace(/^\uFEFF?\s*<\?xml[^?]*\?>\s*/u, "");
  const opening = `<Relationships xmlns="${RELATIONSHIPS_NAMESPACE}">`;
  const closing = "</Relationships>";
  if (!withoutDeclaration.startsWith(opening) || !withoutDeclaration.trimEnd().endsWith(closing)) {
    fail(assetPath, "корневая структура relationships не совпадает с разрешённой.");
  }
  let body = withoutDeclaration
    .slice(opening.length, withoutDeclaration.trimEnd().length - closing.length)
    .trim();
  const relationships = [];
  while (body.length > 0) {
    const match = /^<Relationship((?:\s+[A-Za-z_][\w.-]*="[^"<>&]*")+)\s*\/>/u.exec(
      body
    );
    if (match === null || match[1] === undefined) {
      fail(assetPath, "relationship имеет неподдерживаемую XML-форму.");
    }
    relationships.push(parseRelationshipAttributes(assetPath, match[1]));
    body = body.slice(match[0].length).trimStart();
  }
  return relationships;
}

function sameRelationships(actual, expected) {
  return (
    actual.length === expected.length &&
    actual.every((relationship, index) =>
      relationship.every((value, column) => value === expected[index]?.[column])
    )
  );
}

function assertNoExecutableDocumentFeatures(assetPath, xml) {
  if (/<!DOCTYPE|<!ENTITY/iu.test(xml)) {
    fail(assetPath, "объявления DTD и ENTITY запрещены.");
  }
  const forbiddenLocalNames = new Set([
    "definedname",
    "f",
    "fldchar",
    "fldsimple",
    "instrtext"
  ]);
  const tags = xml.matchAll(
    /<(?![!?/])([A-Za-z_][\w.-]*(?::[A-Za-z_][\w.-]*)?)(?=[\s/>])/gu
  );
  for (const match of tags) {
    const qualifiedName = match[1];
    const localName = qualifiedName?.split(":").at(-1)?.toLowerCase();
    if (localName !== undefined && forbiddenLocalNames.has(localName)) {
      fail(assetPath, `XML-элемент ${qualifiedName} запрещён.`);
    }
  }
}

export async function validateSafeExampleAsset(asset) {
  if (asset.kind === "csv") {
    const table = await parseDataImportBuffer({
      buffer: asset.content,
      fileName: asset.path
    });
    const values = [
      ...table.headers,
      ...table.rows.flatMap((row) => Object.values(row))
    ];
    if (values.some((value) => /^\s*[=+@-]/u.test(value))) {
      fail(asset.path, "CSV содержит значение, похожее на формулу.");
    }
    return;
  }

  const kind = documentKind(asset);
  const report = await inspectOoxmlBuffer({
    buffer: asset.content,
    fileName: path.basename(asset.path)
  });
  if (report.decision !== "accepted" || report.issues.length > 0) {
    fail(asset.path, report.issues.map((issue) => issue.message).join("; "));
  }
  if (
    report.summary.externalRelationships !== 0 ||
    report.summary.hasMacros ||
    report.summary.hasActiveX ||
    report.summary.hasEmbeddedObjects ||
    report.summary.hasDigitalSignatures ||
    report.summary.hasExternalLinks
  ) {
    fail(asset.path, "обнаружено активное или внешнее содержимое.");
  }

  const entries = await readOoxmlPackage(asset.content);
  const expectedParts = kind === "docx" ? DOCX_PARTS : XLSX_PARTS;
  const actualParts = entries.map((entry) => entry.name).sort();
  if (
    actualParts.length !== expectedParts.length ||
    actualParts.some((part, index) => part !== [...expectedParts].sort()[index])
  ) {
    fail(asset.path, "состав частей OOXML не совпадает с точным списком.");
  }

  const expectedRelationships = EXPECTED_RELATIONSHIPS[kind];
  for (const entry of entries) {
    if (!/\.(?:xml|rels)$/u.test(entry.name)) continue;
    const xml = entry.content.toString("utf8");
    assertNoExecutableDocumentFeatures(asset.path, xml);
    if (!entry.name.endsWith(".rels")) continue;
    const expected = expectedRelationships.get(entry.name);
    if (expected === undefined) {
      fail(asset.path, `relationship-часть ${entry.name} не разрешена.`);
    }
    const actual = parseRelationships(asset.path, xml);
    if (!sameRelationships(actual, expected)) {
      fail(asset.path, `relationship-часть ${entry.name} изменена.`);
    }
  }
}

export async function validateSafeExampleAssets(assets) {
  const paths = new Set();
  for (const asset of assets) {
    if (paths.has(asset.path)) {
      fail(asset.path, "путь повторяется.");
    }
    paths.add(asset.path);
    await validateSafeExampleAsset(asset);
  }
}
