#!/usr/bin/env bash
# One-time: push the five signing/notarization secrets to GitHub so the
# Release workflow can build the DMG in CI. Run this YOURSELF — it reads your
# keychain and your App Store Connect key and uploads them with `gh secret set`.
#
# Why this exists: release.yml has hard guards on these five secrets (added in
# b757857c when releases started shipping real DMGs). The secrets were never
# added, so every CI release since 2026-07-23 has failed at that step. The
# green runs before that date were tag+notes only — no DMG.
#
#   One-time prereq (only you can do this):
#     appstoreconnect.apple.com -> Users and Access -> Integrations ->
#     App Store Connect API -> Team Keys -> Generate (role: Developer).
#     Download the AuthKey_XXXXXX.p8 into ~/Downloads — Apple lets you
#     download it exactly once. Note the Issuer ID shown at the top of
#     that same page.
#
#   Then just run:  scripts/setup-release-secrets.sh
#   (finds the key in ~/Downloads, derives the key id from the filename,
#    asks for the issuer id, generates the p12 password itself)
set -euo pipefail

REPO="sybil-solutions/local-studio"

# Locate the .p8: explicit argument wins, otherwise newest in ~/Downloads.
p8_path="${1:-}"
if [[ -z "$p8_path" ]]; then
  p8_path="$(ls -t "$HOME"/Downloads/AuthKey_*.p8 2>/dev/null | head -1 || true)"
fi
if [[ -z "$p8_path" || ! -f "$p8_path" ]]; then
  echo "error: no AuthKey_*.p8 found in ~/Downloads (and none given as an argument)." >&2
  echo "       Generate one first — see the prereq comment at the top of this script." >&2
  exit 1
fi

# Key id is embedded in Apple's filename: AuthKey_<KEYID>.p8
key_id="${2:-}"
if [[ -z "$key_id" ]]; then
  base="$(basename "$p8_path")"
  key_id="${base#AuthKey_}"
  key_id="${key_id%.p8}"
fi
[[ -n "$key_id" ]] || { echo "error: could not derive key id from $p8_path" >&2; exit 1; }

issuer_id="${3:-}"
if [[ -z "$issuer_id" ]]; then
  read -r -p "Issuer ID (top of the App Store Connect API page): " issuer_id
fi
[[ -n "$issuer_id" ]] || { echo "error: issuer id is required" >&2; exit 1; }

workdir="$(mktemp -d)"
trap 'rm -rf "$workdir"' EXIT

# Export the Developer ID cert + private key as a p12 with a generated one-off
# password — it only ever lives in this secret pair, so nobody needs to type
# or remember it. Approve the keychain prompt when macOS asks.
p12_path="$workdir/developer-id.p12"
p12_pass="$(openssl rand -base64 24)"
security export -k login.keychain-db -t identities -f pkcs12 \
  -P "$p12_pass" -o "$p12_path" 2>/dev/null || {
  echo "error: keychain export failed — approve the keychain prompt and retry." >&2
  echo "       If the key is marked non-exportable, export the p12 manually from" >&2
  echo "       Keychain Access and pass it as: $0 <p8> <key-id> <issuer-id> <p12> <p12-pass>" >&2
  exit 1
}

echo "==> uploading secrets to $REPO (key id $key_id)"
gh secret set MACOS_CERTIFICATE_P12 --repo "$REPO" --body "$(base64 -i "$p12_path")"
gh secret set MACOS_CERTIFICATE_PASSWORD --repo "$REPO" --body "$p12_pass"
gh secret set APPLE_API_KEY_BASE64 --repo "$REPO" --body "$(base64 -i "$p8_path")"
gh secret set APPLE_API_KEY_ID --repo "$REPO" --body "$key_id"
gh secret set APPLE_API_ISSUER --repo "$REPO" --body "$issuer_id"

echo "==> done:"
gh secret list --repo "$REPO"
echo
echo "Kick the pipeline with:"
echo "  gh run rerun \$(gh run list --repo $REPO --workflow=release.yml --limit 1 --json databaseId -q '.[0].databaseId') --repo $REPO"
