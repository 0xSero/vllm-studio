# Local Studio — product site

Pure static site: `index.html`, `site.css`, and a tiny `site.js` for OS
detection. No build step, no external requests (no CDN fonts, scripts, or
remote images).

## Serve locally

```sh
cd site
python3 -m http.server 8000
# open http://localhost:8000
```

## Deploy

Copy the three files (plus this README if you like) to any static host —
GitHub Pages, Cloudflare Pages, Netlify, an nginx root. No configuration
needed.

## Download links

The macOS button links direct to the latest release asset:

```
https://github.com/sybil-solutions/local-studio/releases/latest/download/Local-Studio-arm64.dmg
```

The `Local-Studio-arm64.dmg` (and `Local-Studio-arm64-mac.zip`) assets are
attached to the latest GitHub release. Windows (`.exe`) and Linux
(`.AppImage`) installers are not built yet; those rows fall back to the
releases page until they ship.
