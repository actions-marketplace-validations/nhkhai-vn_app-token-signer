import assert from "node:assert/strict";
import { test } from "node:test";

import { assertProxySupport, RequestTimeout, requestText } from "./http.ts";

test("accepts no proxy", () => {
  assertProxySupport({});
});

test("accepts a proxy when Node.js proxy support is on", () => {
  assertProxySupport({ HTTPS_PROXY: "http://proxy:3128", NODE_USE_ENV_PROXY: "1" });
});

test("rejects a proxy that fetch would silently ignore", () => {
  assert.throws(() => assertProxySupport({ https_proxy: "http://proxy:3128" }), /NODE_USE_ENV_PROXY=1/);
});

test("gives every request a deadline and names the call that missed it", async () => {
  let signal: AbortSignal | null | undefined;
  const hung = requestText(
    async (_url, init) => {
      signal = init?.signal;
      throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
    },
    "sign with Vault Transit",
    "https://vault.example/v1/transit/sign/app",
    { method: "POST" },
  );
  await assert.rejects(hung, (error: unknown) => {
    assert.ok(error instanceof RequestTimeout);
    assert.match(error.message, /^sign with Vault Transit: no response within 10 s$/);
    return true;
  });
  assert.ok(signal instanceof AbortSignal);
});
