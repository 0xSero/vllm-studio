#!/usr/bin/env bash
#
# install.sh — install/upgrade the B70 recovery + power-cap stack consistently.
#
# Idempotent: safe to re-run after every repo change. This is the ONLY supported
# way to update the box — never hand-edit /usr/local/sbin or /etc/systemd.
#
# Usage (on the GPU host, from this directory):
#   sudo ./install.sh            # install/upgrade + enable + start + verify
#   sudo ./install.sh --no-start # install only (no enable/start), still verify presence
#
# Exit non-zero if the post-install health check fails.

set -euo pipefail

SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SBIN="/usr/local/sbin/set-intel-xe-power-cap"
UNIT="/etc/systemd/system/intel-xe-power-cap.service"
CHECK="/usr/local/sbin/b70-check"
NO_START=0
[ "${1:-}" = "--no-start" ] && NO_START=1

if [ "$(id -u)" -ne 0 ]; then
  echo "ERROR: run as root (sudo ./install.sh)" >&2
  exit 1
fi

echo "== installing B70 stack from $SRC_DIR =="

# 1. Recovery/cap script
install -m 0755 "$SRC_DIR/set-intel-xe-power-cap" "$SBIN"
echo "  installed $SBIN"

# 2. Preflight checker (system-wide, so the vLLM unit and humans share it)
install -m 0755 "$SRC_DIR/b70-check.sh" "$CHECK"
echo "  installed $CHECK"

# 2b. Runtime watchdog
install -m 0755 "$SRC_DIR/b70-watchdog.sh" "/usr/local/sbin/b70-watchdog"
echo "  installed /usr/local/sbin/b70-watchdog"

# 3. systemd unit
install -m 0644 "$SRC_DIR/intel-xe-power-cap.service" "$UNIT"
echo "  installed $UNIT"

# 3b. watchdog unit + timer
install -m 0644 "$SRC_DIR/b70-watchdog.service" "/etc/systemd/system/b70-watchdog.service"
install -m 0644 "$SRC_DIR/b70-watchdog.timer"   "/etc/systemd/system/b70-watchdog.timer"
echo "  installed b70-watchdog.service + .timer"

# 4. (Optional) vLLM unit if present in repo
if [ -f "$SRC_DIR/b70-vllm.service" ]; then
  install -m 0644 "$SRC_DIR/b70-vllm.service" "/etc/systemd/system/b70-vllm.service"
  echo "  installed /etc/systemd/system/b70-vllm.service"
fi

systemctl daemon-reload
echo "  systemctl daemon-reload done"

if [ "$NO_START" -eq 0 ]; then
  systemctl enable --now intel-xe-power-cap.service
  echo "  enabled + started intel-xe-power-cap.service"
  systemctl enable --now b70-watchdog.timer
  echo "  enabled + started b70-watchdog.timer"
  # Give bind + render node creation a moment.
  sleep 2
fi

echo
echo "== post-install health check =="
if "$CHECK"; then
  echo "INSTALL OK"
else
  echo "INSTALL COMPLETED BUT HEALTH CHECK FAILED — investigate before serving." >&2
  echo "See B70-RECOVERY-GUIDE.md (escalation tree)." >&2
  exit 1
fi
