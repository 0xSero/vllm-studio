#!/usr/bin/env bash
#
# b70-check.sh — preflight gate for the Intel Arc Pro B70s.
#
# Verifies all four conditions vLLM needs and exits non-zero if any fail:
#   1. both e223 PCI endpoints exist
#   2. both bound to xe
#   3. both have /dev/dri render nodes
#   4. both capped at 150 W (power1_cap = 150000000)
#
# Usage:
#   ./b70-check.sh            # report + exit code
#   ./b70-check.sh && start-vllm.sh
#   ./b70-check.sh --fix      # attempt service-based recovery, then re-check

set -u

TARGETS=("0000:83:00.0" "0000:c4:00.0")
EXPECTED_CAP="150000000"
FIX=0
[ "${1:-}" = "--fix" ] && FIX=1

green() { printf '  \033[32mOK\033[0m  %s\n' "$1"; }
red()   { printf '  \033[31mFAIL\033[0m %s\n' "$1"; }

run_checks() {
  local fails=0 dev short

  echo "== B70 preflight =="
  for dev in "${TARGETS[@]}"; do
    short="${dev#0000:}"
    echo "-- $dev --"

    # 1. PCI present
    if [ -e "/sys/bus/pci/devices/$dev" ]; then
      green "PCI endpoint present"
    else
      red "PCI endpoint MISSING (reboot/bus reset needed)"
      fails=$((fails+1)); echo; continue
    fi

    # 2. xe bound
    drv=""
    [ -e "/sys/bus/pci/devices/$dev/driver" ] && \
      drv="$(basename "$(readlink -f "/sys/bus/pci/devices/$dev/driver")")"
    if [ "$drv" = "xe" ]; then
      green "driver in use: xe"
    else
      red "driver NOT xe (got: '${drv:-none}')"
      fails=$((fails+1))
    fi

    # 3. render node
    if ls -l /dev/dri/by-path 2>/dev/null | grep -q "pci-$dev-render"; then
      node="$(readlink -f "/dev/dri/by-path/pci-$dev-render" 2>/dev/null)"
      green "render node: ${node:-present}"
    else
      red "no /dev/dri render node"
      fails=$((fails+1))
    fi

    # 4. power cap
    capok=0
    for h in /sys/bus/pci/devices/"$dev"/hwmon/hwmon*; do
      [ -e "$h/power1_cap" ] || continue
      cap="$(cat "$h/power1_cap" 2>/dev/null)"
      if [ "$cap" = "$EXPECTED_CAP" ]; then capok=1; break; fi
    done
    if [ "$capok" = 1 ]; then
      green "power cap = ${EXPECTED_CAP} uW (150 W)"
    else
      red "power cap != ${EXPECTED_CAP} (got: '${cap:-none}')"
      fails=$((fails+1))
    fi
    echo
  done

  return "$fails"
}

run_checks
result=$?

if [ "$result" -ne 0 ] && [ "$FIX" -eq 1 ]; then
  echo ">> failures detected; attempting recovery via intel-xe-power-cap.service"
  sudo systemctl restart intel-xe-power-cap.service || \
    sudo /usr/local/sbin/set-intel-xe-power-cap
  sleep 2
  echo
  run_checks
  result=$?
fi

if [ "$result" -eq 0 ]; then
  echo "ALL CHECKS PASSED — safe to start vLLM on the B70s."
else
  echo "PREFLIGHT FAILED ($result issue[s]) — do NOT start vLLM. See B70-RECOVERY-GUIDE.md."
fi
exit "$result"
