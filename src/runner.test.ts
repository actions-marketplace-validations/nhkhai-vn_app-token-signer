import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { createRunner } from "./runner.ts";

function runner(env: NodeJS.ProcessEnv = {}) {
  const lines: string[] = [];
  return { lines, runner: createRunner(env, (line) => lines.push(line)) };
}

test("reads trimmed inputs by their upper-cased name", () => {
  const { runner: r } = runner({ "INPUT_CLIENT-ID": " Iv1.abc \n", "INPUT_SKIP-TOKEN-REVOKE": "True" });
  assert.equal(r.getInput("client-id"), "Iv1.abc");
  assert.equal(r.getInput("owner"), "");
  assert.equal(r.getBooleanInput("skip-token-revoke"), true);
});

test("rejects a boolean input that is not a YAML boolean", () => {
  const { runner: r } = runner({ "INPUT_SKIP-TOKEN-REVOKE": "yes" });
  assert.throws(() => r.getBooleanInput("skip-token-revoke"), /must be one of/);
});

test("writes outputs and state as delimited entries", () => {
  const dir = mkdtempSync(join(tmpdir(), "runner-"));
  const output = join(dir, "output");
  const state = join(dir, "state");
  writeFileSync(output, "");
  writeFileSync(state, "");
  const { runner: r } = runner({ GITHUB_OUTPUT: output, GITHUB_STATE: state, STATE_token: "saved" });

  r.setOutput("token", "ghs_x");
  r.saveState("expiresAt", "2026-11-07T01:00:00Z");

  assert.match(readFileSync(output, "utf8"), /^token<<(ghadelimiter_[0-9a-f-]+)\nghs_x\n\1\n$/);
  assert.match(readFileSync(state, "utf8"), /^expiresAt<<(ghadelimiter_[0-9a-f-]+)\n2026-11-07T01:00:00Z\n\1\n$/);
  assert.equal(r.getState("token"), "saved");
});

test("fails loudly when the runner gave no output file", () => {
  const { runner: r } = runner();
  assert.throws(() => r.setOutput("token", "ghs_x"), /GITHUB_OUTPUT is not set/);
});

test("escapes workflow commands so a multi-line secret is masked whole", () => {
  const { runner: r, lines } = runner();
  r.setSecret("a%b\r\nc");
  r.warning("line 1\nline 2");
  assert.deepEqual(lines, ["::add-mask::a%25b%0D%0Ac", "::warning::line 1%0Aline 2"]);
});

test("marks the step failed", () => {
  const { runner: r, lines } = runner();
  r.setFailed("boom");
  assert.equal(process.exitCode, 1);
  process.exitCode = 0;
  assert.deepEqual(lines, ["::error::boom"]);
});
