#!/usr/bin/env bash
# shellcheck source=lib.sh
source "$(dirname "$0")/lib.sh"

if [ "${1:-}" = "--keep-pem" ]; then
  keep_pem=true
  shift
fi
[ $# -eq 2 ] || usage "PEM projects/P/locations/L/keyRings/R/cryptoKeys/K"
pem=$1 key=$2
[[ $key =~ ^projects/([^/]+)/locations/([^/]+)/keyRings/([^/]+)/cryptoKeys/([^/]+)$ ]] \
  || usage "PEM projects/P/locations/L/keyRings/R/cryptoKeys/K"
scope=(--project "${BASH_REMATCH[1]}" --location "${BASH_REMATCH[2]}" --keyring "${BASH_REMATCH[3]}")
key_name=${BASH_REMATCH[4]}

require openssl gcloud od
require_key_wrap

protection="$(gcloud kms keys describe "$key_name" "${scope[@]}" --format='value(versionTemplate.protectionLevel)')"
job="app-token-signer-$(date -u +%Y%m%d%H%M%S)"
gcloud kms import-jobs create "$job" "${scope[@]}" --import-method rsa-oaep-3072-sha256-aes-256 \
  --protection-level "$(tr '[:upper:]' '[:lower:]' <<<"$protection")" >/dev/null
until [ "$(gcloud kms import-jobs describe "$job" "${scope[@]}" --format='value(state)')" = ACTIVE ]; do sleep 2; done
gcloud kms import-jobs describe "$job" "${scope[@]}" --format='value(publicKey.pem)' >"$work_dir/wrapping.pem"

pkcs8_der "$pem" "$work_dir/key.der"
wrap_key "$work_dir/wrapping.pem" PEM "$work_dir/key.der" "$work_dir/wrapped"
version="$(gcloud kms keys versions import --import-job "$job" --key "$key_name" "${scope[@]}" \
  --algorithm rsa-sign-pkcs1-2048-sha256 --wrapped-key-file "$work_dir/wrapped" --format='value(name)')"

until state="$(gcloud kms keys versions describe "${version##*/}" --key "$key_name" "${scope[@]}" --format='value(state)')" \
  && [ "$state" != PENDING_IMPORT ]; do sleep 2; done
[ "$state" = ENABLED ] || { echo "import of $version ended in state $state" >&2; exit 1; }

gcloud kms keys versions get-public-key "${version##*/}" --key "$key_name" "${scope[@]}" --output-file "$work_dir/public.pem"
confirm_and_clean "$pem" "$(public_key_fingerprint "$work_dir/public.pem" PEM)"
echo "key: gcp-kms://$version"
