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

export { analyzeOoxmlBuffer } from "./document-ir.js";

export type {
  AnalyzeOoxmlInput,
  DocumentAnalysisResult,
  DocumentStructure,
  DocumentStructureTotals,
  DocxDocumentStructure,
  DocxParagraphElement,
  DocxPartKind,
  DocxPartStructure,
  DocxRunElement,
  DocxTableLocation,
  XlsxCellElement,
  XlsxCellValueKind,
  XlsxDocumentStructure,
  XlsxSheetStructure
} from "./document-ir.js";
