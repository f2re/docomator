import { parseJson, stringifyJson, toJsonValue, type JsonValue } from "./json.js";

export const PROPERTY_VALUE_TYPES = [
  "string",
  "text",
  "number",
  "integer",
  "boolean",
  "date",
  "date-time",
  "enum",
  "entity-reference",
  "list",
  "json",
  "file",
  "image"
] as const;

export type PropertyValueType = (typeof PROPERTY_VALUE_TYPES)[number];

export interface PropertyCodecOptions {
  allowedValues?: readonly string[];
}

export interface EncodedPropertyValue {
  valueType: PropertyValueType;
  valueJson: string;
  valueText: string | null;
  valueNumber: number | null;
  valueInteger: number | null;
  valueBoolean: number | null;
  valueDate: string | null;
  valueDatetime: string | null;
  valueEntityId: string | null;
  valueFileId: string | null;
}

export class PropertyValueValidationError extends TypeError {
  override name = "PropertyValueValidationError";
}

function invalid(message: string): never {
  throw new PropertyValueValidationError(message);
}

function normalizeJson(value: unknown): JsonValue {
  try {
    return toJsonValue(value);
  } catch (error) {
    if (error instanceof TypeError) {
      invalid(error.message);
    }
    throw error;
  }
}

function requireString(value: unknown, type: PropertyValueType): string {
  if (typeof value !== "string") {
    invalid(`${type} value must be a string`);
  }
  return value;
}

function requireIdentifier(value: unknown, type: PropertyValueType): string {
  const identifier = requireString(value, type).trim();
  if (identifier.length === 0) {
    invalid(`${type} value must not be empty`);
  }
  return identifier;
}

function normalizeDate(value: unknown): string {
  const text = requireString(value, "date");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    invalid("date value must use YYYY-MM-DD");
  }
  const parsed = new Date(`${text}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== text) {
    invalid("date value is not a valid calendar date");
  }
  return text;
}

function normalizeDateTime(value: unknown): string {
  const text = requireString(value, "date-time");
  if (!/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(text)) {
    invalid("date-time value must include an explicit timezone");
  }
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) {
    invalid("date-time value is invalid");
  }
  return parsed.toISOString();
}

function emptyEncoded(valueType: PropertyValueType, normalized: JsonValue): EncodedPropertyValue {
  return {
    valueType,
    valueJson: stringifyJson(normalized),
    valueText: null,
    valueNumber: null,
    valueInteger: null,
    valueBoolean: null,
    valueDate: null,
    valueDatetime: null,
    valueEntityId: null,
    valueFileId: null
  };
}

export class PropertyValueCodecRegistry {
  encode(
    valueType: PropertyValueType,
    value: unknown,
    options: PropertyCodecOptions = {}
  ): EncodedPropertyValue {
    switch (valueType) {
      case "string":
      case "text": {
        const normalized = requireString(value, valueType);
        return { ...emptyEncoded(valueType, normalized), valueText: normalized };
      }
      case "number": {
        if (typeof value !== "number" || !Number.isFinite(value)) {
          invalid("number value must be finite");
        }
        return { ...emptyEncoded(valueType, value), valueNumber: value };
      }
      case "integer": {
        if (typeof value !== "number" || !Number.isSafeInteger(value)) {
          invalid("integer value must be a safe integer");
        }
        return { ...emptyEncoded(valueType, value), valueInteger: value };
      }
      case "boolean": {
        if (typeof value !== "boolean") {
          invalid("boolean value must be true or false");
        }
        return { ...emptyEncoded(valueType, value), valueBoolean: value ? 1 : 0 };
      }
      case "date": {
        const normalized = normalizeDate(value);
        return { ...emptyEncoded(valueType, normalized), valueDate: normalized };
      }
      case "date-time": {
        const normalized = normalizeDateTime(value);
        return { ...emptyEncoded(valueType, normalized), valueDatetime: normalized };
      }
      case "enum": {
        const normalized = requireString(value, valueType);
        if (
          options.allowedValues !== undefined &&
          !options.allowedValues.includes(normalized)
        ) {
          invalid(`enum value is not allowed: ${normalized}`);
        }
        return { ...emptyEncoded(valueType, normalized), valueText: normalized };
      }
      case "entity-reference": {
        const normalized = requireIdentifier(value, valueType);
        return { ...emptyEncoded(valueType, normalized), valueEntityId: normalized };
      }
      case "file":
      case "image": {
        const normalized = requireIdentifier(value, valueType);
        return { ...emptyEncoded(valueType, normalized), valueFileId: normalized };
      }
      case "list": {
        if (!Array.isArray(value)) {
          invalid("list value must be an array");
        }
        return emptyEncoded(valueType, normalizeJson(value));
      }
      case "json":
        return emptyEncoded(valueType, normalizeJson(value));
    }
  }

  decode(
    valueType: PropertyValueType,
    valueJson: string,
    options: PropertyCodecOptions = {}
  ): JsonValue {
    const parsed = parseJson(valueJson);
    return parseJson(this.encode(valueType, parsed, options).valueJson);
  }
}
