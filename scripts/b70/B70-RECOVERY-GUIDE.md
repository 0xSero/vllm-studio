# B70 Recovery Guide

Operational guide for the two **Intel Arc Pro B70** GPUs (Battlemage, PCI id
`8086:e223`) on the AMD EPYC host that also carries four RTX Pro 6000s.

> TL;DR: the B70s have **two independent "back" states** — PCI enumeration and
> `xe` driver bind. vLLM/XPU only works when *both* are true and the cards are
> capped at 150 W. If a card is present but unbound, the recovery service fixes
> it. If a card has vanished from the PCI bus entirely, only a reboot or a real
> bus reset brings it back.

---

## 1. The two layers of "being back"

### Layer 1 — PCI enumeration

The OS sees the physical endpoint:

```text
83:00.0 Intel e223
c4:00.0 Intel e223
```

### Layer 2 — driver/runtime availability

The `xe` driver must actually bind to those endpoints and create
`/dev/dri/renderD*` nodes. Only then do XPU devices exist for vLLM.

The failure that bit us: after reboot, both B70 PCI endpoints reappeared but
were **disabled and unbound**:

```text
Kernel modules: xe
no driver
enable=0
```

Linux could see the cards; `xe` had not attached; no render nodes; no XPU
devices for vLLM.

---

## 2. Manual recovery (present-but-unbound)

This is exactly what fixed it, parameterized per card:

```bash
for dev in 0000:83:00.0 0000:c4:00.0; do
  echo 1   | sudo tee /sys/bus/pci/devices/$dev/enable
  echo on  | sudo tee /sys/bus/pci/devices/$dev/power/control
  echo $dev | sudo tee /sys/bus/pci/drivers/xe/bind
done
```

Expected result — both bound and given render nodes:

```text
83:00.0 -> /dev/dri/renderD132
c4:00.0 -> /dev/dri/renderD133
```

That is the state vLLM needs.

> If `xe/bind` errors with "No such device", the card is still wedged in a bad
> power state. Try the escalation in §6 before concluding it needs a reboot.

---

## 3. Persistent service

The boot service does four things per card, **skipping absent cards and exiting
cleanly** (the old version failed the whole unit when one card was missing):

1. Enable the PCI endpoint (`enable -> 1`)
2. Force PCI runtime power control on (`power/control -> on`)
3. Bind `xe` if not already bound
4. Apply the 150 W cap via xe hwmon (`power1_cap -> 150000000`)

Files in this directory:

| File | Installed path |
| --- | --- |
| `set-intel-xe-power-cap` | `/usr/local/sbin/set-intel-xe-power-cap` |
| `intel-xe-power-cap.service` | `/etc/systemd/system/intel-xe-power-cap.service` |

Install / update:

```bash
sudo install -m 0755 set-intel-xe-power-cap /usr/local/sbin/set-intel-xe-power-cap
sudo install -m 0644 intel-xe-power-cap.service /etc/systemd/system/intel-xe-power-cap.service
sudo systemctl daemon-reload
sudo systemctl enable --now intel-xe-power-cap.service
journalctl -u intel-xe-power-cap.service -b --no-pager
```

Targets `0000:83:00.0` and `0000:c4:00.0`; applies `150000000` µW = **150 W**.

Key behavior change vs the old script: a **missing card is a warning, not a
failure**. The script always `exit 0`, so one dropped B70 can never wedge boot.

---

## 4. Health check — run before every vLLM start

```bash
# 1. Both PCI endpoints present?
lspci -nn | egrep -i '8086:e223|8086:e2f7'
# Expect both functions:
#   83:00.0 ... [8086:e223]
#   c4:00.0 ... [8086:e223]

# 2. xe actually bound?
for d in 83:00.0 c4:00.0; do lspci -nnk -s $d | sed -n '1,4p'; echo; done
# Expect: "Kernel driver in use: xe"

# 3. Render nodes present?
ls -l /dev/dri/by-path
# Expect:
#   pci-0000:83:00.0-render -> ../renderD132
#   pci-0000:c4:00.0-render -> ../renderD133

# 4. 150 W cap applied?
for b in 0000:83:00.0 0000:c4:00.0; do
  for h in /sys/bus/pci/devices/$b/hwmon/hwmon*; do
    [ -e "$h/name" ] && echo "$b $(cat $h/name) cap=$(cat $h/power1_cap)"
  done
done
# Expect: cap=150000000
```

A one-shot version of this lives in `b70-check.sh` (§8). **If any of the four
checks fail, fix the driver binding first. Do not start the model into a
half-bound B70 state.**

---

## 5. Power caps (both GPU families)

RTX Pro 6000s — NVIDIA tooling, expect 275 W:

```bash
nvidia-smi --query-gpu=index,pci.bus_id,name,power.limit,power.draw --format=csv
# power.limit = 275 W
```

B70s — xe hwmon, expect 150000000 µW:

```bash
for b in 0000:83:00.0 0000:c4:00.0; do
  for h in /sys/bus/pci/devices/$b/hwmon/hwmon*; do
    [ -e "$h/name" ] && echo "$b $(cat $h/name) cap=$(cat $h/power1_cap)"
  done
done
```

---

## 6. Why it drops, and how to escalate

This is an Intel `xe` + PCIe power-management interaction on this AMD platform.
The card fails to return cleanly from a low-power (D3cold/D3hot) state and gets
wedged. Symptoms in `dmesg`:

```text
Unable to change power state from D3cold to D0
GuC reset timed out
forcewake register returns 0xffffffff
device declared wedged
```

**Confirmed upstream:** the kernel `xe` driver disabled D3cold for *all*
Battlemage GPUs for ~a year due to exactly these D3cold→D0 transition failures.
A Linux 6.20/7.0-era patch only re-enables it for known-good platforms (it still
blocks the NUC13RNG). So this is a recognized Battlemage power-state bug, not a
local misconfiguration. Source: Phoronix, "Intel Xe Linux Driver Will No Longer
Block D3cold For All Battlemage GPUs" (2026-02-05).

**Recovery decision tree:**

- **Present but unbound/disabled** → §2 manual recovery (or restart the service).
- **`xe/bind` fails with the card still present** → try a Function-Level Reset
  before rebooting:

  ```bash
  dev=0000:83:00.0
  echo 1 | sudo tee /sys/bus/pci/devices/$dev/remove   # detach from kernel
  echo 1 | sudo tee /sys/bus/pci/rescan                  # re-enumerate
  # then re-run the recovery service:
  sudo systemctl restart intel-xe-power-cap.service
  ```

  If the function exposes reset support, this also works:

  ```bash
  echo 1 | sudo tee /sys/bus/pci/devices/0000:83:00.0/reset
  ```

- **Endpoint gone from `lspci` entirely** → no software path recovers it.
  Reboot (or a real secondary-bus reset on the slot's bridge). Do not waste
  time on bind tricks.

---

## 6b. It keeps dropping at/after vLLM startup

A drop that reliably happens **when vLLM starts** (not random idle) is a
different, more fixable beast than a random idle D3cold wedge. At startup,
level-zero opens the device and — with `TP=2` — vLLM brings up **PCIe P2P**
between the two B70s. Either step can wedge a card that idled into a low-power
state. Mitigations, in order of impact:

1. **Keep the cards out of deep sleep before serving** (the boot service already
   sets `power/control=on`; verify it survived):

   ```bash
   for d in 0000:83:00.0 0000:c4:00.0; do
     cat /sys/bus/pci/devices/$d/power/control      # must be: on
     cat /sys/bus/pci/devices/$d/power_state        # want: D0
   done
   ```

2. **Add `pcie_port_pm=off`** (see §7) — this is the single most relevant fix for
   a startup-time D3cold→D0 wedge.

3. **Disable P2P for the TP=2 bring-up** if the drop only happens with two cards.
   The container already sets `CCL_ZE_IPC_EXCHANGE=sockets`; also try forcing
   USM instead of P2P:

   ```bash
   -e CCL_TOPO_P2P_ACCESS=0      # USM memory exchange (no PCIe P2P)
   ```

   If the card stops dropping with P2P off, the wedge is in the P2P path and
   `pcie_port_pm=off` + keeping D0 is the real fix; re-enable P2P afterward.

4. **Warm the device before vLLM** so the first access isn't from a cold D3
   state — the watchdog/boot service binding + a trivial `xpu-smi`/`clinfo`
   touch right before launch helps. `b70-check --fix` as `ExecStartPre` already
   does the bind/cap warm-up.

The runtime **watchdog** (§6c) exists precisely because some startup drops will
still slip through: it captures the exact drop-state and stops vLLM cleanly so
you're not chasing it blind.

## 6c. Runtime watchdog (it dropped *while running*)

The boot service only fires once at boot. If a card falls off **mid-run or at
vLLM startup**, the watchdog handles it. Per the chosen policy it **stops vLLM
and alerts** rather than silently re-bouncing the model.

Files: `b70-watchdog.sh` → `/usr/local/sbin/b70-watchdog`, driven by
`b70-watchdog.timer` (every 30s). On a detected drop it:

1. **Captures a diagnostic snapshot** to `/var/log/b70/drop-<ts>.txt` —
   this resolves the "not sure which state" question automatically by recording
   `lspci`, sysfs `enable`/`power_state`/`driver`, and the relevant `dmesg`
   lines **at the moment of failure**.
2. **Stops `b70-vllm.service`** so it releases the device (never re-bind under a
   live vLLM).
3. **Attempts non-destructive recovery only** (enable + xe bind + cap) — and
   only for state A (card still present). It never does a PCI `remove`/`reset`
   or bridge SBR.
4. **Writes a verdict + alert** to `/var/log/b70/ALERT` and leaves vLLM stopped
   for you to restart or escalate.

Check what happened after a drop:

```bash
cat /var/log/b70/ALERT                 # verdict + which snapshot
ls -lt /var/log/b70/drop-*.txt | head  # newest snapshots
journalctl -u b70-watchdog.service -n 50 --no-pager
```

Verdicts:

| Verdict | Meaning | Action |
| --- | --- | --- |
| `RECOVERED_STATE_A_vllm_stopped` | card was present+unbound; re-bound OK | `systemctl start b70-vllm.service` |
| `FAILED_STATE_A_needs_FLR_or_reboot` | present but bind won't stick | §6 FLR (`remove`+`rescan`/`reset`), else reboot |
| `FAILED_STATE_B_needs_reboot_or_SBR` | card vanished from PCI | reboot, or manual bridge SBR (see below) |

> The watchdog deliberately does **not** auto-restart vLLM. Once you've
> confirmed health (`b70-check`), restart it yourself. This stops a flapping
> card from crash-looping the model.

### Bridge secondary-bus reset (manual, state B only)

When a card has truly vanished (state B), the only software recovery short of a
reboot is resetting the **parent bridge's** secondary bus — which resets
**everything downstream of that bridge**. First confirm what shares the bridge:

```bash
ls /sys/bus/pci/devices/0000:83:00.0/../   # siblings under the same bridge
lspci -tv                                   # full topology tree
```

If the B70 is alone under its bridge, an SBR is relatively safe. If it shares
the bridge with the other B70, an RTX card, or an NVMe, the SBR hits those too.
**This is intentionally kept manual** — do not automate it on a shared bridge.

## 7. Boot mitigations (kernel command line)

Current cmdline:

```text
pcie_aspm=off xe.force_probe=e223
```

- `pcie_aspm=off` — disables Active State Power Management link low-power
  states (a known Arc idle-instability source).
- `xe.force_probe=e223` — forces `xe` to bind the B70 even though the PCI id may
  not be on the driver's default allow-list yet.

**Next mitigation to add** (directly targets the wedge):

```text
pcie_port_pm=off
```

This disables PCIe **port** power management on the root/downstream ports, which
is the layer that drives the D3cold transitions that wedge the card. It is the
most targeted software mitigation short of a kernel that fixes Battlemage
D3cold. Apply it and re-test stability:

```bash
# /etc/default/grub -> GRUB_CMDLINE_LINUX_DEFAULT="... pcie_aspm=off pcie_port_pm=off xe.force_probe=e223"
sudo update-grub   # or: sudo grub-mkconfig -o /boot/grub/grub.cfg
sudo reboot
```

Optional belt-and-suspenders if drops continue after `pcie_port_pm=off`: pin the
B70 functions to D0 by keeping `power/control = on` (the service already does
this) and avoid letting the desktop/compositor idle them.

---

## 8. vLLM serving stack (B70s)

```text
Docker image:   b70-vllm-qwen36:latest
Base image:     intel/llm-scaler-vllm:0.14.0-b8.3.1
Model:          /mnt/llm_models/Qwen3.6-27B-int4-GPTQ-compat
Serving port:   8010
Tensor parallel: TP=2  (across both B70s)
Backend:        XPU
Devices:        /dev/dri
```

Stable intended mode:

```text
INT4 weights (GPTQ — auto-detected, no --quantization flag needed)
16-bit / default KV cache
TP=2, no CPU offload
vision enabled
MTP DISABLED
```

**MTP must stay off.** Qwen MTP (multi-token prediction / speculative decoding)
fails on Intel XPU for this path because the XPU GDN attention implementation
does not support the speculative mask path Qwen MTP uses. It is not
stability-safe right now. (llm-scaler-vllm trails upstream vLLM by several minor
versions and lists speculative decoding support only for n-gram / EAGLE /
EAGLE3 on XPU — not Qwen MTP.)

Container launch (mirrors Intel's documented XPU pattern — `--privileged`,
host net/ipc, `/dev/dri` + `by-path` passthrough, oneAPI sourced):

```bash
sudo docker run -td \
  --privileged --net=host --ipc=host \
  --device=/dev/dri \
  -v /dev/dri/by-path:/dev/dri/by-path \
  -v /mnt/llm_models:/llm/models \
  --shm-size=32g \
  --name b70-qwen36 \
  -e ZES_ENABLE_SYSMAN=1 \
  -e VLLM_WORKER_MULTIPROC_METHOD=spawn \
  -e VLLM_ALLOW_LONG_MAX_MODEL_LEN=1 \
  -e CCL_ZE_IPC_EXCHANGE=sockets \
  --entrypoint /bin/bash \
  b70-vllm-qwen36:latest

docker exec -it b70-qwen36 bash -lc '
  source /opt/intel/oneapi/setvars.sh --force &&
  vllm serve \
    --model /llm/models/Qwen3.6-27B-int4-GPTQ-compat \
    --served-model-name qwen3.6-27b \
    --dtype float16 \
    --enforce-eager \
    --trust-remote-code \
    --host 0.0.0.0 --port 8010 \
    --tensor-parallel-size 2 \
    --gpu-memory-util 0.90 \
    --max-model-len 32768 \
    --max-num-batched-tokens 8192 \
    --block-size 64 \
    --no-enable-prefix-caching
'
```

Notes:
- GPTQ INT4 is auto-detected from `config.json`; do **not** pass `--quantization`.
- `--enforce-eager` is the documented-stable path for these cards (torch.compile
  on XPU is still fragile); enable compile only after a clean eager baseline.
- Do **not** add any `--speculative*` / MTP flags.
- If you only want the two B70s in the container and not the RTX cards, map the
  specific `renderD132`/`renderD133` nodes + their `by-path` symlinks instead of
  all of `/dev/dri`, and/or set `ZE_AFFINITY_MASK`.

---

## 9. Operational rule (must pass before starting vLLM)

```text
[ ] both e223 PCI devices exist
[ ] both report: Kernel driver in use: xe
[ ] both have /dev/dri render nodes
[ ] both capped at 150 W (power1_cap = 150000000)
```

If any is false, fix the driver binding first (service restart → §2 manual →
§6 reset → reboot). **Never start the model into a half-bound B70 state.**
