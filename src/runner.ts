import { randomUUID } from "node:crypto";
import { appendFileSync } from "node:fs";

export interface Runner {
  getInput(name: string): string;
  getBooleanInput(name: string): boolean;
  getState(name: string): string;
  setOutput(name: string, value: string): void;
  saveState(name: string, value: string): void;
  setSecret(secret: string): void;
  info(message: string): void;
  warning(message: string): void;
  setFailed(message: string): void;
}

export function createRunner(env: NodeJS.ProcessEnv, write: (line: string) => void): Runner {
  const getInput = (name: string) => (env[`INPUT_${name.replaceAll(" ", "_").toUpperCase()}`] ?? "").trim();

  const append = (fileVariable: string, name: string, value: string) => {
    const path = env[fileVariable];
    if (!path) throw new Error(`${fileVariable} is not set`);
    const delimiter = `ghadelimiter_${randomUUID()}`;
    appendFileSync(path, `${name}<<${delimiter}\n${value}\n${delimiter}\n`);
  };

  return {
    getInput,
    getBooleanInput(name) {
      const value = getInput(name);
      if (["true", "True", "TRUE"].includes(value)) return true;
      if (["false", "False", "FALSE"].includes(value)) return false;
      throw new TypeError(`Input '${name}' must be one of: true | True | TRUE | false | False | FALSE`);
    },
    getState: (name) => env[`STATE_${name}`] ?? "",
    setOutput: (name, value) => append("GITHUB_OUTPUT", name, value),
    saveState: (name, value) => append("GITHUB_STATE", name, value),
    setSecret: (secret) => write(`::add-mask::${escapeCommand(secret)}`),
    info: (message) => write(message),
    warning: (message) => write(`::warning::${escapeCommand(message)}`),
    setFailed(message) {
      process.exitCode = 1;
      write(`::error::${escapeCommand(message)}`);
    },
  };
}

function escapeCommand(text: string): string {
  return text.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A");
}
