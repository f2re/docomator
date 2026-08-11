#!/usr/bin/env node
import process from "node:process";

let baseUrl = "http://127.0.0.1:8080";
for (let index = 2; index < process.argv.length; index += 1) {
  const argument = process.argv[index];
  if (argument === "--url") {
    const value = process.argv[index + 1];
    if (value === undefined) throw new Error("После --url требуется адрес.");
    baseUrl = value;
    index += 1;
  } else {
    throw new Error(`Неизвестный параметр: ${argument}`);
  }
}
const parsed = new URL(baseUrl);
if (!new Set(["http:", "https:"]).has(parsed.protocol)) {
  throw new Error("Разрешён только http/https адрес локального Оформлятора.");
}
let input = "";
for await (const chunk of process.stdin) input += chunk.toString("utf8");
const [password = "", confirmation = ""] = input.replaceAll("\r", "").split("\n");
if (password.length === 0 || confirmation.length === 0) {
  throw new Error("Пароль и подтверждение не получены.");
}
const response = await fetch(new URL("/api/v1/auth/setup", parsed), {
  method: "POST",
  headers: {
    "content-type": "application/json",
    origin: parsed.origin
  },
  body: JSON.stringify({ password, confirmation })
});
const body = await response.json().catch(() => ({}));
if (!response.ok) {
  throw new Error(body?.error?.message ?? `Настройка пароля не выполнена: HTTP ${response.status}`);
}
process.stdout.write("Общий пароль Оформлятора настроен. Теперь можно войти через браузер.\n");
