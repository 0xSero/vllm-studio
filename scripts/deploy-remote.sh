#!/usr/bin/env bash
# Deploy Local Studio from this machine to the remote GPU server.
#
# ─── Connection ───────────────────────────────────────────────────────────
#
#   Remote connection values are intentionally loaded from .env.local.
#   Required: REMOTE_HOST, REMOTE_USER, REMOTE_PATH.
#   Optional: REMOTE_SSH_KEY (defaults to ~/.ssh/id_ed25519).
#
# ─── What runs where ─────────────────────────────────────────────────────
#
#   Docker (infra only, stays up across deploys):
#     postgres:16       :5432   optional database service
#
#   Native on host (needs nvidia-smi + host process visibility):
#     controller (bun)  :8080   Model lifecycle, GPU stats, chat, recipes
#     frontend (next)   :3000   Web UI
#     agent-runtime     :8081   Standalone pi agent runtime sidecar (node,
#                               user systemd unit local-studio-agent-runtime).
#                               The frontend proxies its runtime/browser routes
#                               here via LOCAL_STUDIO_AGENT_RUNTIME_URL=
#                               http://127.0.0.1:8081 (exported by
#                               restart_frontend below) — required so SSE
#                               flushes through Next's standalone server.
#
#   Managed separately:
#     vLLM / SGLang     :8000   Inference (launched via controller or manually)
#
# ─── How it works ─────────────────────────────────────────────────────────
#
#   1. rsync  — push controller/src, frontend/src, shared/ to remote
#   2. install — bun install (controller), npm install (frontend)
#   3. restart — kill old process, start new one via nohup, wait for port
#   4. verify  — hit health endpoints, print GPU and model status
#
# ─── Usage ────────────────────────────────────────────────────────────────
#
#   ./scripts/deploy-remote.sh              Deploy everything
#   ./scripts/deploy-remote.sh controller   Controller only
#   ./scripts/deploy-remote.sh frontend     Frontend only
#   ./scripts/deploy-remote.sh agent-runtime  Agent-runtime sidecar only
#   ./scripts/deploy-remote.sh infra        Restart Docker infra
#   ./scripts/deploy-remote.sh status       Check what's running (no changes)

set -euo pipefail
cd "$(dirname "$0")/.."

# ─── Config ───────────────────────────────────────────────────────────────

if [[ -f .env.local ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env.local
  set +a
fi

: "${REMOTE_HOST:?Set REMOTE_HOST in .env.local}"
: "${REMOTE_USER:?Set REMOTE_USER in .env.local}"
: "${REMOTE_PATH:?Set REMOTE_PATH in .env.local}"

SSH_KEY="${REMOTE_SSH_KEY:-$HOME/.ssh/id_ed25519}"
REMOTE_DIR="$REMOTE_PATH"
REMOTE_DIR_SHELL="$(printf '%q' "$REMOTE_DIR")"

SSH_OPTS="-T -i $SSH_KEY -o ConnectTimeout=5"
REMOTE="$REMOTE_USER@$REMOTE_HOST"

# ─── Output ───────────────────────────────────────────────────────────────

_c() { printf '\033[%sm' "$1"; }
_r="$(_c 31)" _g="$(_c 32)" _y="$(_c 33)" _b="$(_c 36)" _d="$(_c 2)" _n="$(_c 0)"

step() { printf '%s==>%s %s\n' "$_b" "$_n" "$*"; }
ok()   { printf '%s  ✓%s %s\n' "$_g" "$_n" "$*"; }
warn() { printf '%s  !%s %s\n' "$_y" "$_n" "$*"; }
fail() { printf '%s  ✗%s %s\n' "$_r" "$_n" "$*"; }
dim()  { printf '%s%s%s\n' "$_d" "$*" "$_n"; }

die() { fail "$@"; exit 1; }

# ─── Helpers ──────────────────────────────────────────────────────────────

remote() { ssh $SSH_OPTS "$REMOTE" "$@"; }

# rsync a local directory to remote, excluding node_modules and build artifacts
sync_dir() {
  local src="$1" dst="$2"
  rsync -az --delete \
    --exclude 'node_modules' \
    --exclude '.next' \
    --exclude 'bun.lock' \
    --exclude '.turbo' \
    --exclude '*.test.ts' \
    --exclude 'test-output' \
    -e "ssh $SSH_OPTS" \
    "$src" "$REMOTE:$dst" 2>&1 | grep -v 'cannot delete non-empty directory' || true
}

# Wait for a port to be listening, or fail after N seconds
wait_port() {
  local port="$1" label="$2" max="${3:-10}"
  for i in $(seq 1 "$max"); do
    if remote "ss -tlnp | grep -q ':${port}\b'" 2>/dev/null; then
      return 0
    fi
    sleep 1
  done
  fail "$label not listening on :$port after ${max}s"
  remote "tail -20 /tmp/${label}-stdout.log" 2>/dev/null || true
  return 1
}

