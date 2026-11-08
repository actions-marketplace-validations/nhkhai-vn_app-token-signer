# Setup

For every store: generate a private key under the App's settings on GitHub, import it with the script for your store, give the workflow's identity permission to sign with that one key and nothing else, then delete the PEM. Each import script checks that the stored public key matches the PEM, prints the SHA-256 fingerprint GitHub shows next to the App's private keys, and deletes the PEM only after a match (`--keep-pem` keeps it). The scripts need `openssl` 3; on macOS, `brew install openssl@3`.

Who may sign is who may mint tokens. Bind signing to the repository and, where you can, the branch or workflow.

## A main-only binding still lets pull requests sign

`pull_request_target`, `workflow_run` and `issue_comment` runs use the default branch as their ref, whoever triggered them. Their OIDC token says `ref: refs/heads/main` and `sub: repo:OWNER/REPO:ref:refs/heads/main`, so a signer bound only to `main` signs for a run a pull request or a commenter started. If any workflow in the repository has those triggers, bind the event too:

- GCP: add `assertion.event_name in ['push', 'workflow_dispatch', 'schedule']` to the provider's attribute condition.
- AWS and Azure match only `sub`. [Customize the repository's subject](https://docs.github.com/en/actions/reference/security/oidc#customizing-the-subject-claims-for-an-organization-or-repository) to include `event_name` (`["repo", "context", "event_name"]`) and trust `repo:OWNER/REPO:ref:refs/heads/main:event_name:push`.
- Vault: add `event_name` to the role's `bound_claims`.

## GCP Cloud KMS

```sh
gcloud kms keyrings create github-apps --location global
gcloud kms keys create my-app --keyring github-apps --location global \
  --purpose asymmetric-signing --default-algorithm rsa-sign-pkcs1-2048-sha256 \
  --import-only --skip-initial-version-creation --protection-level software

scripts/import-gcp.sh my-app.private-key.pem projects/P/locations/global/keyRings/github-apps/cryptoKeys/my-app

gcloud kms keys add-iam-policy-binding my-app --keyring github-apps --location global --role roles/cloudkms.signer \
  --member "principalSet://iam.googleapis.com/projects/NUMBER/locations/global/workloadIdentityPools/github/attribute.repository/OWNER/REPO"
```

Create the workload identity pool as in [`google-github-actions/auth`](https://github.com/google-github-actions/auth#preferred-direct-workload-identity-federation), with an attribute condition on your owner. The binding above uses direct federation: no service account. Importing needs `roles/cloudkms.admin`, `roles/cloudkms.importer` and `roles/cloudkms.publicKeyViewer` on the key ring. Turn on Data Access audit logs for Cloud KMS to see every signature and its caller; they are off by default.

With direct federation, the auth step logs that it failed to compute a project ID. That is harmless: this action needs no project, and the auth step only skips exporting project variables. For a universe other than `googleapis.com`, set `universe` on the auth step and this action follows it.

## AWS KMS

```sh
scripts/import-aws.sh my-app.private-key.pem github-app-my-app
```

The script creates an `RSA_2048` `SIGN_VERIFY` key with external key material and imports the PEM into it. Give the workflow's role, trusted through GitHub's OIDC provider with a `sub` condition such as `repo:OWNER/REPO:ref:refs/heads/main`, only this:

```json
{
  "Effect": "Allow",
  "Action": "kms:Sign",
  "Resource": "arn:aws:kms:REGION:ACCOUNT:key/KEY_ID",
  "Condition": {
    "StringEquals": {
      "kms:SigningAlgorithm": "RSASSA_PKCS1_V1_5_SHA_256",
      "kms:MessageType": "DIGEST"
    }
  }
}
```

Log in with [`aws-actions/configure-aws-credentials`](https://github.com/aws-actions/configure-aws-credentials). CloudTrail records every `Sign` call.

## Azure Key Vault

```sh
scripts/import-azure.sh my-app.private-key.pem my-vault my-app
```

The key is imported as a software key that can only sign and verify. With the vault on Azure RBAC, give the workflow's identity, federated with a subject such as `repo:OWNER/REPO:ref:refs/heads/main`, a role on the key with only the `Microsoft.KeyVault/vaults/keys/sign/action` data action (or the built-in Key Vault Crypto User). Log in with [`azure/login`](https://github.com/Azure/login); set `allow-no-subscriptions: true` when the identity has no role on a subscription. The action gets its token from `az`, which `azure/login` requires anyway. Send the vault's `AuditEvent` logs to a workspace to see every signature.

## Vault / OpenBao Transit

```sh
VAULT_ADDR=https://vault.example.com VAULT_TOKEN=… scripts/import-vault.sh my-app.private-key.pem transit my-app
```

Running it again for the same key adds a version. Policy for the workflow:

```hcl
path "transit/sign/my-app/sha2-256" {
  capabilities = ["update"]
}
```

Bind a JWT auth role to GitHub's OIDC issuer with `bound_claims` on `repository` and `ref`, then log in with [`hashicorp/vault-action`](https://github.com/hashicorp/vault-action) and `exportToken: true`. Set `VAULT_ADDR` (and `VAULT_NAMESPACE` if you use one) on the job. The action always asks for PKCS#1 v1.5 signatures; Vault's default, PSS, is rejected by GitHub.

## Rotating the key

Generate a second private key on GitHub, import it (a new version in GCP, Azure and Vault; a new key in AWS), point the variable at it, then delete the old key on GitHub.

