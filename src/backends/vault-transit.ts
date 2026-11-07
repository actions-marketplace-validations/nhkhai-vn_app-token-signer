import { base64, fromBase64 } from "../encoding.ts";
import { requestJson } from "../http.ts";
import { object, string } from "../json.ts";
import type { VaultTransitKey } from "../key.ts";
import { explainRefusal, type Signer, type SignerDeps } from "../signer.ts";

export function vaultTransitSigner(key: VaultTransitKey, { fetch, env }: Pick<SignerDeps, "fetch" | "env">): Signer {
  return {
    async signDigest(digest) {
      const address = env.VAULT_ADDR?.replace(/\/+$/, "");
      const token = env.VAULT_TOKEN;
      if (!address || !token) {
        throw new Error(
          "Vault: VAULT_ADDR and VAULT_TOKEN must be set (hashicorp/vault-action exports the token with exportToken: true)",
        );
      }
      const body = object(
        await requestJson(fetch, "sign with Vault Transit", `${address}/v1/${key.mount}/sign/${key.name}/sha2-256`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-vault-token": token,
            ...(env.VAULT_NAMESPACE ? { "x-vault-namespace": env.VAULT_NAMESPACE } : {}),
          },
          body: JSON.stringify({
            input: base64(digest),
            prehashed: true,
            // Vault defaults RSA signatures to PSS, which GitHub rejects.
            signature_algorithm: "pkcs1v15",
            ...(key.version === undefined ? {} : { key_version: key.version }),
          }),
        }).catch(
          explainRefusal(
            `this job may not sign with ${key.mount}/keys/${key.name}: check that the token's policy allows update on ${key.mount}/sign/${key.name}/sha2-256`,
          ),
        ),
        "Vault response",
      );
      const signature = string(object(body.data, "Vault response data"), "signature", "Vault response data");
      return fromBase64(signature.replace(/^vault:v\d+:/, ""));
    },
  };
}
