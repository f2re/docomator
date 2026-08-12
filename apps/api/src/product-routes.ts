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
import { registerPublicationRoutes } from "./publication-routes.js";
import { registerPublicDocumentFormattingRoutes } from "./public-document-formatting-routes.js";

export function registerProductRoutes(
  app: FastifyInstance,
  store: SqliteStore,
  objectStore: ContentAddressedObjectStore
): void {
  const publications = new SpaceScopedPublicationRegistry(store);
  registerPublicationRoutes(app, publications);
  registerBibliographyRoutes(app, store, publications);
  registerDocumentFormattingRoutes(app, new DocumentFormattingRegistry(store), objectStore);
  registerPublicDocumentFormattingRoutes(app);
  registerProductUiBundle(app);
}
