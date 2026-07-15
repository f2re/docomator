import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { FastifyInstance, FastifyReply } from "fastify";

interface UiAsset {
  readonly fileName: string;
  readonly contentType: string;
  readonly cacheControl: string;
  readonly appendFileNames?: readonly string[];
}

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const defaultUiDirectory = path.resolve(moduleDirectory, "../ui");

const assets: Readonly<Record<string, UiAsset>> = {
  "/": {
    fileName: "index.html",
    contentType: "text/html; charset=utf-8",
    cacheControl: "no-store"
  },
  "/ui/styles.css": {
    fileName: "styles.css",
    appendFileNames: [
      "spaces.css",
      "intake.css",
      "quarantine.css",
      "structure.css",
      "template-field.css",
      "template-trial.css",
      "template-multi-trial.css",
      "template-activation.css",
      "document-generation.css",
      "document-data-correction.css",
      "document-email-delivery.css",
      "email-recipients.css",
      "document-schedules.css",
      "shared-document-results.css"
    ],
    contentType: "text/css; charset=utf-8",
    cacheControl: "private, max-age=3600"
  },
  "/ui/app.js": {
    fileName: "app.js",
    contentType: "text/javascript; charset=utf-8",
    cacheControl: "private, max-age=3600"
  },
  "/ui/document-intake.js": {
    fileName: "document-intake.js",
    appendFileNames: [
      "document-structure.js",
      "template-trial.js",
      "template-multi-trial.js",
      "template-activation.js",
      "document-generation.js",
      "document-generation-preflight.js",
      "document-data-correction.js",
      "document-generation-retry.js",
      "document-delivery.js",
      "document-email-delivery.js",
      "email-recipients.js",
      "document-schedules.js",
      "shared-document-results.js",
      "shared-document-view-labels.js",
      "shared-corporate-mode.js"
    ],
    contentType: "text/javascript; charset=utf-8",
    cacheControl: "private, max-age=3600"
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
  const bodies = await Promise.all([
    fs.readFile(path.join(uiDirectory, asset.fileName)),
    ...(asset.appendFileNames ?? []).map((fileName) =>
      fs.readFile(path.join(uiDirectory, fileName))
    )
  ]);
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

export function registerUiRoutes(
  app: FastifyInstance,
  uiDirectory: string = defaultUiDirectory
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
}
