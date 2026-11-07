import { HttpError } from "./http.ts";

const retries = 3;

export type Sleep = (milliseconds: number) => Promise<void>;

const wait: Sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export async function withRetry<T>(
  run: () => Promise<T>,
  onRetry: (error: unknown, attempt: number) => void,
  sleep: Sleep = wait,
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await run();
    } catch (error) {
      if (attempt > retries || !isTransient(error)) throw error;
      onRetry(error, attempt);
      await sleep(1000 * 2 ** (attempt - 1));
    }
  }
}

function isTransient(error: unknown): boolean {
  if (error instanceof HttpError) return error.status >= 500;
  return error instanceof TypeError && error.message === "fetch failed";
}
