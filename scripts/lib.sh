# shellcheck shell=bash
set -euo pipefail

work_dir="$(mktemp -d)"
chmod 700 "$work_dir"
trap 'rm -rf "$work_dir"' EXIT

keep_pem=false

usage() {
  echo "usage: $(basename "$0") [--keep-pem] $1" >&2
  exit 2
}

require() {
  local command
  for command in "$@"; do
    command -v "$command" >/dev/null || { echo "$command is required" >&2; exit 1; }
  done
}

require_key_wrap() {
  openssl rand -out "$work_dir/probe" 16
  openssl enc -id-aes256-wrap-pad -K "$(hex "$work_dir/probe")$(hex "$work_dir/probe")" -iv A65959A6 \
    -in "$work_dir/probe" -out /dev/null 2>/dev/null \
    || { echo "openssl lacks AES key wrap with padding; use OpenSSL 3 (macOS: brew install openssl@3)" >&2; exit 1; }
}

wait_until() {
  local what=$1 deadline=$((SECONDS + 600))
  shift
  until "$@"; do
    [ "$SECONDS" -lt "$deadline" ] || { echo "gave up after 10 minutes waiting for $what" >&2; exit 1; }
    sleep 2
  done
}

hex() {
  od -An -v -tx1 "$1" | tr -d ' \n'
}

pkcs8_der() {
  openssl pkcs8 -topk8 -nocrypt -in "$1" -outform DER -out "$2"
}

# Stores import RSA keys as RSAES-OAEP-SHA256(fresh AES-256 key) followed by AES-KWP (RFC 5649) of the PKCS#8 key.
wrap_key() {
  local wrapping_key=$1 wrapping_key_form=$2 key_der=$3 out=$4
  openssl rand -out "$work_dir/aes.key" 32
  openssl pkeyutl -encrypt -pubin -keyform "$wrapping_key_form" -inkey "$wrapping_key" \
    -pkeyopt rsa_padding_mode:oaep -pkeyopt rsa_oaep_md:sha256 -pkeyopt rsa_mgf1_md:sha256 \
    -in "$work_dir/aes.key" -out "$work_dir/aes.wrapped"
  openssl enc -id-aes256-wrap-pad -K "$(hex "$work_dir/aes.key")" -iv A65959A6 -in "$key_der" -out "$work_dir/key.wrapped"
  cat "$work_dir/aes.wrapped" "$work_dir/key.wrapped" >"$out"
}

public_key_fingerprint() {
  local public_key=$1 form=$2
  openssl pkey -pubin -inform "$form" -in "$public_key" -outform DER | openssl dgst -sha256 -binary | openssl base64 -A
}

# Deletes the PEM only once the store holds the same key, so a failed import never loses it.
confirm_and_clean() {
  local pem=$1 stored=$2 expected
  expected="$(openssl pkey -in "$pem" -pubout -outform DER | openssl dgst -sha256 -binary | openssl base64 -A)"
  if [ "$stored" != "$expected" ]; then
    echo "mismatch: PEM is SHA256:$expected, the store holds SHA256:$stored; kept $pem" >&2
    exit 1
  fi
  echo "stored public key matches the PEM: SHA256:$expected (compare with the App's private keys on GitHub)"
  if [ "$keep_pem" = true ]; then
    echo "kept $pem"
    return
  fi
  rm -f "$pem"
  echo "deleted $pem"
}
