import { hostname } from "node:os";
import path from "node:path";

export interface CommonConfig {
  version: string;
  dataDir: string;
  logLevel: "trace" | "debug" | "info" | "warn" | "error" | "fatal";
  llmEnabled: boolean;
  llmBaseUrl: string;
}

export interface ApiConfig extends CommonConfig {
  host: string;
  port: number;
}

export interface WorkerConfig extends CommonConfig {
  workerId: string;
  pollIntervalMs: number;
  heartbeatIntervalMs: number;
  leaseDurationMs: number;
  retryBaseMs: number;
  retryMaxMs: number;
}

const LOG_LEVELS = new Set<CommonConfig["logLevel"]>([
  "trace",
  "debug",
  "info",
  "warn",
  "error",
  "fatal"
]);

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value.trim() === "") {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }
  throw new Error(`Invalid boolean value: ${value}`);
}

function parseInteger(
  name: string,
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number
): number {
  if (value === undefined || value.trim() === "") {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be an integer in range ${minimum}..${maximum}`);
  }
  return parsed;
}

function parseLogLevel(value: string | undefined): CommonConfig["logLevel"] {
  const normalized = (value ?? "info").toLowerCase() as CommonConfig["logLevel"];
  if (!LOG_LEVELS.has(normalized)) {
    throw new Error(`Unsupported DOCOMATOR_LOG_LEVEL: ${value}`);
  }
  return normalized;
}

function common(env: NodeJS.ProcessEnv): CommonConfig {
  const dataDir = path.resolve(env.DOCOMATOR_DATA_DIR ?? "/var/lib/docomator");
  return {
    version: env.DOCOMATOR_VERSION ?? "0.1.0-alpha.0",
    dataDir,
    logLevel: parseLogLevel(env.DOCOMATOR_LOG_LEVEL),
    llmEnabled: parseBoolean(env.DOCOMATOR_LLM_ENABLED, false),
    llmBaseUrl: env.DOCOMATOR_LLM_BASE_URL ?? "http://127.0.0.1:8081"
  };
}

export function loadApiConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  return {
    ...common(env),
    host: env.DOCOMATOR_HOST ?? "127.0.0.1",
    port: parseInteger("DOCOMATOR_PORT", env.DOCOMATOR_PORT, 8080, 1, 65535)
  };
}

export function loadWorkerConfig(env: NodeJS.ProcessEnv = process.env): WorkerConfig {
  const retryBaseMs = parseInteger(
    "DOCOMATOR_WORKER_RETRY_BASE_MS",
    env.DOCOMATOR_WORKER_RETRY_BASE_MS,
    1_000,
    100,
    3_600_000
  );
  const retryMaxMs = parseInteger(
    "DOCOMATOR_WORKER_RETRY_MAX_MS",
    env.DOCOMATOR_WORKER_RETRY_MAX_MS,
    300_000,
    100,
    86_400_000
  );
  if (retryBaseMs > retryMaxMs) {
    throw new Error("DOCOMATOR_WORKER_RETRY_BASE_MS must not exceed DOCOMATOR_WORKER_RETRY_MAX_MS");
  }

  const configuredWorkerId = env.DOCOMATOR_WORKER_ID?.trim();
  return {
    ...common(env),
    workerId:
      configuredWorkerId === undefined || configuredWorkerId.length === 0
        ? `${hostname()}:${process.pid}`
        : configuredWorkerId,
    pollIntervalMs: parseInteger(
      "DOCOMATOR_WORKER_POLL_MS",
      env.DOCOMATOR_WORKER_POLL_MS,
      1000,
      100,
      3_600_000
    ),
    heartbeatIntervalMs: parseInteger(
      "DOCOMATOR_WORKER_HEARTBEAT_MS",
      env.DOCOMATOR_WORKER_HEARTBEAT_MS,
      30_000,
      1000,
      3_600_000
    ),
    leaseDurationMs: parseInteger(
      "DOCOMATOR_WORKER_LEASE_MS",
      env.DOCOMATOR_WORKER_LEASE_MS,
      60_000,
      1_000,
      86_400_000
    ),
    retryBaseMs,
    retryMaxMs
  };
}
