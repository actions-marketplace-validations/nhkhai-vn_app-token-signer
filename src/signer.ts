import type { Fetch } from "./http.ts";

export interface Signer {
  signDigest(sha256: Uint8Array): Promise<Uint8Array>;
}

export interface SignerDeps {
  fetch: Fetch;
  env: NodeJS.ProcessEnv;
  readFile: (path: string) => Promise<string>;
  exec: (command: string, args: string[]) => Promise<string>;
  mask: (secret: string) => void;
  now: () => Date;
}
