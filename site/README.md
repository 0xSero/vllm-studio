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

All download buttons currently point at
`https://github.com/sybil-solutions/local-studio/releases/latest`.
When installer assets are published, switch to direct links using the
canonical pattern:

```
https://github.com/sybil-solutions/local-studio/releases/latest/download/<asset>
```
