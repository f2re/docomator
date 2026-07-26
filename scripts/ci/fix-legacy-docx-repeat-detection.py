from pathlib import Path

path = Path(__file__).resolve().parents[2] / "packages/template-compiler/src/scalar-render.ts"
value = path.read_text(encoding="utf-8")
old = '''  const sourceRow = findDocxTableRowRange(
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
    const rowXml = decoded.text.slice(sourceRow.start, sourceRow.end);'''
new = '''  let sourceRow: ReturnType<typeof findDocxTableRowRange> | null = null;
  try {
    sourceRow = findDocxTableRowRange(
      decoded.text,
      input.binding.tableIndex,
      input.binding.rowIndex
    );
  } catch (error) {
    if (
      !(error instanceof TemplateCompilerError) ||
      (error.code !== "repeat_row_structure_mismatch" &&
        error.code !== "repeat_row_not_found")
    ) {
      throw error;
    }
  }
  const markerInsideRow =
    sourceRow !== null &&
    repeatOpen.start >= sourceRow.openEnd &&
    repeatClose.end <= sourceRow.closeStart;
  let template: string;
  let replacementStart: number;
  let replacementEnd: number;
  if (markerInsideRow && sourceRow !== null) {
    const rowXml = decoded.text.slice(sourceRow.start, sourceRow.end);'''
if value.count(old) != 1:
    raise RuntimeError(f"Ожидалось одно вхождение, найдено {value.count(old)}")
path.write_text(value.replace(old, new, 1), encoding="utf-8")
print("legacy DOCX repeat detection restored")
