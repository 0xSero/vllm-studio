# B70 ops — setup standard

How to set up the Intel Arc Pro B70 recovery + serving stack **safely and
consistently**. The full troubleshooting/background lives in
[`B70-RECOVERY-GUIDE.md`](./B70-RECOVERY-GUIDE.md); this file is the workflow.

## Principles (the "standard")

1. **Repo is the source of truth.** Edit files here, never hand-edit
   `/usr/local/sbin/*` or `/etc/systemd/system/*` on the host. To change the box,
   change the repo and re-run `install.sh`.
2. **systemd owns lifecycle.** A oneshot recovery unit runs at boot; the vLLM
   unit depends on it and runs the preflight gate as `ExecStartPre`.
3. **Idempotent + safe by default.** Everything can run repeatedly, skips absent
   cards, exits 0, and makes no destructive PCI change without an explicit
   manual escalation (FLR / `remove` / `reset` stay manual — see the guide).
4. **Verify, don't trust.** The same `b70-check` gate is the install acceptance
   test, the boot interlock, and the manual preflight.

## Files

| File | Role | Installed to |
| --- | --- | --- |
| `set-intel-xe-power-cap` | enable + bind xe + 150 W cap per card | `/usr/local/sbin/set-intel-xe-power-cap` |
| `intel-xe-power-cap.service` | boot recovery unit | `/etc/systemd/system/` |
| `b70-check.sh` | preflight health gate | `/usr/local/sbin/b70-check` |
| `b70-vllm.service` | vLLM server, gated on health | `/etc/systemd/system/` |
| `install.sh` | idempotent installer + verifier | — |

## First-time setup (on the GPU host)

```bash
# 1. (one-time) kernel cmdline mitigations — see guide §7
#    GRUB_CMDLINE_LINUX_DEFAULT="... pcie_aspm=off pcie_port_pm=off xe.force_probe=e223"
sudo update-grub && sudo reboot

# 2. install everything from the repo
cd scripts/b70
sudo ./install.sh        # installs, enables boot recovery, runs health check

# 3. (optional) bring up the model under systemd
sudo systemctl enable --now b70-vllm.service
journalctl -u b70-vllm.service -f
```

`install.sh` exits non-zero if the post-install health check fails, so a broken
setup is caught immediately rather than at serving time.

## Updating after a repo change

```bash
cd scripts/b70
git pull
sudo ./install.sh                              # re-installs + re-verifies
sudo systemctl restart intel-xe-power-cap.service
sudo systemctl restart b70-vllm.service        # if serving
```

## Daily / pre-serve checks

```bash
b70-check                       # report-only, exit code reflects health
b70-check --fix                 # attempt service recovery, then re-check
sudo systemctl status intel-xe-power-cap.service
journalctl -u intel-xe-power-cap.service -b --no-pager
```

## Safety interlock (why this is "safe")

- `b70-vllm.service` has `Requires=intel-xe-power-cap.service` and
  `ExecStartPre=/usr/local/sbin/b70-check --fix`.
- If any B70 is missing / not bound to `xe` / has no render node / wrong power
  cap, **the gate fails and vLLM never starts**. You cannot serve into a
  half-bound state.
- Destructive recovery (PCI `remove`/`rescan`/`reset`, reboot) is **never**
  automated — it stays a deliberate human step documented in the guide.

## Verification after any change (acceptance test)

```text
[ ] sudo ./install.sh   -> "INSTALL OK"
[ ] b70-check           -> "ALL CHECKS PASSED"
[ ] systemctl is-enabled intel-xe-power-cap.service -> enabled
[ ] (if serving) curl -s localhost:8010/v1/models   -> 200 + model listed
```
