import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";

import { base64, fromBase64 } from "../encoding.ts";
import { fakeFetch, newTestKey, signDigestLocally } from "../testing.ts";
import { awsKmsSigner } from "./aws-kms.ts";

const { privateKey } = newTestKey();
const digest = createHash("sha256").update("input").digest();
const key = {
  backend: "aws-kms" as const,
  arn: "arn:aws:kms:eu-west-1:123456789012:key/k",
  region: "eu-west-1",
  host: "kms.eu-west-1.amazonaws.com",
};
const env = { AWS_ACCESS_KEY_ID: "AKIDEXAMPLE", AWS_SECRET_ACCESS_KEY: "secret", AWS_SESSION_TOKEN: "session" };
const now = () => new Date("2026-11-07T01:02:03Z");

function kms() {
  return fakeFetch(({ body }) => ({
    body: { Signature: base64(signDigestLocally(privateKey, fromBase64(JSON.parse(body).Message))) },
  }));
}

test("signs the digest as a PKCS#1 v1.5 SHA-256 message digest", async () => {
  const server = kms();
  const signature = await awsKmsSigner(key, { fetch: server.fetch, env, now }).signDigest(digest);

  const request = server.requests[0];
  assert.equal(request?.url, "https://kms.eu-west-1.amazonaws.com/");
  assert.equal(request?.headers.get("x-amz-target"), "TrentService.Sign");
  assert.match(
    request?.headers.get("authorization") ?? "",
    /^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\/20261107\/eu-west-1\/kms\/aws4_request, /,
  );
  assert.equal(request?.headers.get("x-amz-security-token"), "session");
  assert.deepEqual(JSON.parse(request?.body ?? ""), {
    KeyId: key.arn,
    Message: base64(digest),
    MessageType: "DIGEST",
    SigningAlgorithm: "RSASSA_PKCS1_V1_5_SHA_256",
  });
  assert.deepEqual(signature, signDigestLocally(privateKey, digest));
});

test("requires configure-aws-credentials to have run", async () => {
  await assert.rejects(awsKmsSigner(key, { fetch: kms().fetch, env: {}, now }).signDigest(digest), /AWS_ACCESS_KEY_ID/);
});
