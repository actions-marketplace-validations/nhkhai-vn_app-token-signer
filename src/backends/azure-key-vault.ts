import { base64url, fromBase64 } from "../encoding.ts";
import { requestJson } from "../http.ts";
import { object, string } from "../json.ts";
import type { AzureKeyVaultKey } from "../key.ts";
import type { Signer, SignerDeps } from "../signer.ts";

export function azureKeyVaultSigner(key: AzureKeyVaultKey, deps: Pick<SignerDeps, "fetch" | "exec" | "mask">): Signer {
  return {
    async signDigest(digest) {
      const token = await accessToken(key.resource, deps);
      const response = object(
        await requestJson(deps.fetch, "sign with Azure Key Vault", `${key.keyUrl}/sign?api-version=7.4`, {
          method: "POST",
          headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
          body: JSON.stringify({ alg: "RS256", value: base64url(digest) }),
        }),
        "Azure Key Vault response",
      );
      return fromBase64(string(response, "value", "Azure Key Vault response"));
    },
  };
}

async function accessToken(resource: string, { exec, mask }: Pick<SignerDeps, "exec" | "mask">): Promise<string> {
  const token = (
    await exec("az", [
      "account",
      "get-access-token",
      "--resource",
      resource,
      "--query",
      "accessToken",
      "--output",
      "tsv",
    ])
  ).trim();
  if (!token) throw new Error("Azure: az returned no access token; run azure/login first");
  mask(token);
  return token;
}
