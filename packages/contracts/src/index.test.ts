import assert from "node:assert/strict";
import test from "node:test";

import { SERVICE_NAMES } from "./index.js";

test("service contract contains the bootstrap processes", () => {
  assert.deepEqual(SERVICE_NAMES, ["api", "worker"]);
});
