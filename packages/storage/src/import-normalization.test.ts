import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeIdentityForComparison,
  normalizeImportRow,
  normalizeImportText,
  splitRussianPersonName
} from "./import-normalization.js";

test("normalization preserves empty columns and applies selected case", () => {
  const row = normalizeImportRow(
    {
      Код: "  AbC-01  ",
      ФИО: "  иВАНОВ   иВАН   иВАНОВИЧ ",
      Отдел: "  НАУЧНЫЙ   ОТДЕЛ  ",
      Пусто: ""
    },
    [
      {
        column: "Отдел",
        normalization: { case: "title" }
      },
      {
        column: "Пусто",
        normalization: { case: "upper" }
      }
    ],
    {
      identityColumn: "Код",
      displayNameColumn: "ФИО",
      identityNormalization: { case: "upper" },
      displayNameNormalization: { case: "name" }
    }
  );

  assert.deepEqual(row, {
    Код: "ABC-01",
    ФИО: "Иванов Иван Иванович",
    Отдел: "Научный Отдел",
    Пусто: ""
  });
});

test("identity comparison ignores Unicode form, spaces, and register", () => {
  assert.equal(
    normalizeIdentityForComparison("  ROOM-ЁЖ  "),
    normalizeIdentityForComparison("room-ёж")
  );
});

test("Russian full name splits into reusable family, given, and patronymic fields", () => {
  assert.deepEqual(
    splitRussianPersonName("  иВАНОВ   иВАН иВАНОВИЧ ", {
      enabled: true,
      order: "family-given-patronymic"
    }),
    {
      familyName: "Иванов",
      givenName: "Иван",
      patronymic: "Иванович",
      normalizedDisplayName: "Иванов Иван Иванович"
    }
  );
  assert.deepEqual(
    splitRussianPersonName("Иван Иванович Иванов", {
      enabled: true,
      order: "given-patronymic-family"
    }),
    {
      familyName: "Иванов",
      givenName: "Иван",
      patronymic: "Иванович",
      normalizedDisplayName: "Иван Иванович Иванов"
    }
  );
  assert.deepEqual(splitRussianPersonName("Петров Пётр"), {
    familyName: "Петров",
    givenName: "Пётр",
    patronymic: "",
    normalizedDisplayName: "Петров Пётр"
  });
});

test("case modes are deterministic for Russian text", () => {
  assert.equal(normalizeImportText("  сАНКТ-пЕТЕРБУРГ ", { case: "name" }), "Санкт-Петербург");
  assert.equal(normalizeImportText("НаУчНый ОТДЕЛ", { case: "lower" }), "научный отдел");
  assert.equal(normalizeImportText("НаУчНый ОТДЕЛ", { case: "upper" }), "НАУЧНЫЙ ОТДЕЛ");
});
