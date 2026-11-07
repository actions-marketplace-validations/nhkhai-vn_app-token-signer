import { createHash, createHmac } from "node:crypto";

export interface AwsCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string | undefined;
}

export interface SigV4Request {
  method: string;
  host: string;
  headers: Record<string, string>;
  body: string;
  service: string;
  region: string;
}

export function signV4(request: SigV4Request, credentials: AwsCredentials, now: Date): Record<string, string> {
  const timestamp = now.toISOString().replace(/[-:]|\.\d{3}/g, "");
  const date = timestamp.slice(0, 8);
  const sent: Record<string, string> = {
    ...request.headers,
    "x-amz-date": timestamp,
    ...(credentials.sessionToken ? { "x-amz-security-token": credentials.sessionToken } : {}),
  };
  const headers: Record<string, string> = { ...sent, host: request.host };
  const names = Object.keys(headers).sort();
  const signedHeaders = names.join(";");
  const canonicalHeaders = names.map((name) => `${name}:${(headers[name] ?? "").trim()}\n`).join("");
  const canonicalRequest = [request.method, "/", "", canonicalHeaders, signedHeaders, sha256Hex(request.body)].join(
    "\n",
  );
  const scope = `${date}/${request.region}/${request.service}/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", timestamp, scope, sha256Hex(canonicalRequest)].join("\n");
  const signingKey = [date, request.region, request.service, "aws4_request"].reduce<Buffer>(
    (key, part) => hmac(key, part),
    Buffer.from(`AWS4${credentials.secretAccessKey}`),
  );
  return {
    ...sent,
    authorization: `AWS4-HMAC-SHA256 Credential=${credentials.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${hmac(signingKey, stringToSign).toString("hex")}`,
  };
}

function sha256Hex(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function hmac(key: Buffer, text: string): Buffer {
  return createHmac("sha256", key).update(text).digest();
}
