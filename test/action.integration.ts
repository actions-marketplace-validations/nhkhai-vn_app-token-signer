import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID, verify } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { promisify } from "node:util";

import { newTestKey } from "../src/testing.ts";

const run = promisify(execFile);
const vaultAddress = process.env.VAULT_ADDR ?? "";
const vaultToken = process.env.VAULT_TOKEN ?? "";
const mount = `transit-${randomUUID()}`;
const { privateKey, publicKey } = newTestKey();
const revoked: string[] = [];

let dir = "";
let server: Server;
let apiUrl = "";
let key = "";

function validJwt(authorization: string | undefined): boolean {
  const [header = "", payload = "", signature = ""] = (authorization ?? "").replace("Bearer ", "").split(".");
  return verify("sha256", Buffer.from(`${header}.${payload}`), publicKey, Buffer.from(signature, "base64url"));
}

function fakeGitHub(): Server {
  return createServer((request, response) => {
    const send = (status: number, body?: unknown) => {
      response.writeHead(status, { "content-type": "application/json" });
      response.end(body === undefined ? undefined : JSON.stringify(body));
    };
    if (request.method === "DELETE" && request.url === "/installation/token") {
      revoked.push(request.headers.authorization ?? "");
      return send(204);
    }
    if (!validJwt(request.headers.authorization)) return send(401, { message: "bad JWT" });
    if (request.url === "/repos/acme/app/installation") return send(200, { id: 7, app_slug: "test-app" });
    if (request.url === "/app/installations/7/access_tokens") {
      return send(201, {
        token: "ghs_minted",
        expires_at: new Date(Date.now() + 3_600_000).toISOString(),
        permissions: { contents: "read" },
      });
    }
    send(404, { message: "Not Found" });
  });
}

async function vault(method: string, path: string, body?: unknown): Promise<void> {
  const response = await fetch(`${vaultAddress}/v1/${path}`, {
    method,
    headers: { "x-vault-token": vaultToken },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  assert.ok(response.ok, `${method} ${path}: HTTP ${response.status}`);
}

function action(entry: string, env: Record<string, string>) {
  return run("node", [`dist/${entry}.cjs`], { env: { PATH: process.env.PATH ?? "", ...env } });
}

before(async () => {
  assert.ok(vaultAddress && vaultToken, "VAULT_ADDR and VAULT_TOKEN must point at a Vault dev server");
  dir = await mkdtemp(join(tmpdir(), "app-token-signer-"));
  server = fakeGitHub();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  apiUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  await vault("POST", `sys/mounts/${mount}`, { type: "transit" });
  const pem = join(dir, "app.pem");
  await writeFile(pem, privateKey.export({ type: "pkcs1", format: "pem" }));
  const { stdout } = await run("bash", ["scripts/import-vault.sh", pem, mount, "app"]);
  key = /^key: (\S+)$/m.exec(stdout)?.[1] ?? "";
});

after(async () => {
  server.close();
  await vault("DELETE", `sys/mounts/${mount}`);
  await rm(dir, { recursive: true, force: true });
});

test("the built action mints a masked token with a Vault-held key and the post step revokes it", async () => {
  const output = join(dir, "output");
  const state = join(dir, "state");
  await writeFile(output, "");
  await writeFile(state, "");

  const main = await action("main", {
    "INPUT_CLIENT-ID": "Iv1.test",
    INPUT_KEY: key,
    "INPUT_GITHUB-API-URL": apiUrl,
    "INPUT_SKIP-TOKEN-REVOKE": "false",
    "INPUT_PERMISSION-CONTENTS": "read",
    GITHUB_REPOSITORY: "acme/app",
    GITHUB_REPOSITORY_OWNER: "acme",
    GITHUB_OUTPUT: output,
    GITHUB_STATE: state,
    VAULT_ADDR: vaultAddress,
    VAULT_TOKEN: vaultToken,
  });

  assert.match(main.stdout, /^::add-mask::ghs_minted$/m);
  assert.match(main.stdout, /Token for installation 7 \(test-app\)/);
  assert.equal(main.stdout.replace("::add-mask::ghs_minted", "").includes("ghs_minted"), false);
  assert.match(await readFile(output, "utf8"), /^token<<(\S+)\nghs_minted\n\1\n/m);

  const saved = Object.fromEntries(
    [...(await readFile(state, "utf8")).matchAll(/^(\w+)<<(\S+)\n(.*)\n\2$/gm)].map(([, name = "", , value = ""]) => [
      `STATE_${name}`,
      value,
    ]),
  );
  const post = await action("post", { ...saved, "INPUT_GITHUB-API-URL": apiUrl });

  assert.match(post.stdout, /Token revoked/);
  assert.deepEqual(revoked, ["token ghs_minted"]);
});
