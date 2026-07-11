import assert from "node:assert/strict";
import test from "node:test";

import { runWorkerLoop } from "./loop.js";

test("worker loop stops after abort", async () => {
  const controller = new AbortController();
  let polls = 0;
  let heartbeats = 0;
  let clock = 0;

  await runWorkerLoop({
    pollIntervalMs: 1,
    heartbeatIntervalMs: 10,
    signal: controller.signal,
    now: () => {
      clock += 10;
      return clock;
    },
    onHeartbeat: () => {
      heartbeats += 1;
    },
    onPoll: async () => {
      polls += 1;
      if (polls === 2) {
        controller.abort();
      }
    }
  });

  assert.equal(polls, 2);
  assert.equal(heartbeats, 2);
});
