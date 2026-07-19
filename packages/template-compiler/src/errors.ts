export class TemplateCompilerError extends Error {
  override readonly name = "TemplateCompilerError";

  constructor(
    readonly code: string,
    readonly userMessage: string
  ) {
    super(userMessage);
  }
}
