import assert from "node:assert/strict";
import { test } from "node:test";

import { HttpError } from "./http.ts";
import { withRetry } from "./retry.ts";

const noSleep = async () => {};

test("retries a server error and returns the later success", async () => {
  let calls = 0;
  const result = await withRetry(
    async () => {
      calls++;
      if (calls < 3) throw new HttpError("call", 502, "");
      return "ok";
    },
    () => {},
    noSleep,
  );
  assert.equal(result, "ok");
  assert.equal(calls, 3);
});

test("retries a network failure", async () => {
  let calls = 0;
  await withRetry(
    async () => {
      calls++;
      if (calls === 1) throw new TypeError("fetch failed");
    },
    () => {},
    noSleep,
  );
  assert.equal(calls, 2);
});

test("does not retry a client error", async () => {
  let calls = 0;
  const failing = withRetry(
    async () => {
      calls++;
      throw new HttpError("call", 401, "");
    },
    () => {},
    noSleep,
  );
  await assert.rejects(failing, /HTTP 401/);
  assert.equal(calls, 1);
});

test("gives up after three retries with growing delays", async () => {
  const delays: number[] = [];
  const failing = withRetry(
    async () => {
      throw new HttpError("call", 500, "");
    },
    () => {},
    async (milliseconds) => {
      delays.push(milliseconds);
    },
  );
  await assert.rejects(failing, /HTTP 500/);
  assert.deepEqual(delays, [1000, 2000, 4000]);
});
