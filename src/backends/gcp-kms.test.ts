import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";

import { crc32c } from "../crc32c.ts";
import { base64, fromBase64 } from "../encoding.ts";
import { fakeFetch, newTestKey, signDigestLocally } from "../testing.ts";
import { gcpKmsSigner } from "./gcp-kms.ts";

const { privateKey } = newTestKey();
const digest = createHash("sha256").update("input").digest();
const key = {
  backend: "gcp-kms" as const,
  name: "projects/p/locations/global/keyRings/r/cryptoKeys/k/cryptoKeyVersions/1",
};
const audience = "//iam.googleapis.com/projects/1/locations/global/workloadIdentityPools/github/providers/github";

function credentials(extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    type: "external_account",
    audience,
    subject_token_type: "urn:ietf:params:oauth:token-type:jwt",
    token_url: "https://sts.googleapis.com/v1/token",
    credential_source: {
      url: "https://actions.example/token?audience=gcp",
      headers: { Authorization: "Bearer request-token" },
      format: { type: "json", subject_token_field_name: "value" },
    },
    ...extra,
  });
}

function google(reply: (signReply: Record<string, unknown>) => Record<string, unknown> = (signReply) => signReply) {
  return fakeFetch(({ url, body }) => {
    if (url.startsWith("https://actions.example/")) return { body: { value: "oidc-jwt" } };
    if (url === "https://sts.googleapis.com/v1/token") return { body: { access_token: "federated" } };
    if (url.includes(":generateAccessToken")) return { body: { accessToken: "impersonated" } };
    const request = JSON.parse(body);
    const input = fromBase64(request.digest.sha256);
    const signature = signDigestLocally(privateKey, input);
    return {
      body: reply({
        name: key.name,
        signature: base64(signature),
        signatureCrc32c: String(crc32c(signature)),
        verifiedDigestCrc32c: request.digestCrc32c === String(crc32c(input)),
      }),
    };
  });
}

function deps(server: ReturnType<typeof google>, file: string, masked: string[] = []) {
  return {
    fetch: server.fetch,
    env: { GOOGLE_APPLICATION_CREDENTIALS: "/creds.json" },
    readFile: async () => file,
    mask: (secret: string) => masked.push(secret),
  };
}

test("exchanges the GitHub OIDC token and signs with the federated token", async () => {
  const server = google();
  const masked: string[] = [];
  const signature = await gcpKmsSigner(key, deps(server, credentials(), masked)).signDigest(digest);

  const [oidc, sts, sign] = server.requests;
  assert.equal(oidc?.headers.get("authorization"), "Bearer request-token");
  const exchange = new URLSearchParams(sts?.body);
  assert.equal(exchange.get("subject_token"), "oidc-jwt");
  assert.equal(exchange.get("audience"), audience);
  assert.equal(exchange.get("grant_type"), "urn:ietf:params:oauth:grant-type:token-exchange");
  assert.equal(sign?.url, `https://cloudkms.googleapis.com/v1/${key.name}:asymmetricSign`);
  assert.equal(sign?.headers.get("authorization"), "Bearer federated");
  assert.deepEqual(signature, signDigestLocally(privateKey, digest));
  assert.deepEqual(masked, ["oidc-jwt", "federated"]);
});

test("impersonates the service account when the credentials name one", async () => {
  const server = google();
  const impersonation =
    "https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/sa@p.iam.gserviceaccount.com:generateAccessToken";
  await gcpKmsSigner(key, deps(server, credentials({ service_account_impersonation_url: impersonation }))).signDigest(
    digest,
  );

  assert.equal(server.requests[2]?.url, impersonation);
  assert.equal(server.requests[2]?.headers.get("authorization"), "Bearer federated");
  assert.equal(server.requests[3]?.headers.get("authorization"), "Bearer impersonated");
});

test("reads a plain-text subject token from a file", async () => {
  const server = google();
  const file = JSON.stringify({ ...JSON.parse(credentials()), credential_source: { file: "/token" } });
  const files: Record<string, string> = { "/creds.json": file, "/token": "file-jwt\n" };
  await gcpKmsSigner(key, { ...deps(server, file), readFile: async (path: string) => files[path] ?? "" }).signDigest(
    digest,
  );

  assert.equal(new URLSearchParams(server.requests[0]?.body).get("subject_token"), "file-jwt");
});

test("rejects a service account key file", async () => {
  await assert.rejects(
    gcpKmsSigner(key, deps(google(), JSON.stringify({ type: "service_account" }))).signDigest(digest),
    /"service_account" are not supported/,
  );
});

test("requires google-github-actions/auth to have run", async () => {
  const server = google();
  await assert.rejects(
    gcpKmsSigner(key, { ...deps(server, credentials()), env: {} }).signDigest(digest),
    /GOOGLE_APPLICATION_CREDENTIALS/,
  );
});

test("says which role is missing when KMS refuses to sign", async () => {
  const server = fakeFetch(({ url }) => {
    if (url.startsWith("https://actions.example/")) return { body: { value: "oidc-jwt" } };
    if (url === "https://sts.googleapis.com/v1/token") return { body: { access_token: "federated" } };
    return { status: 403, body: { error: { code: 403, message: "Permission denied", status: "PERMISSION_DENIED" } } };
  });
  await assert.rejects(
    gcpKmsSigner(key, deps(server, credentials())).signDigest(digest),
    new RegExp(
      `PERMISSION_DENIED: Permission denied; this job may not sign with ${key.name}: check roles/cloudkms.signer`,
    ),
  );
});

test("sends the digest checksum and checks the one KMS returns", async () => {
  const server = google();
  await gcpKmsSigner(key, deps(server, credentials())).signDigest(digest);

  assert.equal(JSON.parse(server.requests[2]?.body ?? "").digestCrc32c, String(crc32c(digest)));
});

test("rejects a sign request KMS received corrupted", async () => {
  const server = google((reply) => ({ ...reply, verifiedDigestCrc32c: false }));
  await assert.rejects(
    gcpKmsSigner(key, deps(server, credentials())).signDigest(digest),
    /sign request was corrupted in transit/,
  );
});

test("rejects a reply for another key version", async () => {
  const server = google((reply) => ({ ...reply, name: key.name.replace(/1$/, "2") }));
  await assert.rejects(
    gcpKmsSigner(key, deps(server, credentials())).signDigest(digest),
    /sign request was corrupted in transit/,
  );
});

test("rejects a signature that does not match its checksum", async () => {
  const server = google((reply) => ({ ...reply, signatureCrc32c: "1" }));
  await assert.rejects(
    gcpKmsSigner(key, deps(server, credentials())).signDigest(digest),
    /signature was corrupted in transit/,
  );
});
