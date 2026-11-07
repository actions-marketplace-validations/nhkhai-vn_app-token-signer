#!/usr/bin/env bash
# shellcheck source-path=SCRIPTDIR source=lib.sh
source "$(dirname "$0")/lib.sh"

if [ "${1:-}" = "--keep-pem" ]; then
  keep_pem=true
  shift
fi
[ $# -ge 1 ] && [ $# -le 2 ] || usage "PEM [ALIAS]"
pem=$1 alias=${2:-}

require openssl aws jq od
require_key_wrap

read -r arn key_id < <(aws kms create-key --origin EXTERNAL --key-spec RSA_2048 --key-usage SIGN_VERIFY \
  --description "GitHub App private key for app-token-signer" --query 'KeyMetadata.[Arn,KeyId]' --output text)

aws kms get-parameters-for-import --key-id "$key_id" --wrapping-algorithm RSA_AES_KEY_WRAP_SHA_256 \
  --wrapping-key-spec RSA_4096 --output json >"$work_dir/parameters.json"
jq -r .PublicKey "$work_dir/parameters.json" | openssl base64 -d -A >"$work_dir/wrapping.der"
jq -r .ImportToken "$work_dir/parameters.json" | openssl base64 -d -A >"$work_dir/import-token"

pkcs8_der "$pem" "$work_dir/key.der"
wrap_key "$work_dir/wrapping.der" DER "$work_dir/key.der" "$work_dir/wrapped"
aws kms import-key-material --key-id "$key_id" --encrypted-key-material "fileb://$work_dir/wrapped" \
  --import-token "fileb://$work_dir/import-token" --expiration-model KEY_MATERIAL_DOES_NOT_EXPIRE >/dev/null

aws kms get-public-key --key-id "$key_id" --query PublicKey --output text | openssl base64 -d -A >"$work_dir/public.der"
confirm_and_clean "$pem" "$(public_key_fingerprint "$work_dir/public.der" DER)"
if [ -n "$alias" ]; then
  aws kms create-alias --alias-name "alias/$alias" --target-key-id "$key_id"
fi
echo "key: aws-kms://$arn"
