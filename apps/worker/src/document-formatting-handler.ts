import {
  DocumentFormattingRegistry,
  type JsonValue
} from "@docomator/storage";
import {
  DocumentFormattingError,
  formatDocumentToProfile,
  normalizeDocumentFormattingSettings,
  type DocumentFormattingSettings
} from "@docomator/template-compiler";
import type { ContentAddressedObjectStore } from "@docomator/storage";

import type { JobHandler } from "./processor.js";

function objectValue(value: JsonValue): { [key: string]: JsonValue } | null {
  return value !== null && !Array.isArray(value) && typeof value === "object" ? value : null;
}

function outputName(fileName: string, profile: string): string {
  const base = fileName.replace(/\.docx$/iu, "").replace(/[\\/\u0000-\u001f\u007f]/gu, "_").slice(0, 180) || "документ";
  return `${base}-${profile.startsWith("eskd") ? "ЕСКД" : "ГОСТ"}.docx`;
}

function errorJson(error: unknown): JsonValue {
  if (error instanceof DocumentFormattingError) return { code: error.code, message: error.message };
  if (error instanceof Error) return { code: "formatting_failed", message: error.message };
  return { code: "formatting_failed", message: String(error) };
}

export function createDocumentFormattingHandler(options: {
  registry: DocumentFormattingRegistry;
  objectStore: ContentAddressedObjectStore;
}): JobHandler {
  return async ({ job, signal }) => {
    const payload = objectValue(job.payload);
    const spaceId = typeof payload?.spaceId === "string" ? payload.spaceId : "";
    const rawSettings = payload?.settings;
    if (!spaceId || rawSettings === undefined || rawSettings === null || Array.isArray(rawSettings) || typeof rawSettings !== "object") {
      throw new Error("Некорректная полезная нагрузка задания форматирования.");
    }
    const settings = normalizeDocumentFormattingSettings(rawSettings as unknown as DocumentFormattingSettings);
    for (const item of options.registry.listWorkItems(spaceId, job.id)) {
      if (signal.aborted) throw signal.reason instanceof Error ? signal.reason : new Error("Worker stopping");
      try {
        options.registry.markRunning(spaceId, job.id, item.itemId);
        const source = await options.objectStore.getBuffer(item.sha256);
        const result = await formatDocumentToProfile(source, settings);
        const stored = await options.objectStore.putBuffer(result.buffer);
        options.registry.completeItem(spaceId, job.id, item.itemId, stored, outputName(item.fileName, settings.profile), {
          profile: settings.profile,
          changedParts: result.changedParts,
          untouchedParts: result.untouchedParts,
          before: result.analysisBefore
        });
      } catch (error) {
        options.registry.failItem(spaceId, job.id, item.itemId, errorJson(error));
      }
    }
  };
}
