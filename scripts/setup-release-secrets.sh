#!/usr/bin/env bash
# One-time: push the five signing/notarization secrets to GitHub so the
# Release workflow can build the DMG in CI. Run this YOURSELF — it reads your
# keychain and your App Store Connect key and uploads them with `gh secret set`.
#
# Why this exists: release.yml has hard `test -n` guards on these five secrets
# (added in b757857c when releases started shipping real DMGs). The secrets
# were never added, so every CI release since 2026-07-23 has failed at that
# step. The green runs before that date were tag+notes only — no DMG.
#
#   Prereqs:
#     1. The "Developer ID Application: sherif cherfa (TZ447KHNZL)" identity in
#        your login keychain (it is there — `security find-identity` lists it).
#     2. An App Store Connect API key (.p8) with the Developer role:
#        appstoreconnect.apple.com -> Users and Access -> Integrations ->
#        App Store Connect API -> Team Keys -> Generate. Download the .p8 —
#        Apple lets you download it exactly once.
#
#   Usage: scripts/setup-release-secrets.sh <AuthKey_XXXXXX.p8> <key-id> <issuer-id>
set -euo pipefail

REPO="sybil-solutions/local-studio"
IDENTITY="Developer ID Application: sherif cherfa (TZ447KHNZL)"

if [[ $# -ne 3 ]]; then
  echo "usage: $0 <path-to-AuthKey.p8> <key-id> <issuer-id>" >&2
  exit 2
fi
p8_path="$1"; key_id="$2"; issuer_id="$3"
[[ -f "$p8_path" ]] || { echo "error: no file at $p8_path" >&2; exit 1; }

workdir="$(mktemp -d)"
trap 'rm -rf "$workdir"' EXIT

# Export the Developer ID cert + private key as a passworded p12. macOS makes
# you pick the password interactively in the keychain prompt; feed the same one
# below so CSC_KEY_PASSWORD matches.
p12_path="$workdir/developer-id.p12"
read -r -s -p "Choose a one-off password for the exported certificate: " p12_pass; echo
security export -k login.keychain-db -t identities -f pkcs12 \
  -P "$p12_pass" -o "$p12_path" 2>/dev/null || {
  echo "error: keychain export failed — approve the keychain prompt and retry" >&2
  exit 1
}

echo "==> uploading secrets to $REPO"
gh secret set MACOS_CERTIFICATE_P12 --repo "$REPO" --body "$(base64 -i "$p12_path")"
gh secret set MACOS_CERTIFICATE_PASSWORD --repo "$REPO" --body "$p12_pass"
gh secret set APPLE_API_KEY_BASE64 --repo "$REPO" --body "$(base64 -i "$p8_path")"
gh secret set APPLE_API_KEY_ID --repo "$REPO" --body "$key_id"
gh secret set APPLE_API_ISSUER --repo "$REPO" --body "$issuer_id"

echo "==> done:"
gh secret list --repo "$REPO"
echo
echo "Re-run the failed Release workflow with:"
echo "  gh run rerun \$(gh run list --repo $REPO --workflow=release.yml --limit 1 --json databaseId -q '.[0].databaseId') --repo $REPO"
