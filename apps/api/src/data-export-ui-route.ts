import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { FastifyInstance } from "fastify";

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const defaultUiDirectory = path.resolve(moduleDirectory, "../ui");

export function registerDataExportUiRoute(
  app: FastifyInstance,
  uiDirectory: string = defaultUiDirectory
): void {
  app.get("/ui/data-export.js", async (_request, reply) => {
    const body = await fs.readFile(path.join(uiDirectory, "data-export.js"));
    return reply
      .header("cache-control", "no-store")
      .header("x-content-type-options", "nosniff")
      .type("text/javascript; charset=utf-8")
      .send(body);
  });
}
