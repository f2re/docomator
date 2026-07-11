export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

function normalizeJsonValue(value: unknown, seen: Set<object>): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("JSON numbers must be finite");
    }
    return value;
  }

  if (Array.isArray(value)) {
    if (seen.has(value)) {
      throw new TypeError("Cyclic JSON arrays are not supported");
    }
    seen.add(value);
    const normalized = value.map((item) => normalizeJsonValue(item, seen));
    seen.delete(value);
    return normalized;
  }

  if (typeof value === "object") {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError("Only plain objects are accepted as JSON values");
    }
    if (seen.has(value)) {
      throw new TypeError("Cyclic JSON objects are not supported");
    }

    seen.add(value);
    const normalized: { [key: string]: JsonValue } = {};
    const record = value as Record<string, unknown>;
    for (const key of Object.keys(record).sort()) {
      const item = record[key];
      if (item === undefined) {
        throw new TypeError(`Undefined JSON property is not supported: ${key}`);
      }
      normalized[key] = normalizeJsonValue(item, seen);
    }
    seen.delete(value);
    return normalized;
  }

  throw new TypeError(`Unsupported JSON value type: ${typeof value}`);
}

export function toJsonValue(value: unknown): JsonValue {
  return normalizeJsonValue(value, new Set<object>());
}

export function stringifyJson(value: unknown): string {
  return JSON.stringify(toJsonValue(value));
}

export function parseJson(serialized: string): JsonValue {
  return toJsonValue(JSON.parse(serialized) as unknown);
}
