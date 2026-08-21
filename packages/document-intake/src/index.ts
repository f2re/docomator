export {
  DEFAULT_INTAKE_LIMITS,
  DocumentIntakeError,
  inspectOoxmlBuffer
} from "./intake.js";

export type {
  DocumentFormat,
  DocumentIntakeReport,
  InspectOoxmlInput,
  IntakeDecision,
  IntakeIssue,
  IntakeIssueSeverity,
  IntakeLimits,
  IntakePart,
  IntakeSummary
} from "./intake.js";

export {
  DEFAULT_STRUCTURE_LIMITS,
  analyzeOoxmlBuffer
} from "./structure.js";

export type {
  AnalyzeOoxmlInput,
  DocumentStructureElement,
  DocumentStructureLimits,
  DocumentStructureReport,
  DocumentStructureSummary,
  DocxParagraphElement,
  DocxRunElement,
  DocxTableLocation,
  XlsxCellElement,
  XlsxCellValueKind
} from "./structure.js";

export { analyzeOoxmlVisualLayout } from "./visual-layout-projection.js";
export type {
  AnalyzeVisualOoxmlInput,
  DocumentVisualLayoutReport,
  VisualBorderSide,
  VisualCellStyle,
  VisualDocxLayout,
  VisualDocxParagraph,
  VisualDocxTable,
  VisualEmbeddedImage,
  VisualParagraphStyle,
  VisualTextStyle,
  VisualXlsxCellStyle,
  VisualXlsxLayout,
  VisualXlsxSheet
} from "./visual-layout.js";
