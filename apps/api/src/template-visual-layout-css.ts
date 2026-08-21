import type {
  DocumentVisualLayoutReport,
  VisualBorderSide,
  VisualCellStyle,
  VisualParagraphStyle,
  VisualTextStyle,
  VisualXlsxCellStyle
} from "@docomator/document-intake";

const SAFE_FONT = /^[\p{L}\p{N} .,_()\-]+$/u;
const SAFE_COLOR = /^#[0-9a-f]{6}$/iu;

function finite(
  value: number | null | undefined,
  minimum: number,
  maximum: number
): number | null {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value >= minimum &&
    value <= maximum
    ? value
    : null;
}

function color(value: string | null | undefined): string | null {
  return SAFE_COLOR.test(value ?? "") ? value!.toUpperCase() : null;
}

function fontFamily(value: string | null | undefined): string | null {
  const normalized = (value ?? "").normalize("NFKC").trim();
  if (!normalized || normalized.length > 120 || !SAFE_FONT.test(normalized)) {
    return null;
  }
  return JSON.stringify(normalized);
}

function addRule(lines: string[], token: string, declarations: readonly string[]): void {
  const filtered = declarations.filter(Boolean);
  if (filtered.length === 0) return;
  lines.push(`[data-visual-style="${token}"]{${filtered.join(";")}}`);
}

function textRules(style: VisualTextStyle): string[] {
  const rules: string[] = [];
  if (style.bold) rules.push("font-weight:700");
  if (style.italic) rules.push("font-style:italic");
  const foreground = color(style.color);
  const background = color(style.backgroundColor);
  const family = fontFamily(style.fontFamily);
  const size = finite(style.fontSizePt, 4, 144);
  if (foreground) rules.push(`color:${foreground}`);
  if (background) rules.push(`background-color:${background}`);
  if (family) rules.push(`font-family:${family},sans-serif`);
  if (size !== null) rules.push(`font-size:${size}pt`);
  if (style.underline && style.strike) rules.push("text-decoration:underline line-through");
  else if (style.underline) rules.push("text-decoration:underline");
  else if (style.strike) rules.push("text-decoration:line-through");
  if (style.verticalAlign === "superscript") {
    rules.push("vertical-align:super", "font-size:0.8em");
  } else if (style.verticalAlign === "subscript") {
    rules.push("vertical-align:sub", "font-size:0.8em");
  }
  if (style.caps) rules.push("text-transform:uppercase");
  if (style.smallCaps) rules.push("font-variant-caps:small-caps");
  return rules;
}

function paragraphRules(style: VisualParagraphStyle): string[] {
  const rules: string[] = [];
  if (["left", "center", "right", "justify"].includes(style.alignment ?? "")) {
    rules.push(`text-align:${style.alignment}`);
  }
  const left = finite(style.marginLeftPt, -5000, 5000);
  const right = finite(style.marginRightPt, -5000, 5000);
  const first = finite(style.firstLinePt, -5000, 5000);
  const hanging = finite(style.hangingPt, 0, 5000);
  const before = finite(style.spaceBeforePt, 0, 1000);
  const after = finite(style.spaceAfterPt, 0, 1000);
  const line = finite(style.lineHeightPt, 1, 1000);
  const background = color(style.backgroundColor);
  if (left !== null) rules.push(`margin-left:${left}pt`);
  if (right !== null) rules.push(`margin-right:${right}pt`);
  if (first !== null) rules.push(`text-indent:${first}pt`);
  else if (hanging !== null) rules.push(`text-indent:-${hanging}pt`);
  if (before !== null) rules.push(`margin-top:${before}pt`);
  if (after !== null) rules.push(`margin-bottom:${after}pt`);
  if (line !== null) rules.push(`line-height:${line}pt`);
  if (background) rules.push(`background-color:${background}`);
  return rules;
}

function borderRule(side: string, border: VisualBorderSide): string | null {
  if (!border.style || border.style === "none" || border.style === "nil") return null;
  const width = finite(border.widthPt, 0.25, 12) ?? 0.75;
  const borderColor = color(border.color) ?? "var(--border-strong)";
  const style = /double/iu.test(border.style)
    ? "double"
    : /dash/iu.test(border.style)
      ? "dashed"
      : /dot/iu.test(border.style)
        ? "dotted"
        : "solid";
  return `border-${side}:${width}pt ${style} ${borderColor}`;
}

function borderRules(borders: VisualCellStyle["borders"]): string[] {
  return (["top", "right", "bottom", "left"] as const)
    .map((side) => borderRule(side, borders[side]))
    .filter((value): value is string => value !== null);
}

function cellRules(style: VisualCellStyle): string[] {
  const rules = borderRules(style.borders);
  const background = color(style.backgroundColor);
  const width = finite(style.widthPt, 1, 5000);
  if (background) rules.push(`background-color:${background}`);
  if (width !== null) rules.push(`width:${width}pt`);
  if (["top", "center", "bottom"].includes(style.verticalAlign ?? "")) {
    rules.push(`vertical-align:${style.verticalAlign === "center" ? "middle" : style.verticalAlign}`);
  }
  return rules;
}

function xlsxCellRules(style: VisualXlsxCellStyle): string[] {
  const rules = [...textRules(style.font), ...borderRules(style.borders)];
  const fill = color(style.fillColor);
  if (fill) rules.push(`background-color:${fill}`);
  if (["left", "center", "right", "justify"].includes(style.horizontalAlign ?? "")) {
    rules.push(`text-align:${style.horizontalAlign}`);
  }
  if (["top", "center", "bottom"].includes(style.verticalAlign ?? "")) {
    rules.push(`vertical-align:${style.verticalAlign === "center" ? "middle" : style.verticalAlign}`);
  }
  if (style.wrapText) rules.push("white-space:pre-wrap");
  return rules;
}

function imageRules(widthPt: number | null, heightPt: number | null): string[] {
  const rules: string[] = [];
  const width = finite(widthPt, 4, 1200);
  const height = finite(heightPt, 4, 1200);
  if (width !== null) rules.push(`width:${width}pt`);
  if (height !== null) rules.push(`height:${height}pt`);
  return rules;
}

export function buildTemplateVisualLayoutCss(report: DocumentVisualLayoutReport): string {
  const lines = ["/* Оформлятор: безопасная CSS-проекция локального Office-документа. */"];

  if (report.docx) {
    const pageRules: string[] = [];
    const pageWidth = finite(report.docx.page.widthPt, 100, 2000);
    const margins = report.docx.page.margins;
    const top = finite(margins.topPt, 0, 500);
    const right = finite(margins.rightPt, 0, 500);
    const bottom = finite(margins.bottomPt, 0, 500);
    const left = finite(margins.leftPt, 0, 500);
    if (pageWidth !== null) pageRules.push(`--template-page-width:${pageWidth}pt`);
    if (top !== null) pageRules.push(`--template-page-top:${top}pt`);
    if (right !== null) pageRules.push(`--template-page-right:${right}pt`);
    if (bottom !== null) pageRules.push(`--template-page-bottom:${bottom}pt`);
    if (left !== null) pageRules.push(`--template-page-left:${left}pt`);
    addRule(lines, "docx-page", pageRules);

    report.docx.paragraphs.forEach((paragraph, paragraphIndex) => {
      addRule(lines, `docx-p-${paragraphIndex}`, paragraphRules(paragraph.paragraphStyle));
      paragraph.runs.forEach((run, runIndex) => {
        addRule(lines, `docx-p-${paragraphIndex}-r-${runIndex}`, textRules(run));
      });
      paragraph.images.forEach((image, imageIndex) => {
        addRule(
          lines,
          `docx-p-${paragraphIndex}-i-${imageIndex}`,
          imageRules(image.widthPt, image.heightPt)
        );
      });
    });

    report.docx.tables.forEach((table, tableOrdinal) => {
      table.columnWidthsPt.forEach((width, columnIndex) => {
        const bounded = finite(width, 1, 5000);
        addRule(
          lines,
          `docx-t-${tableOrdinal}-col-${columnIndex}`,
          bounded === null ? [] : [`width:${bounded}pt`]
        );
      });
      table.cells.forEach((cell) => {
        addRule(
          lines,
          `docx-t-${tableOrdinal}-r-${cell.rowIndex}-c-${cell.columnIndex}`,
          cellRules(cell.style)
        );
      });
    });
  }

  if (report.xlsx) {
    report.xlsx.sheets.forEach((sheet, sheetIndex) => {
      sheet.columns.forEach((column) => {
        const width = finite(column.widthChars, 0, 255);
        const rules: string[] = [];
        if (width !== null) {
          const px = Math.max(48, Math.min(420, Math.round(width * 7 + 12)));
          rules.push(`width:${px}px`);
        }
        if (column.hidden) rules.push("visibility:collapse");
        addRule(lines, `xlsx-s-${sheetIndex}-col-${column.column}`, rules);
      });
      sheet.rows.forEach((row) => {
        const rules: string[] = [];
        const height = finite(row.heightPt, 8, 500);
        if (height !== null) rules.push(`height:${height}pt`);
        if (row.hidden) rules.push("display:none");
        addRule(lines, `xlsx-s-${sheetIndex}-row-${row.row}`, rules);
      });
      sheet.cells.forEach((cell) => {
        addRule(
          lines,
          `xlsx-s-${sheetIndex}-r-${cell.row}-c-${cell.column}`,
          xlsxCellRules(cell.style)
        );
      });
      sheet.images.forEach((image, imageIndex) => {
        addRule(
          lines,
          `xlsx-s-${sheetIndex}-i-${imageIndex}`,
          imageRules(image.widthPt, image.heightPt)
        );
      });
    });
  }

  const css = `${lines.join("\n")}\n`;
  if (/url\s*\(|@import|javascript\s*:/iu.test(css)) {
    throw new Error("Сформированная CSS-проекция содержит запрещённую конструкцию.");
  }
  return css;
}
