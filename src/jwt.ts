import { createHash } from "node:crypto";

import { base64url } from "./encoding.ts";
import type { Signer } from "./signer.ts";

const header = base64url(Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })));

export async function createAppJwt(clientId: string, signer: Signer, now: Date): Promise<string> {
  // GitHub rejects an iat in the future and an exp more than 10 minutes ahead; backdating absorbs runner clock skew.
  const issuedAt = Math.floor(now.getTime() / 1000) - 60;
  const payload = base64url(Buffer.from(JSON.stringify({ iat: issuedAt, exp: issuedAt + 600, iss: clientId })));
  const signingInput = `${header}.${payload}`;
  const signature = await signer.signDigest(createHash("sha256").update(signingInput).digest());
  return `${signingInput}.${base64url(signature)}`;
}
