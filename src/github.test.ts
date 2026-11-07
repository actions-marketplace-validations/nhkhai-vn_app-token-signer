import assert from "node:assert/strict";
import { test } from "node:test";

import { createGitHub } from "./github.ts";
import { fakeFetch } from "./testing.ts";

const repository = { type: "repository" as const, owner: "acme", repositories: ["app"] };

test("uses a GitHub Enterprise Server API URL without a trailing slash", async () => {
  const server = fakeFetch(() => ({ body: { id: 1, app_slug: "a" } }));
  await createGitHub("https://ghe.example/api/v3/", server.fetch).findInstallation("jwt", repository);
  assert.equal(server.requests[0]?.url, "https://ghe.example/api/v3/repos/acme/app/installation");
});

test("finds an enterprise installation", async () => {
  const server = fakeFetch(() => ({ body: { id: 1, app_slug: "a" } }));
  await createGitHub("https://api.github.com", server.fetch).findInstallation("jwt", { type: "enterprise", enterprise: "corp" });
  assert.equal(server.requests[0]?.url, "https://api.github.com/enterprises/corp/installation");
});

test("explains a rejected JWT", async () => {
  const server = fakeFetch(() => ({ status: 401, body: { message: "A JSON web token could not be decoded" } }));
  await assert.rejects(createGitHub("https://api.github.com", server.fetch).findInstallation("jwt", repository), /rejected the App JWT/);
});

test("explains a missing installation", async () => {
  const server = fakeFetch(() => ({ status: 404, body: { message: "Not Found" } }));
  await assert.rejects(createGitHub("https://api.github.com", server.fetch).findInstallation("jwt", repository), /not installed on acme\/app/);
});

test("reads the granted repositories of a token", async () => {
  const server = fakeFetch(() => ({
    status: 201,
    body: { token: "ghs_x", expires_at: "2026-11-07T01:00:00Z", permissions: { contents: "read" }, repositories: [{ full_name: "acme/app" }] },
  }));
  const token = await createGitHub("https://api.github.com", server.fetch).createToken("jwt", 1, { repositories: ["app"] });
  assert.deepEqual(token.repositories, ["acme/app"]);
});

test("revokes a token with the token itself", async () => {
  const server = fakeFetch(() => ({ status: 204 }));
  await createGitHub("https://api.github.com", server.fetch).revokeToken("ghs_x");
  assert.equal(server.requests[0]?.method, "DELETE");
  assert.equal(server.requests[0]?.url, "https://api.github.com/installation/token");
  assert.equal(server.requests[0]?.headers.get("authorization"), "token ghs_x");
});
