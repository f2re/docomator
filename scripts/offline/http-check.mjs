#!/usr/bin/env node

const [url, expected = ""] = process.argv.slice(2);
if (url === undefined || process.argv.length > 4) {
  process.stderr.write("Использование: http-check.mjs URL [ОЖИДАЕМЫЙ_ТЕКСТ]\n");
  process.exit(2);
}

const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 5_000);
try {
  const response = await fetch(url, {
    signal: controller.signal,
    redirect: "error"
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > 4 * 1024 * 1024) {
    throw new Error("ответ превышает 4 МиБ");
  }
  const body = await response.arrayBuffer();
  if (body.byteLength > 4 * 1024 * 1024) {
    throw new Error("ответ превышает 4 МиБ");
  }
  if (expected.length > 0 && !Buffer.from(body).includes(Buffer.from(expected))) {
    throw new Error("в ответе отсутствует ожидаемый текст");
  }
} catch {
  process.stderr.write(`Локальная HTTP-проверка не пройдена: ${url}\n`);
  process.exit(1);
} finally {
  clearTimeout(timeout);
}
