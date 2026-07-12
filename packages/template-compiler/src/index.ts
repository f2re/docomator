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
  ScalarFieldBinding,
  XlsxCellBinding
} from "./compiler.js";

export {
  readScalarValue,
  renderScalarValue
} from "./scalar-render.js";

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
