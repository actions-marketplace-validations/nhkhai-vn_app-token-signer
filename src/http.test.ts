import assert from "node:assert/strict";
import { test } from "node:test";

import { assertProxySupport } from "./http.ts";

test("accepts no proxy", () => {
  assertProxySupport({});
});

test("accepts a proxy when Node.js proxy support is on", () => {
  assertProxySupport({ HTTPS_PROXY: "http://proxy:3128", NODE_USE_ENV_PROXY: "1" });
});

test("rejects a proxy that fetch would silently ignore", () => {
  assert.throws(() => assertProxySupport({ https_proxy: "http://proxy:3128" }), /NODE_USE_ENV_PROXY=1/);
});
