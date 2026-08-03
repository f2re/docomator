import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { FastifyInstance, FastifyRequest } from "fastify";

import {
  PUBLICATION_AUTHOR_ROLES,
  PUBLICATION_CLASSIFICATION_CODES,
  PUBLICATION_CLASSIFICATION_STATES,
  PublicationConflictError,
  PublicationRegistry,
  PublicationValidationError,
  type PublicationClassificationCode,
  type PublicationReportCriteriaInput
} from "@docomator/storage";

import { correlationId, mutationContextFromRequest } from "./request-context.js";

interface SpaceParams {
  spaceId: string;
}

interface PublicationParams extends SpaceParams {
  publicationId: string;
}

interface ClassificationParams extends PublicationParams {
  code: string;
}

interface SnapshotParams extends SpaceParams {
  snapshotId: string;
}

interface ConfigurationBody {
  publicationEntityTypeKey: string;
  teacherEntityTypeKey: string;
  publicationYearPropertyKey?: string | null;
  publicationDatePropertyKey?: string | null;
  teacherDepartmentPropertyKey?: string | null;
  doiPropertyKey?: string | null;
  journalPropertyKey?: string | null;
  bibliographyPropertyKey?: string | null;
  statusPropertyKey?: string | null;
}

interface AuthorsBody {
  authors: Array<{
    authorEntityId: string;
    role?: "author" | "corresponding_author" | "editor" | "translator";
    position?: number;
  }>;
}

interface ClassificationBody {
  state: "confirmed" | "review" | "excluded";
  source?: string | null;
  checkedAt?: string | null;
  note?: string | null;
}

interface ReportQuery {
  year?: number;
  dateFrom?: string;
  dateTo?: string;
  classifications?: string;
  classificationMatch?: "any" | "all";
  includeReview?: boolean;
  teacherEntityId?: string;
  department?: string;
  status?: string;
  includeInactive?: boolean;
  limit?: number;
}

interface ReportBody {
  criteria?: ReportQuery;
}

interface SnapshotListQuery {
  limit?: number;
}

const identifierSchema = {
  type: "string",
  minLength: 1,
  maxLength: 160
} as const;

const nullableStableKeySchema = {
  anyOf: [
    {
      type: "string",
      minLength: 1,
      maxLength: 160,
      pattern: "^[A-Za-z][A-Za-z0-9]*(?:[._-][A-Za-z0-9]+)*$"
    },
    { type: "null" }
  ]
} as const;

const reportProperties = {
  year: { type: "integer", minimum: 1900, maximum: 3000 },
  dateFrom: { type: "string", minLength: 1, maxLength: 64 },
  dateTo: { type: "string", minLength: 1, maxLength: 64 },
  classifications: { type: "string", maxLength: 200 },
  classificationMatch: { type: "string", enum: ["any", "all"] },
  includeReview: { type: "boolean" },
  teacherEntityId: identifierSchema,
  department: { type: "string", minLength: 1, maxLength: 500 },
  status: { type: "string", minLength: 1, maxLength: 500 },
  includeInactive: { type: "boolean" },
  limit: { type: "integer", minimum: 1, maximum: 1_000 }
} as const;

function responseEnvelope<T>(request: FastifyRequest, data: T) {
  return { data, correlationId: correlationId(request) };
}

function requireSchema(registry: PublicationRegistry): void {
  if (!registry.schemaReady()) {
    throw new PublicationConflictError(
      "Миграция учёта публикаций не применена. Запустите штатное обновление базы данных."
    );
  }
}

function reportCriteria(query: ReportQuery | undefined): PublicationReportCriteriaInput {
  const source = query ?? {};
  const classificationValues = (source.classifications ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => {
      if (
        !PUBLICATION_CLASSIFICATION_CODES.includes(
          value as PublicationClassificationCode
        )
      ) {
        throw new PublicationValidationError(
          `Неизвестная классификация в условии отчёта: ${value}.`
        );
      }
      return value as PublicationClassificationCode;
    });
  return {
    year: source.year ?? null,
    dateFrom: source.dateFrom ?? null,
    dateTo: source.dateTo ?? null,
    classifications: classificationValues,
    classificationMatch: source.classificationMatch ?? "any",
    includeReview: source.includeReview ?? false,
    teacherEntityId: source.teacherEntityId ?? null,
    department: source.department ?? null,
    status: source.status ?? null,
    includeInactive: source.includeInactive ?? false,
    ...(source.limit === undefined ? {} : { limit: source.limit })
  };
}

function csvCell(value: unknown): string {
  const text = String(value ?? "").replaceAll("\r\n", "\n").replaceAll("\r", "\n");
  return `"${text.replaceAll('"', '""')}"`;
}

function reportCsv(
  report: Pick<ReturnType<PublicationRegistry["buildReport"]>, "rows">
): string {
  const headings = [
    "№",
    "Год",
    "Дата",
    "Название",
    "Авторы",
    "Кафедры",
    "Журнал или сборник",
    "DOI",
    "Классификации",
    "Статус"
  ];
  const rows = report.rows.map((row, index) => [
    index + 1,
    row.year ?? "",
    row.publicationDate ?? "",
    row.title,
    row.authors.map((author) => author.displayName).join("; "),
    row.departments.join("; "),
    row.journal ?? "",
    row.doi ?? "",
    row.classifications
      .filter((classification) => classification.state !== "excluded")
      .map((classification) =>
        classification.state === "review"
          ? `${classification.label} (требует проверки)`
          : classification.label
      )
      .join(", "),
    row.publicationStatus ?? ""
  ]);
  return `\uFEFF${[headings, ...rows]
    .map((row) => row.map(csvCell).join(";"))
    .join("\r\n")}\r\n`;
}

const publicationUiDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../ui"
);

function installPublicationUiBundle(app: FastifyInstance): void {
  app.addHook("onSend", async (request, reply, payload) => {
    const extraFile =
      request.url === "/ui/app.js"
        ? "publication-workspace.js"
        : request.url === "/ui/styles.css"
          ? "publication-workspace.css"
          : null;
    if (extraFile === null) return payload;
    if (!(typeof payload === "string" || Buffer.isBuffer(payload))) return payload;
    const extra = await fs.readFile(path.join(publicationUiDirectory, extraFile));
    reply.removeHeader("content-length");
    const base = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
    return Buffer.concat([base, Buffer.from("\n\n"), extra]);
  });
}

function publicationParamsSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["spaceId", "publicationId"],
    properties: {
      spaceId: identifierSchema,
      publicationId: identifierSchema
    }
  } as const;
}

export function registerPublicationRoutes(
  app: FastifyInstance,
  registry: PublicationRegistry
): void {
  installPublicationUiBundle(app);
  app.get<{ Params: SpaceParams }>(
    "/api/v1/spaces/:spaceId/publications/config",
    {
      schema: {
        params: {
          type: "object",
          additionalProperties: false,
          required: ["spaceId"],
          properties: { spaceId: identifierSchema }
        }
      }
    },
    async (request, reply) => {
      requireSchema(registry);
      reply.header("cache-control", "no-store");
      return responseEnvelope(
        request,
        registry.getConfiguration(request.params.spaceId)
      );
    }
  );

  app.put<{ Params: SpaceParams; Body: ConfigurationBody }>(
    "/api/v1/spaces/:spaceId/publications/config",
    {
      schema: {
        params: {
          type: "object",
          additionalProperties: false,
          required: ["spaceId"],
          properties: { spaceId: identifierSchema }
        },
        body: {
          type: "object",
          additionalProperties: false,
          required: ["publicationEntityTypeKey", "teacherEntityTypeKey"],
          properties: {
            publicationEntityTypeKey: identifierSchema,
            teacherEntityTypeKey: identifierSchema,
            publicationYearPropertyKey: nullableStableKeySchema,
            publicationDatePropertyKey: nullableStableKeySchema,
            teacherDepartmentPropertyKey: nullableStableKeySchema,
            doiPropertyKey: nullableStableKeySchema,
            journalPropertyKey: nullableStableKeySchema,
            bibliographyPropertyKey: nullableStableKeySchema,
            statusPropertyKey: nullableStableKeySchema
          }
        }
      }
    },
    async (request) => {
      requireSchema(registry);
      return responseEnvelope(
        request,
        registry.configure(
          request.params.spaceId,
          request.body,
          mutationContextFromRequest(request)
        )
      );
    }
  );

  app.post<{ Params: SpaceParams }>(
    "/api/v1/spaces/:spaceId/publications/bootstrap",
    {
      schema: {
        params: {
          type: "object",
          additionalProperties: false,
          required: ["spaceId"],
          properties: { spaceId: identifierSchema }
        }
      }
    },
    async (request, reply) => {
      requireSchema(registry);
      const existed = registry.getConfiguration(request.params.spaceId) !== null;
      const configuration = registry.ensureDefaultConfiguration(
        request.params.spaceId,
        mutationContextFromRequest(request)
      );
      reply.code(existed ? 200 : 201);
      return responseEnvelope(request, configuration);
    }
  );

  app.get<{ Params: PublicationParams }>(
    "/api/v1/spaces/:spaceId/publications/:publicationId/authors",
    { schema: { params: publicationParamsSchema() } },
    async (request, reply) => {
      requireSchema(registry);
      reply.header("cache-control", "no-store");
      return responseEnvelope(
        request,
        registry.listAuthors(
          request.params.spaceId,
          request.params.publicationId
        )
      );
    }
  );

  app.put<{ Params: PublicationParams; Body: AuthorsBody }>(
    "/api/v1/spaces/:spaceId/publications/:publicationId/authors",
    {
      schema: {
        params: publicationParamsSchema(),
        body: {
          type: "object",
          additionalProperties: false,
          required: ["authors"],
          properties: {
            authors: {
              type: "array",
              maxItems: 200,
              uniqueItems: false,
              items: {
                type: "object",
                additionalProperties: false,
                required: ["authorEntityId"],
                properties: {
                  authorEntityId: identifierSchema,
                  role: {
                    type: "string",
                    enum: [...PUBLICATION_AUTHOR_ROLES]
                  },
                  position: {
                    type: "integer",
                    minimum: 0,
                    maximum: 10_000
                  }
                }
              }
            }
          }
        }
      }
    },
    async (request) => {
      requireSchema(registry);
      return responseEnvelope(
        request,
        registry.replaceAuthors(
          request.params.spaceId,
          request.params.publicationId,
          request.body.authors,
          mutationContextFromRequest(request)
        )
      );
    }
  );

  app.get<{ Params: PublicationParams }>(
    "/api/v1/spaces/:spaceId/publications/:publicationId/classifications",
    { schema: { params: publicationParamsSchema() } },
    async (request, reply) => {
      requireSchema(registry);
      reply.header("cache-control", "no-store");
      return responseEnvelope(
        request,
        registry.listClassifications(
          request.params.spaceId,
          request.params.publicationId
        )
      );
    }
  );

  app.put<{ Params: ClassificationParams; Body: ClassificationBody }>(
    "/api/v1/spaces/:spaceId/publications/:publicationId/classifications/:code",
    {
      schema: {
        params: {
          type: "object",
          additionalProperties: false,
          required: ["spaceId", "publicationId", "code"],
          properties: {
            spaceId: identifierSchema,
            publicationId: identifierSchema,
            code: {
              type: "string",
              enum: [...PUBLICATION_CLASSIFICATION_CODES]
            }
          }
        },
        body: {
          type: "object",
          additionalProperties: false,
          required: ["state"],
          properties: {
            state: {
              type: "string",
              enum: [...PUBLICATION_CLASSIFICATION_STATES]
            },
            source: {
              anyOf: [
                { type: "string", maxLength: 1_000 },
                { type: "null" }
              ]
            },
            checkedAt: {
              anyOf: [
                { type: "string", minLength: 1, maxLength: 64 },
                { type: "null" }
              ]
            },
            note: {
              anyOf: [
                { type: "string", maxLength: 4_000 },
                { type: "null" }
              ]
            }
          }
        }
      }
    },
    async (request) => {
      requireSchema(registry);
      return responseEnvelope(
        request,
        registry.setClassification(
          request.params.spaceId,
          request.params.publicationId,
          request.params.code,
          request.body,
          mutationContextFromRequest(request)
        )
      );
    }
  );

  app.delete<{ Params: ClassificationParams }>(
    "/api/v1/spaces/:spaceId/publications/:publicationId/classifications/:code",
    {
      schema: {
        params: {
          type: "object",
          additionalProperties: false,
          required: ["spaceId", "publicationId", "code"],
          properties: {
            spaceId: identifierSchema,
            publicationId: identifierSchema,
            code: {
              type: "string",
              enum: [...PUBLICATION_CLASSIFICATION_CODES]
            }
          }
        }
      }
    },
    async (request, reply) => {
      requireSchema(registry);
      registry.removeClassification(
        request.params.spaceId,
        request.params.publicationId,
        request.params.code,
        mutationContextFromRequest(request)
      );
      reply.code(204).send();
    }
  );

  app.get<{ Params: SpaceParams; Querystring: ReportQuery }>(
    "/api/v1/spaces/:spaceId/publications/reports/preview",
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
          properties: reportProperties
        }
      }
    },
    async (request, reply) => {
      requireSchema(registry);
      reply.header("cache-control", "no-store");
      return responseEnvelope(
        request,
        registry.buildReport(
          request.params.spaceId,
          reportCriteria(request.query)
        )
      );
    }
  );

  app.get<{ Params: SpaceParams; Querystring: ReportQuery }>(
    "/api/v1/spaces/:spaceId/publications/reports/export.csv",
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
          properties: reportProperties
        }
      }
    },
    async (request, reply) => {
      requireSchema(registry);
      const report = registry.buildReport(
        request.params.spaceId,
        reportCriteria({ ...request.query, limit: 1_000 })
      );
      if (report.totals.truncated) {
        throw new PublicationValidationError(
          "В выгрузке больше 1000 публикаций. Уточните условия отчёта."
        );
      }
      const suffix = report.criteria.year ?? new Date().getFullYear();
      return reply
        .type("text/csv; charset=utf-8")
        .header("cache-control", "no-store")
        .header(
          "content-disposition",
          `attachment; filename*=UTF-8''${encodeURIComponent(`публикации-${suffix}.csv`)}`
        )
        .send(reportCsv(report));
    }
  );

  app.post<{ Params: SpaceParams; Body: ReportBody }>(
    "/api/v1/spaces/:spaceId/publications/reports/snapshots",
    {
      schema: {
        params: {
          type: "object",
          additionalProperties: false,
          required: ["spaceId"],
          properties: { spaceId: identifierSchema }
        },
        body: {
          type: "object",
          additionalProperties: false,
          properties: {
            criteria: {
              type: "object",
              additionalProperties: false,
              properties: reportProperties
            }
          }
        }
      }
    },
    async (request, reply) => {
      requireSchema(registry);
      const snapshot = registry.createReportSnapshot(
        request.params.spaceId,
        reportCriteria(request.body.criteria),
        mutationContextFromRequest(request)
      );
      reply.code(201);
      return responseEnvelope(request, snapshot);
    }
  );

  app.get<{ Params: SpaceParams; Querystring: SnapshotListQuery }>(
    "/api/v1/spaces/:spaceId/publications/reports/snapshots",
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
          properties: {
            limit: { type: "integer", minimum: 1, maximum: 200 }
          }
        }
      }
    },
    async (request, reply) => {
      requireSchema(registry);
      reply.header("cache-control", "no-store");
      return responseEnvelope(
        request,
        registry.listReportSnapshots(
          request.params.spaceId,
          request.query.limit
        )
      );
    }
  );

  app.get<{ Params: SnapshotParams }>(
    "/api/v1/spaces/:spaceId/publications/reports/snapshots/:snapshotId",
    {
      schema: {
        params: {
          type: "object",
          additionalProperties: false,
          required: ["spaceId", "snapshotId"],
          properties: {
            spaceId: identifierSchema,
            snapshotId: identifierSchema
          }
        }
      }
    },
    async (request, reply) => {
      requireSchema(registry);
      reply.header("cache-control", "no-store");
      return responseEnvelope(
        request,
        registry.getReportSnapshot(
          request.params.spaceId,
          request.params.snapshotId
        )
      );
    }
  );

  app.get<{ Params: SnapshotParams }>(
    "/api/v1/spaces/:spaceId/publications/reports/snapshots/:snapshotId/export.csv",
    {
      schema: {
        params: {
          type: "object",
          additionalProperties: false,
          required: ["spaceId", "snapshotId"],
          properties: {
            spaceId: identifierSchema,
            snapshotId: identifierSchema
          }
        }
      }
    },
    async (request, reply) => {
      requireSchema(registry);
      const snapshot = registry.getReportSnapshot(
        request.params.spaceId,
        request.params.snapshotId
      );
      return reply
        .type("text/csv; charset=utf-8")
        .header("cache-control", "no-store")
        .header(
          "content-disposition",
          `attachment; filename*=UTF-8''${encodeURIComponent(`публикации-снимок-${snapshot.id.slice(0, 8)}.csv`)}`
        )
        .send(reportCsv(snapshot));
    }
  );

  app.post<{ Params: SnapshotParams }>(
    "/api/v1/spaces/:spaceId/publications/reports/snapshots/:snapshotId/audience-snapshot",
    {
      schema: {
        params: {
          type: "object",
          additionalProperties: false,
          required: ["spaceId", "snapshotId"],
          properties: {
            spaceId: identifierSchema,
            snapshotId: identifierSchema
          }
        }
      }
    },
    async (request, reply) => {
      requireSchema(registry);
      const result = registry.createAudienceSnapshotFromReportSnapshot(
        request.params.spaceId,
        request.params.snapshotId,
        mutationContextFromRequest(request)
      );
      reply.code(201);
      return responseEnvelope(request, result);
    }
  );

  app.post<{ Params: SpaceParams; Body: ReportBody }>(
    "/api/v1/spaces/:spaceId/publications/reports/audience-snapshot",
    {
      schema: {
        params: {
          type: "object",
          additionalProperties: false,
          required: ["spaceId"],
          properties: { spaceId: identifierSchema }
        },
        body: {
          type: "object",
          additionalProperties: false,
          properties: {
            criteria: {
              type: "object",
              additionalProperties: false,
              properties: reportProperties
            }
          }
        }
      }
    },
    async (request, reply) => {
      requireSchema(registry);
      const result = registry.createAudienceSnapshot(
        request.params.spaceId,
        reportCriteria(request.body.criteria),
        mutationContextFromRequest(request)
      );
      reply.code(201);
      return responseEnvelope(request, result);
    }
  );
}
