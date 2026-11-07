import assert from "node:assert/strict";
import { test } from "node:test";

import { assertProxySupport, HttpError, RequestTimeout, requestText } from "./http.ts";

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

test("reads the code and message of each service's JSON error reply", () => {
  const replies: [unknown, string, string | undefined][] = [
    [{ message: "Bad credentials", documentation_url: "https://docs.github.com" }, "Bad credentials", undefined],
    [
      {
        error: {
          code: 403,
          message: "Permission 'cloudkms.cryptoKeyVersions.useToSign' denied",
          status: "PERMISSION_DENIED",
        },
      },
      "PERMISSION_DENIED: Permission 'cloudkms.cryptoKeyVersions.useToSign' denied",
      "PERMISSION_DENIED",
    ],
    [
      { error: "invalid_grant", error_description: "The audience does not match" },
      "invalid_grant: The audience does not match",
      "invalid_grant",
    ],
    [
      { __type: "com.amazonaws.kms#AccessDeniedException", message: "User is not authorized to perform: kms:Sign" },
      "AccessDeniedException: User is not authorized to perform: kms:Sign",
      "AccessDeniedException",
    ],
    [
      { error: { code: "Forbidden", message: "Caller is not authorized" } },
      "Forbidden: Caller is not authorized",
      "Forbidden",
    ],
    [{ errors: ["1 error occurred:\n\t* permission denied\n\n"] }, "1 error occurred: * permission denied", undefined],
  ];
  for (const [reply, detail, code] of replies) {
    const error = new HttpError("call", 403, JSON.stringify(reply));
    assert.equal(error.message, `call: HTTP 403: ${detail}`);
    assert.equal(error.code, code);
  }
});

test("keeps a long JSON error message whole", () => {
  const message = "x".repeat(800);
  assert.equal(new HttpError("call", 400, JSON.stringify({ message })).message, `call: HTTP 400: ${message}`);
});

test("cuts a reply that is not JSON", () => {
  const error = new HttpError("call", 502, `<html>${"x".repeat(800)}</html>`);
  assert.equal(error.message, `call: HTTP 502: <html>${"x".repeat(494)}`);
  assert.equal(error.code, undefined);
});
