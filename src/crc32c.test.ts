import assert from "node:assert/strict";
import { test } from "node:test";

import { crc32c } from "./crc32c.ts";

test("matches the CRC-32C check values", () => {
  assert.equal(crc32c(new TextEncoder().encode("123456789")), 0xe3069283);
  assert.equal(crc32c(new Uint8Array(32)), 0x8a9136aa);
  assert.equal(crc32c(new Uint8Array()), 0);
});
