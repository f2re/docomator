import { readFile } from "node:fs/promises";

import { expect, test as base } from "@playwright/test";

const test = base.extend({
  accessCodeSession: [
    async ({ baseURL, page }, use) => {
      const accessCodeFile = process.env.DOCOMATOR_E2E_ACCESS_CODE_FILE;
      if (accessCodeFile) {
        const code = (await readFile(accessCodeFile, "utf8")).replace(/\r?\n$/u, "");
        expect(code, "файл UX-приёмки должен содержать ровно 4 цифры").toMatch(/^[0-9]{4}$/u);
        const origin = new URL(baseURL || "http://127.0.0.1:18080").origin;
        const response = await page.request.post(`${origin}/api/v1/access/unlock`, {
          headers: {
            accept: "application/json",
            origin
          },
          data: { code }
        });
        expect(
          response.status(),
          "offline UX-приёмка не смогла открыть рабочую область по коду доступа"
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