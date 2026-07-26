from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def replace_once(relative: str, old: str, new: str) -> None:
    path = ROOT / relative
    value = path.read_text(encoding="utf-8")
    count = value.count(old)
    if count != 1:
        raise RuntimeError(f"{relative}: expected one occurrence, found {count}")
    path.write_text(value.replace(old, new, 1), encoding="utf-8")
    print(f"updated {relative}")


def insert_after(relative: str, marker: str, addition: str) -> None:
    path = ROOT / relative
    value = path.read_text(encoding="utf-8")
    if addition in value:
        return
    count = value.count(marker)
    if count != 1:
        raise RuntimeError(f"{relative}: expected one marker, found {count}")
    path.write_text(value.replace(marker, marker + addition, 1), encoding="utf-8")
    print(f"updated {relative}")


replace_once(
    "packages/template-compiler/src/compiler.ts",
    '''  if (
    rowTags.some(
      (tag) =>
        !tag.closing &&
        (/\s(?:[A-Za-z_][\w.-]*:)?(?:anchorId|paraId|textId)\s*=/u.test(
          tag.raw
        ) ||
          tag.localName === "tbl" ||
          tag.localName === "vMerge" ||
          tag.localName === "tblHeader" ||
          [
            "altChunk",
            "bookmarkStart",
            "bookmarkEnd",
            "commentRangeStart",
            "commentRangeEnd",
            "commentReference",
            "control",
            "customXml",
            "customXmlDelRangeEnd",
            "customXmlDelRangeStart",
            "customXmlInsRangeEnd",
            "customXmlInsRangeStart",
            "del",
            "drawing",
            "endnoteReference",
            "fldSimple",
            "fldChar",
            "footnoteReference",
            "hyperlink",
            "ins",
            "instrText",
            "moveFrom",
            "moveFromRangeEnd",
            "moveFromRangeStart",
            "moveTo",
            "moveToRangeEnd",
            "moveToRangeStart",
            "object",
            "permStart",
            "permEnd",
            "pict",
            "proofErr",
            "smartTag",
            "subDoc"
          ].includes(tag.localName))
    )
  ) {
    throw new TemplateCompilerError(
      "unsupported_repeat_row",
      "Строка с вложенной таблицей, вертикальным объединением, признаком заголовка или сложным объектом DOCX не может повторяться."
    );
  }''',
    '''  if (rowTags.some((tag) => !tag.closing && tag.localName === "tbl")) {
    throw new TemplateCompilerError(
      "unsupported_repeat_row",
      "Строка содержит вложенную таблицу DOCX. Выберите обычную строку без таблицы внутри ячейки."
    );
  }
  if (rowTags.some((tag) => !tag.closing && tag.localName === "vMerge")) {
    throw new TemplateCompilerError(
      "unsupported_repeat_row",
      "Строка использует вертикальное объединение ячеек. Выберите строку без объединения по вертикали."
    );
  }
  if (rowTags.some((tag) => !tag.closing && tag.localName === "tblHeader")) {
    throw new TemplateCompilerError(
      "unsupported_repeat_row",
      "Выбрана строка заголовка таблицы. Для повторения выберите строку-образец под заголовками."
    );
  }
  const unsupportedRepeatRowElements = new Set([
    "altChunk",
    "bookmarkStart",
    "bookmarkEnd",
    "commentRangeStart",
    "commentRangeEnd",
    "commentReference",
    "control",
    "customXml",
    "customXmlDelRangeEnd",
    "customXmlDelRangeStart",
    "customXmlInsRangeEnd",
    "customXmlInsRangeStart",
    "del",
    "drawing",
    "endnoteReference",
    "fldSimple",
    "fldChar",
    "footnoteReference",
    "hyperlink",
    "ins",
    "instrText",
    "moveFrom",
    "moveFromRangeEnd",
    "moveFromRangeStart",
    "moveTo",
    "moveToRangeEnd",
    "moveToRangeStart",
    "object",
    "permStart",
    "permEnd",
    "pict",
    "smartTag",
    "subDoc"
  ]);
  if (
    rowTags.some(
      (tag) => !tag.closing && unsupportedRepeatRowElements.has(tag.localName)
    )
  ) {
    throw new TemplateCompilerError(
      "unsupported_repeat_row",
      "Строка содержит рисунок, поле, ссылку, исправления или другой сложный объект DOCX. Упростите только строку-образец и повторите проверку."
    );
  }'''
)

insert_after(
    "packages/template-compiler/src/scalar-render.ts",
    '''function wordIdCounts(xml: string): Map<number, number> {
  const counts = new Map<number, number>();
  for (const tag of scanXmlTags(xml)) {
    if (tag.closing || tag.localName !== "id") continue;
    const raw = attributeValue(tag.raw, "w:val") ?? attributeValue(tag.raw, "val");
    if (raw === null) continue;
    const value = Number(raw);
    if (Number.isInteger(value) && value > 0 && value <= 0x7fffffff) {
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
  }
  return counts;
}
''',
    '''
type DocxRepeatVolatileIdentifier = "anchorId" | "paraId" | "textId";

function collectDocxRepeatVolatileIdentifiers(
  xml: string
): Record<DocxRepeatVolatileIdentifier, Set<string>> {
  const identifiers: Record<DocxRepeatVolatileIdentifier, Set<string>> = {
    anchorId: new Set<string>(),
    paraId: new Set<string>(),
    textId: new Set<string>()
  };
  const expression =
    /\s(?:[A-Za-z_][\w.-]*:)?(anchorId|paraId|textId)\s*=\s*(["'])([0-9A-Fa-f]{8})\2/gu;
  for (const match of xml.matchAll(expression)) {
    const localName = match[1] as DocxRepeatVolatileIdentifier;
    const value = match[3];
    if (value !== undefined) identifiers[localName].add(value.toUpperCase());
  }
  return identifiers;
}

function allocateDocxRepeatVolatileIdentifier(
  localName: DocxRepeatVolatileIdentifier,
  memberIndex: number,
  occurrenceIndex: number,
  used: Set<string>
): string {
  let candidate = createHash("sha256")
    .update("docomator-repeat-volatile-id")
    .update("\u0000")
    .update(localName)
    .update("\u0000")
    .update(String(memberIndex))
    .update("\u0000")
    .update(String(occurrenceIndex))
    .digest()
    .readUInt32BE(0);
  if (candidate === 0) candidate = 1;
  const first = candidate;
  do {
    const value = candidate.toString(16).toUpperCase().padStart(8, "0");
    if (!used.has(value)) {
      used.add(value);
      return value;
    }
    candidate = candidate === 0xffffffff ? 1 : candidate + 1;
  } while (candidate !== first);
  throw new TemplateCompilerError(
    "repeat_volatile_id_exhausted",
    "Не удалось назначить уникальные служебные идентификаторы строкам DOCX."
  );
}

function stripDocxProofingMarkers(xml: string): string {
  return xml.replace(
    /<\/?(?:[A-Za-z_][\w.-]*:)?proofErr\b[^>]*>/gu,
    ""
  );
}

function rewriteDocxRepeatVolatileIdentifiers(
  xml: string,
  memberIndex: number,
  used: Record<DocxRepeatVolatileIdentifier, Set<string>>
): string {
  const occurrences: Record<DocxRepeatVolatileIdentifier, number> = {
    anchorId: 0,
    paraId: 0,
    textId: 0
  };
  return xml.replace(
    /(\s(?:[A-Za-z_][\w.-]*:)?(anchorId|paraId|textId)\s*=\s*)(["'])([0-9A-Fa-f]{8})\3/gu,
    (_source, prefix: string, localNameValue: string, quote: string) => {
      const localName = localNameValue as DocxRepeatVolatileIdentifier;
      const occurrenceIndex = occurrences[localName];
      occurrences[localName] += 1;
      const value = allocateDocxRepeatVolatileIdentifier(
        localName,
        memberIndex,
        occurrenceIndex,
        used[localName]
      );
      return `${prefix}${quote}${value}${quote}`;
    }
  );
}
'''
)
replace_once(
    "packages/template-compiler/src/scalar-render.ts",
    '''  const expectedRows: string[][] = [];
  const usedWordIds = existingWordIds(decoded.text);
  const generatedWordIds = new Set<number>();''',
    '''  const expectedRows: string[][] = [];
  const usedWordIds = existingWordIds(decoded.text);
  const volatileIdentifiers = collectDocxRepeatVolatileIdentifiers(decoded.text);
  const generatedWordIds = new Set<number>();'''
)
replace_once(
    "packages/template-compiler/src/scalar-render.ts",
    '''    const row = applyXmlReplacements(template, replacements);
    expandedRowsBytes += Buffer.byteLength(row, "utf8");''',
    '''    const row = rewriteDocxRepeatVolatileIdentifiers(
      stripDocxProofingMarkers(applyXmlReplacements(template, replacements)),
      memberIndex,
      volatileIdentifiers
    );
    expandedRowsBytes += Buffer.byteLength(row, "utf8");'''
)

replace_once(
    "packages/template-compiler/src/multi-field.test.ts",
    '''async function docxRepeatRowDefinitions(
  options: { unsafe?: "vMerge" | "nested" | "complex" | "unique-id" } = {}
) {''',
    '''async function docxRepeatRowDefinitions(
  options: { unsafe?: "vMerge" | "nested" | "complex" } = {}
) {'''
)
replace_once(
    "packages/template-compiler/src/multi-field.test.ts",
    '''        : options.unsafe === "complex"
          ? '<w:p><w:hyperlink r:id="rIdExternal" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:r><w:t>Ссылка</w:t></w:r></w:hyperlink></w:p>'
          : options.unsafe === "unique-id"
            ? '<w:p xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml" w14:paraId="12345678"><w:r><w:t>Уникальный абзац</w:t></w:r></w:p>'
        : "";''',
    '''        : options.unsafe === "complex"
          ? '<w:p><w:hyperlink r:id="rIdExternal" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:r><w:t>Ссылка</w:t></w:r></w:hyperlink></w:p>'
          : "";'''
)
replace_once(
    "packages/template-compiler/src/multi-field.test.ts",
    '''  for (const unsafe of [
    "vMerge",
    "nested",
    "complex",
    "unique-id"
  ] as const) {''',
    '''  for (const unsafe of ["vMerge", "nested", "complex"] as const) {'''
)

replace_once(
    "apps/api/src/ui-routes.ts",
    '''      "interface-hierarchy.css",
      "interface-stability.css"''',
    '''      "interface-hierarchy.css",
      "interface-stability.css",
      "template-row-flow.css"'''
)
replace_once(
    "apps/api/src/ui-routes.ts",
    '''      "operation-center.js",
      "operations-readiness.js"''',
    '''      "operation-center.js",
      "operations-readiness.js",
      "template-row-flow.js"'''
)
replace_once(
    "scripts/ci/check-ui-bundles.mjs",
    '''    "operation-center.js",
    "operations-readiness.js"''',
    '''    "operation-center.js",
    "operations-readiness.js",
    "template-row-flow.js"'''
)
replace_once(
    "package.json",
    '''node --check apps/api/ui/template-row-editor-v2.js && node --check apps/api/ui/template-multi-trial-recovery.js && node scripts/ci/check-ui-bundles.mjs''',
    '''node --check apps/api/ui/template-row-editor-v2.js && node --check apps/api/ui/template-multi-trial-recovery.js && node --check apps/api/ui/template-row-flow.js && node scripts/ci/check-ui-bundles.mjs'''
)
replace_once(
    "scripts/ci/check-user-facing-language.mjs",
    '''  "apps/api/ui/template-row-editor-v2.js",''',
    '''  "apps/api/ui/template-row-editor-v2.js",
  "apps/api/ui/template-row-flow.js",'''
)

insert_after(
    "tests/e2e/word-roster-assistant.spec.mjs",
    '''  await page.locator("#documentStructureButton").click();

''',
    '''  await expect(page.locator(".structure-table-row")).toHaveCount(2);
  await expect(
    page.locator(".structure-table-row").nth(1).locator(".structure-table-cell-stack")
  ).toHaveCount(4);

'''
)
insert_after(
    "tests/e2e/word-roster-assistant.spec.mjs",
    '''  await expect(panel).toBeVisible();
  await expect(page.locator("#documentFieldForm")).toBeHidden();
''',
    '''  await expect(page.locator(".structure-report")).toHaveClass(
    /is-row-editor-open/u
  );
  await expect(page.locator(".structure-element-list")).toBeHidden();
  await expect(panel.locator(".roster-assistant-heading")).toContainText(
    "4 ячейки"
  );
  expect(
    await panel.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)
  ).toBe(true);
'''
)

insert_after(
    "docs/TEMPLATE_ROW_EDITOR.md",
    '''1. Подготовьте строку заголовков и одну пустую образцовую строку.
''',
    '''   Обычный файл, сохранённый в настольном Microsoft Word или LibreOffice, поддерживается вместе со служебными идентификаторами абзацев.
'''
)
insert_after(
    "docs/TEMPLATE_ROW_EDITOR.md",
    '''7. Нажмите **«Сохранить настройки строки»**.
''',
    '''
Строка-образец не должна содержать вложенную таблицу, вертикально объединённые ячейки, рисунок, поле Word, ссылку или режим «повторять как строку заголовка». Горизонтальные ячейки обычной таблицы и пустые абзацы внутри них являются штатным вариантом.
'''
)
insert_after(
    "docs/RELEASE_NOTES.md",
    '''## 2026-07-26 — визуальная иерархия интерфейса
''',
    '''
### Исправление повторяемой строки Word

- Обычные `w14:paraId`, `w14:textId` и `w14:anchorId`, которые настольный Word добавляет к простым абзацам и строкам, больше не считаются сложным объектом.
- При создании списка служебные идентификаторы каждой копии строки создаются заново детерминированно; маркеры проверки орфографии не переносятся в итоговые строки.
- Ошибки вложенной таблицы, вертикального объединения, строки-заголовка и действительно сложного содержимого разделены на конкретные сообщения.
- Структура DOCX показывает строки таблицы и их ячейки горизонтально, а редактор строки открывается на всю рабочую ширину без вложенной прокрутки.
'''
)

print("DOCX repeat row core and UI integration fixed")
