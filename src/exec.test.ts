import assert from "node:assert/strict";
import { test } from "node:test";

import { exec } from "./exec.ts";

test("returns what the command prints", async () => {
  assert.match(await exec("node", ["--version"]), /^v\d+/);
});

test("stops a command that hangs", async () => {
  await assert.rejects(exec("sleep", ["5"], 0.2), /^Error: sleep 5 gave no answer within 0.2 s$/);
});

test("refuses an argument the shell would interpret", async () => {
  await assert.rejects(exec("az", ["account", "show;", "rm"]), /az: unsafe argument/);
});
