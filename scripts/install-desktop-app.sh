#!/usr/bin/env bash
# Install the freshly built Local Studio desktop bundle into /Applications.
#
# Replaces the app IN PLACE and keeps exactly ONE rollback copy, always at the
# same path. Earlier turns each hand-rolled a `mv … .pre-<slug>` backup before
# installing, which left a pile of 1.2 GB bundles in /Applications — every one
# of them showing up in Launchpad as a separate "Local Studio" app.
#
#   Usage: scripts/install-desktop-app.sh [--no-backup]
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUILT="$REPO_ROOT/frontend/dist-desktop/mac-arm64/Local Studio.app"
TARGET="/Applications/Local Studio.app"
ROLLBACK="/Applications/Local Studio.app.previous"

keep_backup=1
[[ "${1:-}" == "--no-backup" ]] && keep_backup=0

if [[ ! -d "$BUILT" ]]; then
  echo "error: no built bundle at $BUILT" >&2
  echo "       run: npm --prefix frontend run desktop:dist" >&2
  exit 1
fi

# Refuse to install a bundle the packager left unsigned/incomplete.
if [[ ! -x "$BUILT/Contents/MacOS/Local Studio" ]]; then
  echo "error: built bundle has no executable — packaging did not finish" >&2
  exit 1
fi

echo "==> quitting Local Studio (if running)"
osascript -e 'tell application "Local Studio" to quit' >/dev/null 2>&1 || true
# Give the app a moment to release its files before we swap the bundle.
for _ in 1 2 3 4 5 6 7 8 9 10; do
  pgrep -f "Local Studio.app/Contents/MacOS/Local Studio" >/dev/null || break
  sleep 0.5
done
pkill -f "Local Studio.app/Contents/MacOS/Local Studio" >/dev/null 2>&1 || true

# A left-over mounted DMG is why "the rebuild did nothing": `open -a` resolves
# by bundle id and picks the HIGHEST version it can see, so a stale
# /Volumes/Local Studio <newer>-arm64 wins over the copy we just installed.
while IFS= read -r vol; do
  [[ -z "$vol" ]] && continue
  echo "==> ejecting stale disk image $vol"
  hdiutil detach "$vol" -quiet || hdiutil detach "$vol" -force -quiet || true
done < <(ls -d /Volumes/Local\ Studio* 2>/dev/null || true)

# Orphaned servers from an earlier run keep serving OLD code on :3000/:8081 and
# the relaunched app happily reuses them, so the new build never actually runs.
for port in 3000 8081; do
  pid="$(lsof -nP -iTCP:"$port" -sTCP:LISTEN -t 2>/dev/null | head -1)"
  [[ -n "$pid" ]] || continue
  echo "==> stopping stale server on :$port (pid $pid)"
  kill "$pid" 2>/dev/null || true
done

if [[ -d "$TARGET" ]]; then
  if (( keep_backup )); then
    echo "==> rotating current install -> $ROLLBACK"
    rm -rf "$ROLLBACK"
    mv "$TARGET" "$ROLLBACK"
  else
    echo "==> removing current install (no backup requested)"
    rm -rf "$TARGET"
  fi
fi

echo "==> installing $TARGET"
# ditto preserves signatures and extended attributes; cp -R does not.
ditto "$BUILT" "$TARGET"

echo "==> verifying signature"
codesign --verify --deep --strict "$TARGET" || {
  echo "error: signature verification failed" >&2
  exit 1
}

# Point Launch Services at this exact bundle so `open -a "Local Studio"` cannot
# resolve to some other copy still registered from a previous build.
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister \
  -f "$TARGET" >/dev/null 2>&1 || true

echo "==> done. rollback copy: $ROLLBACK"
echo "    launch with: open \"$TARGET\"   (path, not -a, so the right copy wins)"
