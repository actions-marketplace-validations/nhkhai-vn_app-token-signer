import assert from "node:assert/strict";
import { test } from "node:test";

import { resolveTarget } from "./target.ts";

const env = { GITHUB_REPOSITORY: "acme/app", GITHUB_REPOSITORY_OWNER: "acme" };
const none = { enterprise: "", owner: "", repositories: [] };

test("defaults to the current repository", () => {
  assert.deepEqual(resolveTarget(none, env), { type: "repository", owner: "acme", repositories: ["app"] });
});

test("targets every repository of an owner when only owner is set", () => {
  assert.deepEqual(resolveTarget({ ...none, owner: "other" }, env), { type: "owner", owner: "other" });
});

test("scopes to repositories of the current owner when owner is unset", () => {
  assert.deepEqual(resolveTarget({ ...none, repositories: ["a", "acme/b"] }, env), {
    type: "repository",
    owner: "acme",
    repositories: ["a", "b"],
  });
});

test("matches repository owners case-insensitively", () => {
  const target = resolveTarget({ ...none, owner: "Other", repositories: ["other/a"] }, env);
  assert.deepEqual(target, { type: "repository", owner: "Other", repositories: ["a"] });
});

test("rejects a repository owned by someone else", () => {
  assert.throws(() => resolveTarget({ ...none, repositories: ["other/a"] }, env), /does not match/);
});

test("rejects a malformed repository", () => {
  assert.throws(() => resolveTarget({ ...none, repositories: ["a/b/c"] }, env), /Invalid repository/);
});

test("targets an enterprise", () => {
  assert.deepEqual(resolveTarget({ ...none, enterprise: "corp" }, env), { type: "enterprise", enterprise: "corp" });
});

test("rejects enterprise together with owner", () => {
  assert.throws(() => resolveTarget({ ...none, enterprise: "corp", owner: "acme" }, env), /Cannot use 'enterprise'/);
});

test("fails when the runner did not set the repository", () => {
  assert.throws(() => resolveTarget(none, {}), /GITHUB_REPOSITORY is not set/);
});
