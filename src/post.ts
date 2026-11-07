import { errorMessage } from "./errors.ts";
import { createGitHub } from "./github.ts";
import { createRunner } from "./runner.ts";

const runner = createRunner(process.env, (line) => process.stdout.write(`${line}\n`));

async function run(): Promise<void> {
  const token = runner.getState("token");
  if (!token) {
    runner.info("No token to revoke");
    return;
  }
  if (Date.parse(runner.getState("expiresAt")) <= Date.now()) {
    runner.info("Token already expired");
    return;
  }
  await createGitHub(runner.getInput("github-api-url"), fetch).revokeToken(token);
  runner.info("Token revoked");
}

run().catch((error: unknown) => runner.warning(`Token revocation failed: ${errorMessage(error)}`));
