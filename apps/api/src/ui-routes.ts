import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import { correlationId } from "./request-context.js";

interface UiAsset {
  readonly fileName: string;
  readonly contentType: string;
  readonly cacheControl: string;
  readonly appendFileNames?: readonly string[];
}

interface HelpDocumentSummary {
  id: string;
  path: string;
  title: string;
  category: string;
  sizeBytes: number;
}

interface HelpDocumentRecord extends HelpDocumentSummary {
  absolutePath: string;
}

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const defaultUiDirectory = path.resolve(moduleDirectory, "../ui");
const defaultDocsDirectory = path.resolve(moduleDirectory, "../../../docs");
const maximumHelpDocuments = 500;
const maximumHelpDocumentBytes = 2 * 1024 * 1024;

const assets: Readonly<Record<string, UiAsset>> = {
  "/": {
    fileName: "index.html",
    contentType: "text/html; charset=utf-8",
    cacheControl: "no-store"
  },
  "/ui/styles.css": {
    fileName: "styles.css",
    appendFileNames: [
      "searchable-select.css",
      "entity-workspace.css",
      "spaces.css",
      "workspace-switcher.css",
      "intake.css",
      "quarantine.css",
      "structure.css",
      "template-field.css",
      "template-repeat-assistant.css",
      "template-workflow.css",
      "template-trial.css",
      "template-multi-trial.css",
      "template-activation.css",
      "document-generation.css",
      "document-data-correction.css",
      "document-email-delivery.css",
      "email-recipients.css",
      "document-schedules.css",
      "operator-workflows.css",
      "shared-document-results.css",
      "storage-maintenance.css",
      "bulk-data-import.css",
      "bulk-data-import-ux.css",
      "database-admin.css",
      "operation-center.css",
      "operations-readiness.css",
      "help-center.css",
      "interface-hierarchy.css",
      "interface-stability.css",
      "template-row-flow.css"
    ],
    contentType: "text/css; charset=utf-8",
    cacheControl: "no-store"
  },
  "/ui/app.js": {
    fileName: "field-groups-ui.js",
    appendFileNames: [
      "searchable-select.js",
      "space-property-scope.js",
      "app.js",
      "space-isolation-app.js",
      "entity-workspace.js",
      "operator-workflows.js",
      "workspace-switcher.js",
      "help-center.js",
      "help-project-documents.js",
      "interface-hierarchy.js",
      "database-admin.js"
    ],
    contentType: "text/javascript; charset=utf-8",
    cacheControl: "no-store"
  },
  "/ui/document-intake.js": {
    fileName: "document-intake.js",
    appendFileNames: [
      "document-structure.js",
      "generic-template-entities.js",
      "template-placement-guidance.js",
      "template-repeat-assistant.js",
      "template-row-editor.js",
      "template-trial.js",
      "template-multi-trial.js",
      "template-activation.js",
      "document-generation.js",
      "generic-document-generation.js",
      "document-generation-preflight.js",
      "document-data-correction.js",
      "document-generation-retry.js",
      "document-delivery.js",
      "document-email-delivery.js",
      "email-recipients.js",
      "document-schedules.js",
      "shared-document-results.js",
      "shared-document-view-labels.js",
      "shared-corporate-mode.js",
      "storage-maintenance.js",
      "bulk-data-import.js",
      "space-isolation-ui.js",
      "operation-center.js",
      "operations-readiness.js",
      "template-row-flow.js",
      "guided-flow-simplification.js"
    ],
    contentType: "text/javascript; charset=utf-8",
    cacheControl: "no-store"
  },
  "/favicon.svg": {
    fileName: "favicon.svg",
    contentType: "image/svg+xml; charset=utf-8",
    cacheControl: "private, max-age=86400"
  }
};

async function sendAsset(
  reply: FastifyReply,
  uiDirectory: string,
  asset: UiAsset
): Promise<FastifyReply> {
  const fileNames = [asset.fileName, ...(asset.appendFileNames ?? [])];
  const bodies = await Promise.all(
    fileNames.map((fileName) => fs.readFile(path.join(uiDirectory, fileName)))
  );
  const body =
    bodies.length === 1
      ? bodies[0]
      : Buffer.concat(
          bodies.flatMap((part, index) =>
            index === 0 ? [part] : [Buffer.from("\n\n"), part]
          )
        );
  return reply
    .type(asset.contentType)
    .header("cache-control", asset.cacheControl)
    .header("x-content-type-options", "nosniff")
    .send(body);
}

function helpDocumentId(relativePath: string): string {
  return createHash("sha256").update(relativePath).digest("hex").slice(0, 24);
}

function helpDocumentCategory(relativePath: string): string {
  const normalized = relativePath.toLocaleLowerCase("ru-RU");
  if (normalized.startsWith("adr/")) return "Архитектурные решения";
  if (/operations|deployment|install|release|backup|pilot/u.test(normalized)) {
    return "Эксплуатация и установка";
  }
  if (/requirement|specification|technical_specification/u.test(normalized)) {
    return "Требования и технические задания";
  }
  if (/architecture|template|document|space|knowledge|persistence|api/u.test(normalized)) {
    return "Архитектура и интерфейсы";
  }
  if (/guide|case|import|example|readme/u.test(normalized)) {
    return "Руководства и примеры";
  }
  if (/roadmap|plan|iteration|change|release_notes/u.test(normalized)) {
    return "Планы и состояние проекта";
  }
  return "Прочие документы";
}

function helpDocumentTitle(content: string, relativePath: string): string {
  const heading = /^#\s+(.+)$/mu.exec(content)?.[1]?.trim();
  if (heading !== undefined && heading.length > 0 && heading.length <= 300) {
    return heading;
  }
  return path.basename(relativePath, ".md").replace(/[_-]+/gu, " ");
}

async function collectHelpDocuments(
  docsDirectory: string,
  currentDirectory: string = docsDirectory,
  records: HelpDocumentRecord[] = []
): Promise<HelpDocumentRecord[]> {
  const entries = await fs.readdir(currentDirectory, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name, "ru-RU"));
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const absolutePath = path.join(currentDirectory, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      await collectHelpDocuments(docsDirectory, absolutePath, records);
      continue;
    }
    if (!entry.isFile() || !entry.name.toLocaleLowerCase("en-US").endsWith(".md")) {
      continue;
    }
    if (records.length >= maximumHelpDocuments) {
      throw new Error("Количество документов превышает допустимый предел.");
    }
    const relativePath = path.relative(docsDirectory, absolutePath).split(path.sep).join("/");
    if (relativePath.startsWith("../") || path.isAbsolute(relativePath)) {
      throw new Error("Найден документ вне разрешённого каталога.");
    }
    const stat = await fs.stat(absolutePath);
    if (stat.size > maximumHelpDocumentBytes) {
      throw new Error(`Документ «${relativePath}» превышает допустимый размер.`);
    }
    const content = await fs.readFile(absolutePath, "utf8");
    records.push({
      id: helpDocumentId(relativePath),
      path: relativePath,
      title: helpDocumentTitle(content, relativePath),
      category: helpDocumentCategory(relativePath),
      sizeBytes: stat.size,
      absolutePath
    });
  }
  return records;
}

function publicHelpDocument(record: HelpDocumentRecord): HelpDocumentSummary {
  const { absolutePath: _absolutePath, ...summary } = record;
  return summary;
}

function helpError(
  request: FastifyRequest,
  reply: FastifyReply,
  statusCode: number,
  code: string,
  message: string
) {
  return reply.code(statusCode).header("cache-control", "no-store").send({
    error: { code, message },
    correlationId: correlationId(request)
  });
}

export function registerUiRoutes(
  app: FastifyInstance,
  uiDirectory: string = defaultUiDirectory,
  docsDirectory: string = defaultDocsDirectory
): void {
  app.addHook("onSend", async (request, reply, payload) => {
    if (request.url === "/" || request.url.startsWith("/ui/")) {
      reply.header(
        "content-security-policy",
        "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"
      );
      reply.header("referrer-policy", "no-referrer");
      reply.header("permissions-policy", "camera=(), microphone=(), geolocation=()");
    }
    return payload;
  });

  for (const [route, asset] of Object.entries(assets)) {
    app.get(route, async (_request, reply) => sendAsset(reply, uiDirectory, asset));
  }

  app.get("/api/v1/help/documents", async (request, reply) => {
    try {
      const records = await collectHelpDocuments(docsDirectory);
      reply.header("cache-control", "no-store");
      return {
        data: records.map(publicHelpDocument),
        correlationId: correlationId(request)
      };
    } catch (error) {
      request.log.error(
        { err: error, correlationId: correlationId(request) },
        "не удалось получить документацию проекта"
      );
      return helpError(
        request,
        reply,
        503,
        "help_documents_unavailable",
        "Документация проекта временно недоступна. Проверьте установленный комплект."
      );
    }
  });

  app.get<{ Params: { documentId: string } }>(
    "/api/v1/help/documents/:documentId",
    {
      schema: {
        params: {
          type: "object",
          additionalProperties: false,
          required: ["documentId"],
          properties: {
            documentId: {
              type: "string",
              pattern: "^[a-f0-9]{24}$"
            }
          }
        }
      }
    },
    async (request, reply) => {
      try {
        const records = await collectHelpDocuments(docsDirectory);
        const record = records.find(
          (candidate) => candidate.id === request.params.documentId
        );
        if (record === undefined) {
          return helpError(
            request,
            reply,
            404,
            "help_document_not_found",
            "Документ не найден в установленной версии."
          );
        }
        const content = await fs.readFile(record.absolutePath, "utf8");
        reply.header("cache-control", "no-store");
        return {
          data: {
            ...publicHelpDocument(record),
            content
          },
          correlationId: correlationId(request)
        };
      } catch (error) {
        request.log.error(
          { err: error, correlationId: correlationId(request) },
          "не удалось прочитать документ проекта"
        );
        return helpError(
          request,
          reply,
          503,
          "help_document_read_failed",
          "Не удалось прочитать документ. Повторите действие или проверьте установленный комплект."
        );
      }
    }
  );
}
