import type {
  DocumentGenerationField,
  DocumentGenerationMember
} from "./document-generation.js";

export interface DocumentValueContext {
  spaceName: string;
  spaceKey: string;
  audienceCount: number;
}

export interface ResolvedDocumentMemberValues {
  values: unknown[];
  missingRequired: DocumentGenerationField[];
  availableCount: number;
}

function propertyCandidates(fieldKey: string): string[] {
  const normalized = fieldKey.trim().toLowerCase();
  const result = [normalized];
  for (const prefix of ["subject.", "person.", "recipient.", "user."]) {
    if (normalized.startsWith(prefix) && normalized.length > prefix.length) {
      result.push(normalized.slice(prefix.length));
    }
  }
  return [...new Set(result)];
}

export function resolveDocumentValue(
  field: DocumentGenerationField,
  member: DocumentGenerationMember,
  context: DocumentValueContext
): unknown {
  const key = field.key.trim().toLowerCase();
  if (key === "space.name") return context.spaceName;
  if (key === "space.key") return context.spaceKey;
  if (key === "audience.count") return context.audienceCount;
  if (key === "subject.entity_id" || key === "entity_id") return member.entityId;
  if (key === "subject.entity_type" || key === "entity_type") {
    return member.entityTypeKey;
  }
  if (key === "subject.position" || key === "position") {
    return member.position + 1;
  }

  for (const candidate of propertyCandidates(key)) {
    if (Object.prototype.hasOwnProperty.call(member.properties, candidate)) {
      return member.properties[candidate];
    }
  }

  if (
    key === "subject.display_name" ||
    key === "display_name" ||
    key === "full_name" ||
    key === "fio" ||
    key.endsWith(".full_name") ||
    key.endsWith(".display_name")
  ) {
    return member.displayName;
  }
  return undefined;
}

export function documentValueMissing(value: unknown): boolean {
  return value === undefined || value === null || value === "";
}

export function normalizeResolvedDocumentValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => String(item ?? "")).join(", ");
  }
  if (value !== null && typeof value === "object") {
    return JSON.stringify(value) ?? "";
  }
  return value;
}

export function resolveDocumentMemberValues(
  fields: readonly DocumentGenerationField[],
  member: DocumentGenerationMember,
  context: DocumentValueContext
): ResolvedDocumentMemberValues {
  const values = fields.map((field) =>
    normalizeResolvedDocumentValue(resolveDocumentValue(field, member, context))
  );
  const missingRequired = fields.filter(
    (field, index) => field.required && documentValueMissing(values[index])
  );
  return {
    values,
    missingRequired,
    availableCount: values.filter((value) => !documentValueMissing(value)).length
  };
}
