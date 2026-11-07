import { type JsonObject, stringFields } from "./json.ts";

export type Fetch = typeof fetch;

const timeoutSeconds = 10;

export class HttpError extends Error {
  readonly status: number;
  readonly code: string | undefined;
  readonly retryAfterMs: number | undefined;

  constructor(what: string, status: number, body: string, retryAfterMs?: number) {
    const reply = parseReply(body);
    super(`${what}: HTTP ${status}${reply.detail ? `: ${reply.detail}` : ""}`);
    this.status = status;
    this.code = reply.code;
    this.retryAfterMs = retryAfterMs;
  }
}

export class RequestTimeout extends Error {
  constructor(what: string) {
    super(`${what}: no response within ${timeoutSeconds} s`);
  }
}

const proxyVariables = ["https_proxy", "HTTPS_PROXY", "http_proxy", "HTTP_PROXY"];

export function assertProxySupport(env: NodeJS.ProcessEnv): void {
  if (!proxyVariables.some((name) => env[name])) return;
  if (env.NODE_USE_ENV_PROXY === "1") return;
  throw new Error("A proxy variable is set but Node.js proxy support is off; set NODE_USE_ENV_PROXY=1 on this step");
}

export async function requestText(fetchFn: Fetch, what: string, url: string, init: RequestInit): Promise<string> {
  const failed = timedOut(what);
  const response = await fetchFn(url, { ...init, signal: AbortSignal.timeout(timeoutSeconds * 1000) }).catch(failed);
  const text = await response.text().catch(failed);
  if (!response.ok) throw new HttpError(what, response.status, text, retryAfterMs(response.headers, Date.now()));
  return text;
}

export async function requestJson(fetchFn: Fetch, what: string, url: string, init: RequestInit): Promise<unknown> {
  const text = await requestText(fetchFn, what, url, init);
  return text === "" ? undefined : JSON.parse(text);
}

function timedOut(what: string): (error: unknown) => never {
  return (error) => {
    if (error instanceof DOMException && error.name === "TimeoutError") throw new RequestTimeout(what);
    throw error;
  };
}

export function retryAfterMs(headers: Headers, now: number): number | undefined {
  const at = retryAt(headers, now);
  return at === undefined ? undefined : Math.max(0, at - now);
}

function retryAt(headers: Headers, now: number): number | undefined {
  const retryAfter = headers.get("retry-after");
  if (retryAfter !== null) {
    if (/^\d+$/.test(retryAfter)) return now + Number(retryAfter) * 1000;
    const date = Date.parse(retryAfter);
    return Number.isNaN(date) ? undefined : date;
  }
  const reset = headers.get("x-ratelimit-reset") ?? "";
  if (headers.get("x-ratelimit-remaining") !== "0" || !/^\d+$/.test(reset)) return undefined;
  return Number(reset) * 1000;
}

interface Reply {
  code: string | undefined;
  detail: string;
}

function parseReply(body: string): Reply {
  const reply = parseJson(body);
  const raw = { code: undefined, detail: body.slice(0, 500) };
  if (typeof reply !== "object" || reply === null || Array.isArray(reply)) return raw;
  const top = stringFields(reply);
  const nested = stringFields((reply as JsonObject).error);
  const code = top.__type?.replace(/^.*#|:.*$/g, "") ?? nested.status ?? nested.code ?? top.error;
  const message =
    nested.message ?? top.message ?? top.Message ?? top.error_description ?? listedErrors((reply as JsonObject).errors);
  const detail = [code, message].filter(Boolean).join(": ").replace(/\s+/g, " ").trim();
  return detail ? { code, detail } : raw;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function listedErrors(errors: unknown): string | undefined {
  if (!Array.isArray(errors)) return undefined;
  return errors.filter((error) => typeof error === "string").join("; ") || undefined;
}
