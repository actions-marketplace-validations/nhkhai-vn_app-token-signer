export function base64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

export function base64url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

export function fromBase64(text: string): Uint8Array {
  return new Uint8Array(Buffer.from(text, "base64"));
}
