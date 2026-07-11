import fs from "node:fs/promises";
import path from "node:path";

import type { ApiConfig } from "@docomator/config";
import type {
  HealthResponse,
  ReadinessResponse,
  SystemInfoResponse
} from "@docomator/contracts";
import Fastify, { type FastifyInstance } from "fastify";

const startedAt = Date.now();

function uptimeSeconds(): number {
  return Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
}

async function pathAccessible(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

export function buildApp(config: ApiConfig): FastifyInstance {
  const app = Fastify({
    logger: {
      level: config.logLevel,
      redact: {
        paths: [
          "req.headers.authorization",
          "req.headers.cookie",
          "res.headers.set-cookie"
        ],
        censor: "[REDACTED]"
      }
    }
  });

  app.get("/healthz", async (): Promise<HealthResponse> => ({
    service: "api",
    status: "ok",
    version: config.version,
    timestamp: new Date().toISOString(),
    uptimeSeconds: uptimeSeconds()
  }));

  app.get("/readyz", async (_request, reply): Promise<ReadinessResponse> => {
    const dataDirectoryReady = await pathAccessible(config.dataDir);
    const databaseReady = await pathAccessible(
      path.join(config.dataDir, "docomator.db")
    );
    const ready = dataDirectoryReady && databaseReady;

    if (!ready) {
      reply.code(503);
    }

    return {
      service: "api",
      status: ready ? "ok" : "degraded",
      version: config.version,
      timestamp: new Date().toISOString(),
      uptimeSeconds: uptimeSeconds(),
      checks: {
        dataDirectory: dataDirectoryReady ? "ok" : "error",
        database: databaseReady ? "ok" : "error"
      }
    };
  });

  app.get("/api/v1/system/info", async (): Promise<SystemInfoResponse> => ({
    name: "docomator",
    version: config.version,
    architecture: "modular-monolith",
    runtime: {
      node: process.version,
      platform: process.platform,
      arch: process.arch
    },
    features: {
      offlineFirst: true,
      localLlm: config.llmEnabled,
      documentFormats: ["docx", "xlsx"]
    }
  }));

  return app;
}
