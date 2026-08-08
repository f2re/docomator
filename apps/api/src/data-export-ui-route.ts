import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { FastifyInstance } from "fastify";

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const defaultUiDirectory = path.resolve(moduleDirectory, "../ui");

function registerUiModule(
  app: FastifyInstance,
  route: string,
  fileName: string,
  uiDirectory: string
): void {
  app.get(route, async (_request, reply) => {
    const body = await fs.readFile(path.join(uiDirectory, fileName));
    return reply
      .header("cache-control", "no-store")
      .header("x-content-type-options", "nosniff")
      .type("text/javascript; charset=utf-8")
      .send(body);
  });
}

export function registerDataExportUiRoute(
  app: FastifyInstance,
  uiDirectory: string = defaultUiDirectory
): void {
  registerUiModule(app, "/ui/data-export.js", "data-export.js", uiDirectory);
  registerUiModule(app, "/ui/auth-session.js", "auth-session.js", uiDirectory);
}
