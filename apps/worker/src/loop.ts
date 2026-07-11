import { setTimeout as sleep } from "node:timers/promises";

export interface WorkerLoopOptions {
  pollIntervalMs: number;
  heartbeatIntervalMs: number;
  signal: AbortSignal;
  onPoll: () => Promise<void>;
  onHeartbeat: () => void;
  now?: () => number;
}

export async function runWorkerLoop(options: WorkerLoopOptions): Promise<void> {
  const now = options.now ?? Date.now;
  let nextHeartbeat = now();

  while (!options.signal.aborted) {
    await options.onPoll();

    const currentTime = now();
    if (currentTime >= nextHeartbeat) {
      options.onHeartbeat();
      nextHeartbeat = currentTime + options.heartbeatIntervalMs;
    }

    try {
      await sleep(options.pollIntervalMs, undefined, { signal: options.signal });
    } catch (error) {
      if (options.signal.aborted) {
        break;
      }
      throw error;
    }
  }
}
