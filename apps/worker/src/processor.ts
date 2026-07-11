import { clearInterval, setInterval } from "node:timers";

import {
  LostWorkerJobLeaseError,
  WorkerQueue,
  type JsonValue,
  type WorkerJob
} from "@docomator/storage";

export interface JobHandlerContext {
  job: WorkerJob;
  signal: AbortSignal;
}

export type JobHandler = (context: JobHandlerContext) => Promise<void>;

export class PermanentJobError extends Error {}

export class JobHandlerRegistry {
  private readonly handlers = new Map<string, JobHandler>();

  register(jobType: string, handler: JobHandler): void {
    const normalized = jobType.trim();
    if (normalized.length === 0) {
      throw new TypeError("jobType must not be empty");
    }
    if (this.handlers.has(normalized)) {
      throw new Error(`Job handler is already registered: ${normalized}`);
    }
    this.handlers.set(normalized, handler);
  }

  get(jobType: string): JobHandler | undefined {
    return this.handlers.get(jobType);
  }
}

export type ProcessNextJobResult =
  | { status: "idle" }
  | {
      status: "completed" | "retry" | "dead_letter" | "lease_lost";
      job: WorkerJob;
    };

export interface ProcessNextJobOptions {
  queue: WorkerQueue;
  handlers: JobHandlerRegistry;
  workerId: string;
  leaseDurationMs: number;
  retryBaseMs: number;
  retryMaxMs: number;
  signal: AbortSignal;
  now?: () => Date;
}

function errorToJson(error: unknown): JsonValue {
  if (error instanceof Error) {
    const details: { [key: string]: JsonValue } = {
      name: error.name,
      message: error.message
    };
    if (error.stack !== undefined) {
      details.stack = error.stack;
    }
    return details;
  }
  if (
    error === null ||
    typeof error === "string" ||
    typeof error === "number" ||
    typeof error === "boolean"
  ) {
    return error;
  }
  return { name: "NonErrorThrow", message: String(error) };
}

export function computeRetryDelayMs(
  attempts: number,
  baseMilliseconds: number,
  maxMilliseconds: number
): number {
  const exponent = Math.max(0, Math.min(attempts - 1, 30));
  return Math.min(maxMilliseconds, baseMilliseconds * 2 ** exponent);
}

export async function processNextJob(
  options: ProcessNextJobOptions
): Promise<ProcessNextJobResult> {
  const now = options.now ?? (() => new Date());
  const claimed = options.queue.claimNext({
    workerId: options.workerId,
    leaseDurationMs: options.leaseDurationMs,
    now: now()
  });
  if (claimed === null) {
    return { status: "idle" };
  }

  let leaseLost = false;
  const renewalIntervalMs = Math.max(100, Math.floor(options.leaseDurationMs / 3));
  const renewalTimer = setInterval(() => {
    try {
      const renewed = options.queue.renewLease(
        claimed.id,
        options.workerId,
        options.leaseDurationMs,
        now()
      );
      if (!renewed) {
        leaseLost = true;
      }
    } catch {
      leaseLost = true;
    }
  }, renewalIntervalMs);
  renewalTimer.unref();

  try {
    const handler = options.handlers.get(claimed.jobType);
    if (handler === undefined) {
      throw new PermanentJobError(`No handler is registered for job type: ${claimed.jobType}`);
    }

    await handler({ job: claimed, signal: options.signal });
    if (leaseLost) {
      return { status: "lease_lost", job: claimed };
    }

    const completed = options.queue.complete(claimed.id, options.workerId, now());
    return { status: "completed", job: completed };
  } catch (error) {
    if (leaseLost || error instanceof LostWorkerJobLeaseError) {
      return { status: "lease_lost", job: claimed };
    }

    const retryable = !(error instanceof PermanentJobError);
    const failureTime = now();
    const delay = computeRetryDelayMs(
      claimed.attempts,
      options.retryBaseMs,
      options.retryMaxMs
    );
    try {
      const failed = options.queue.fail({
        jobId: claimed.id,
        workerId: options.workerId,
        error: errorToJson(error),
        retryable,
        retryAt: new Date(failureTime.getTime() + delay),
        now: failureTime
      });
      return {
        status: failed.state === "retry" ? "retry" : "dead_letter",
        job: failed
      };
    } catch (failureError) {
      if (failureError instanceof LostWorkerJobLeaseError) {
        return { status: "lease_lost", job: claimed };
      }
      throw failureError;
    }
  } finally {
    clearInterval(renewalTimer);
  }
}
