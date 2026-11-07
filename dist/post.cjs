"use strict";

// src/errors.ts
function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

// src/json.ts
function object(value, what) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${what}: expected a JSON object`);
  }
  return value;
}
function string(value, key, what) {
  const field = value[key];
  if (typeof field !== "string" || field === "") throw new Error(`${what}: missing "${key}"`);
  return field;
}
function number(value, key, what) {
  const field = value[key];
  if (typeof field !== "number") throw new Error(`${what}: missing "${key}"`);
  return field;
}
function stringFields(value) {
  if (typeof value !== "object" || value === null) return {};
  return Object.fromEntries(
    Object.entries(value).filter((entry) => typeof entry[1] === "string")
  );
}

// src/http.ts
var timeoutSeconds = 10;
var HttpError = class extends Error {
  status;
  code;
  retryAfterMs;
  constructor(what, status, body, retryAfterMs2) {
    const reply = parseReply(body);
    super(`${what}: HTTP ${status}${reply.detail ? `: ${reply.detail}` : ""}`);
    this.status = status;
    this.code = reply.code;
    this.retryAfterMs = retryAfterMs2;
  }
};
var RequestTimeout = class extends Error {
  constructor(what) {
    super(`${what}: no response within ${timeoutSeconds} s`);
  }
};
async function requestText(fetchFn, what, url, init) {
  const failed = timedOut(what);
  const response = await fetchFn(url, { ...init, signal: AbortSignal.timeout(timeoutSeconds * 1e3) }).catch(failed);
  const text = await response.text().catch(failed);
  if (!response.ok) throw new HttpError(what, response.status, text, retryAfterMs(response.headers, Date.now()));
  return text;
}
async function requestJson(fetchFn, what, url, init) {
  const text = await requestText(fetchFn, what, url, init);
  return text === "" ? void 0 : JSON.parse(text);
}
function timedOut(what) {
  return (error) => {
    if (error instanceof DOMException && error.name === "TimeoutError") throw new RequestTimeout(what);
    throw error;
  };
}
function retryAfterMs(headers, now) {
  const at = retryAt(headers, now);
  return at === void 0 ? void 0 : Math.max(0, at - now);
}
function retryAt(headers, now) {
  const retryAfter = headers.get("retry-after");
  if (retryAfter !== null) {
    if (/^\d+$/.test(retryAfter)) return now + Number(retryAfter) * 1e3;
    const date = Date.parse(retryAfter);
    return Number.isNaN(date) ? void 0 : date;
  }
  const reset = headers.get("x-ratelimit-reset") ?? "";
  if (headers.get("x-ratelimit-remaining") !== "0" || !/^\d+$/.test(reset)) return void 0;
  return Number(reset) * 1e3;
}
function parseReply(body) {
  const reply = parseJson(body);
  const raw = { code: void 0, detail: body.slice(0, 500) };
  if (typeof reply !== "object" || reply === null || Array.isArray(reply)) return raw;
  const top = stringFields(reply);
  const nested = stringFields(reply.error);
  const code = top.__type?.replace(/^.*#|:.*$/g, "") ?? nested.status ?? nested.code ?? top.error;
  const message = nested.message ?? top.message ?? top.Message ?? top.error_description ?? listedErrors(reply.errors);
  const detail = [code, message].filter(Boolean).join(": ").replace(/\s+/g, " ").trim();
  return detail ? { code, detail } : raw;
}
function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return void 0;
  }
}
function listedErrors(errors) {
  if (!Array.isArray(errors)) return void 0;
  return errors.filter((error) => typeof error === "string").join("; ") || void 0;
}

// src/github.ts
var rejectedJwt = "GitHub rejected the App JWT: check that client-id is right and the key is one of the App's private keys";
function createGitHub(apiUrl, fetchFn) {
  const baseUrl = apiUrl.replace(/\/+$/, "");
  const call = (what, method, path, authorization, body) => requestJson(fetchFn, what, `${baseUrl}${path}`, {
    method,
    headers: {
      accept: "application/vnd.github+json",
      authorization,
      "user-agent": "app-token-signer",
      "x-github-api-version": "2022-11-28",
      ...body === void 0 ? {} : { "content-type": "application/json" }
    },
    ...body === void 0 ? {} : { body: JSON.stringify(body) }
  });
  return {
    async findInstallation(jwt, target) {
      try {
        const body = object(
          await call("find installation", "GET", installationPath(target), `Bearer ${jwt}`),
          "installation"
        );
        return { id: number(body, "id", "installation"), appSlug: string(body, "app_slug", "installation") };
      } catch (error) {
        throw explainInstallationError(error, target);
      }
    },
    async createToken(jwt, installationId, request) {
      const body = object(
        await call(
          "create installation token",
          "POST",
          `/app/installations/${installationId}/access_tokens`,
          `Bearer ${jwt}`,
          request
        ),
        "installation token"
      );
      return {
        token: string(body, "token", "installation token"),
        expiresAt: string(body, "expires_at", "installation token"),
        permissions: stringFields(body.permissions),
        repositories: Array.isArray(body.repositories) ? body.repositories.map(
          (repository) => string(object(repository, "repository"), "full_name", "repository")
        ) : []
      };
    },
    async revokeToken(token) {
      await call("revoke installation token", "DELETE", "/installation/token", `token ${token}`);
    }
  };
}
function installationPath(target) {
  switch (target.type) {
    case "repository":
      return `/repos/${encodeURIComponent(target.owner)}/${encodeURIComponent(target.repositories[0] ?? "")}/installation`;
    case "owner":
      return `/users/${encodeURIComponent(target.owner)}/installation`;
    case "enterprise":
      return `/enterprises/${encodeURIComponent(target.enterprise)}/installation`;
  }
}
function explainInstallationError(error, target) {
  if (!(error instanceof HttpError)) return error;
  if (error.status === 401) return new Error(`${rejectedJwt} (${error.message})`);
  if (error.status !== 404) return error;
  return new Error(`The App is not installed on ${describe(target)} (${error.message})`);
}
function describe(target) {
  switch (target.type) {
    case "repository":
      return `${target.owner}/${target.repositories[0] ?? ""}`;
    case "owner":
      return target.owner;
    case "enterprise":
      return `enterprise "${target.enterprise}"`;
  }
}

// src/runner.ts
var import_node_crypto = require("node:crypto");
var import_node_fs = require("node:fs");
function createRunner(env, write) {
  const getInput = (name) => (env[`INPUT_${name.replaceAll(" ", "_").toUpperCase()}`] ?? "").trim();
  const append = (fileVariable, name, value) => {
    const path = env[fileVariable];
    if (!path) throw new Error(`${fileVariable} is not set`);
    const delimiter = `ghadelimiter_${(0, import_node_crypto.randomUUID)()}`;
    (0, import_node_fs.appendFileSync)(path, `${name}<<${delimiter}
${value}
${delimiter}
`);
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
    }
  };
}
function escapeCommand(text) {
  return text.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A");
}

// src/post.ts
var runner = createRunner(process.env, (line) => process.stdout.write(`${line}
`));
async function run() {
  const token = runner.getState("token");
  if (!token) {
    runner.info("No token to revoke");
    return;
  }
  if (Date.parse(runner.getState("expiresAt")) <= Date.now()) {
    runner.info("Token already expired");
    return;
  }
  await createGitHub(runner.getInput("github-api-url"), fetch).revokeToken(token);
  runner.info("Token revoked");
}
run().catch((error) => runner.warning(`Token revocation failed: ${errorMessage(error)}`));
