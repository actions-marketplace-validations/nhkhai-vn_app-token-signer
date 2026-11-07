import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { promisify } from "node:util";

import { vaultTransitSigner } from "../src/backends/vault-transit.ts";
import { parseKey } from "../src/key.ts";
import { newTestKey, signDigestLocally } from "../src/testing.ts";

const run = promisify(execFile);
const address = process.env.VAULT_ADDR ?? "";
const token = process.env.VAULT_TOKEN ?? "";
const mount = `transit-${randomUUID()}`;
const digest = createHash("sha256").update("header.payload").digest();

let dir = "";

async function vault(method: string, path: string, body?: unknown): Promise<void> {
  const response = await fetch(`${address}/v1/${path}`, {
    method,
    headers: { "x-vault-token": token },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  assert.ok(response.ok, `${method} ${path}: HTTP ${response.status}`);
}

async function importKey(name: string, ...flags: string[]) {
  const key = newTestKey();
  const pem = join(dir, `${randomUUID()}.pem`);
  await writeFile(pem, key.privateKey.export({ type: "pkcs1", format: "pem" }));
  const { stdout } = await run("bash", ["scripts/import-vault.sh", ...flags, pem, mount, name]);
  const uri = /^key: (\S+)$/m.exec(stdout)?.[1] ?? "";
  return { key, pem, uri };
}

async function sign(uri: string): Promise<Uint8Array> {
  const key = parseKey(uri);
  if (key.backend !== "vault-transit") throw new Error(`expected a Vault key, got ${uri}`);
  return vaultTransitSigner(key, { fetch, env: process.env }).signDigest(digest);
}

before(async () => {
  assert.ok(address && token, "VAULT_ADDR and VAULT_TOKEN must point at a Vault dev server");
  dir = await mkdtemp(join(tmpdir(), "app-token-signer-"));
  await vault("POST", `sys/mounts/${mount}`, { type: "transit" });
});

after(async () => {
  await vault("DELETE", `sys/mounts/${mount}`);
  await rm(dir, { recursive: true, force: true });
});

test("an imported key signs exactly like the PEM it came from, then the PEM is deleted", async () => {
  const first = await importKey("app");
  assert.equal(first.uri, `vault-transit://${mount}/keys/app?version=1`);
  assert.deepEqual(await sign(first.uri), signDigestLocally(first.key.privateKey, digest));
  assert.equal(existsSync(first.pem), false);
});

test("a second import adds a version and leaves the first one signing", async () => {
  const second = await importKey("rotated", "--keep-pem");
  const third = await importKey("rotated", "--keep-pem");
  assert.equal(third.uri, `vault-transit://${mount}/keys/rotated?version=2`);
  assert.deepEqual(await sign(second.uri), signDigestLocally(second.key.privateKey, digest));
  assert.deepEqual(await sign(third.uri), signDigestLocally(third.key.privateKey, digest));
  assert.equal(existsSync(third.pem), true);
});
