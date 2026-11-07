import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";

import { base64url, fromBase64 } from "../encoding.ts";
import { fakeFetch, newTestKey, signDigestLocally } from "../testing.ts";
import { azureKeyVaultSigner } from "./azure-key-vault.ts";

const { privateKey } = newTestKey();
const digest = createHash("sha256").update("input").digest();
const key = {
  backend: "azure-kv" as const,
  keyUrl: "https://v.vault.azure.net/keys/app/abc",
  resource: "https://vault.azure.net",
};

function keyVault() {
  return fakeFetch(({ body }) => ({
    body: { value: base64url(signDigestLocally(privateKey, fromBase64(JSON.parse(body).value))) },
  }));
}

test("gets a Key Vault token from az and signs with RS256", async () => {
  const server = keyVault();
  const commands: string[][] = [];
  const masked: string[] = [];
  const exec = async (command: string, args: string[]) => {
    commands.push([command, ...args]);
    return "vault-token\n";
  };
  const signature = await azureKeyVaultSigner(key, {
    fetch: server.fetch,
    exec,
    mask: (secret) => masked.push(secret),
  }).signDigest(digest);

  assert.deepEqual(commands, [
    [
      "az",
      "account",
      "get-access-token",
      "--resource",
      "https://vault.azure.net",
      "--query",
      "accessToken",
      "--output",
      "tsv",
    ],
  ]);
  assert.deepEqual(masked, ["vault-token"]);
  const request = server.requests[0];
  assert.equal(request?.url, "https://v.vault.azure.net/keys/app/abc/sign?api-version=7.4");
  assert.equal(request?.headers.get("authorization"), "Bearer vault-token");
  assert.deepEqual(JSON.parse(request?.body ?? ""), { alg: "RS256", value: base64url(digest) });
  assert.deepEqual(signature, signDigestLocally(privateKey, digest));
});

test("fails clearly when az has no session", async () => {
  const signer = azureKeyVaultSigner(key, { fetch: keyVault().fetch, exec: async () => "", mask: () => {} });
  await assert.rejects(signer.signDigest(digest), /run azure\/login first/);
});
