#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# Downloads the QoreSign test vectors this kit reuses by reference, from the
# tagged QoreSign release, and checks their SHA-256 before keeping them.
# The URL and hash are recorded in vectors/custody-v1.json.
set -euo pipefail

cd "$(dirname "$0")/.."
url="https://raw.githubusercontent.com/qorechain/qoresign/v0.1.0/vectors/qoresign-v1.json"
want="bf920288d234204bb77c51b59aec0b3a6c9ce5735cef247a18629b4912186f7c"
tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT
curl -fsSL "$url" -o "$tmp"
if command -v sha256sum >/dev/null 2>&1; then got="$(sha256sum "$tmp" | cut -d' ' -f1)"; else got="$(shasum -a 256 "$tmp" | cut -d' ' -f1)"; fi
if [ "$got" != "$want" ]; then
  echo "qoresign-v1.json: SHA-256 $got, expected $want" >&2
  exit 1
fi
mv "$tmp" vectors/qoresign-v1.json
trap - EXIT
echo "vectors/qoresign-v1.json verified ($want)"
