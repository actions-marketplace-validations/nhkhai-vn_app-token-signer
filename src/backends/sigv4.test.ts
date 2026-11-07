import assert from "node:assert/strict";
import { test } from "node:test";

import { signV4 } from "./sigv4.ts";

const example = { accessKeyId: "AKIDEXAMPLE", secretAccessKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY" };

test("matches the AWS SigV4 test suite get-vanilla case", () => {
  const headers = signV4(
    { method: "GET", host: "example.amazonaws.com", headers: {}, body: "", service: "service", region: "us-east-1" },
    { ...example, sessionToken: undefined },
    new Date("2015-08-30T12:36:00Z"),
  );
  assert.equal(
    headers.authorization,
    "AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, SignedHeaders=host;x-amz-date, Signature=5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31",
  );
  assert.equal(headers["x-amz-date"], "20150830T123600Z");
  assert.equal("host" in headers, false);
});

test("matches botocore for a KMS Sign call with a session token", () => {
  const body = JSON.stringify({
    KeyId: "arn:aws:kms:eu-west-1:123456789012:key/k",
    Message: "AAAA",
    MessageType: "DIGEST",
    SigningAlgorithm: "RSASSA_PKCS1_V1_5_SHA_256",
  });
  const headers = signV4(
    {
      method: "POST",
      host: "kms.eu-west-1.amazonaws.com",
      headers: { "content-type": "application/x-amz-json-1.1", "x-amz-target": "TrentService.Sign" },
      body,
      service: "kms",
      region: "eu-west-1",
    },
    { ...example, sessionToken: "session-token" },
    new Date("2026-11-07T01:02:03Z"),
  );
  assert.equal(
    headers.authorization,
    "AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20261107/eu-west-1/kms/aws4_request, SignedHeaders=content-type;host;x-amz-date;x-amz-security-token;x-amz-target, Signature=52142eec58b89c9397041738bd52df23ad7f1e28a46fc3a60fe5cbb2b8d74bab",
  );
  assert.equal(headers["x-amz-security-token"], "session-token");
});
