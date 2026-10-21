import type { CommonConfig } from "@docomator/config";

const MAX_RESPONSE_BYTES = 65_536;

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LlmRequestOptions {
  config: CommonConfig;
  messages?: ChatMessage[] | undefined;
  systemPrompt?: string | undefined;
  userPrompt?: string | undefined;
  fetchImpl?: typeof fetch | undefined;
  maxTokens?: number | undefined;
}

export interface LlmCompletionResult {
  success: boolean;
  status: "completed" | "disabled" | "failed";
  content?: string | undefined;
  json?: Record<string, unknown> | null | undefined;
  model?: string | null | undefined;
  endpoint?: string | null | undefined;
  durationMs: number;
  error?: string | undefined;
}

export function endpointFor(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(String(value).trim());
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
      return null;
    }
    return url.href.replace(/\/+$/u, "").replace(/\/v1$/u, "");
  } catch {
    return null;
  }
}

export function extractJsonObject(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "string" || Buffer.byteLength(value) > MAX_RESPONSE_BYTES) return null;
  const text = value.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/u.exec(text);
  const target = fenced ? fenced[1]?.trim() ?? text : text;
  try {
    const parsed = JSON.parse(target);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    // If text contains a JSON object embedded inside explanations, try extracting it between first { and last }
    const firstBrace = target.indexOf("{");
    const lastBrace = target.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      try {
        const parsed = JSON.parse(target.slice(firstBrace, lastBrace + 1));
        return parsed && typeof parsed === "object" && !Array.isArray(parsed)
          ? (parsed as Record<string, unknown>)
          : null;
      } catch {
        return null;
      }
    }
    return null;
  }
}

function safeFailure(error: unknown): string {
  const err = error as { name?: string; code?: string; message?: string };
  const name = String(err?.name || "").toLowerCase();
  const code = String(err?.code || "").toLowerCase();
  if (name.includes("timeout") || name === "aborterror" || code.includes("timeout") || code === "abort_err") {
    return "llm_timeout";
  }
  const message = String(err?.message || "");
  if (/^llm_(?:http_\d+|invalid_json|invalid_response|response_too_large|invalid_endpoint)$/u.test(message)) {
    return message;
  }
  return "llm_request_failed";
}

export async function chatCompletionWithLlm(
  options: LlmRequestOptions
): Promise<LlmCompletionResult> {
  const started = Date.now();
  const { config, fetchImpl = globalThis.fetch } = options;

  if (!config.llmEnabled) {
    return {
      success: false,
      status: "disabled",
      durationMs: Date.now() - started,
      error: "llm_disabled"
    };
  }

  const endpoint = endpointFor(config.llmBaseUrl);
  if (!endpoint) {
    return {
      success: false,
      status: "failed",
      durationMs: Date.now() - started,
      error: "llm_invalid_endpoint"
    };
  }

  const messages: ChatMessage[] = options.messages
    ? [...options.messages]
    : [
        ...(options.systemPrompt ? [{ role: "system" as const, content: options.systemPrompt }] : []),
        ...(options.userPrompt ? [{ role: "user" as const, content: options.userPrompt }] : [])
      ];

  if (messages.length === 0) {
    return {
      success: false,
      status: "failed",
      durationMs: Date.now() - started,
      error: "llm_empty_prompt"
    };
  }

  try {
    const headers: Record<string, string> = {
      "content-type": "application/json",
      accept: "application/json"
    };
    if (config.llmApiKey) {
      headers.authorization = `Bearer ${config.llmApiKey}`;
    }

    const requestBody: Record<string, unknown> = {
      model: config.llmModel,
      messages,
      temperature: config.llmTemperature,
      response_format: { type: "json_object" }
    };
    if (options.maxTokens) {
      requestBody.max_tokens = options.maxTokens;
    }

    const timeoutMs = config.llmTimeoutMs || 30_000;
    const signal = AbortSignal.timeout(timeoutMs);

    const send = async (body: Record<string, unknown>) =>
      fetchImpl(`${endpoint}/v1/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal,
        redirect: "error"
      });

    let response = await send(requestBody);

    // If remote LLM rejects response_format (e.g. HTTP 400 or 422), retry once without it
    if ([400, 422].includes(response.status)) {
      await response.body?.cancel();
      delete requestBody.response_format;
      response = await send(requestBody);
    }

    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`llm_http_${response.status}`);
    }

    const text = await response.text();
    if (Buffer.byteLength(text) > MAX_RESPONSE_BYTES) {
      throw new Error("llm_response_too_large");
    }

    let payload: Record<string, unknown> | null = null;
    try {
      payload = JSON.parse(text);
    } catch {
      throw new Error("llm_invalid_response");
    }

    const choices = payload?.choices as Array<{
      message?: { content?: string };
      finish_reason?: string;
    }> | undefined;
    const content = choices?.[0]?.message?.content;

    if (typeof content !== "string") {
      throw new Error("llm_invalid_response");
    }

    const json = extractJsonObject(content);

    return {
      success: true,
      status: "completed",
      content,
      json,
      model: typeof payload?.model === "string" ? payload.model : config.llmModel,
      endpoint,
      durationMs: Date.now() - started
    };
  } catch (error) {
    return {
      success: false,
      status: "failed",
      endpoint,
      model: config.llmModel,
      durationMs: Date.now() - started,
      error: safeFailure(error)
    };
  }
}
