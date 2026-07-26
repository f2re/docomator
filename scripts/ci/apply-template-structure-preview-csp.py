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


def insert_before(relative: str, marker: str, addition: str) -> None:
    path = ROOT / relative
    value = path.read_text(encoding="utf-8")
    if addition in value:
        return
    count = value.count(marker)
    if count != 1:
        raise RuntimeError(f"{relative}: expected one marker, found {count}")
    path.write_text(value.replace(marker, addition + marker, 1), encoding="utf-8")
    print(f"updated {relative}")


# Keep the repeated rows as direct children of the original Word table.
insert_before(
    "packages/template-compiler/src/compiler.ts",
    "function docxTagIdentifiers(xml: string): string[] {",
    '''function firstDocxParagraphRange(
  xml: string,
  parent: XmlElementRange
): XmlElementRange {
  const tags = scanXmlTags(xml);
  for (let index = 0; index < tags.length; index += 1) {
    const tag = tags[index];
    if (
      tag === undefined ||
      tag.closing ||
      tag.selfClosing ||
      tag.localName !== "p" ||
      tag.start < parent.openEnd ||
      tag.end > parent.closeStart
    ) {
      continue;
    }
    const close = tags[matchingCloseIndex(tags, index)];
    if (close === undefined || close.end > parent.closeStart) continue;
    return {
      start: tag.start,
      end: close.end,
      openEnd: tag.end,
      closeStart: close.start,
      name: tag.name,
      selfClosing: false
    };
  }
  throw new TemplateCompilerError(
    "repeat_row_paragraph_not_found",
    "В строке-образце не найден обычный абзац для служебной метки повтора."
  );
}

'''
)
replace_once(
    "packages/template-compiler/src/compiler.ts",
    '''  const prefix = tagPrefix(row.name) || "w:";
  const namespace =
    tagPrefix(row.name).length === 0
      ? ' xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'
      : "";
  const wrapper = `<${prefix}sdt${namespace}><${prefix}sdtPr><${prefix}alias ${prefix}val="Повтор участников"/><${prefix}tag ${prefix}val="${xmlAttribute(repeatIdentifier)}"/><${prefix}id ${prefix}val="${deterministicWordId(repeatIdentifier)}"/></${prefix}sdtPr><${prefix}sdtContent>${rowXml}</${prefix}sdtContent></${prefix}sdt>`;
  const updated =
    decoded.text.slice(0, row.start) +
    wrapper +
    decoded.text.slice(row.end);''',
    '''  const paragraph = firstDocxParagraphRange(decoded.text, row);
  const prefix = tagPrefix(paragraph.name);
  const marker = `<${prefix}sdt><${prefix}sdtPr><${prefix}alias ${prefix}val="Повтор участников"/><${prefix}tag ${prefix}val="${xmlAttribute(repeatIdentifier)}"/><${prefix}id ${prefix}val="${deterministicWordId(repeatIdentifier)}"/></${prefix}sdtPr><${prefix}sdtContent><${prefix}r><${prefix}t/></${prefix}r></${prefix}sdtContent></${prefix}sdt>`;
  const updated =
    decoded.text.slice(0, paragraph.closeStart) +
    marker +
    decoded.text.slice(paragraph.closeStart);'''
)
replace_once(
    "packages/template-compiler/src/compiler.ts",
    '''  const content = docxSdtContentRange(verifiedXml, repeatIdentifier);
  if (content === null) {
    throw new TemplateCompilerError(
      "compiled_repeat_binding_not_found",
      "После сборки не удалось повторно найти повторяемую строку DOCX."
    );
  }
  const verifiedRow = verifiedXml.slice(content.openEnd, content.closeStart);
  findDocxTableRowRange(
    `<w:tbl xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">${verifiedRow}</w:tbl>`,
    0,
    0
  );''',
    '''  const content = docxSdtContentRange(verifiedXml, repeatIdentifier);
  if (content === null) {
    throw new TemplateCompilerError(
      "compiled_repeat_binding_not_found",
      "После сборки не удалось повторно найти служебную метку повторяемой строки DOCX."
    );
  }
  const verifiedRow = findDocxTableRowRange(
    verifiedXml,
    binding.tableIndex,
    binding.rowIndex
  );
  if (
    content.start < verifiedRow.openEnd ||
    content.end > verifiedRow.closeStart
  ) {
    throw new TemplateCompilerError(
      "compiled_repeat_binding_outside_row",
      "Служебная метка повтора оказалась вне выбранной строки таблицы DOCX."
    );
  }'''
)

insert_before(
    "packages/template-compiler/src/scalar-render.ts",
    "function setWordIdAttribute(opening: string, value: number): string {",
    '''function findDocxTableRowRange(
  xml: string,
  tableIndex: number,
  rowIndex: number
): { start: number; end: number; openEnd: number; closeStart: number } {
  const tags = scanXmlTags(xml);
  const openStack: XmlTag[] = [];
  const tableStack: Array<{ tableIndex: number; rowIndex: number }> = [];
  let tableSequence = -1;
  for (let index = 0; index < tags.length; index += 1) {
    const tag = tags[index];
    if (tag === undefined) continue;
    if (tag.closing) {
      const opening = openStack.pop();
      if (opening === undefined || opening.name !== tag.name) throwInvalidXml();
      if (tag.localName === "tbl") tableStack.pop();
      continue;
    }
    if (tag.localName === "tbl") {
      tableSequence += 1;
      tableStack.push({ tableIndex: tableSequence, rowIndex: -1 });
    } else if (tag.localName === "tr") {
      const table = tableStack.at(-1);
      if (table !== undefined) {
        table.rowIndex += 1;
        if (table.tableIndex === tableIndex && table.rowIndex === rowIndex) {
          if (openStack.at(-1)?.localName !== "tbl" || tag.selfClosing) {
            throw new TemplateCompilerError(
              "repeat_row_structure_mismatch",
              "Повторяемая строка должна оставаться непосредственной строкой исходной таблицы DOCX."
            );
          }
          const close = tags[matchingCloseIndex(tags, index)];
          if (close === undefined) throwInvalidXml();
          return {
            start: tag.start,
            end: close.end,
            openEnd: tag.end,
            closeStart: close.start
          };
        }
      }
    }
    if (!tag.selfClosing) openStack.push(tag);
    else if (tag.localName === "tbl") tableStack.pop();
  }
  throw new TemplateCompilerError(
    "repeat_row_not_found",
    `Строка ${rowIndex + 1} таблицы ${tableIndex + 1} не найдена в DOCX.`
  );
}

'''
)
replace_once(
    "packages/template-compiler/src/scalar-render.ts",
    '''  const target = docxContentTarget(
    decoded.text,
    input.technicalBinding.identifier
  );
  const content = target.tags[target.contentOpenIndex];
  const contentClose = target.tags[target.contentCloseIndex];
  if (content === undefined || contentClose === undefined) throwInvalidXml();
  const templates = directDocxRows(
    decoded.text,
    target.tags,
    target.contentOpenIndex,
    target.contentCloseIndex
  );
  if (templates.length !== 1) {
    throw new TemplateCompilerError(
      "repeat_template_row_count_mismatch",
      "Скомпилированный повтор должен содержать ровно одну строку-образец."
    );
  }
  const template = templates[0];
  if (template === undefined) throwInvalidXml();''',
    '''  const target = docxContentTarget(
    decoded.text,
    input.technicalBinding.identifier
  );
  const repeatOpen = target.tags[target.sdtOpenIndex];
  const repeatClose = target.tags[target.sdtCloseIndex];
  if (repeatOpen === undefined || repeatClose === undefined) throwInvalidXml();
  const sourceRow = findDocxTableRowRange(
    decoded.text,
    input.binding.tableIndex,
    input.binding.rowIndex
  );
  const markerInsideRow =
    repeatOpen.start >= sourceRow.openEnd &&
    repeatClose.end <= sourceRow.closeStart;
  let template: string;
  let replacementStart: number;
  let replacementEnd: number;
  if (markerInsideRow) {
    const rowXml = decoded.text.slice(sourceRow.start, sourceRow.end);
    template =
      rowXml.slice(0, repeatOpen.start - sourceRow.start) +
      rowXml.slice(repeatClose.end - sourceRow.start);
    replacementStart = sourceRow.start;
    replacementEnd = sourceRow.end;
  } else {
    const content = target.tags[target.contentOpenIndex];
    const contentClose = target.tags[target.contentCloseIndex];
    if (content === undefined || contentClose === undefined) throwInvalidXml();
    const templates = directDocxRows(
      decoded.text,
      target.tags,
      target.contentOpenIndex,
      target.contentCloseIndex
    );
    if (templates.length !== 1) {
      throw new TemplateCompilerError(
        "repeat_template_row_count_mismatch",
        "Скомпилированный повтор должен содержать ровно одну строку-образец."
      );
    }
    const legacyTemplate = templates[0];
    if (legacyTemplate === undefined) throwInvalidXml();
    template = legacyTemplate;
    replacementStart = content.end;
    replacementEnd = contentClose.start;
  }'''
)
replace_once(
    "packages/template-compiler/src/scalar-render.ts",
    '''  const updatedXml =
    decoded.text.slice(0, content.end) +
    renderedRows.join("") +
    decoded.text.slice(contentClose.start);''',
    '''  const updatedXml =
    decoded.text.slice(0, replacementStart) +
    renderedRows.join("") +
    decoded.text.slice(replacementEnd);'''
)
replace_once(
    "packages/template-compiler/src/scalar-render.ts",
    '''  const verifiedTarget = docxContentTarget(
    verifiedDecoded.text,
    input.technicalBinding.identifier
  );
  const verifiedRows = directDocxRows(
    verifiedDecoded.text,
    verifiedTarget.tags,
    verifiedTarget.contentOpenIndex,
    verifiedTarget.contentCloseIndex
  );''',
    '''  let verifiedRows: string[];
  if (markerInsideRow) {
    const remainingMarker = readDocxSdtValues(
      verifiedDecoded.text,
      new Set([input.technicalBinding.identifier])
    ).get(input.technicalBinding.identifier);
    if (remainingMarker !== undefined) {
      throw new TemplateCompilerError(
        "repeat_marker_not_removed",
        "После формирования в DOCX осталась служебная метка строки-образца."
      );
    }
    verifiedRows = input.members.map((_member, memberIndex) => {
      const row = findDocxTableRowRange(
        verifiedDecoded.text,
        input.binding.tableIndex,
        input.binding.rowIndex + memberIndex
      );
      return verifiedDecoded.text.slice(row.start, row.end);
    });
  } else {
    const verifiedTarget = docxContentTarget(
      verifiedDecoded.text,
      input.technicalBinding.identifier
    );
    verifiedRows = directDocxRows(
      verifiedDecoded.text,
      verifiedTarget.tags,
      verifiedTarget.contentOpenIndex,
      verifiedTarget.contentCloseIndex
    );
  }'''
)

# Replace CSP-blocked inline progress styles with native progress elements.
replace_once(
    "apps/api/ui/operation-center.js",
    '''  return `<div class="operation-progress" role="progressbar" aria-label="Выполнение ${percent}%" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${percent}"><span style="--operation-progress: ${percent}%"></span></div>`;''',
    '''  return `<progress class="operation-progress" max="100" value="${percent}" aria-label="Выполнение ${percent}%">${percent}%</progress>`;'''
)
replace_once(
    "apps/api/ui/document-generation.js",
    '''    <div class="generation-progress-bar" aria-label="Выполнение ${progress}%"><span style="--progress: ${progress}%"></span></div>''',
    '''    <progress class="generation-progress-bar" max="100" value="${progress}" aria-label="Выполнение ${progress}%">${progress}%</progress>'''
)
replace_once(
    "apps/api/ui/operation-center.css",
    '''.operation-progress {
  width: min(28rem, 100%);
  height: 0.3rem;
  margin: 0.25rem 0;
  overflow: hidden;
  background: var(--surface-hover);
  border-radius: 999px;
}

.operation-progress span {
  display: block;
  width: var(--operation-progress);
  height: 100%;
  background: var(--accent);
  border-radius: inherit;
}''',
    '''.operation-progress {
  width: min(28rem, 100%);
  height: 0.3rem;
  margin: 0.25rem 0;
  overflow: hidden;
  appearance: none;
  background: var(--surface-hover);
  border: 0;
  border-radius: 999px;
}

.operation-progress::-webkit-progress-bar {
  background: var(--surface-hover);
  border-radius: 999px;
}

.operation-progress::-webkit-progress-value {
  background: var(--accent);
  border-radius: 999px;
}

.operation-progress::-moz-progress-bar {
  background: var(--accent);
  border-radius: 999px;
}'''
)

# The generation progress CSS has the same old span-based pattern.
replace_once(
    "apps/api/ui/document-generation.css",
    '''.generation-progress-bar {
  height: 0.65rem;
  overflow: hidden;
  background: var(--surface-2);
  border-radius: 999px;
}

.generation-progress-bar span {
  display: block;
  width: var(--progress);
  height: 100%;
  background: var(--accent);
  border-radius: inherit;
}''',
    '''.generation-progress-bar {
  width: 100%;
  height: 0.65rem;
  overflow: hidden;
  appearance: none;
  background: var(--surface-2);
  border: 0;
  border-radius: 999px;
}

.generation-progress-bar::-webkit-progress-bar {
  background: var(--surface-2);
  border-radius: 999px;
}

.generation-progress-bar::-webkit-progress-value {
  background: var(--accent);
  border-radius: 999px;
}

.generation-progress-bar::-moz-progress-bar {
  background: var(--accent);
  border-radius: 999px;
}'''
)
replace_once(
    "package.json",
    '''node --check apps/api/ui/template-row-flow.js && node scripts/ci/check-ui-bundles.mjs''',
    '''node --check apps/api/ui/template-row-flow.js && node scripts/ci/check-ui-bundles.mjs && node scripts/ci/check-ui-csp.mjs'''
)

# Strengthen the real Word table regression.
replace_once(
    "packages/template-compiler/src/word-repeat-row.test.ts",
    '''  const byId = new Map(compiled.fields.map((field) => [field.fieldId, field]));
  const rendered = await renderDocxRepeatRows({''',
    '''  const compiledXml = packageEntry(
    await readOoxmlPackage(compiled.output),
    "word/document.xml"
  ).content.toString("utf8");
  assert.equal((compiledXml.match(/<w:tbl\\b/gu) ?? []).length, 1);
  assert.doesNotMatch(
    compiledXml,
    /<w:tbl\\b[^>]*>[\\s\\S]*?<w:sdt\\b[^>]*>[\\s\\S]*?<w:sdtContent>[\\s\\S]*?<w:tr\\b/u
  );
  assert.match(
    compiledXml,
    /<w:tr\\b[^>]*>[\\s\\S]*?airepeat:[a-f0-9]{24}[\\s\\S]*?<\\/w:tr>/u
  );

  const byId = new Map(compiled.fields.map((field) => [field.fieldId, field]));
  const rendered = await renderDocxRepeatRows({'''
)
replace_once(
    "packages/template-compiler/src/word-repeat-row.test.ts",
    '''  assert.equal((xml.match(/<w:tr\\b/gu) ?? []).length, 3);
  assert.match(xml, /Темы работ/u);''',
    '''  assert.equal((xml.match(/<w:tbl\\b/gu) ?? []).length, 1);
  assert.equal((xml.match(/<w:tr\\b/gu) ?? []).length, 3);
  assert.doesNotMatch(xml, /airepeat:[a-f0-9]{24}/u);
  assert.match(
    xml,
    /<w:tbl\\b[^>]*>[\\s\\S]*?<w:tr\\b[^>]*>[\\s\\S]*?<w:t>#<\\/w:t>[\\s\\S]*?<\\/w:tr><w:tr\\b[^>]*>[\\s\\S]*?Иванов Иван[\\s\\S]*?<\\/w:tr><w:tr\\b[^>]*>[\\s\\S]*?Петров Пётр[\\s\\S]*?<\\/w:tr>[\\s\\S]*?<\\/w:tbl>/u
  );
  assert.match(xml, /Темы работ/u);'''
)

# User-facing copy no longer claims that a PDF is mandatory.
replace_once(
    "apps/api/ui/document-generation.js",
    '''<div class="generation-state is-warning"><div><strong>Сначала подключите шаблон</strong><p>Проверьте документ, свяжите его с полями сотрудников и подтвердите предварительный просмотр.</p><button class="primary-button" type="button" data-view-target="templates">Открыть шаблоны</button></div></div>''',
    '''<div class="generation-state is-warning"><div><strong>Сначала подключите шаблон</strong><p>Проверьте документ, свяжите его с полями сотрудников и сохраните проверенную версию. PDF можно создать отдельно только для визуального контроля.</p><button class="primary-button" type="button" data-view-target="templates">Открыть шаблоны</button></div></div>'''
)

# Documentation and release note updates.
insert_before(
    "docs/RELEASE_NOTES.md",
    "## 2026-07-26 — визуальная иерархия интерфейса",
    '''## 2026-07-26 — целостная таблица Word, необязательный PDF и чистая CSP

- Повторяемые строки остаются непосредственными строками исходной таблицы DOCX; заголовок и созданные записи больше не разделяются служебным контейнером Word.
- Служебная метка строки хранится внутри абзаца образца и удаляется при выпуске, а прежние скомпилированные шаблоны продолжают поддерживаться.
- Проверенную версию шаблона можно сохранить сразу. PDF-предпросмотр оставлен отдельной необязательной визуальной проверкой.
- Полосы выполнения используют нативный элемент `progress`; встроенные стили удалены, а CI запрещает повторное появление нарушений Content-Security-Policy.

'''
)
replace_once(
    "docs/TEMPLATE_ACTIVATION.md",
    '''# Предварительный просмотр и активация шаблона''',
    '''# Сохранение шаблона и необязательный предварительный просмотр'''
)

print("template structure and CSP patches applied")
