import type { FastifyInstance } from "fastify";
import {
  ContentAddressedObjectStore,
  DocumentFormattingRegistry,
  SpaceScopedPublicationRegistry,
  type SqliteStore
} from "@docomator/storage";

import { registerBibliographyRoutes } from "./bibliography-routes.js";
import { registerDocumentFormattingRoutes } from "./document-formatting-routes.js";
import { registerProductUiBundle } from "./product-ui-routes.js";
import { registerPublicDocumentFormattingRoutes } from "./public-document-formatting-routes.js";

export function registerProductRoutes(
  app: FastifyInstance,
  store: SqliteStore,
  objectStore: ContentAddressedObjectStore
): void {
  // Publication routes and their base UI are already registered by the existing
  // object-cleanup/document-generation bootstrap. Reuse the same scoped storage
  // model here instead of registering the HTTP surface a second time.
  const publications = new SpaceScopedPublicationRegistry(store);
  registerBibliographyRoutes(app, store, publications);
  registerDocumentFormattingRoutes(app, new DocumentFormattingRegistry(store), objectStore);
  registerPublicDocumentFormattingRoutes(app);
  registerProductUiBundle(app);
}
