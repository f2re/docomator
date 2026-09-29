#!/usr/bin/env node

import fs from "node:fs/promises";
import { constants } from "node:fs";

const [url, expected = ""] = process.argv.slice(2);
if (url === undefined || process.argv.length > 4) {
  process.stderr.write("Использование: http-check.mjs URL [ОЖИДАЕМЫЙ_ТЕКСТ]\n");
  process.exit(2);
}

const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 5_000);
try {
  const headers = {};
  const sessionFile = process.env.DOCOMATOR_HTTP_SESSION_FILE;
  if (sessionFile) {
    const handle = await fs.open(sessionFile, constants.O_RDONLY | constants.O_NOFOLLOW);
    let session;
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || (stat.mode & 0o077) !== 0 || stat.size > 8192) throw new Error("Небезопасный файл проверочной сессии.");
      session = JSON.parse(await handle.readFile("utf8"));
    } finally {
      await handle.close();
    }
    if (session.origin !== new URL(url).origin || typeof session.cookie !== "string" || !/^docomator_session=[A-Za-z0-9._-]+$/u.test(session.cookie)) {
      throw new Error("Сессия не соответствует проверяемому серверу.");
    }
    headers.cookie = session.cookie;
  }
  const response = await fetch(url, {
    signal: controller.signal,
    redirect: "error",
    headers
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
