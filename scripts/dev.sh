#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STACK_AGENT_TOKEN="$(
  node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("base64url"))'
)"
export LOCAL_STUDIO_AGENT_LIFECYCLE_TOKEN="$STACK_AGENT_TOKEN"
export LOCAL_STUDIO_PROVISIONING_TOKEN="$STACK_AGENT_TOKEN"

port_owner() {
  lsof -nP -iTCP:"$1" -sTCP:LISTEN -t 2>/dev/null | head -n 1
}

BUSY=0
for PORT_SPEC in "3000:frontend" "8080:controller" "8081:agent runtime"; do
  PORT="${PORT_SPEC%%:*}"
  SERVICE="${PORT_SPEC#*:}"
  OWNER="$(port_owner "$PORT" || true)"
  if [[ -n "$OWNER" ]]; then
    printf 'Cannot start %s: port %s is already held by PID %s\n' "$SERVICE" "$PORT" "$OWNER" >&2
    BUSY=1
  fi
done

if [[ "$BUSY" -ne 0 ]]; then
  printf 'Stop the existing stack, or use npm run dev:frontend to connect to existing services.\n' >&2
  exit 1
fi

cleanup() {
  unset LOCAL_STUDIO_AGENT_LIFECYCLE_TOKEN LOCAL_STUDIO_PROVISIONING_TOKEN STACK_AGENT_TOKEN
  if [[ -n "${CONTROLLER_PID:-}" ]]; then
    kill "$CONTROLLER_PID" 2>/dev/null || true
  fi
  if [[ -n "${FRONTEND_PID:-}" ]]; then
    kill "$FRONTEND_PID" 2>/dev/null || true
  fi
}

trap cleanup EXIT INT TERM

(cd "$ROOT/controller" && bun run dev) &
CONTROLLER_PID=$!

(cd "$ROOT/frontend" && npm run dev) &
FRONTEND_PID=$!

while kill -0 "$CONTROLLER_PID" 2>/dev/null && kill -0 "$FRONTEND_PID" 2>/dev/null; do
  sleep 1
done

STATUS=0
if ! kill -0 "$CONTROLLER_PID" 2>/dev/null; then
  wait "$CONTROLLER_PID" || STATUS=$?
fi
if ! kill -0 "$FRONTEND_PID" 2>/dev/null; then
  wait "$FRONTEND_PID" || STATUS=$?
fi

cleanup
wait "$CONTROLLER_PID" 2>/dev/null || true
wait "$FRONTEND_PID" 2>/dev/null || true
exit "$STATUS"
