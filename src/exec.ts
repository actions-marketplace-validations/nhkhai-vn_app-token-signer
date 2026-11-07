import { exec as execCommand } from "node:child_process";

const shellSafe = /^[\w.:/-]+$/;

export function exec(command: string, args: string[], timeoutSeconds = 60): Promise<string> {
  const words = [command, ...args];
  if (!words.every((word) => shellSafe.test(word))) return Promise.reject(new Error(`${command}: unsafe argument`));
  const what = `${command} ${args.slice(0, 2).join(" ")}`;
  return new Promise((resolve, reject) => {
    // Through a shell because Windows runners install CLIs as .cmd shims, which Node will not start directly.
    execCommand(words.join(" "), { timeout: timeoutSeconds * 1000 }, (error, stdout, stderr) => {
      if (!error) resolve(stdout);
      else if (error.killed) reject(new Error(`${what} gave no answer within ${timeoutSeconds} s`));
      else reject(new Error(`${what} failed: ${stderr.trim() || error.message}`));
    });
  });
}
