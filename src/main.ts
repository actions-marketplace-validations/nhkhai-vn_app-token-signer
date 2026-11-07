import { readFile } from "node:fs/promises";

import { type AppToken, mintAppToken } from "./app-token.ts";
import { createSigner } from "./backends/index.ts";
import { errorMessage } from "./errors.ts";
import { exec } from "./exec.ts";
import { createGitHub } from "./github.ts";
import { assertProxySupport } from "./http.ts";
import { readInputs } from "./inputs.ts";
import { withRetry } from "./retry.ts";
import { createRunner } from "./runner.ts";

const runner = createRunner(process.env, (line) => process.stdout.write(`${line}\n`));

function describe(token: AppToken): string {
  const repositories = token.repositories.length > 0 ? token.repositories.join(", ") : "all of the installation";
  const permissions = Object.entries(token.permissions)
    .map(([name, level]) => `${name}=${level}`)
    .join(", ");
  return `Token for installation ${token.installationId} (${token.appSlug}) expires ${token.expiresAt}. Repositories: ${repositories}. Permissions: ${permissions}.`;
}

async function run(): Promise<void> {
  assertProxySupport(process.env);
  const inputs = readInputs(runner, process.env);
  const signer = createSigner(inputs.key, {
    fetch,
    env: process.env,
    readFile: (path) => readFile(path, "utf8"),
    exec,
    mask: runner.setSecret,
    now: () => new Date(),
  });
  const github = createGitHub(inputs.apiUrl, fetch);
  const token = await withRetry(
    () => mintAppToken(inputs, signer, github, runner.setSecret, new Date()),
    (error, attempt) => runner.info(`Attempt ${attempt} failed, retrying: ${errorMessage(error)}`),
  );

  runner.setOutput("token", token.token);
  runner.setOutput("installation-id", String(token.installationId));
  runner.setOutput("app-slug", token.appSlug);
  runner.info(describe(token));
  if (inputs.skipTokenRevoke) return;
  runner.saveState("token", token.token);
  runner.saveState("expiresAt", token.expiresAt);
}

run().catch((error: unknown) => runner.setFailed(errorMessage(error)));
