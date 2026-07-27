from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def replace_once(relative: str, old: str, new: str) -> None:
    path = ROOT / relative
    value = path.read_text(encoding="utf-8")
    count = value.count(old)
    if count != 1:
        raise RuntimeError(f"{relative}: expected one occurrence, found {count}")
    path.write_text(value.replace(old, new, 1), encoding="utf-8")
    print(f"updated {relative}")


def insert_before(relative: str, marker: str, addition: str) -> None:
    path = ROOT / relative
    value = path.read_text(encoding="utf-8")
    if addition in value:
        return
    count = value.count(marker)
    if count != 1:
        raise RuntimeError(f"{relative}: expected one marker, found {count}")
    path.write_text(value.replace(marker, addition + marker, 1), encoding="utf-8")
    print(f"updated {relative}")


# Shared semantic field groups are stored in validation_json to avoid a schema migration.
replace_once(
    "packages/storage/src/knowledge.ts",
    'export type PropertySensitivity = "public" | "internal" | "personal" | "restricted";\n',
    '''export type PropertySensitivity = "public" | "internal" | "personal" | "restricted";
export const PROPERTY_UI_GROUPS = [
  "common",
  "teacher",
  "student",
  "unassigned"
] as const;
export type PropertyUiGroup = (typeof PROPERTY_UI_GROUPS)[number];
'''
)

insert_before(
    "packages/storage/src/knowledge.ts",
    "function propertyValueType(value: string): PropertyValueType {",
    '''export function normalizePropertyUiGroup(value: string): PropertyUiGroup {
  if (PROPERTY_UI_GROUPS.includes(value as PropertyUiGroup)) {
    return value as PropertyUiGroup;
  }
  throw new KnowledgeValidationError(`Unsupported property UI group: ${value}`);
}

export function propertyUiGroupFromValidation(value: JsonValue): PropertyUiGroup {
  if (value === null || Array.isArray(value) || typeof value !== "object") {
    return "unassigned";
  }
  const candidate = value["uiGroup"];
  return typeof candidate === "string" &&
    PROPERTY_UI_GROUPS.includes(candidate as PropertyUiGroup)
    ? (candidate as PropertyUiGroup)
    : "unassigned";
}

function validationWithPropertyUiGroup(
  validation: JsonValue,
  uiGroup: PropertyUiGroup
): JsonValue {
  if (validation === null || Array.isArray(validation) || typeof validation !== "object") {
    throw new KnowledgeValidationError("validation must be a JSON object");
  }
  return toJsonValue({ ...validation, uiGroup });
}

'''
)

insert_before(
    "packages/storage/src/knowledge.ts",
    '''  getPropertyDefinition(keyValue: string): PropertyDefinitionRecord {''',
    '''  updatePropertyDefinitionUiGroup(
    keyValue: string,
    uiGroupValue: string,
    contextInput: MutationContext
  ): PropertyDefinitionRecord {
    const key = stableKey(keyValue, "key");
    const uiGroup = normalizePropertyUiGroup(uiGroupValue);
    const context = mutationContext(contextInput);
    return this.store.transaction((connection) => {
      const current = propertyByKey(connection, key);
      if (current === undefined) {
        throw new KnowledgeNotFoundError(`Property definition was not found: ${key}`);
      }
      const validation = validationWithPropertyUiGroup(
        parseJson(current.validation_json),
        uiGroup
      );
      connection
        .prepare(`
          UPDATE property_definitions
          SET validation_json = ?, version = version + 1, updated_at = ?
          WHERE id = ?
        `)
        .run(stringifyJson(validation), context.now, current.id);
      this.outbox.append(
        {
          eventType: "property_definition.ui_group_changed",
          schemaVersion: 1,
          source: "knowledge-registry",
          occurredAt: context.now,
          payload: { id: current.id, key, uiGroup },
          dedupeKey: `property_definition.ui_group_changed:${current.id}:v${current.version + 1}`,
          now: context.now
        },
        connection
      );
      this.audit.record(
        {
          occurredAt: context.now,
          actorType: context.actorType,
          actorId: context.actorId,
          action: "change_ui_group",
          objectType: "property_definition",
          objectId: current.id,
          correlationId: context.correlationId,
          details: { key, uiGroup, version: current.version + 1 }
        },
        connection
      );
      const updated = propertyByKey(connection, key);
      if (updated === undefined) {
        throw new Error(`Updated property definition was not found: ${key}`);
      }
      return mapPropertyDefinition(updated);
    });
  }

'''
)

# HTTP route for explicit reclassification of legacy fields.
replace_once(
    "apps/api/src/knowledge-routes.ts",
    '''  PROPERTY_VALUE_TYPES,
  type EntityStatus,''',
    '''  PROPERTY_UI_GROUPS,
  PROPERTY_VALUE_TYPES,
  type EntityStatus,'''
)
insert_before(
    "apps/api/src/knowledge-routes.ts",
    "interface CreateEntityBody {",
    '''interface UpdatePropertyUiGroupBody {
  uiGroup: string;
}

'''
)
insert_before(
    "apps/api/src/knowledge-routes.ts",
    '''  app.post<{ Body: CreateEntityBody }>(''',
    '''  app.put<{ Params: KeyParams; Body: UpdatePropertyUiGroupBody }>(
    "/api/v1/knowledge/property-definitions/:key/group",
    {
      schema: {
        params: {
          type: "object",
          additionalProperties: false,
          required: ["key"],
          properties: { key: stableKeySchema }
        },
        body: {
          type: "object",
          additionalProperties: false,
          required: ["uiGroup"],
          properties: {
            uiGroup: { type: "string", enum: [...PROPERTY_UI_GROUPS] }
          }
        }
      }
    },
    async (request) =>
      responseEnvelope(
        request,
        registry.updatePropertyDefinitionUiGroup(
          request.params.key,
          request.body.uiGroup,
          mutationContextFromRequest(request)
        )
      )
  );

'''
)

# Employee creation keeps same-label fields separate when their semantic groups differ.
replace_once(
    "packages/storage/src/employees.ts",
    '''  generateOpaqueStableKey,
  KnowledgeConflictError,''',
    '''  generateOpaqueStableKey,
  KnowledgeConflictError,'''
)
replace_once(
    "packages/storage/src/employees.ts",
    '''  KnowledgeRegistry,
  KnowledgeValidationError,
  type MutationContext,
  type PropertyDefinitionRecord''',
    '''  KnowledgeRegistry,
  KnowledgeValidationError,
  normalizePropertyUiGroup,
  propertyUiGroupFromValidation,
  type MutationContext,
  type PropertyDefinitionRecord,
  type PropertyUiGroup'''
)
replace_once(
    "packages/storage/src/employees.ts",
    '''export interface NewEmployeeFieldDefinitionInput {
  label: string;
  valueType: string;
  unit?: string | null;
}''',
    '''export interface NewEmployeeFieldDefinitionInput {
  label: string;
  valueType: string;
  unit?: string | null;
  uiGroup?: string;
}'''
)
replace_once(
    "packages/storage/src/employees.ts",
    '''  applies_to_json: string;
}''',
    '''  applies_to_json: string;
  validation_json: string;
}'''
)
replace_once(
    "packages/storage/src/employees.ts",
    '''        unit: string | null;
      };
      value: JsonValue;''',
    '''        unit: string | null;
        uiGroup: PropertyUiGroup;
      };
      value: JsonValue;'''
)
# Both create and update normalization blocks use the same field definition shape.
old_definition = '''        label: requiredText(definition.label, `fields[${index}].definition.label`),
        valueType: valueType(definition.valueType),
        unit: optionalText(definition.unit, `fields[${index}].definition.unit`, 80)'''
new_definition = '''        label: requiredText(definition.label, `fields[${index}].definition.label`),
        valueType: valueType(definition.valueType),
        unit: optionalText(definition.unit, `fields[${index}].definition.unit`, 80),
        uiGroup: normalizePropertyUiGroup(definition.uiGroup ?? "unassigned")'''
path = ROOT / "packages/storage/src/employees.ts"
value = path.read_text(encoding="utf-8")
count = value.count(old_definition)
if count != 2:
    raise RuntimeError(f"packages/storage/src/employees.ts: expected two normalization blocks, found {count}")
path.write_text(value.replace(old_definition, new_definition), encoding="utf-8")
print("updated packages/storage/src/employees.ts normalization")

replace_once(
    "packages/storage/src/employees.ts",
    '''          SELECT key, label, value_type, applies_to_json
          FROM property_definitions''',
    '''          SELECT key, label, value_type, applies_to_json, validation_json
          FROM property_definitions'''
)
replace_once(
    "packages/storage/src/employees.ts",
    '''          appliesTo.includes(STANDARD_PERSON_TYPE_KEY) &&
          normalizedLabel(row.label) === targetLabel''',
    '''          appliesTo.includes(STANDARD_PERSON_TYPE_KEY) &&
          normalizedLabel(row.label) === targetLabel &&
          propertyUiGroupFromValidation(parseJson(row.validation_json)) === input.uiGroup'''
)
replace_once(
    "packages/storage/src/employees.ts",
    '''            sensitivity: "personal",
            appliesTo: [STANDARD_PERSON_TYPE_KEY]''',
    '''            sensitivity: "personal",
            appliesTo: [STANDARD_PERSON_TYPE_KEY],
            validation: { uiGroup: input.uiGroup }'''
)

# Employee API accepts the semantic group for newly created properties.
replace_once(
    "apps/api/src/employee-routes.ts",
    '''  PROPERTY_VALUE_TYPES,
  type EmployeeRegistry,''',
    '''  PROPERTY_UI_GROUPS,
  PROPERTY_VALUE_TYPES,
  type EmployeeRegistry,'''
)
replace_once(
    "apps/api/src/employee-routes.ts",
    '''  valueType: string;
  unit?: string;
}''',
    '''  valueType: string;
  unit?: string;
  uiGroup?: string;
}'''
)
replace_once(
    "apps/api/src/employee-routes.ts",
    '''    valueType: { type: "string", enum: [...PROPERTY_VALUE_TYPES] },
    unit: { type: "string", maxLength: 80 }''',
    '''    valueType: { type: "string", enum: [...PROPERTY_VALUE_TYPES] },
    unit: { type: "string", maxLength: 80 },
    uiGroup: { type: "string", enum: [...PROPERTY_UI_GROUPS] }'''
)

print("property field groups backend patches applied")
