export type Fetch = typeof fetch;

export class HttpError extends Error {
  readonly status: number;

  constructor(what: string, status: number, body: string) {
    super(`${what}: HTTP ${status}${body ? `: ${body}` : ""}`);
    this.status = status;
  }
}

const proxyVariables = ["https_proxy", "HTTPS_PROXY", "http_proxy", "HTTP_PROXY"];

export function assertProxySupport(env: NodeJS.ProcessEnv): void {
  if (!proxyVariables.some((name) => env[name])) return;
  if (env.NODE_USE_ENV_PROXY === "1") return;
  throw new Error("A proxy variable is set but Node.js proxy support is off; set NODE_USE_ENV_PROXY=1 on this step");
}

export async function requestText(fetchFn: Fetch, what: string, url: string, init: RequestInit): Promise<string> {
  const response = await fetchFn(url, init);
  const text = await response.text();
  if (!response.ok) throw new HttpError(what, response.status, text.slice(0, 500));
  return text;
}

export async function requestJson(fetchFn: Fetch, what: string, url: string, init: RequestInit): Promise<unknown> {
  const text = await requestText(fetchFn, what, url, init);
  return text === "" ? undefined : JSON.parse(text);
}
