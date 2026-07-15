import { expect, test as base } from "@playwright/test";

const test = base.extend({
  externalOriginGuard: [
    async ({ baseURL, page }, use) => {
      const allowedOrigin = new URL(
        baseURL || "http://127.0.0.1:18080"
      ).origin;
      const externalRequests = [];
      const runtimeErrors = [];
      const inspectRequest = (request) => {
        const url = new URL(request.url());
        if (
          (url.protocol === "http:" || url.protocol === "https:") &&
          url.origin !== allowedOrigin
        ) {
          externalRequests.push(`${request.method()} ${request.url()}`);
        }
      };
      const inspectPageError = (error) => {
        runtimeErrors.push(error.stack || error.message || String(error));
      };
      page.on("request", inspectRequest);
      page.on("pageerror", inspectPageError);
      await use(externalRequests);
      page.off("request", inspectRequest);
      page.off("pageerror", inspectPageError);
      expect(
        externalRequests,
        `интерфейс обращался за пределы локального origin ${allowedOrigin}`
      ).toEqual([]);
      expect(runtimeErrors, "в UI возникли необработанные ошибки JavaScript").toEqual(
        []
      );
    },
    { auto: true }
  ]
});

export { expect, test };
