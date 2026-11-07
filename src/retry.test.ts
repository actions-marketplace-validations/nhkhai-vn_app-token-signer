import assert from "node:assert/strict";
import { test } from "node:test";

import { HttpError, RequestTimeout } from "./http.ts";
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

test("retries a request that timed out", async () => {
  let calls = 0;
  await withRetry(
    async () => {
      calls++;
      if (calls === 1) throw new RequestTimeout("call");
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

test("retries a 429 after the time the server asks for", async () => {
  const delays: number[] = [];
  let calls = 0;
  await withRetry(
    async () => {
      calls++;
      if (calls === 1) throw new HttpError("call", 429, "", 7000);
      if (calls === 2) throw new HttpError("call", 429, "");
    },
    () => {},
    async (milliseconds) => {
      delays.push(milliseconds);
    },
  );
  assert.deepEqual(delays, [7000, 2000]);
});

test("retries a GitHub rate limit, which comes back as 403 with a wait", async () => {
  const delays: number[] = [];
  let calls = 0;
  await withRetry(
    async () => {
      calls++;
      if (calls === 1) throw new HttpError("call", 403, "", 30_000);
    },
    () => {},
    async (milliseconds) => {
      delays.push(milliseconds);
    },
  );
  assert.deepEqual(delays, [30_000]);
});

test("does not retry a 403 without a wait", async () => {
  let calls = 0;
  const failing = withRetry(
    async () => {
      calls++;
      throw new HttpError("call", 403, "");
    },
    () => {},
    noSleep,
  );
  await assert.rejects(failing, /HTTP 403/);
  assert.equal(calls, 1);
});

test("fails at once when the server asks to wait more than a minute", async () => {
  let calls = 0;
  const failing = withRetry(
    async () => {
      calls++;
      throw new HttpError("call", 429, "", 61_000);
    },
    () => {},
    noSleep,
  );
  await assert.rejects(failing, /HTTP 429/);
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
