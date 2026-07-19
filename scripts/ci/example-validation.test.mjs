import assert from "node:assert/strict";
import test from "node:test";

import {
  readOoxmlPackage,
  writeOoxmlPackage
} from "@docomator/template-compiler";

import { createExampleAssets } from "./example-assets.mjs";
import {
  validateSafeExampleAsset,
  validateSafeExampleAssets
} from "./example-validation.mjs";

function example(kind) {
  const asset = createExampleAssets().find((candidate) => candidate.kind === kind);
  assert.ok(asset, `Не найден пример ${kind}.`);
  return asset;
}

async function replacePart(asset, partName, replace) {
  const entries = await readOoxmlPackage(asset.content);
  let replaced = false;
  const changed = entries.map((entry) => {
    if (entry.name !== partName) return entry;
    replaced = true;
    return {
      ...entry,
      content: Buffer.from(replace(entry.content.toString("utf8")), "utf8")
    };
  });
  assert.equal(replaced, true, `Не найдена часть ${partName}.`);
  return { ...asset, content: writeOoxmlPackage(changed) };
}

async function addPart(asset, name, content) {
  const entries = await readOoxmlPackage(asset.content);
  return {
    ...asset,
    content: writeOoxmlPackage([
      ...entries,
      { name, content: Buffer.from(content), isDirectory: false }
    ])
  };
}

test("example validator accepts only the generated safe corpus", async () => {
  await validateSafeExampleAssets(createExampleAssets());
});

test("example validator rejects a CSV formula-like value", async () => {
  const asset = example("csv");
  const changed = {
    ...asset,
    content: Buffer.from(
      asset.content.toString("utf8").replace(
        "Иванов Алексей Сергеевич,Инженер",
        "Иванов Алексей Сергеевич,=1+1"
      ),
      "utf8"
    )
  };
  await assert.rejects(() => validateSafeExampleAsset(changed), /формул/iu);
});

test("example validator rejects a Word field with an alternate prefix", async () => {
  const changed = await replacePart(
    example("docx-template"),
    "word/document.xml",
    (xml) =>
      xml.replace(
        "<w:body>",
        '<w:body><x:instrText xmlns:x="http://schemas.openxmlformats.org/wordprocessingml/2006/main">INCLUDETEXT</x:instrText>'
      )
  );
  await assert.rejects(() => validateSafeExampleAsset(changed), /instrText/iu);
});

test("example validator rejects XLSX cell and named formulas", async () => {
  const cellFormula = await replacePart(
    example("xlsx-template"),
    "xl/worksheets/sheet1.xml",
    (xml) => xml.replace('<row r="4">', '<row r="4"><x:f xmlns:x="urn:x">1+1</x:f>')
  );
  await assert.rejects(() => validateSafeExampleAsset(cellFormula), /x:f/iu);

  const namedFormula = await replacePart(
    example("xlsx-template"),
    "xl/workbook.xml",
    (xml) =>
      xml.replace(
        "<calcPr",
        '<definedNames><definedName name="remote">WEBSERVICE(&quot;https://example.invalid&quot;)</definedName></definedNames><calcPr'
      )
  );
  await assert.rejects(
    () => validateSafeExampleAsset(namedFormula),
    /definedName/iu
  );
});

test("example validator rejects external and altered relationships", async () => {
  const external = await replacePart(
    example("docx-template"),
    "_rels/.rels",
    (xml) =>
      xml.replace(
        "</Relationships>",
        '<Relationship Id="rExt" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.invalid" TargetMode="External"/></Relationships>'
      )
  );
  await assert.rejects(() => validateSafeExampleAsset(external));

  const redirected = await replacePart(
    example("xlsx-template"),
    "xl/_rels/workbook.xml.rels",
    (xml) => xml.replace("worksheets/sheet1.xml", "worksheets/other.xml")
  );
  await assert.rejects(
    () => validateSafeExampleAsset(redirected),
    /relationship-часть/iu
  );
});

test("example validator rejects macro and extra OOXML parts", async () => {
  const macro = await addPart(
    example("docx-template"),
    "word/vbaProject.bin",
    "macro"
  );
  await assert.rejects(() => validateSafeExampleAsset(macro), /макрос/iu);

  const extra = await addPart(example("xlsx-template"), "custom/extra.xml", "<x/>");
  await assert.rejects(
    () => validateSafeExampleAsset(extra),
    /состав частей/iu
  );
});
