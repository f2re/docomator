import assert from "node:assert/strict";
import test from "node:test";

import { BibliographyInputError, exportBibTeX, exportCslJson, parseBibliography } from "./bibliography-io.js";

test("BibTeX сохраняет русские поля, DOI и авторов при round-trip", () => {
  const source = `@article{ivanov2026,\n  author = {Иванов, Иван and Петров, Пётр},\n  title = {Радарный наукастинг осадков},\n  journal = {Метеорология},\n  year = {2026},\n  volume = {12},\n  number = {3},\n  pages = {10--22},\n  doi = {https://doi.org/10.1000/Test.1},\n  url = {https://example.test/paper}\n}`;
  const first = parseBibliography("bibtex", source);
  assert.equal(first.records.length, 1);
  assert.equal(first.records[0]?.title, "Радарный наукастинг осадков");
  assert.equal(first.records[0]?.authors.length, 2);
  assert.equal(first.records[0]?.doi, "10.1000/test.1");
  assert.equal(first.records[0]?.volume, "12");
  const second = parseBibliography("bibtex", exportBibTeX(first.records));
  assert.equal(second.records[0]?.title, first.records[0]?.title);
  assert.equal(second.records[0]?.doi, first.records[0]?.doi);
  assert.equal(second.records[0]?.pages, first.records[0]?.pages);
});

test("CSL JSON экспортируется и повторно читается без облачного Zotero API", () => {
  const source = JSON.stringify([{ id: "paper-1", type: "article-journal", title: "Локальная библиография", author: [{ family: "Сидоров", given: "Алексей" }], issued: { "date-parts": [[2025, 8, 18]] }, "container-title": "Сборник", DOI: "10.2000/example", ISSN: "1234-5678", keyword: "ГОСТ, Zotero" }]);
  const parsed = parseBibliography("csl-json", source);
  assert.equal(parsed.records.length, 1);
  assert.equal(parsed.records[0]?.issuedYear, 2025);
  assert.equal(parsed.records[0]?.issuedDate, "2025-08-18");
  const again = parseBibliography("csl-json", exportCslJson(parsed.records));
  assert.equal(again.records[0]?.containerTitle, "Сборник");
  assert.equal(again.records[0]?.issn, "1234-5678");
});

test("повреждённый или пустой каталог возвращает машинный код ошибки", () => {
  assert.throws(() => parseBibliography("csl-json", "{"), (error: unknown) => error instanceof BibliographyInputError && error.code === "invalid_json");
  assert.throws(() => parseBibliography("bibtex", "   \n"), (error: unknown) => error instanceof BibliographyInputError && error.code === "empty_input");
});
