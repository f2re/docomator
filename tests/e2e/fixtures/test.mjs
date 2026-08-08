import { readFile } from "node:fs/promises";

import { expect, test as base } from "@playwright/test";

const test = base.extend({
  accessPasswordSession: [
    async ({ baseURL, page }, use) => {
      const passwordFile = process.env.DOCOMATOR_E2E_ACCESS_PASSWORD_FILE;
      if (passwordFile) {
        const password = (await readFile(passwordFile, "utf8")).replace(/\r?\n$/u, "");
        const origin = new URL(baseURL || "http://127.0.0.1:18080").origin;
        const response = await page.request.post(`${origin}/api/v1/auth/login`, {
          headers: {
            accept: "application/json",
            origin
          },
          data: { password }
        });
        expect(
          response.status(),
          "offline UX-приёмка не смогла войти по общему паролю Docomator"
        ).toBe(200);
      }
      await use();
    },
    { auto: true }
  ],
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
