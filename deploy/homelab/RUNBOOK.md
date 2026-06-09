# Homelab lockdown runbook — Tailscale-only app/api.homelabai.org

Goal: make `app.homelabai.org` (frontend) and `api.homelabai.org` (controller)
reachable **only** over the Tailscale network, keep the URLs, and deploy the
hardened code. pop-os Tailscale IP: `100.90.62.80`.

> ⚠️ Cutover order matters. The hardened frontend defaults to **locked** in
> production when no token is set. You must set `VLLM_STUDIO_FRONTEND_TOKEN`
> (or `VLLM_STUDIO_FRONTEND_ALLOW_NO_AUTH=true`) **before/at** the moment you
> deploy the new frontend, or the web UI returns 503.

## Secrets (generate fresh; never commit)

```
# Frontend access token (browser presents once via ?token=, then cookie)
VLLM_STUDIO_FRONTEND_TOKEN=<openssl rand -hex 32>
# Rotated controller API key (the old hlai… key was exposed in chat — rotate it)
VLLM_STUDIO_API_KEY=<openssl rand -hex 32, with your hlai_ prefix if you like>
```

## 1. Point DNS at the Tailscale IP (Cloudflare)

For both records (proxy **off** / DNS-only, grey cloud):

```
app.homelabai.org  A  100.90.62.80
api.homelabai.org  A  100.90.62.80
```

Off-tailnet clients will resolve the address but cannot route to it.

## 2. Install Caddy with the Cloudflare DNS module on pop-os

```
xcaddy build --with github.com/caddy-dns/cloudflare   # or download a build with the module
sudo mv caddy /usr/local/bin/caddy
```

Provide the Cloudflare token (Zone:DNS:Edit + Zone:Read on homelabai.org) to
Caddy's environment, then run with `deploy/homelab/Caddyfile`. Run Caddy as a
user or system service with `CLOUDFLARE_API_TOKEN` set.

## 3. Bind the frontend to loopback

The frontend currently listens on `*:3000`; behind Caddy it should be
`127.0.0.1:3000`. For the Next standalone server set `HOSTNAME=127.0.0.1` in
the `vllm-studio-frontend.service` environment (the standalone `server.js`
reads `HOSTNAME`/`PORT`). The controller already binds `127.0.0.1:8080`.

## 4. Set environment and deploy the hardened code

On pop-os, in the controller and frontend unit environments (or their `.env`):

```
# controller
VLLM_STUDIO_API_KEY=<rotated key>
VLLM_STUDIO_DEFAULT_TRUST_REMOTE_CODE=true     # you run REAP/Qwen builds that need it
# (leave VLLM_STUDIO_ALLOW_CUSTOM_LAUNCH_COMMAND / _RUNTIME_UPGRADE_COMMAND off
#  unless you rely on raw launch/upgrade commands)

# frontend
VLLM_STUDIO_FRONTEND_TOKEN=<frontend token>    # OR VLLM_STUDIO_FRONTEND_ALLOW_NO_AUTH=true
HOSTNAME=127.0.0.1
```

Deploy via the existing flow (scp working tree + `systemctl --user restart`).
Note: restarting the controller **kills the running model** — relaunch via
`POST /launch/:recipeId` afterward.

## 5. Disconnect the public path

Once Tailscale access is confirmed working, remove the cloudflared ingress for
these hostnames (cloudflared was already `inactive` at audit time — confirm it
is not re-enabled for app/api).

## 6. Verify

- From a tailnet device: `https://app.homelabai.org/?token=<frontend token>` →
  loads, sets cookie; subsequent navigation works.
- `https://api.homelabai.org/health` → 200; mutating calls require the rotated
  key.
- From a non-tailnet network: both hostnames resolve to `100.90.62.80` but
  connections time out.

## Open items to confirm before cutover

- `vllm-studio-controller.service` and `vllm-studio-frontend.service` were both
  in `activating auto-restart` (crash loop?). Confirm which units are
  authoritative vs. the `-b70` lane before restarting anything.
- Cloudflare API token with DNS edit rights (needed for both step 1 and the
  Caddy DNS-01 in step 2).
