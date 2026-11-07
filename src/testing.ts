import { constants, generateKeyPairSync, type KeyObject, privateEncrypt } from "node:crypto";

import type { Fetch } from "./http.ts";
import type { Signer } from "./signer.ts";

const sha256DigestInfo = Buffer.from("3031300d060960864801650304020105000420", "hex");

export function newTestKey(): { privateKey: KeyObject; publicKey: KeyObject } {
  return generateKeyPairSync("rsa", { modulusLength: 2048 });
}

export function signDigestLocally(privateKey: KeyObject, digest: Uint8Array): Uint8Array {
  return new Uint8Array(
    privateEncrypt(
      { key: privateKey, padding: constants.RSA_PKCS1_PADDING },
      Buffer.concat([sha256DigestInfo, digest]),
    ),
  );
}

export function localSigner(privateKey: KeyObject): Signer {
  return { signDigest: async (digest) => signDigestLocally(privateKey, digest) };
}

export interface FakeRequest {
  url: string;
  method: string;
  headers: Headers;
  body: string;
}

export interface FakeResponse {
  status?: number;
  body?: unknown;
}

export function fakeFetch(respond: (request: FakeRequest) => FakeResponse | Promise<FakeResponse>): {
  fetch: Fetch;
  requests: FakeRequest[];
} {
  const requests: FakeRequest[] = [];
  const fetchFn: Fetch = async (input, init) => {
    const request = {
      url: String(input),
      method: init?.method ?? "GET",
      headers: new Headers(init?.headers),
      body: init?.body === undefined || init.body === null ? "" : String(init.body),
    };
    requests.push(request);
    const { status = 200, body } = await respond(request);
    const text = body === undefined ? null : typeof body === "string" ? body : JSON.stringify(body);
    return new Response(text, { status });
  };
  return { fetch: fetchFn, requests };
}
