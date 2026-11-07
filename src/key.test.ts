import assert from "node:assert/strict";
import { test } from "node:test";

import { parseKey } from "./key.ts";

test("parses a GCP Cloud KMS key version", () => {
  const name = "projects/p/locations/global/keyRings/r/cryptoKeys/k/cryptoKeyVersions/3";
  assert.deepEqual(parseKey(`gcp-kms://${name}`), { backend: "gcp-kms", name });
});

test("rejects a GCP key without a version", () => {
  assert.throws(() => parseKey("gcp-kms://projects/p/locations/global/keyRings/r/cryptoKeys/k"), /cryptoKeyVersions/);
});

test("parses an AWS key ARN and derives the regional endpoint", () => {
  const arn = "arn:aws:kms:eu-west-1:123456789012:key/1234abcd-12ab-34cd-56ef-1234567890ab";
  assert.deepEqual(parseKey(`aws-kms://${arn}`), {
    backend: "aws-kms",
    arn,
    region: "eu-west-1",
    host: "kms.eu-west-1.amazonaws.com",
  });
});

test("parses an AWS alias ARN in the China partition", () => {
  const key = parseKey("aws-kms://arn:aws-cn:kms:cn-north-1:123456789012:alias/app-token");
  assert.equal(key.backend === "aws-kms" && key.host, "kms.cn-north-1.amazonaws.com.cn");
});

test("rejects an AWS key ID without an ARN", () => {
  assert.throws(() => parseKey("aws-kms://1234abcd-12ab-34cd-56ef-1234567890ab"), /arn:aws:kms/);
});

test("parses an Azure Key Vault key and derives the token resource from the host", () => {
  assert.deepEqual(parseKey("azure-kv://my-vault.vault.azure.net/keys/app/0123abcd"), {
    backend: "azure-kv",
    keyUrl: "https://my-vault.vault.azure.net/keys/app/0123abcd",
    resource: "https://vault.azure.net",
  });
});

test("derives the token resource for a sovereign cloud vault", () => {
  const key = parseKey("azure-kv://my-vault.vault.azure.cn/keys/app/0123abcd");
  assert.equal(key.backend === "azure-kv" && key.resource, "https://vault.azure.cn");
});

test("rejects an Azure key without a version", () => {
  assert.throws(() => parseKey("azure-kv://my-vault.vault.azure.net/keys/app"), /VERSION/);
});

test("parses a Vault Transit key on a nested mount with a version", () => {
  assert.deepEqual(parseKey("vault-transit://team/transit/keys/app?version=2"), {
    backend: "vault-transit",
    mount: "team/transit",
    name: "app",
    version: 2,
  });
});

test("leaves the Vault version unset when it is not given", () => {
  const key = parseKey("vault-transit://transit/keys/app");
  assert.equal(key.backend === "vault-transit" && key.version, undefined);
});

test("rejects a Vault key with a non-numeric version", () => {
  assert.throws(() => parseKey("vault-transit://transit/keys/app?version=latest"), /positive integer/);
});

test("rejects a Vault key without a mount", () => {
  assert.throws(() => parseKey("vault-transit://keys/app"), /MOUNT/);
});

test("rejects an unknown scheme", () => {
  assert.throws(() => parseKey("file:///tmp/key.pem"), /expected a gcp-kms/);
});
