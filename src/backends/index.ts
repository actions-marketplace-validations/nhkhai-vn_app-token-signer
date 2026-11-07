import type { KeyRef } from "../key.ts";
import type { Signer, SignerDeps } from "../signer.ts";
import { awsKmsSigner } from "./aws-kms.ts";
import { azureKeyVaultSigner } from "./azure-key-vault.ts";
import { gcpKmsSigner } from "./gcp-kms.ts";
import { vaultTransitSigner } from "./vault-transit.ts";

export function createSigner(key: KeyRef, deps: SignerDeps): Signer {
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
