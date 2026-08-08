import type { FastifyInstance, FastifyRequest } from "fastify";

import type { SqliteStore } from "@docomator/storage";

import { correlationId } from "./request-context.js";

interface ExportParams {
  spaceId: string;
}

interface ExportQuery {
  entityTypeKey: string;
}

interface PropertyRow {
  id: string;
  key: string;
  label: string;
  unit: string | null;
  valueType: string;
  appliesToJson: string;
}

interface EntityRow {
  id: string;
  displayName: string;
  status: string;
}

interface ValueRow {
  entityId: string;
  propertyDefinitionId: string;
  valueJson: string;
  version: number;
}

const identifierSchema = {
  type: "string",
  minLength: 1,
  maxLength: 160
} as const;

const stableKeySchema = {
  type: "string",
  minLength: 1,
  maxLength: 160,
  pattern: "^[A-Za-z][A-Za-z0-9]*(?:[._-][A-Za-z0-9]+)*$"
} as const;

function safeAppliesTo(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

function humanStatus(status: string): string {
  return (
    {
      active: "Активен",
      inactive: "Неактивен",
      archived: "Архив"
    } as Record<string, string>
  )[status] ?? status;
}

function displayValue(valueJson: string): string {
  let value: unknown;
  try {
    value = JSON.parse(valueJson);
  } catch {
    return "";
  }
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "Да" : "Нет";
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) {
    return value
      .map((item) =>
        item === null || item === undefined
          ? ""
          : typeof item === "object"
            ? JSON.stringify(item)
            : String(item)
      )
      .join("; ");
  }
  return JSON.stringify(value);
}

function neutralizeSpreadsheetFormula(value: string): string {
  const trimmed = value.trimStart();
  if (/^[=+\-@\t\r]/u.test(trimmed)) return `'${value}`;
  return value;
}

function csvCell(value: string): string {
  const safe = neutralizeSpreadsheetFormula(value);
  return `"${safe.replace(/"/gu, '""')}"`;
}

function uniqueHeaders(properties: readonly PropertyRow[]): Map<string, string> {
  const result = new Map<string, string>();
  const counts = new Map<string, number>();
  for (const property of properties) {
    const base = property.unit ? `${property.label}, ${property.unit}` : property.label;
    const count = (counts.get(base) ?? 0) + 1;
    counts.set(base, count);
    result.set(property.id, count === 1 ? base : `${base} (${count})`);
  }
  return result;
}

function exportFileName(spaceKey: string, entityTypeKey: string): string {
  const date = new Date().toISOString().slice(0, 10);
  const safeSpace = spaceKey.replace(/[^A-Za-z0-9._-]+/gu, "-").slice(0, 80) || "space";
  const safeType = entityTypeKey.replace(/[^A-Za-z0-9._-]+/gu, "-").slice(0, 80) || "objects";
  return `docomator-${safeSpace}-${safeType}-${date}.csv`;
}

function exportError(
  request: FastifyRequest,
  statusCode: number,
  code: string,
  message: string
) {
  return {
    statusCode,
    body: {
      error: { code, message },
      correlationId: correlationId(request)
    }
  };
}

export function registerDataExportRoutes(
  app: FastifyInstance,
  store: SqliteStore
): void {
  app.get<{ Params: ExportParams; Querystring: ExportQuery }>(
    "/api/v1/spaces/:spaceId/data-export.csv",
    {
      schema: {
        params: {
          type: "object",
          additionalProperties: false,
          required: ["spaceId"],
          properties: { spaceId: identifierSchema }
        },
        querystring: {
          type: "object",
          additionalProperties: false,
          required: ["entityTypeKey"],
          properties: { entityTypeKey: stableKeySchema }
        }
      }
    },
    async (request, reply) => {
      const result = store.execute((database) => {
        const space = database
          .prepare("SELECT id, key, name FROM spaces WHERE id = ?")
          .get(request.params.spaceId) as
          | { id: string; key: string; name: string }
          | undefined;
        if (space === undefined) {
          return { kind: "space_missing" as const };
        }
        const entityType = database
          .prepare("SELECT id, key, label FROM entity_types WHERE key = ?")
          .get(request.query.entityTypeKey) as
          | { id: string; key: string; label: string }
          | undefined;
        if (entityType === undefined) {
          return { kind: "type_missing" as const };
        }

        const properties = database
          .prepare(`
            SELECT
              p.id,
              p.key,
              p.label,
              p.unit,
              p.value_type AS valueType,
              p.applies_to_json AS appliesToJson
            FROM property_definitions p
            JOIN space_property_definitions spd
              ON spd.property_definition_id = p.id
            WHERE spd.space_id = ?
            ORDER BY p.label COLLATE NOCASE, p.key
          `)
          .all(space.id) as unknown as PropertyRow[];
        const applicable = properties.filter((property) => {
          const appliesTo = safeAppliesTo(property.appliesToJson);
          return appliesTo.length === 0 || appliesTo.includes(entityType.key);
        });

        const entities = database
          .prepare(`
            SELECT e.id, e.display_name AS displayName, e.status
            FROM entities e
            JOIN entity_types et ON et.id = e.entity_type_id
            JOIN space_entity_ownership seo ON seo.entity_id = e.id
            WHERE seo.space_id = ? AND et.key = ?
            ORDER BY e.display_name COLLATE NOCASE, e.id
          `)
          .all(space.id, entityType.key) as unknown as EntityRow[];

        const values = database
          .prepare(`
            SELECT
              epv.entity_id AS entityId,
              epv.property_definition_id AS propertyDefinitionId,
              epv.value_json AS valueJson,
              epv.version
            FROM entity_property_values epv
            JOIN entities e ON e.id = epv.entity_id
            JOIN entity_types et ON et.id = e.entity_type_id
            JOIN space_entity_ownership seo ON seo.entity_id = e.id
            JOIN space_property_definitions spd
              ON spd.space_id = seo.space_id
             AND spd.property_definition_id = epv.property_definition_id
            WHERE seo.space_id = ? AND et.key = ?
            ORDER BY epv.entity_id, epv.property_definition_id, epv.version DESC
          `)
          .all(space.id, entityType.key) as unknown as ValueRow[];

        return {
          kind: "ok" as const,
          space,
          entityType,
          properties: applicable,
          entities,
          values
        };
      });

      if (result.kind === "space_missing") {
        const error = exportError(
          request,
          404,
          "space_not_found",
          "Пространство не найдено. Обновите список и повторите экспорт."
        );
        return reply.code(error.statusCode).send(error.body);
      }
      if (result.kind === "type_missing") {
        const error = exportError(
          request,
          404,
          "entity_type_not_found",
          "Тип объектов не найден. Обновите список и повторите экспорт."
        );
        return reply.code(error.statusCode).send(error.body);
      }

      const latest = new Map<string, string>();
      for (const value of result.values) {
        const key = `${value.entityId}\u0000${value.propertyDefinitionId}`;
        if (!latest.has(key)) latest.set(key, value.valueJson);
      }
      const headers = uniqueHeaders(result.properties);
      const lines = [
        ["Название", "Статус", ...result.properties.map((property) => headers.get(property.id) ?? property.label)]
          .map(csvCell)
          .join(";")
      ];
      for (const entity of result.entities) {
        const row = [entity.displayName, humanStatus(entity.status)];
        for (const property of result.properties) {
          row.push(
            displayValue(
              latest.get(`${entity.id}\u0000${property.id}`) ?? "null"
            )
          );
        }
        lines.push(row.map(csvCell).join(";"));
      }
      const body = `\uFEFF${lines.join("\r\n")}\r\n`;
      const fileName = exportFileName(result.space.key, result.entityType.key);
      return reply
        .header("cache-control", "no-store")
        .header("x-content-type-options", "nosniff")
        .header("content-disposition", `attachment; filename="${fileName}"`)
        .header("x-docomator-export-count", String(result.entities.length))
        .type("text/csv; charset=utf-8")
        .send(body);
    }
  );
}
