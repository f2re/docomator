import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { FastifyInstance } from "fastify";

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const defaultUiDirectory = path.resolve(moduleDirectory, "../ui");

function registerUiAsset(
  app: FastifyInstance,
  route: string,
  fileName: string,
  contentType: string,
  uiDirectory: string
): void {
  app.get(route, async (_request, reply) => {
    const body = await fs.readFile(path.join(uiDirectory, fileName));
    return reply
      .header("cache-control", "no-store")
      .header("x-content-type-options", "nosniff")
      .type(contentType)
      .send(body);
  });
}

export function registerSupplementalUiRoutes(
  app: FastifyInstance,
  uiDirectory: string = defaultUiDirectory
): void {
  registerUiAsset(
    app,
    "/ui/data-export.js",
    "data-export.js",
    "text/javascript; charset=utf-8",
    uiDirectory
  );
  registerUiAsset(
    app,
    "/ui/navigation-contract.js",
    "navigation-contract.js",
    "text/javascript; charset=utf-8",
    uiDirectory
  );
  registerUiAsset(
    app,
    "/ui/data-extraction.js",
    "data-extraction.js",
    "text/javascript; charset=utf-8",
    uiDirectory
  );
  registerUiAsset(
    app,
    "/ui/data-export.css",
    "data-export.css",
    "text/css; charset=utf-8",
    uiDirectory
  );
  registerUiAsset(
    app,
    "/ui/interaction-contract.css",
    "interaction-contract.css",
    "text/css; charset=utf-8",
    uiDirectory
  );
  registerUiAsset(
    app,
    "/ui/data-extraction.css",
    "data-extraction.css",
    "text/css; charset=utf-8",
    uiDirectory
  );
}
