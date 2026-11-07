export type Target =
  | { type: "repository"; owner: string; repositories: string[] }
  | { type: "owner"; owner: string }
  | { type: "enterprise"; enterprise: string };

export interface TargetInputs {
  enterprise: string;
  owner: string;
  repositories: string[];
}

export function resolveTarget(inputs: TargetInputs, env: NodeJS.ProcessEnv): Target {
  if (inputs.enterprise) {
    if (inputs.owner || inputs.repositories.length > 0) {
      throw new Error("Cannot use 'enterprise' input with 'owner' or 'repositories' inputs");
    }
    return { type: "enterprise", enterprise: inputs.enterprise };
  }
  if (inputs.owner && inputs.repositories.length === 0) return { type: "owner", owner: inputs.owner };
  if (inputs.repositories.length === 0) return currentRepository(env);

  const owner = inputs.owner || required(env, "GITHUB_REPOSITORY_OWNER");
  return { type: "repository", owner, repositories: inputs.repositories.map((input) => repositoryName(input, owner)) };
}

function currentRepository(env: NodeJS.ProcessEnv): Target {
  const [owner = "", repository = ""] = required(env, "GITHUB_REPOSITORY").split("/");
  return { type: "repository", owner, repositories: [repository] };
}

function repositoryName(input: string, owner: string): string {
  const parts = input.split("/");
  const [first = "", second = ""] = parts;
  if (parts.length === 1 && first) return first;
  if (parts.length !== 2 || !first || !second) {
    throw new Error(`Invalid repository '${input}'. Expected 'repository' or 'owner/repository'.`);
  }
  if (first.toLowerCase() !== owner.toLowerCase()) {
    throw new Error(
      `Repository '${input}' includes owner '${first}', which does not match the resolved owner '${owner}'.`,
    );
  }
  return second;
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}
