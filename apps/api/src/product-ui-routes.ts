import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { FastifyInstance } from "fastify";

const uiDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../ui");

export function registerProductUiBundle(app: FastifyInstance): void {
  app.addHook("onSend", async (request, reply, payload) => {
    const extraFiles =
      request.url === "/ui/app.js"
        ? ["gost-formatting.js", "publication-bibliography.js"]
        : request.url === "/ui/styles.css"
          ? ["product-workspace.css"]
          : [];
    if (extraFiles.length === 0 || !(typeof payload === "string" || Buffer.isBuffer(payload))) return payload;
    const extra = await Promise.all(extraFiles.map((fileName) => fs.readFile(path.join(uiDirectory, fileName))));
    reply.removeHeader("content-length");
    const base = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
    return Buffer.concat([base, ...extra.flatMap((body) => [Buffer.from("\n\n"), body])]);
  });
}
