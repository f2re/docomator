import type { JsonValue } from "./json.js";

export type RepeatContractFormat = "docx" | "xlsx";

function jsonObject(
  value: JsonValue | undefined
): value is { [key: string]: JsonValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function repeatContractFormat(value: JsonValue): RepeatContractFormat | null {
  if (!jsonObject(value) || !jsonObject(value.binding) || !jsonObject(value.technicalBinding)) {
    return null;
  }
  if (
    value.version === 1 &&
    value.kind === "docx.repeat-row-contract" &&
    value.binding.kind === "docx.repeat-row" &&
    value.technicalBinding.kind === "docx.repeat-sdt"
  ) {
    return "docx";
  }
  if (
    value.version === 1 &&
    value.kind === "xlsx.repeat-row-contract" &&
    value.binding.kind === "xlsx.repeat-row" &&
    value.technicalBinding.kind === "xlsx.repeat-defined-name"
  ) {
    return "xlsx";
  }
  return null;
}
