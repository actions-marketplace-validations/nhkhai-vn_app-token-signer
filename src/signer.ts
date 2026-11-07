import { type Fetch, HttpError } from "./http.ts";

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

export function explainRefusal(
  hint: string,
  isRefusal: (error: HttpError) => boolean = (error) => error.status === 403,
): (error: unknown) => never {
  return (error) => {
    if (error instanceof HttpError && isRefusal(error)) throw new Error(`${error.message}; ${hint}`);
    throw error;
  };
}
