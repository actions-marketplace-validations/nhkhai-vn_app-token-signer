import { HttpError, RequestTimeout } from "./http.ts";

const retries = 3;
const longestWaitMs = 60_000;

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
      const delay = retryDelay(error, 1000 * 2 ** (attempt - 1));
      if (attempt > retries || delay === undefined) throw error;
      onRetry(error, attempt);
      await sleep(delay);
    }
  }
}

function retryDelay(error: unknown, backoff: number): number | undefined {
  if (error instanceof RequestTimeout) return backoff;
  if (error instanceof TypeError && error.message === "fetch failed") return backoff;
  if (!(error instanceof HttpError)) return undefined;
  const { status, retryAfterMs } = error;
  if (retryAfterMs !== undefined && retryAfterMs > longestWaitMs) return undefined;
  if (status >= 500 || status === 429) return retryAfterMs ?? backoff;
  return status === 403 ? retryAfterMs : undefined;
}
