import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";

import { base64, fromBase64 } from "../encoding.ts";
import { fakeFetch, newTestKey, signDigestLocally } from "../testing.ts";
import { vaultTransitSigner } from "./vault-transit.ts";

const { privateKey } = newTestKey();
const digest = createHash("sha256").update("input").digest();
const env = { VAULT_ADDR: "https://vault.example:8200/", VAULT_TOKEN: "hvs.x", VAULT_NAMESPACE: "team" };

function vault() {
  return fakeFetch(({ body }) => {
    const input = fromBase64(JSON.parse(body).input);
    return { body: { data: { signature: `vault:v2:${base64(signDigestLocally(privateKey, input))}` } } };
  });
}

test("signs the digest with PKCS#1 v1.5 and strips the version prefix", async () => {
  const server = vault();
  const key = { backend: "vault-transit" as const, mount: "team/transit", name: "app", version: 2 };
  const signature = await vaultTransitSigner(key, { fetch: server.fetch, env }).signDigest(digest);

  const request = server.requests[0];
  assert.equal(request?.url, "https://vault.example:8200/v1/team/transit/sign/app/sha2-256");
  assert.equal(request?.headers.get("x-vault-token"), "hvs.x");
  assert.equal(request?.headers.get("x-vault-namespace"), "team");
  assert.deepEqual(JSON.parse(request?.body ?? ""), {
    input: base64(digest),
    prehashed: true,
    signature_algorithm: "pkcs1v15",
    key_version: 2,
  });
  assert.deepEqual(signature, signDigestLocally(privateKey, digest));
});

test("lets Vault pick the latest version when none is given", async () => {
  const server = vault();
  const key = { backend: "vault-transit" as const, mount: "transit", name: "app", version: undefined };
  await vaultTransitSigner(key, {
    fetch: server.fetch,
    env: { VAULT_ADDR: "http://127.0.0.1:8200", VAULT_TOKEN: "root" },
  }).signDigest(digest);
  assert.equal("key_version" in JSON.parse(server.requests[0]?.body ?? ""), false);
  assert.equal(server.requests[0]?.headers.has("x-vault-namespace"), false);
});

test("requires the Vault address and token", async () => {
  const key = { backend: "vault-transit" as const, mount: "transit", name: "app", version: undefined };
  await assert.rejects(
    vaultTransitSigner(key, { fetch: vault().fetch, env: {} }).signDigest(digest),
    /VAULT_ADDR and VAULT_TOKEN/,
  );
});
