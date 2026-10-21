import type { CommonConfig } from "@docomator/config";
import { endpointFor } from "./llm-client.js";

export interface LlmDiagnosticsResult {
  status: "ready" | "unavailable" | "disabled" | "misconfigured";
  enabled: boolean;
  endpoint?: string;
  model?: string;
  availableModels?: string[];
  latencyMs?: number;
  reason?: string;
}

async function fetchWithTimeout(
  fetchImpl: typeof fetch,
  url: string,
  timeoutMs: number,
  headers: Record<string, string> = {}
): Promise<{ ok: boolean; status: number; payload: unknown }> {
  const signal = AbortSignal.timeout(timeoutMs);
  try {
    const response = await fetchImpl(url, {
      method: "GET",
      signal,
      headers: { accept: "application/json", ...headers }
    });
    const text = await response.text();
    let payload = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = text;
    }
    return { ok: response.ok, status: response.status, payload };
  } catch (error) {
    const name = String((error as { name?: string })?.name || "").toLowerCase();
    if (name.includes("timeout") || name === "aborterror") {
      throw new Error("timeout");
    }
    throw error;
  }
}

export async function diagnoseLlm(
  config: CommonConfig,
  options: { fetchImpl?: typeof fetch } = {}
): Promise<LlmDiagnosticsResult> {
  if (!config.llmEnabled) {
    return {
      status: "disabled",
      enabled: false
    };
  }

  const endpoint = endpointFor(config.llmBaseUrl);
  if (!endpoint) {
    return {
      status: "misconfigured",
      enabled: true,
      reason: "endpoint_invalid"
    };
  }

  const headers: Record<string, string> = {};
  if (config.llmApiKey) {
    headers.authorization = `Bearer ${config.llmApiKey}`;
  }

  const timeoutMs = Math.max(1000, Math.min(config.llmTimeoutMs || 30_000, 10_000));
  const started = Date.now();
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;

  try {
    // 1. Try /health first (fastest for llama-server and specialized LLM hosts)
    let healthOk = false;
    try {
      const health = await fetchWithTimeout(fetchImpl, `${endpoint}/health`, timeoutMs, headers);
      if (health.ok) {
        healthOk = true;
      }
    } catch {
      // /health may not be present on standard OpenAI proxies, ignore and proceed to /v1/models
    }

    // 2. Query /v1/models
    const modelsResult = await fetchWithTimeout(
      fetchImpl,
      `${endpoint}/v1/models`,
      timeoutMs,
      headers
    );

    const latencyMs = Date.now() - started;

    if (!healthOk && !modelsResult.ok) {
      return {
        status: "unavailable",
        enabled: true,
        endpoint,
        latencyMs,
        reason: `http_${modelsResult.status}`
      };
    }

    let availableModels: string[] = [];
    if (modelsResult.ok && modelsResult.payload && typeof modelsResult.payload === "object") {
      const data = (modelsResult.payload as { data?: unknown[] }).data;
      if (Array.isArray(data)) {
        availableModels = data
          .map((item) => String((item as { id?: unknown })?.id || ""))
          .filter(Boolean);
      }
    }

    return {
      status: "ready",
      enabled: true,
      endpoint,
      model: config.llmModel,
      availableModels,
      latencyMs
    };
  } catch (error) {
    const latencyMs = Date.now() - started;
    const msg = error instanceof Error ? error.message : "request_failed";
    return {
      status: "unavailable",
      enabled: true,
      endpoint,
      latencyMs,
      reason: msg === "timeout" ? "timeout" : "request_failed"
    };
  }
}
