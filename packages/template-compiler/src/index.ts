export {
  compileDocxRepeatRow,
  parseDocxRepeatRowBinding,
  parseDocxRepeatRowContract,
  TemplateCompilerError,
  compileScalarField
} from "./compiler.js";

export type {
  CompileScalarFieldDefinition,
  CompileScalarFieldInput,
  CompileScalarFieldResult,
  CompileDocxRepeatRowInput,
  CompileDocxRepeatRowResult,
  CompiledRepeatTechnicalBinding,
  CompiledTechnicalBinding,
  DocxParagraphBinding,
  DocxRepeatRowBinding,
  DocxRepeatRowContract,
  DocxTextRangeBinding,
  ScalarFieldBinding,
  XlsxCellBinding
} from "./compiler.js";

export {
  compileScalarFields,
  renderScalarValues
} from "./multi-field.js";

export type {
  CompileScalarFieldsInput,
  CompileScalarFieldsResult,
  CompiledScalarFieldResult,
  RenderScalarFieldValue,
  RenderScalarValuesInput,
  RenderScalarValuesResult,
  RenderedScalarFieldValue
} from "./multi-field.js";

export {
  compileEntityCollectionDocx,
  renderEntityCollectionDocxTrial
} from "./entity-collection-repeat.js";
export type {
  CompileEntityCollectionDocxInput,
  CompileEntityCollectionDocxResult,
  EntityCollectionDocxRepeatSource,
  RenderEntityCollectionDocxTrialInput,
  RenderEntityCollectionDocxTrialResult,
  RenderEntityCollectionTrialField
} from "./entity-collection-repeat.js";

export { renderAudienceAggregate } from "./audience-render.js";
export type {
  AudienceAggregateField,
  AudienceAggregateMember,
  RenderAudienceAggregateInput
} from "./audience-render.js";

export {
  readScalarValue,
  renderDocxRepeatRows,
  renderScalarValue
} from "./scalar-render.js";

export {
  compileXlsxRepeatRow,
  parseXlsxRepeatRowBinding,
  parseXlsxRepeatRowContract,
  renderXlsxRepeatRows
} from "./xlsx-repeat.js";

export type {
  CompileXlsxRepeatField,
  CompileXlsxRepeatRowInput,
  CompileXlsxRepeatRowResult,
  RenderXlsxRepeatField,
  RenderXlsxRepeatMember,
  RenderXlsxRepeatRowsInput,
  RenderXlsxRepeatRowsResult,
  XlsxRepeatRowBinding,
  XlsxRepeatRowContract,
  XlsxRepeatTechnicalBinding
} from "./xlsx-repeat.js";

export type {
  DocumentFormattingAnalysis,
  DocumentFormattingFinding,
  DocumentFormattingProfile,
  DocumentFormattingResult,
  DocumentFormattingSettings
} from "./gost-formatting.js";
export {
  DocumentFormattingError,
  analyzeDocumentFormatting,
  documentFormattingProfile,
  documentFormattingProfileLabel,
  formatDocumentToProfile,
  normalizeDocumentFormattingSettings
} from "./gost-formatting.js";

export {
  defaultScalarFormatter,
  formatScalarDisplay,
  parseScalarFormatter
} from "./scalar-formatter.js";
export type { ScalarFormatter } from "./scalar-formatter.js";

export type {
  ReadScalarValueInput,
  ReadScalarValueResult,
  RenderDocxRepeatField,
  RenderDocxRepeatMember,
  RenderDocxRepeatRowsInput,
  RenderDocxRepeatRowsResult,
  RenderScalarValueInput,
  RenderScalarValueResult,
  ScalarValueType
} from "./scalar-render.js";

export {
  DEFAULT_OOXML_PACKAGE_LIMITS,
  OoxmlPackageError,
  crc32,
  packageEntry,
  readOoxmlPackage,
  writeOoxmlPackage
} from "./ooxml-package.js";

export type {
  OoxmlPackageEntry,
  OoxmlPackageLimits
} from "./ooxml-package.js";

export {
  XLSX_METADATA_PART,
  XLSX_METADATA_SHEET_NAME,
  XLSX_METADATA_VERSION,
  verifyXlsxMetadata
} from "./xlsx-metadata.js";
export type {
  VerifyXlsxMetadataOptions,
  XlsxMetadataRecord
} from "./xlsx-metadata.js";
