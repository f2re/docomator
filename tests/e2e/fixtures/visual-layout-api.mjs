const JSON_HEADERS = {
  "cache-control": "no-store",
  "content-type": "application/json; charset=utf-8",
  "x-correlation-id": "e2e-visual-layout"
};

export async function installVisualLayoutApiMock(
  page,
  { sourceSha256 = "e2e-docx-source-sha256" } = {}
) {
  await page.route(
    "**/api/v1/spaces/*/template-drafts/*/visual-layout",
    async (route) => {
      if (route.request().method() !== "GET") {
        await route.fallback();
        return;
      }
      await route.fulfill({
        status: 200,
        headers: JSON_HEADERS,
        body: JSON.stringify({
          data: {
            format: "docx",
            sourceSha256,
            warnings: [],
            docx: {
              page: {},
              paragraphs: [],
              tables: []
            }
          },
          correlationId: "e2e-visual-layout"
        })
      });
    }
  );
}
