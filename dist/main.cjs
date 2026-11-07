"use strict";

// src/main.ts
var import_node_child_process = require("node:child_process");
var import_promises = require("node:fs/promises");

// src/jwt.ts
var import_node_crypto = require("node:crypto");

// src/encoding.ts
function base64(bytes) {
  return Buffer.from(bytes).toString("base64");
}
function base64url(bytes) {
  return Buffer.from(bytes).toString("base64url");
}
function fromBase64(text) {
  return new Uint8Array(Buffer.from(text, "base64"));
}

// src/jwt.ts
var header = base64url(Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })));
async function createAppJwt(clientId, signer, now) {
  const issuedAt = Math.floor(now.getTime() / 1e3) - 60;
  const payload = base64url(Buffer.from(JSON.stringify({ iat: issuedAt, exp: issuedAt + 600, iss: clientId })));
  const signingInput = `${header}.${payload}`;
  const signature = await signer.signDigest((0, import_node_crypto.createHash)("sha256").update(signingInput).digest());
  return `${signingInput}.${base64url(signature)}`;
}

// src/app-token.ts
async function mintAppToken(request, signer, github, mask, now) {
  const jwt = await createAppJwt(request.clientId, signer, now);
  mask(jwt);
  const installation = await github.findInstallation(jwt, request.target);
  const token = await github.createToken(jwt, installation.id, tokenRequest(request));
  mask(token.token);
  return { ...token, installationId: installation.id, appSlug: installation.appSlug };
}
function tokenRequest({ target, permissions }) {
  return {
    ...target.type === "repository" ? { repositories: target.repositories } : {},
    ...permissions === void 0 ? {} : { permissions }
  };
}

// src/http.ts
var HttpError = class extends Error {
  status;
  constructor(what, status, body) {
    super(`${what}: HTTP ${status}${body ? `: ${body}` : ""}`);
    this.status = status;
  }
};
var proxyVariables = ["https_proxy", "HTTPS_PROXY", "http_proxy", "HTTP_PROXY"];
function assertProxySupport(env) {
  if (!proxyVariables.some((name) => env[name])) return;
  if (env.NODE_USE_ENV_PROXY === "1") return;
  throw new Error("A proxy variable is set but Node.js proxy support is off; set NODE_USE_ENV_PROXY=1 on this step");
}
async function requestText(fetchFn, what, url, init) {
  const response = await fetchFn(url, init);
  const text = await response.text();
  if (!response.ok) throw new HttpError(what, response.status, text.slice(0, 500));
  return text;
}
async function requestJson(fetchFn, what, url, init) {
  const text = await requestText(fetchFn, what, url, init);
  return text === "" ? void 0 : JSON.parse(text);
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

// src/backends/sigv4.ts
var import_node_crypto2 = require("node:crypto");
function signV4(request, credentials2, now) {
  const timestamp = now.toISOString().replace(/[-:]|\.\d{3}/g, "");
  const date = timestamp.slice(0, 8);
  const sent = {
    ...request.headers,
    "x-amz-date": timestamp,
    ...credentials2.sessionToken ? { "x-amz-security-token": credentials2.sessionToken } : {}
  };
  const headers = { ...sent, host: request.host };
  const names = Object.keys(headers).sort();
  const signedHeaders = names.join(";");
  const canonicalHeaders = names.map((name) => `${name}:${(headers[name] ?? "").trim()}
`).join("");
  const canonicalRequest = [request.method, "/", "", canonicalHeaders, signedHeaders, sha256Hex(request.body)].join(
    "\n"
  );
  const scope2 = `${date}/${request.region}/${request.service}/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", timestamp, scope2, sha256Hex(canonicalRequest)].join("\n");
  const signingKey = [date, request.region, request.service, "aws4_request"].reduce(
    (key, part) => hmac(key, part),
    Buffer.from(`AWS4${credentials2.secretAccessKey}`)
  );
  return {
    ...sent,
    authorization: `AWS4-HMAC-SHA256 Credential=${credentials2.accessKeyId}/${scope2}, SignedHeaders=${signedHeaders}, Signature=${hmac(signingKey, stringToSign).toString("hex")}`
  };
}
function sha256Hex(text) {
  return (0, import_node_crypto2.createHash)("sha256").update(text).digest("hex");
}
function hmac(key, text) {
  return (0, import_node_crypto2.createHmac)("sha256", key).update(text).digest();
}

// src/backends/aws-kms.ts
function awsKmsSigner(key, { fetch: fetch2, env, now }) {
  return {
    async signDigest(digest) {
      const body = JSON.stringify({
        KeyId: key.arn,
        Message: base64(digest),
        MessageType: "DIGEST",
        SigningAlgorithm: "RSASSA_PKCS1_V1_5_SHA_256"
      });
      const headers = signV4(
        {
          method: "POST",
          host: key.host,
          headers: { "content-type": "application/x-amz-json-1.1", "x-amz-target": "TrentService.Sign" },
          body,
          service: "kms",
          region: key.region
        },
        credentials(env),
        now()
      );
      const response = object(
        await requestJson(fetch2, "sign with AWS KMS", `https://${key.host}/`, { method: "POST", headers, body }),
        "AWS KMS response"
      );
      return fromBase64(string(response, "Signature", "AWS KMS response"));
    }
  };
}
function credentials(env) {
  const accessKeyId = env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = env.AWS_SECRET_ACCESS_KEY;
  if (!accessKeyId || !secretAccessKey) {
    throw new Error(
      "AWS: AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY are not set; run aws-actions/configure-aws-credentials first"
    );
  }
  return { accessKeyId, secretAccessKey, sessionToken: env.AWS_SESSION_TOKEN };
}

// src/backends/azure-key-vault.ts
function azureKeyVaultSigner(key, deps) {
  return {
    async signDigest(digest) {
      const token = await accessToken(key.resource, deps);
      const response = object(
        await requestJson(deps.fetch, "sign with Azure Key Vault", `${key.keyUrl}/sign?api-version=7.4`, {
          method: "POST",
          headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
          body: JSON.stringify({ alg: "RS256", value: base64url(digest) })
        }),
        "Azure Key Vault response"
      );
      return fromBase64(string(response, "value", "Azure Key Vault response"));
    }
  };
}
async function accessToken(resource, { exec: exec2, mask }) {
  const token = (await exec2("az", [
    "account",
    "get-access-token",
    "--resource",
    resource,
    "--query",
    "accessToken",
    "--output",
    "tsv"
  ])).trim();
  if (!token) throw new Error("Azure: az returned no access token; run azure/login first");
  mask(token);
  return token;
}

// src/backends/gcp-kms.ts
var scope = "https://www.googleapis.com/auth/cloud-platform";
function gcpKmsSigner(key, deps) {
  return {
    async signDigest(digest) {
      const token = await accessToken2(deps);
      const body = object(
        await requestJson(
          deps.fetch,
          "sign with GCP Cloud KMS",
          `https://cloudkms.googleapis.com/v1/${key.name}:asymmetricSign`,
          {
            method: "POST",
            headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
            body: JSON.stringify({ digest: { sha256: base64(digest) } })
          }
        ),
        "GCP Cloud KMS response"
      );
      return fromBase64(string(body, "signature", "GCP Cloud KMS response"));
    }
  };
}
async function accessToken2(deps) {
  const path = deps.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!path) throw new Error("GCP: GOOGLE_APPLICATION_CREDENTIALS is not set; run google-github-actions/auth first");
  const credentials2 = object(JSON.parse(await deps.readFile(path)), "GCP credentials");
  if (credentials2.type !== "external_account") {
    throw new Error(
      `GCP: credentials of type "${String(credentials2.type)}" are not supported; use workload identity federation`
    );
  }
  const subjectToken = await readSubjectToken(object(credentials2.credential_source, "GCP credential_source"), deps);
  deps.mask(subjectToken);
  const federated = object(
    await requestJson(
      deps.fetch,
      "exchange the GCP federated token",
      string(credentials2, "token_url", "GCP credentials"),
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
          audience: string(credentials2, "audience", "GCP credentials"),
          scope,
          requested_token_type: "urn:ietf:params:oauth:token-type:access_token",
          subject_token: subjectToken,
          subject_token_type: string(credentials2, "subject_token_type", "GCP credentials")
        })
      }
    ),
    "GCP STS response"
  );
  const federatedToken = string(federated, "access_token", "GCP STS response");
  deps.mask(federatedToken);
  const impersonationUrl = credentials2.service_account_impersonation_url;
  if (typeof impersonationUrl !== "string") return federatedToken;
  const impersonated = object(
    await requestJson(deps.fetch, "impersonate the GCP service account", impersonationUrl, {
      method: "POST",
      headers: { authorization: `Bearer ${federatedToken}`, "content-type": "application/json" },
      body: JSON.stringify({ scope: [scope] })
    }),
    "GCP impersonation response"
  );
  const token = string(impersonated, "accessToken", "GCP impersonation response");
  deps.mask(token);
  return token;
}
async function readSubjectToken(source, deps) {
  const raw = typeof source.file === "string" ? await deps.readFile(source.file) : await requestText(deps.fetch, "read the OIDC token for GCP", string(source, "url", "GCP credential_source"), {
    headers: stringFields(source.headers)
  });
  const format = typeof source.format === "object" && source.format !== null ? source.format : {};
  if (format.type !== "json") return raw.trim();
  return string(
    object(JSON.parse(raw), "OIDC token response"),
    string(format, "subject_token_field_name", "GCP credential_source format"),
    "OIDC token response"
  );
}

// src/backends/vault-transit.ts
function vaultTransitSigner(key, { fetch: fetch2, env }) {
  return {
    async signDigest(digest) {
      const address = env.VAULT_ADDR?.replace(/\/+$/, "");
      const token = env.VAULT_TOKEN;
      if (!address || !token) {
        throw new Error(
          "Vault: VAULT_ADDR and VAULT_TOKEN must be set (hashicorp/vault-action exports the token with exportToken: true)"
        );
      }
      const body = object(
        await requestJson(fetch2, "sign with Vault Transit", `${address}/v1/${key.mount}/sign/${key.name}/sha2-256`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-vault-token": token,
            ...env.VAULT_NAMESPACE ? { "x-vault-namespace": env.VAULT_NAMESPACE } : {}
          },
          body: JSON.stringify({
            input: base64(digest),
            prehashed: true,
            // Vault defaults RSA signatures to PSS, which GitHub rejects.
            signature_algorithm: "pkcs1v15",
            ...key.version === void 0 ? {} : { key_version: key.version }
          })
        }),
        "Vault response"
      );
      const signature = string(object(body.data, "Vault response data"), "signature", "Vault response data");
      return fromBase64(signature.replace(/^vault:v\d+:/, ""));
    }
  };
}

// src/backends/index.ts
function createSigner(key, deps) {
  switch (key.backend) {
    case "gcp-kms":
      return gcpKmsSigner(key, deps);
    case "aws-kms":
      return awsKmsSigner(key, deps);
    case "azure-kv":
      return azureKeyVaultSigner(key, deps);
    case "vault-transit":
      return vaultTransitSigner(key, deps);
  }
}

// src/errors.ts
function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
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

// src/key.ts
var gcpName = /^projects\/[^/]+\/locations\/[^/]+\/keyRings\/[^/]+\/cryptoKeys\/[^/]+\/cryptoKeyVersions\/[^/]+$/;
var awsArn = /^arn:(aws|aws-cn|aws-us-gov):kms:([a-z0-9-]+):\d{12}:(?:key|alias)\/[^/\s]+$/;
var azurePath = /^([a-z0-9-]+)\.([a-z0-9-]+(?:\.[a-z0-9-]+)+)\/keys\/([^/]+)\/([^/]+)$/i;
var vaultName = /^[^/?#\s]+$/;
function parseKey(uri) {
  const separator = uri.indexOf("://");
  const scheme = separator < 0 ? "" : uri.slice(0, separator);
  const rest = uri.slice(separator + 3);
  switch (scheme) {
    case "gcp-kms":
      return parseGcp(rest);
    case "aws-kms":
      return parseAws(rest);
    case "azure-kv":
      return parseAzure(rest);
    case "vault-transit":
      return parseVault(rest);
    default:
      throw new Error(`key "${uri}": expected a gcp-kms://, aws-kms://, azure-kv:// or vault-transit:// URI`);
  }
}
function parseGcp(name) {
  if (!gcpName.test(name)) {
    throw new Error(
      `key gcp-kms://${name}: expected projects/P/locations/L/keyRings/R/cryptoKeys/K/cryptoKeyVersions/V`
    );
  }
  return { backend: "gcp-kms", name };
}
function parseAws(arn) {
  const match = awsArn.exec(arn);
  if (!match) throw new Error(`key aws-kms://${arn}: expected arn:aws:kms:REGION:ACCOUNT:key/ID or :alias/NAME`);
  const [, partition, region = ""] = match;
  const domain = partition === "aws-cn" ? "amazonaws.com.cn" : "amazonaws.com";
  return { backend: "aws-kms", arn, region, host: `kms.${region}.${domain}` };
}
function parseAzure(path) {
  const match = azurePath.exec(path);
  if (!match) throw new Error(`key azure-kv://${path}: expected NAME.vault.azure.net/keys/KEY/VERSION`);
  const [, vault = "", domain = "", name = "", version = ""] = match;
  return {
    backend: "azure-kv",
    keyUrl: `https://${vault}.${domain}/keys/${name}/${version}`,
    resource: `https://${domain}`
  };
}
function parseVault(rest) {
  const [path = "", query = ""] = rest.split("?", 2);
  const separator = path.lastIndexOf("/keys/");
  const mount = path.slice(0, separator);
  const name = path.slice(separator + "/keys/".length);
  if (separator <= 0 || !vaultName.test(name)) {
    throw new Error(`key vault-transit://${rest}: expected MOUNT/keys/NAME, optionally ?version=N`);
  }
  return {
    backend: "vault-transit",
    mount,
    name,
    version: parseVersion(rest, new URLSearchParams(query).get("version"))
  };
}
function parseVersion(rest, version) {
  if (version === null) return void 0;
  if (!/^[1-9]\d*$/.test(version)) throw new Error(`key vault-transit://${rest}: version must be a positive integer`);
  return Number(version);
}

// src/target.ts
function resolveTarget(inputs, env) {
  if (inputs.enterprise) {
    if (inputs.owner || inputs.repositories.length > 0) {
      throw new Error("Cannot use 'enterprise' input with 'owner' or 'repositories' inputs");
    }
    return { type: "enterprise", enterprise: inputs.enterprise };
  }
  if (inputs.owner && inputs.repositories.length === 0) return { type: "owner", owner: inputs.owner };
  if (inputs.repositories.length === 0) return currentRepository(env);
  const owner = inputs.owner || required(env, "GITHUB_REPOSITORY_OWNER");
  return { type: "repository", owner, repositories: inputs.repositories.map((input) => repositoryName(input, owner)) };
}
function currentRepository(env) {
  const [owner = "", repository = ""] = required(env, "GITHUB_REPOSITORY").split("/");
  return { type: "repository", owner, repositories: [repository] };
}
function repositoryName(input, owner) {
  const parts = input.split("/");
  const [first = "", second = ""] = parts;
  if (parts.length === 1 && first) return first;
  if (parts.length !== 2 || !first || !second) {
    throw new Error(`Invalid repository '${input}'. Expected 'repository' or 'owner/repository'.`);
  }
  if (first.toLowerCase() !== owner.toLowerCase()) {
    throw new Error(
      `Repository '${input}' includes owner '${first}', which does not match the resolved owner '${owner}'.`
    );
  }
  return second;
}
function required(env, name) {
  const value = env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

// src/inputs.ts
var permissionPrefix = "INPUT_PERMISSION-";
function readInputs(source, env) {
  const clientId = source.getInput("client-id") || source.getInput("app-id");
  if (!clientId) throw new Error("The 'client-id' (or deprecated 'app-id') input must be set");
  const key = source.getInput("key");
  if (!key) throw new Error("The 'key' input must be set");
  const repositories = source.getInput("repositories").split(/[\n,]+/).map((repository) => repository.trim()).filter((repository) => repository !== "");
  return {
    clientId,
    key: parseKey(key),
    target: resolveTarget(
      { enterprise: source.getInput("enterprise"), owner: source.getInput("owner"), repositories },
      env
    ),
    permissions: readPermissions(env),
    skipTokenRevoke: source.getBooleanInput("skip-token-revoke"),
    apiUrl: source.getInput("github-api-url")
  };
}
function readPermissions(env) {
  const entries = Object.entries(env).filter(([name, value]) => name.startsWith(permissionPrefix) && value).map(([name, value]) => [name.slice(permissionPrefix.length).toLowerCase().replaceAll("-", "_"), value]);
  return entries.length === 0 ? void 0 : Object.fromEntries(entries);
}

// src/retry.ts
var retries = 3;
var wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
async function withRetry(run2, onRetry, sleep = wait) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await run2();
    } catch (error) {
      if (attempt > retries || !isTransient(error)) throw error;
      onRetry(error, attempt);
      await sleep(1e3 * 2 ** (attempt - 1));
    }
  }
}
function isTransient(error) {
  if (error instanceof HttpError) return error.status >= 500;
  return error instanceof TypeError && error.message === "fetch failed";
}

// src/runner.ts
var import_node_crypto3 = require("node:crypto");
var import_node_fs = require("node:fs");
function createRunner(env, write) {
  const getInput = (name) => (env[`INPUT_${name.replaceAll(" ", "_").toUpperCase()}`] ?? "").trim();
  const append = (fileVariable, name, value) => {
    const path = env[fileVariable];
    if (!path) throw new Error(`${fileVariable} is not set`);
    const delimiter = `ghadelimiter_${(0, import_node_crypto3.randomUUID)()}`;
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

// src/main.ts
var runner = createRunner(process.env, (line) => process.stdout.write(`${line}
`));
var shellSafe = /^[\w.:/-]+$/;
function exec(command, args) {
  const words = [command, ...args];
  if (!words.every((word) => shellSafe.test(word))) return Promise.reject(new Error(`${command}: unsafe argument`));
  return new Promise((resolve, reject) => {
    (0, import_node_child_process.exec)(words.join(" "), (error, stdout, stderr) => {
      if (error)
        reject(new Error(`${command} ${args.slice(0, 2).join(" ")} failed: ${stderr.trim() || error.message}`));
      else resolve(stdout);
    });
  });
}
function describe2(token) {
  const repositories = token.repositories.length > 0 ? token.repositories.join(", ") : "all of the installation";
  const permissions = Object.entries(token.permissions).map(([name, level]) => `${name}=${level}`).join(", ");
  return `Token for installation ${token.installationId} (${token.appSlug}) expires ${token.expiresAt}. Repositories: ${repositories}. Permissions: ${permissions}.`;
}
async function run() {
  assertProxySupport(process.env);
  const inputs = readInputs(runner, process.env);
  const signer = createSigner(inputs.key, {
    fetch,
    env: process.env,
    readFile: (path) => (0, import_promises.readFile)(path, "utf8"),
    exec,
    mask: runner.setSecret,
    now: () => /* @__PURE__ */ new Date()
  });
  const github = createGitHub(inputs.apiUrl, fetch);
  const token = await withRetry(
    () => mintAppToken(inputs, signer, github, runner.setSecret, /* @__PURE__ */ new Date()),
    (error, attempt) => runner.info(`Attempt ${attempt} failed, retrying: ${errorMessage(error)}`)
  );
  runner.setOutput("token", token.token);
  runner.setOutput("installation-id", String(token.installationId));
  runner.setOutput("app-slug", token.appSlug);
  runner.info(describe2(token));
  if (inputs.skipTokenRevoke) return;
  runner.saveState("token", token.token);
  runner.saveState("expiresAt", token.expiresAt);
}
run().catch((error) => runner.setFailed(errorMessage(error)));
