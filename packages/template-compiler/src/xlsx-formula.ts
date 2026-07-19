import { TemplateCompilerError } from "./compiler.js";

const MAX_FORMULA_LENGTH = 8_192;
const MAX_TOKENS = 512;
const MAX_REFERENCES = 256;
const MAX_COLUMN = 16_384;
const MAX_ROW = 1_048_576;
const SAFE_FUNCTIONS = new Set([
  "ABS",
  "AVERAGE",
  "COUNT",
  "MAX",
  "MIN",
  "ROUND",
  "SUM"
]);

interface BaseToken {
  start: number;
  end: number;
  text: string;
}

interface ReferenceToken extends BaseToken {
  kind: "reference";
  columnText: string;
  columnAbsolute: boolean;
  row: number;
  rowAbsolute: boolean;
}

interface SimpleToken extends BaseToken {
  kind: "number" | "identifier" | "operator";
}

type FormulaToken = ReferenceToken | SimpleToken;

export interface SafeXlsxFormulaArea {
  repeatRow: number;
  startColumn: number;
  endColumn: number;
}

function formulaError(message: string): TemplateCompilerError {
  return new TemplateCompilerError("unsafe_repeat_formula", message);
}

function columnNumber(column: string): number {
  let value = 0;
  for (const character of column.toUpperCase()) {
    value = value * 26 + character.charCodeAt(0) - 64;
  }
  return value;
}

function tokenBoundary(formula: string, index: number): boolean {
  const character = formula[index];
  return character === undefined || !/[A-Za-z0-9_.]/u.test(character);
}

function tokenize(formula: string): FormulaToken[] {
  if (formula.length === 0 || formula.length > MAX_FORMULA_LENGTH) {
    throw formulaError("Формула повторяемой строки имеет недопустимую длину.");
  }
  const tokens: FormulaToken[] = [];
  let index = 0;
  while (index < formula.length) {
    const remaining = formula.slice(index);
    const whitespace = /^\s+/u.exec(remaining);
    if (whitespace !== null) {
      index += whitespace[0].length;
      continue;
    }
    const reference = /^(\$?)([A-Za-z]{1,3})(\$?)([1-9][0-9]{0,6})/u.exec(
      remaining
    );
    if (
      reference !== null &&
      tokenBoundary(formula, index + reference[0].length)
    ) {
      const columnText = (reference[2] ?? "").toUpperCase();
      const row = Number(reference[4]);
      if (columnNumber(columnText) > MAX_COLUMN || row > MAX_ROW) {
        throw formulaError("Формула содержит координату за пределами XLSX.");
      }
      tokens.push({
        kind: "reference",
        start: index,
        end: index + reference[0].length,
        text: reference[0],
        columnText,
        columnAbsolute: reference[1] === "$",
        row,
        rowAbsolute: reference[3] === "$"
      });
      index += reference[0].length;
      continue;
    }
    const number = /^(?:[0-9]+(?:\.[0-9]+)?|\.[0-9]+)/u.exec(remaining);
    if (number !== null) {
      tokens.push({
        kind: "number",
        start: index,
        end: index + number[0].length,
        text: number[0]
      });
      index += number[0].length;
      continue;
    }
    const identifier = /^[A-Za-z][A-Za-z0-9.]*/u.exec(remaining);
    if (identifier !== null) {
      tokens.push({
        kind: "identifier",
        start: index,
        end: index + identifier[0].length,
        text: identifier[0]
      });
      index += identifier[0].length;
      continue;
    }
    const operator = remaining[0];
    if (operator !== undefined && "+-*/%^(),;:".includes(operator)) {
      tokens.push({
        kind: "operator",
        start: index,
        end: index + 1,
        text: operator
      });
      index += 1;
      continue;
    }
    throw formulaError(
      "Формула содержит неподдерживаемую ссылку, функцию или знак."
    );
  }
  if (tokens.length === 0 || tokens.length > MAX_TOKENS) {
    throw formulaError("Формула содержит недопустимое число элементов.");
  }
  if (tokens.filter((token) => token.kind === "reference").length > MAX_REFERENCES) {
    throw formulaError("Формула содержит слишком много ссылок на ячейки.");
  }
  return tokens;
}

class FormulaParser {
  private index = 0;

  constructor(private readonly tokens: readonly FormulaToken[]) {}

  parse(): void {
    this.parseAdditive();
    if (this.current() !== undefined) this.invalid();
  }

  private current(): FormulaToken | undefined {
    return this.tokens[this.index];
  }

  private take(text: string): boolean {
    if (this.current()?.text !== text) return false;
    this.index += 1;
    return true;
  }

  private invalid(): never {
    throw formulaError(
      "Формула выходит за разрешённый объём арифметики и локальных функций."
    );
  }

  private parseAdditive(): void {
    this.parseMultiplicative();
    while (this.take("+") || this.take("-")) this.parseMultiplicative();
  }

  private parseMultiplicative(): void {
    this.parsePower();
    while (this.take("*") || this.take("/") || this.take("%")) {
      this.parsePower();
    }
  }

  private parsePower(): void {
    this.parseUnary();
    if (this.take("^")) this.parsePower();
  }

  private parseUnary(): void {
    if (this.take("+") || this.take("-")) {
      this.parseUnary();
      return;
    }
    this.parsePrimary();
  }

  private parsePrimary(): void {
    const token = this.current();
    if (token === undefined) this.invalid();
    if (token.kind === "number") {
      this.index += 1;
      return;
    }
    if (token.kind === "reference") {
      this.index += 1;
      if (this.take(":")) {
        if (this.current()?.kind !== "reference") this.invalid();
        this.index += 1;
      }
      return;
    }
    if (this.take("(")) {
      this.parseAdditive();
      if (!this.take(")")) this.invalid();
      return;
    }
    if (token.kind !== "identifier") this.invalid();
    const functionName = token.text.toUpperCase();
    if (!SAFE_FUNCTIONS.has(functionName)) {
      throw formulaError(`Функция «${token.text}» не разрешена в повторяемой строке.`);
    }
    this.index += 1;
    if (!this.take("(")) this.invalid();
    if (this.take(")")) return;
    this.parseAdditive();
    while (this.take(",") || this.take(";")) this.parseAdditive();
    if (!this.take(")")) this.invalid();
  }
}

export function translateSafeXlsxFormula(
  formula: string,
  sourceRow: number,
  destinationRow: number,
  area: SafeXlsxFormulaArea
): string {
  if (
    !Number.isInteger(sourceRow) ||
    !Number.isInteger(destinationRow) ||
    sourceRow < 1 ||
    sourceRow > MAX_ROW ||
    destinationRow < 1 ||
    destinationRow > MAX_ROW ||
    !Number.isInteger(area.repeatRow) ||
    area.repeatRow < 1 ||
    area.repeatRow > MAX_ROW ||
    !Number.isInteger(area.startColumn) ||
    !Number.isInteger(area.endColumn) ||
    area.startColumn < 1 ||
    area.endColumn > MAX_COLUMN ||
    area.startColumn > area.endColumn
  ) {
    throw formulaError("Границы формулы находятся за пределами XLSX.");
  }
  const tokens = tokenize(formula);
  new FormulaParser(tokens).parse();
  const references = tokens.filter(
    (token): token is ReferenceToken => token.kind === "reference"
  );
  for (const reference of references) {
    if (!reference.rowAbsolute && reference.row !== sourceRow) {
      throw formulaError(
        "Относительная ссылка формулы выходит за строку-образец. Сделайте строку абсолютной или упростите формулу."
      );
    }
    const column = columnNumber(reference.columnText);
    if (
      !reference.rowAbsolute &&
      (column < area.startColumn || column > area.endColumn)
    ) {
      throw formulaError(
        "Относительная ссылка формулы выходит за клонируемый диапазон строки. Расширьте диапазон или сделайте ссылку абсолютной."
      );
    }
    if (reference.rowAbsolute && reference.row > area.repeatRow) {
      throw formulaError(
        "Абсолютная ссылка формулы указывает на строку, которая сдвигается при повторе. Упростите формулу или перенесите данные выше строки-образца."
      );
    }
  }
  let result = formula;
  for (const reference of [...references].reverse()) {
    const row = reference.rowAbsolute ? reference.row : destinationRow;
    const replacement = `${reference.columnAbsolute ? "$" : ""}${reference.columnText}${reference.rowAbsolute ? "$" : ""}${row}`;
    result =
      result.slice(0, reference.start) +
      replacement +
      result.slice(reference.end);
  }
  return result;
}
