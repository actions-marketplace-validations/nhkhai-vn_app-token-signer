import { type KeyRef, parseKey } from "./key.ts";
import { resolveTarget, type Target } from "./target.ts";

export interface InputSource {
  getInput(name: string): string;
  getBooleanInput(name: string): boolean;
}

export interface Inputs {
  clientId: string;
  key: KeyRef;
  target: Target;
  permissions: Record<string, string> | undefined;
  skipTokenRevoke: boolean;
  apiUrl: string;
}

const permissionPrefix = "INPUT_PERMISSION-";

export function readInputs(source: InputSource, env: NodeJS.ProcessEnv): Inputs {
  const clientId = source.getInput("client-id") || source.getInput("app-id");
  if (!clientId) throw new Error("The 'client-id' (or deprecated 'app-id') input must be set");
  const key = source.getInput("key");
  if (!key) throw new Error("The 'key' input must be set");

  const repositories = source
    .getInput("repositories")
    .split(/[\n,]+/)
    .map((repository) => repository.trim())
    .filter((repository) => repository !== "");

  return {
    clientId,
    key: parseKey(key),
    target: resolveTarget(
      { enterprise: source.getInput("enterprise"), owner: source.getInput("owner"), repositories },
      env,
    ),
    permissions: readPermissions(env),
    skipTokenRevoke: source.getBooleanInput("skip-token-revoke"),
    apiUrl: source.getInput("github-api-url"),
  };
}

function readPermissions(env: NodeJS.ProcessEnv): Record<string, string> | undefined {
  const entries = Object.entries(env)
    .filter(([name, value]) => name.startsWith(permissionPrefix) && value)
    .map(([name, value]) => [name.slice(permissionPrefix.length).toLowerCase().replaceAll("-", "_"), value]);
  return entries.length === 0 ? undefined : Object.fromEntries(entries);
}
