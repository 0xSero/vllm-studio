#!/usr/bin/env bash
#
# b70-watchdog.sh — runtime watchdog for the Intel Arc Pro B70s.
#
# Polls B70 health. On a detected drop it:
#   1. CAPTURES a timestamped diagnostic snapshot (resolves "state A vs B":
#      still-in-lspci-but-unbound  vs  vanished-from-PCI).
#   2. STOPS the vLLM unit so it releases the device (do NOT re-bind underneath
#      a running vLLM — that is useless and can wedge worse).
#   3. Attempts ONLY non-destructive recovery (enable + xe bind + cap) via the
#      existing recovery script. Never does a PCI remove/reset/bridge-SBR.
#   4. ALERTS (journal + state file + optional hook), and leaves vLLM stopped
#      so a human decides whether to restart or escalate.
#
# It does NOT silently bounce the model in a loop. After recovery it writes a
# clear verdict and stops. Per the operator's choice: "stop vLLM + alert".
#
# Run via b70-watchdog.timer (every 30s) or as a long-running service.
#
# Env:
#   B70_VLLM_UNIT      systemd unit to stop on drop (default: b70-vllm.service)
#   B70_ALERT_HOOK     optional executable, called as: $hook <state> <snapshot>
#   B70_STATE_DIR      where snapshots/markers go (default: /var/log/b70)

set -u

TARGETS=("0000:83:00.0" "0000:c4:00.0")
EXPECTED_CAP="150000000"
VLLM_UNIT="${B70_VLLM_UNIT:-b70-vllm.service}"
STATE_DIR="${B70_STATE_DIR:-/var/log/b70}"
ALERT_HOOK="${B70_ALERT_HOOK:-}"
RECOVER="/usr/local/sbin/set-intel-xe-power-cap"
# Allow automatic PCIe bridge secondary-bus reset (SBR) as a last resort for
# MMIO-dead / vanished cards. SAFE ONLY when each B70 is alone under its bridge
# (verified on this host: 83->82:01.0, c4->c3:01.0). Set to 0 to disable.
ALLOW_BRIDGE_SBR="${B70_ALLOW_BRIDGE_SBR:-1}"
HEALTHY_MARKER="$STATE_DIR/healthy"
ALERT_MARKER="$STATE_DIR/ALERT"

mkdir -p "$STATE_DIR"

log() { logger -t b70-watchdog "$*" 2>/dev/null; echo "[b70-watchdog] $*"; }

# Parent bridge BDF of a given endpoint (e.g. 0000:83:00.0 -> 0000:82:01.0).
parent_bridge() {
  local dev="$1" path
  path="$(readlink -f "/sys/bus/pci/devices/$dev" 2>/dev/null)" || return 1
  basename "$(dirname "$path")"
}

# Safety check: bridge must have exactly ONE endpoint downstream (our B70),
# so an SBR cannot disturb sibling devices (other B70 / RTX / NVMe).
bridge_is_isolated() {
  local bridge="$1" sec sec_hex n
  sec="$(cat /sys/bus/pci/devices/$bridge/secondary_bus_number 2>/dev/null)" || return 1
  # secondary_bus_number is DECIMAL; PCI BDFs are HEX. Convert.
  sec_hex="$(printf '%02x' "$sec")" || return 1
  # count functions on the secondary bus
  n="$(ls -d /sys/bus/pci/devices/0000:${sec_hex}:* 2>/dev/null | wc -l)"
  [ "$n" -le 1 ]
}

# PCIe secondary-bus reset on the parent bridge: remove the endpoint, pulse
# BRIDGE_CONTROL bit 6 (SBR), then rescan. Last resort for MMIO-dead/vanished.
bridge_sbr() {
  local dev="$1" bridge bc
  bridge="$(parent_bridge "$dev")" || { log "$dev: cannot resolve parent bridge"; return 1; }

  if [ "$ALLOW_BRIDGE_SBR" != "1" ]; then
    log "$dev: bridge SBR disabled (B70_ALLOW_BRIDGE_SBR!=1); manual reboot needed"
    return 1
  fi
  if ! bridge_is_isolated "$bridge"; then
    log "$dev: bridge $bridge NOT isolated (siblings present) -- refusing SBR; manual reboot needed"
    return 1
  fi

  log "$dev: escalating to bridge SBR on $bridge (isolated)"
  # Detach endpoint if still present.
  if [ -e "/sys/bus/pci/devices/$dev/remove" ]; then
    echo 1 > "/sys/bus/pci/devices/$dev/remove" 2>/dev/null || true
    sleep 1
  fi
  # Pulse secondary bus reset (bit 6 = 0x40) on the bridge.
  bc="$(setpci -s "$bridge" BRIDGE_CONTROL 2>/dev/null)" || bc="0000"
  setpci -s "$bridge" BRIDGE_CONTROL="$(printf '%04x' $((0x$bc | 0x40)))" 2>/dev/null || true
  sleep 1
  setpci -s "$bridge" BRIDGE_CONTROL="$bc" 2>/dev/null || true
  sleep 1
  # Re-enumerate.
  echo 1 > /sys/bus/pci/rescan 2>/dev/null || true
  sleep 2
  # Re-apply enable/bind/cap.
  [ -x "$RECOVER" ] && "$RECOVER" || true
  sleep 2
}

# Returns 0 if all cards healthy, 1 otherwise. Sets global UNHEALTHY_DETAIL.
check_health() {
  UNHEALTHY_DETAIL=""
  local dev drv ok=0 bad=0
  for dev in "${TARGETS[@]}"; do
    if [ ! -e "/sys/bus/pci/devices/$dev" ]; then
      UNHEALTHY_DETAIL+="$dev: VANISHED-from-PCI(stateB); "
      bad=1; continue
    fi
    drv=""
    [ -e "/sys/bus/pci/devices/$dev/driver" ] && \
      drv="$(basename "$(readlink -f "/sys/bus/pci/devices/$dev/driver")")"
    if [ "$drv" != "xe" ]; then
      UNHEALTHY_DETAIL+="$dev: present-but-driver='${drv:-none}'(stateA); "
      bad=1; continue
    fi
    if ! ls /dev/dri/by-path 2>/dev/null | grep -q "pci-$dev-render"; then
      UNHEALTHY_DETAIL+="$dev: bound-but-no-render-node; "
      bad=1; continue
    fi
    ok=$((ok+1))
  done
  [ "$bad" -eq 0 ] && return 0 || return 1
}

# Capture everything needed to classify the failure later.
capture_snapshot() {
  local ts snap
  ts="$(date +%Y%m%d-%H%M%S)"
  snap="$STATE_DIR/drop-$ts.txt"
  {
    echo "=== B70 drop snapshot $ts ==="
    echo "detail: $UNHEALTHY_DETAIL"
    echo
    echo "--- lspci (e223) ---"
    lspci -nn 2>/dev/null | grep -i e223 || echo "(no e223 in lspci -> VANISHED / state B)"
    echo
    for dev in "${TARGETS[@]}"; do
      echo "--- $dev sysfs ---"
      if [ -e "/sys/bus/pci/devices/$dev" ]; then
        echo "present=yes"
        echo "enable=$(cat /sys/bus/pci/devices/$dev/enable 2>/dev/null)"
        echo "power_state=$(cat /sys/bus/pci/devices/$dev/power_state 2>/dev/null)"
        echo "power/control=$(cat /sys/bus/pci/devices/$dev/power/control 2>/dev/null)"
        [ -e "/sys/bus/pci/devices/$dev/driver" ] && \
          echo "driver=$(basename "$(readlink -f /sys/bus/pci/devices/$dev/driver)")" || echo "driver=none"
      else
        echo "present=NO (state B: needs reboot or bridge SBR)"
      fi
      echo
    done
    echo "--- recent dmesg (xe / pcie / D3 / wedged / forcewake / GuC) ---"
    dmesg 2>/dev/null | grep -iE 'xe |pcieport|D3cold|D3hot|wedged|forcewake|GuC|reset' | tail -n 40
  } > "$snap" 2>&1
  echo "$snap"
}

# --- main single pass ---

if check_health; then
  # Healthy: clear any stale alert, refresh marker, done.
  date +%s > "$HEALTHY_MARKER"
  [ -f "$ALERT_MARKER" ] && { log "B70s recovered to healthy state"; rm -f "$ALERT_MARKER"; }
  exit 0
fi

# Avoid alert storms: if we already alerted and nothing changed, stay quiet.
if [ -f "$ALERT_MARKER" ]; then
  exit 0
fi

log "DROP DETECTED: $UNHEALTHY_DETAIL"
SNAP="$(capture_snapshot)"
log "snapshot: $SNAP"

# Classify for the verdict.
STATE="A"
grep -q "VANISHED" <<<"$UNHEALTHY_DETAIL" && STATE="B"

# 1. Stop vLLM so it releases the device before any recovery attempt.
log "stopping $VLLM_UNIT to release device"
systemctl stop "$VLLM_UNIT" 2>/dev/null || true

# 2. Tiered recovery: enable/bind  ->  bridge SBR  (escalating).
VERDICT=""

# Tier 1: non-destructive (only meaningful if the card is still present).
if [ "$STATE" = "A" ] && [ -x "$RECOVER" ]; then
  log "tier1: non-destructive recovery (enable + xe bind + cap)"
  "$RECOVER" || true
  sleep 2
  if check_health; then
    log "RECOVERED (tier1 enable/bind). vLLM left STOPPED for human review/restart."
    VERDICT="RECOVERED_STATE_A_tier1_vllm_stopped"
  fi
fi

# Tier 2: bridge secondary-bus reset for MMIO-dead (stuck state A) or vanished
# (state B) cards. Safe here because each B70 is alone under its bridge.
if [ -z "$VERDICT" ]; then
  log "tier1 insufficient (state=$STATE); escalating to tier2 bridge SBR"
  # Determine which target(s) are unhealthy and SBR each.
  for dev in "${TARGETS[@]}"; do
    drv=""
    [ -e "/sys/bus/pci/devices/$dev/driver" ] && \
      drv="$(basename "$(readlink -f "/sys/bus/pci/devices/$dev/driver")")"
    present=0; [ -e "/sys/bus/pci/devices/$dev" ] && present=1
    if [ "$present" -eq 0 ] || [ "$drv" != "xe" ]; then
      bridge_sbr "$dev" || true
    fi
  done
  if check_health; then
    log "RECOVERED via tier2 bridge SBR. vLLM left STOPPED for human review/restart."
    VERDICT="RECOVERED_via_bridge_SBR_vllm_stopped"
  elif [ "$STATE" = "B" ]; then
    VERDICT="FAILED_STATE_B_SBR_did_not_help_needs_reboot"
  else
    VERDICT="FAILED_STATE_A_SBR_did_not_help_needs_reboot"
  fi
fi

# 3. Alert: marker + journal + optional hook.
{
  echo "verdict=$VERDICT"
  echo "detail=$UNHEALTHY_DETAIL"
  echo "snapshot=$SNAP"
  echo "time=$(date -Is)"
} > "$ALERT_MARKER"
log "ALERT: $VERDICT (see $SNAP). vLLM remains stopped."

if [ -n "$ALERT_HOOK" ] && [ -x "$ALERT_HOOK" ]; then
  "$ALERT_HOOK" "$VERDICT" "$SNAP" || true
fi

exit 1
