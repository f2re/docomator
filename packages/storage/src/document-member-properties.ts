import type { SqliteExecutor } from "./database.js";
import { parseJson, type JsonValue } from "./json.js";

interface PropertyRow {
  entity_id: string;
  property_key: string;
  alias_key: string | null;
  value_json: string;
}

/**
 * Load the latest property values for document preflight/rendering.
 *
 * Physical property keys remain canonical. Migration 0030 may additionally
 * expose a historical key as a space-local alias so immutable activated
 * template fields keep resolving after a legacy shared definition is split.
 */
export function loadDocumentMemberProperties(
  connection: SqliteExecutor,
  spaceId: string,
  entityIds: readonly string[]
): Map<string, Record<string, JsonValue>> {
  const propertiesByEntity = new Map<string, Record<string, JsonValue>>();
  for (let offset = 0; offset < entityIds.length; offset += 200) {
    const chunk = entityIds.slice(offset, offset + 200);
    if (chunk.length === 0) continue;
    const placeholders = chunk.map(() => "?").join(", ");
    const rows = connection
      .prepare(`
        SELECT
          value.entity_id,
          definition.key AS property_key,
          alias.alias_key,
          value.value_json
        FROM entity_property_values value
        JOIN property_definitions definition
          ON definition.id = value.property_definition_id
        JOIN (
          SELECT entity_id, property_definition_id, MAX(version) AS max_version
          FROM entity_property_values
          WHERE entity_id IN (${placeholders})
          GROUP BY entity_id, property_definition_id
        ) latest
          ON latest.entity_id = value.entity_id
         AND latest.property_definition_id = value.property_definition_id
         AND latest.max_version = value.version
        LEFT JOIN space_property_definition_aliases alias
          ON alias.space_id = ?
         AND alias.property_definition_id = value.property_definition_id
        ORDER BY value.entity_id, definition.key, alias.alias_key
      `)
      .all(...chunk, spaceId) as unknown as PropertyRow[];

    for (const row of rows) {
      const values = propertiesByEntity.get(row.entity_id) ?? {};
      const value = parseJson(row.value_json);
      values[row.property_key] = value;
      if (row.alias_key !== null) values[row.alias_key] = value;
      propertiesByEntity.set(row.entity_id, values);
    }
  }
  return propertiesByEntity;
}
