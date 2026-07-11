#!/usr/bin/env node
const url = process.argv[2] ?? "http://127.0.0.1:8080/readyz";
const timeoutMs = Number.parseInt(process.argv[3] ?? "5000", 10);
const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), timeoutMs);

try {
  const response = await fetch(url, { signal: controller.signal });
  const body = await response.text();
  if (!response.ok) {
    process.stderr.write(`Health check failed: HTTP ${response.status} ${body}\n`);
    process.exit(1);
  }
  process.stdout.write(`${body}\n`);
} catch (error) {
  process.stderr.write(
    `Health check failed: ${error instanceof Error ? error.message : String(error)}\n`
  );
  process.exit(1);
} finally {
  clearTimeout(timer);
}
