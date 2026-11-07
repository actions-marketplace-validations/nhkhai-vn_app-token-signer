import { base64, fromBase64 } from "../encoding.ts";
import { requestJson, requestText } from "../http.ts";
import { type JsonObject, object, string, stringFields } from "../json.ts";
import type { GcpKmsKey } from "../key.ts";
import type { Signer, SignerDeps } from "../signer.ts";

type Deps = Pick<SignerDeps, "fetch" | "env" | "readFile" | "mask">;

const scope = "https://www.googleapis.com/auth/cloud-platform";

export function gcpKmsSigner(key: GcpKmsKey, deps: Deps): Signer {
  return {
    async signDigest(digest) {
      const token = await accessToken(deps);
      const body = object(
        await requestJson(
          deps.fetch,
          "sign with GCP Cloud KMS",
          `https://cloudkms.googleapis.com/v1/${key.name}:asymmetricSign`,
          {
            method: "POST",
            headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
            body: JSON.stringify({ digest: { sha256: base64(digest) } }),
          },
        ),
        "GCP Cloud KMS response",
      );
      return fromBase64(string(body, "signature", "GCP Cloud KMS response"));
    },
  };
}

async function accessToken(deps: Deps): Promise<string> {
  const path = deps.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!path) throw new Error("GCP: GOOGLE_APPLICATION_CREDENTIALS is not set; run google-github-actions/auth first");
  const credentials = object(JSON.parse(await deps.readFile(path)), "GCP credentials");
  if (credentials.type !== "external_account") {
    throw new Error(
      `GCP: credentials of type "${String(credentials.type)}" are not supported; use workload identity federation`,
    );
  }

  const subjectToken = await readSubjectToken(object(credentials.credential_source, "GCP credential_source"), deps);
  deps.mask(subjectToken);
  const federated = object(
    await requestJson(
      deps.fetch,
      "exchange the GCP federated token",
      string(credentials, "token_url", "GCP credentials"),
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
          audience: string(credentials, "audience", "GCP credentials"),
          scope,
          requested_token_type: "urn:ietf:params:oauth:token-type:access_token",
          subject_token: subjectToken,
          subject_token_type: string(credentials, "subject_token_type", "GCP credentials"),
        }),
      },
    ),
    "GCP STS response",
  );
  const federatedToken = string(federated, "access_token", "GCP STS response");
  deps.mask(federatedToken);

  const impersonationUrl = credentials.service_account_impersonation_url;
  if (typeof impersonationUrl !== "string") return federatedToken;
  const impersonated = object(
    await requestJson(deps.fetch, "impersonate the GCP service account", impersonationUrl, {
      method: "POST",
      headers: { authorization: `Bearer ${federatedToken}`, "content-type": "application/json" },
      body: JSON.stringify({ scope: [scope] }),
    }),
    "GCP impersonation response",
  );
  const token = string(impersonated, "accessToken", "GCP impersonation response");
  deps.mask(token);
  return token;
}

async function readSubjectToken(source: JsonObject, deps: Deps): Promise<string> {
  const raw =
    typeof source.file === "string"
      ? await deps.readFile(source.file)
      : await requestText(deps.fetch, "read the OIDC token for GCP", string(source, "url", "GCP credential_source"), {
          headers: stringFields(source.headers),
        });
  const format = typeof source.format === "object" && source.format !== null ? (source.format as JsonObject) : {};
  if (format.type !== "json") return raw.trim();
  return string(
    object(JSON.parse(raw), "OIDC token response"),
    string(format, "subject_token_field_name", "GCP credential_source format"),
    "OIDC token response",
  );
}
