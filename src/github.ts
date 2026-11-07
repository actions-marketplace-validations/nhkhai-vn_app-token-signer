import { type Fetch, HttpError, requestJson } from "./http.ts";
import { type JsonObject, number, object, string } from "./json.ts";
import type { Target } from "./target.ts";

export interface Installation {
  id: number;
  appSlug: string;
}

export interface TokenRequest {
  repositories?: string[];
  permissions?: Record<string, string>;
}

export interface InstallationToken {
  token: string;
  expiresAt: string;
  permissions: Record<string, string>;
  repositories: string[];
}

export interface GitHub {
  findInstallation(jwt: string, target: Target): Promise<Installation>;
  createToken(jwt: string, installationId: number, request: TokenRequest): Promise<InstallationToken>;
  revokeToken(token: string): Promise<void>;
}

const rejectedJwt =
  "GitHub rejected the App JWT: check that client-id is right and the key is one of the App's private keys";

export function createGitHub(apiUrl: string, fetchFn: Fetch): GitHub {
  const baseUrl = apiUrl.replace(/\/+$/, "");

  const call = (what: string, method: string, path: string, authorization: string, body?: unknown) =>
    requestJson(fetchFn, what, `${baseUrl}${path}`, {
      method,
      headers: {
        accept: "application/vnd.github+json",
        authorization,
        "user-agent": "app-token-signer",
        "x-github-api-version": "2022-11-28",
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

  return {
    async findInstallation(jwt, target) {
      try {
        const body = object(await call("find installation", "GET", installationPath(target), `Bearer ${jwt}`), "installation");
        return { id: number(body, "id", "installation"), appSlug: string(body, "app_slug", "installation") };
      } catch (error) {
        throw explainInstallationError(error, target);
      }
    },

    async createToken(jwt, installationId, request) {
      const body = object(
        await call("create installation token", "POST", `/app/installations/${installationId}/access_tokens`, `Bearer ${jwt}`, request),
        "installation token",
      );
      return {
        token: string(body, "token", "installation token"),
        expiresAt: string(body, "expires_at", "installation token"),
        permissions: stringRecord(body.permissions),
        repositories: Array.isArray(body.repositories)
          ? body.repositories.map((repository: unknown) => string(object(repository, "repository"), "full_name", "repository"))
          : [],
      };
    },

    async revokeToken(token) {
      await call("revoke installation token", "DELETE", "/installation/token", `token ${token}`);
    },
  };
}

function installationPath(target: Target): string {
  switch (target.type) {
    case "repository":
      return `/repos/${encodeURIComponent(target.owner)}/${encodeURIComponent(target.repositories[0] ?? "")}/installation`;
    case "owner":
      return `/users/${encodeURIComponent(target.owner)}/installation`;
    case "enterprise":
      return `/enterprises/${encodeURIComponent(target.enterprise)}/installation`;
  }
}

function explainInstallationError(error: unknown, target: Target): unknown {
  if (!(error instanceof HttpError)) return error;
  if (error.status === 401) return new Error(`${rejectedJwt} (${error.message})`);
  if (error.status !== 404) return error;
  return new Error(`The App is not installed on ${describe(target)} (${error.message})`);
}

function describe(target: Target): string {
  switch (target.type) {
    case "repository":
      return `${target.owner}/${target.repositories[0] ?? ""}`;
    case "owner":
      return target.owner;
    case "enterprise":
      return `enterprise "${target.enterprise}"`;
  }
}

function stringRecord(value: unknown): Record<string, string> {
  if (typeof value !== "object" || value === null) return {};
  return Object.fromEntries(Object.entries(value as JsonObject).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
}
