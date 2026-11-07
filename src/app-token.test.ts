import assert from "node:assert/strict";
import { verify } from "node:crypto";
import { test } from "node:test";

import { mintAppToken } from "./app-token.ts";
import { createGitHub } from "./github.ts";
import { fakeFetch, localSigner, newTestKey } from "./testing.ts";

const { privateKey, publicKey } = newTestKey();
const now = new Date("2026-11-07T00:00:00Z");

function github() {
  return fakeFetch(({ url }) =>
    url.endsWith("/installation")
      ? { body: { id: 42, app_slug: "my-app" } }
      : { status: 201, body: { token: "ghs_x", expires_at: "2026-11-07T01:00:00Z", permissions: { contents: "read" } } },
  );
}

function decode(part: string): unknown {
  return JSON.parse(Buffer.from(part, "base64url").toString());
}

test("signs an RS256 App JWT that verifies with the App's public key", async () => {
  const server = github();
  const masked: string[] = [];
  const target = { type: "repository" as const, owner: "acme", repositories: ["app"] };
  await mintAppToken({ clientId: "Iv1.abc", target, permissions: undefined }, localSigner(privateKey), createGitHub("https://api.github.com", server.fetch), (secret) => masked.push(secret), now);

  const jwt = server.requests[0]?.headers.get("authorization")?.replace("Bearer ", "") ?? "";
  const [header = "", payload = "", signature = ""] = jwt.split(".");
  assert.deepEqual(decode(header), { alg: "RS256", typ: "JWT" });
  assert.deepEqual(decode(payload), { iat: 1794009540, exp: 1794010140, iss: "Iv1.abc" });
  assert.ok(verify("sha256", Buffer.from(`${header}.${payload}`), publicKey, Buffer.from(signature, "base64url")));
  assert.deepEqual(masked, [jwt, "ghs_x"]);
});

test("scopes the token to the target repositories and the requested permissions", async () => {
  const server = github();
  const token = await mintAppToken(
    { clientId: "Iv1.abc", target: { type: "repository", owner: "acme", repositories: ["a", "b"] }, permissions: { contents: "read" } },
    localSigner(privateKey),
    createGitHub("https://api.github.com", server.fetch),
    () => {},
    now,
  );

  assert.equal(server.requests[0]?.url, "https://api.github.com/repos/acme/a/installation");
  assert.equal(server.requests[1]?.url, "https://api.github.com/app/installations/42/access_tokens");
  assert.deepEqual(JSON.parse(server.requests[1]?.body ?? ""), { repositories: ["a", "b"], permissions: { contents: "read" } });
  assert.deepEqual(token, {
    token: "ghs_x",
    expiresAt: "2026-11-07T01:00:00Z",
    permissions: { contents: "read" },
    repositories: [],
    installationId: 42,
    appSlug: "my-app",
  });
});

test("requests every repository of the installation for an owner target", async () => {
  const server = github();
  await mintAppToken({ clientId: "Iv1.abc", target: { type: "owner", owner: "acme" }, permissions: undefined }, localSigner(privateKey), createGitHub("https://api.github.com", server.fetch), () => {}, now);

  assert.equal(server.requests[0]?.url, "https://api.github.com/users/acme/installation");
  assert.equal(server.requests[1]?.body, "{}");
});
