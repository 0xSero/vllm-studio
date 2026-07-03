# Publish the desktop app (one-click download)

The signed macOS build is done and staged. Publishing is left as a manual step
because `gh release ... --latest` repoints `releases/latest` on the public repo
(what every existing user's "latest" resolves to) — an outward-facing change I
didn't want to make while you were away.

## What's ready
- Signed, un-notarized macOS arm64 build:
  - `frontend/dist-desktop/Local Studio-0.2.9-arm64.dmg`
  - `frontend/dist-desktop/Local Studio-0.2.9-arm64-mac.zip`
- Staged under stable, URL-safe names the site links to:
  - `release-staging/Local-Studio-arm64.dmg`
  - `release-staging/Local-Studio-arm64-mac.zip`
- Site (`site/`) points the macOS button at
  `releases/latest/download/Local-Studio-arm64.dmg`. It works the instant the
  release below exists.

## Publish (one command)
Pick a tag above the highest origin tag so semantic-release doesn't collide
(see [[reference-release-process]] — origin is on the v1.x train):

```bash
gh release create desktop-v0.2.9 \
  "release-staging/Local-Studio-arm64.dmg" \
  "release-staging/Local-Studio-arm64-mac.zip" \
  --title "Local Studio 0.2.9 (desktop)" \
  --notes "macOS (Apple silicon) desktop build. Onboarding ships three starter models; deploy a controller and add connectors from the app." \
  --latest
```

If you'd rather NOT move `latest` (keep the v1.x semantic-release train as
latest), drop `--latest` and instead update the site links from
`releases/latest/download/<asset>` to
`releases/download/desktop-v0.2.9/<asset>`.

## Notarization (optional, removes Gatekeeper prompt)
The build is signed with your Developer ID but **not notarized** (electron-builder
skipped it: no notarize credentials in env). To notarize, set
`APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` and rerun
`npm run desktop:dist` from `frontend/`.

## Windows / Linux
Not built (electron-builder ran on macOS; cross-building needs wine/docker).
The site labels them "on the way" and links to the releases page. Build on the
respective OS (or CI) with `npm run desktop:dist:win` / `:linux`.
