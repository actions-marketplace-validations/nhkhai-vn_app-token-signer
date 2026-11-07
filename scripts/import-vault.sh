#!/usr/bin/env bash
# shellcheck source=lib.sh
source "$(dirname "$0")/lib.sh"

if [ "${1:-}" = "--keep-pem" ]; then
  keep_pem=true
  shift
fi
[ $# -eq 3 ] || usage "PEM MOUNT NAME"
pem=$1 mount=$2 name=$3

require openssl curl jq od
require_key_wrap
: "${VAULT_ADDR:?VAULT_ADDR must be set}" "${VAULT_TOKEN:?VAULT_TOKEN must be set}"

vault_api() {
  local method=$1 path=$2
  shift 2
  curl -sS --fail-with-body -X "$method" -H "X-Vault-Token: $VAULT_TOKEN" \
    ${VAULT_NAMESPACE:+-H "X-Vault-Namespace: $VAULT_NAMESPACE"} "${VAULT_ADDR%/}/v1/$path" "$@"
}

vault_api GET "$mount/wrapping_key" | jq -r .data.public_key >"$work_dir/wrapping.pem"
pkcs8_der "$pem" "$work_dir/key.der"
wrap_key "$work_dir/wrapping.pem" PEM "$work_dir/key.der" "$work_dir/ciphertext"
ciphertext="$(openssl base64 -A -in "$work_dir/ciphertext")"

if vault_api GET "$mount/keys/$name" >/dev/null 2>&1; then
  jq -n --arg ciphertext "$ciphertext" '{ciphertext: $ciphertext, hash_function: "SHA256"}' \
    | vault_api POST "$mount/keys/$name/import_version" --data @- >/dev/null
else
  jq -n --arg ciphertext "$ciphertext" '{ciphertext: $ciphertext, type: "rsa-2048", hash_function: "SHA256"}' \
    | vault_api POST "$mount/keys/$name/import" --data @- >/dev/null
fi

key="$(vault_api GET "$mount/keys/$name")"
version="$(jq -r .data.latest_version <<<"$key")"
jq -r --arg version "$version" '.data.keys[$version].public_key' <<<"$key" >"$work_dir/public.pem"

confirm_and_clean "$pem" "$(public_key_fingerprint "$work_dir/public.pem" PEM)"
echo "key: vault-transit://$mount/keys/$name?version=$version"
