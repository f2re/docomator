export {
  TemplateCompilerError,
  compileScalarField
} from "./compiler.js";

export type {
  CompileScalarFieldDefinition,
  CompileScalarFieldInput,
  CompileScalarFieldResult,
  CompiledTechnicalBinding,
  DocxParagraphBinding,
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

export { renderAudienceAggregate } from "./audience-render.js";
export type {
  AudienceAggregateField,
  AudienceAggregateMember,
  RenderAudienceAggregateInput
} from "./audience-render.js";

export {
  readScalarValue,
  renderScalarValue
} from "./scalar-render.js";

export {
  defaultScalarFormatter,
  formatScalarDisplay,
  parseScalarFormatter
} from "./scalar-formatter.js";
export type { ScalarFormatter } from "./scalar-formatter.js";

export type {
  ReadScalarValueInput,
  ReadScalarValueResult,
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
