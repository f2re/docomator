import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { DEFAULT_INTAKE_LIMITS } from "@docomator/document-intake";
import {
  DocumentFormattingError,
  analyzeDocumentFormatting,
  documentFormattingProfile,
  documentFormattingProfileLabel,
  formatDocumentToProfile,
  normalizeDocumentFormattingSettings,
  type DocumentFormattingProfile,
  type DocumentFormattingSettings
} from "@docomator/template-compiler";
import { correlationId } from "./request-context.js";

const uiDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../ui");
const PUBLIC_LIMIT = Math.min(DEFAULT_INTAKE_LIMITS.maxArchiveBytes, 32 * 1024 * 1024);
const MAX_ACTIVE_PUBLIC_OPERATIONS = 3;
let activePublicOperations = 0;

type PublicProfile = Exclude<DocumentFormattingProfile, "custom">;
interface PublicQuery {
  profile: PublicProfile;
  fileName?: string;
  fontFamily?: string;
  fontSizePt?: number;
  lineSpacing?: number;
  firstLineIndentMm?: number;
  marginTop?: number;
  marginRight?: number;
  marginBottom?: number;
  marginLeft?: number;
  bodyAlignment?: "left" | "both";
}

const publicQuerySchema = {
  type: "object",
  additionalProperties: false,
  required: ["profile"],
  properties: {
    profile: { type: "string", enum: ["gost-r-7.0.97-2025", "eskd-gost-r-2.105-2019"] },
    fileName: { type: "string", minLength: 1, maxLength: 255 },
    fontFamily: { type: "string", minLength: 1, maxLength: 120 },
    fontSizePt: { type: "number", minimum: 8, maximum: 32 },
    lineSpacing: { type: "number", minimum: 1, maximum: 3 },
    firstLineIndentMm: { type: "number", minimum: 0, maximum: 50 },
    marginTop: { type: "number", minimum: 5, maximum: 70 },
    marginRight: { type: "number", minimum: 5, maximum: 70 },
    marginBottom: { type: "number", minimum: 5, maximum: 70 },
    marginLeft: { type: "number", minimum: 5, maximum: 70 },
    bodyAlignment: { type: "string", enum: ["left", "both"] }
  }
} as const;

function envelope<T>(request: FastifyRequest, data: T) {
  return { data, correlationId: correlationId(request) };
}

function formattingError(request: FastifyRequest, reply: FastifyReply, error: DocumentFormattingError) {
  return reply.code(422).header("cache-control", "no-store").send({
    error: { code: error.code, message: error.message },
    correlationId: correlationId(request)
  });
}

function busy(request: FastifyRequest, reply: FastifyReply) {
  return reply.code(429).header("retry-after", "2").header("cache-control", "no-store").send({
    error: {
      code: "public_formatting_busy",
      message: "Сейчас уже обрабатывается несколько документов. Повторите попытку через пару секунд; исходный файл не загружен в хранилище."
    },
    correlationId: correlationId(request)
  });
}

async function bounded<T>(request: FastifyRequest, reply: FastifyReply, operation: () => Promise<T>): Promise<T | FastifyReply> {
  if (activePublicOperations >= MAX_ACTIVE_PUBLIC_OPERATIONS) return busy(request, reply);
  activePublicOperations += 1;
  try {
    return await operation();
  } finally {
    activePublicOperations -= 1;
  }
}

function settingsFromQuery(query: PublicQuery): DocumentFormattingSettings {
  const base = documentFormattingProfile(query.profile);
  return normalizeDocumentFormattingSettings({
    ...base,
    fontFamily: query.fontFamily ?? base.fontFamily,
    fontSizePt: query.fontSizePt ?? base.fontSizePt,
    lineSpacing: query.lineSpacing ?? base.lineSpacing,
    firstLineIndentMm: query.firstLineIndentMm ?? base.firstLineIndentMm,
    marginsMm: {
      top: query.marginTop ?? base.marginsMm.top,
      right: query.marginRight ?? base.marginsMm.right,
      bottom: query.marginBottom ?? base.marginsMm.bottom,
      left: query.marginLeft ?? base.marginsMm.left
    },
    bodyAlignment: query.bodyAlignment ?? base.bodyAlignment
  });
}

function outputName(fileName: string | undefined, profile: PublicProfile): string {
  const base = String(fileName ?? "документ.docx")
    .replace(/\.docx$/iu, "")
    .replace(/[\\/\r\n\u0000-\u001f\u007f]/gu, "_")
    .trim()
    .slice(0, 160) || "документ";
  return `${base}-${profile.startsWith("eskd") ? "ЕСКД" : "ГОСТ"}.docx`;
}

function disposition(fileName: string): string {
  return `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

export function registerPublicDocumentFormattingRoutes(app: FastifyInstance): void {
  app.get("/gost", async (_request, reply) =>
    reply
      .header("cache-control", "no-store")
      .header("referrer-policy", "no-referrer")
      .header("x-content-type-options", "nosniff")
      .header(
        "content-security-policy",
        "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'"
      )
      .type("text/html; charset=utf-8")
      .send(`<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><title>Форматирование по ГОСТ — Оформлятор</title><link rel="stylesheet" href="/gost.css"><script src="/gost.js" defer></script></head><body><main class="public-gost"><header><div><p class="eyebrow">Оформлятор · без входа</p><h1>Форматирование DOCX по ГОСТ и ЕСКД</h1><p>Файл обрабатывается без доступа к пространствам и не сохраняется в базе. Результат возвращается новой DOCX-копией.</p></div><a class="quiet" href="/login">Войти в основной интерфейс</a></header><section class="card"><label class="drop" id="publicGostDrop"><input id="publicGostFiles" type="file" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" multiple><strong>Перетащите DOCX сюда</strong><span>или нажмите, чтобы выбрать один или несколько файлов</span></label><div id="publicGostFilesList" class="stack"></div></section><section class="card"><h2>Профиль и параметры</h2><div id="publicGostSettings" class="grid"></div><div class="actions"><button id="publicGostAnalyze" class="secondary" type="button">Проверить</button><button id="publicGostFormat" class="primary" type="button">Оформить документы</button></div><div id="publicGostStatus" class="status" hidden></div></section><section id="publicGostResults" class="stack"></section><p class="footnote">Автоматически меняются только базовые параметры, которые показаны на экране. Система не выдаёт результат за прошедший нормативную экспертизу и не угадывает смысл реквизитов, заголовков и элементов ЕСКД.</p></main></body></html>`)
  );

  app.get("/gost.js", async (_request, reply) =>
    reply.header("cache-control", "no-store").header("x-content-type-options", "nosniff").type("text/javascript; charset=utf-8").send(await fs.readFile(path.join(uiDirectory, "public-gost.js")))
  );
  app.get("/gost.css", async (_request, reply) =>
    reply.header("cache-control", "no-store").header("x-content-type-options", "nosniff").type("text/css; charset=utf-8").send(await fs.readFile(path.join(uiDirectory, "public-gost.css")))
  );

  app.get("/api/v1/public/document-formatting/profiles", async (request, reply) => {
    reply.header("cache-control", "no-store");
    return envelope(
      request,
      (["gost-r-7.0.97-2025", "eskd-gost-r-2.105-2019"] as const).map((profile) => ({
        id: profile,
        label: documentFormattingProfileLabel(profile),
        settings: documentFormattingProfile(profile)
      }))
    );
  });

  app.post<{ Querystring: PublicQuery; Body: Buffer }>(
    "/api/v1/public/document-formatting/analyze",
    { bodyLimit: PUBLIC_LIMIT, schema: { querystring: publicQuerySchema } },
    async (request, reply) => {
      const result = await bounded(request, reply, async () => {
        try {
          return envelope(request, await analyzeDocumentFormatting(request.body, settingsFromQuery(request.query)));
        } catch (error) {
          if (error instanceof DocumentFormattingError) return formattingError(request, reply, error);
          throw error;
        }
      });
      reply.header("cache-control", "no-store");
      return result;
    }
  );

  app.post<{ Querystring: PublicQuery; Body: Buffer }>(
    "/api/v1/public/document-formatting/format",
    { bodyLimit: PUBLIC_LIMIT, schema: { querystring: publicQuerySchema } },
    async (request, reply) => {
      return bounded(request, reply, async () => {
        try {
          const settings = settingsFromQuery(request.query);
          const result = await formatDocumentToProfile(request.body, settings);
          const name = outputName(request.query.fileName, request.query.profile);
          return reply
            .header("cache-control", "no-store")
            .header("x-content-type-options", "nosniff")
            .header("content-disposition", disposition(name))
            .type("application/vnd.openxmlformats-officedocument.wordprocessingml.document")
            .send(result.buffer);
        } catch (error) {
          if (error instanceof DocumentFormattingError) return formattingError(request, reply, error);
          throw error;
        }
      });
    }
  );
}
