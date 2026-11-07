#!/usr/bin/env bash
# shellcheck source-path=SCRIPTDIR source=lib.sh
source "$(dirname "$0")/lib.sh"

if [ "${1:-}" = "--keep-pem" ]; then
  keep_pem=true
  shift
fi
[ $# -eq 3 ] || usage "PEM VAULT_NAME KEY_NAME"
pem=$1 vault=$2 name=$3

require openssl az

kid="$(az keyvault key import --vault-name "$vault" --name "$name" --pem-file "$pem" --protection software \
  --ops sign verify --query key.kid --output tsv)"
az keyvault key download --id "$kid" --encoding PEM --file "$work_dir/public.pem"
confirm_and_clean "$pem" "$(public_key_fingerprint "$work_dir/public.pem" PEM)"
echo "key: azure-kv://${kid#https://}"
