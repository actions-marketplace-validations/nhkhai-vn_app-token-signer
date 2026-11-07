import assert from "node:assert/strict";
import { test } from "node:test";

import { type InputSource, readInputs } from "./inputs.ts";

const key = "vault-transit://transit/keys/app";
const env = { GITHUB_REPOSITORY: "acme/app", GITHUB_REPOSITORY_OWNER: "acme" };

function source(values: Record<string, string>): InputSource {
  return {
    getInput: (name) => values[name] ?? "",
    getBooleanInput: (name) => values[name] === "true",
  };
}

test("reads client-id, key, repositories and the API URL", () => {
  const inputs = readInputs(
    source({ "client-id": "Iv1.abc", key, repositories: "a,\n b ,", "github-api-url": "https://ghe.example/api/v3" }),
    env,
  );
  assert.equal(inputs.clientId, "Iv1.abc");
  assert.equal(inputs.key.backend, "vault-transit");
  assert.deepEqual(inputs.target, { type: "repository", owner: "acme", repositories: ["a", "b"] });
  assert.equal(inputs.apiUrl, "https://ghe.example/api/v3");
  assert.equal(inputs.skipTokenRevoke, false);
});

test("falls back to the deprecated app-id", () => {
  assert.equal(readInputs(source({ "app-id": "123", key }), env).clientId, "123");
});

test("requires a client ID", () => {
  assert.throws(() => readInputs(source({ key }), env), /client-id/);
});

test("requires a key", () => {
  assert.throws(() => readInputs(source({ "client-id": "Iv1.abc" }), env), /'key'/);
});

test("collects permission inputs from the environment", () => {
  const inputs = readInputs(source({ "client-id": "Iv1.abc", key }), {
    ...env,
    "INPUT_PERMISSION-CONTENTS": "read",
    "INPUT_PERMISSION-PULL-REQUESTS": "write",
    "INPUT_PERMISSION-ISSUES": "",
  });
  assert.deepEqual(inputs.permissions, { contents: "read", pull_requests: "write" });
});

test("inherits the App's permissions when no permission input is set", () => {
  assert.equal(readInputs(source({ "client-id": "Iv1.abc", key }), env).permissions, undefined);
});
