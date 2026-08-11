# Windows support

Local Studio supports Windows 11 x64 as an additive platform port. The macOS
and Linux implementations remain the reference paths for their platforms.

## Supported Windows configuration

- Windows 11 x64
- Node.js 22.19+, npm 10+, Bun 1.3.14+, Python 3.10+, and Git
- Electron desktop UI and a controller running on the same machine
- PowerShell 7 when available, Windows PowerShell next, and `cmd.exe` as the
  final PTY fallback
- Native llama.cpp inference with CPU or NVIDIA CUDA release artifacts
- Model discovery, Hugging Face downloads, recipes, lifecycle, GPU telemetry,
  OpenAI-compatible proxying, logs, usage, settings, and local workspaces

The managed llama.cpp installer downloads the matching official Windows x64
release. On an NVIDIA host it installs the CUDA 12.4 archive and its companion
CUDA runtime archive together. A CUDA toolkit is not required for that binary
distribution, but a compatible NVIDIA driver and working `nvidia-smi` are.

Native vLLM and SGLang are not supported by this port. The Windows controller
offers them only through an explicitly selected WSL2 distribution or an
unchanged remote Linux controller. WSL2 is a distinct recipe runtime, not a
native Windows process disguised by the UI. MLX remains Apple Silicon-only, and
native Windows exllamav3 remains disabled until it passes an independent
experimental gate.

## Explicit WSL2 bridge

The bridge is opt-in and limited to vLLM and SGLang. Configure lists eligible
WSL2 distributions without starting them. Selecting or inspecting a target also
does not start WSL2; the selected distribution starts only when its recipe is
launched. llama.cpp continues to run natively on Windows and remote controllers
are unchanged.

Install and validate the Linux engine yourself inside the selected distribution.
Local Studio does not silently install packages or claim that an importable
Windows Python package is a supported engine. Engine availability is checked at
launch, and a missing Linux binary fails the launch with an explicit error.

The bridge supervises the Linux process group, persists Linux PID identity for
controller restart recovery, translates absolute Windows drive paths with the
selected distribution's `wslpath`, and captures the engine log in the Windows
controller data directory. UNC translation depends on the distribution's mount
and interoperability configuration and has not completed real-host acceptance.

When Local Studio starts a previously stopped distribution, eviction terminates
that exact distribution by default so its WSL VM memory can be released. A
distribution that was already running is left running. Set
`LOCAL_STUDIO_WSL_TERMINATE_ON_STOP=false` before starting the controller to
disable automatic termination. The bridge never calls global `wsl --shutdown`
and never edits `.wslconfig`; Microsoft's global WSL memory controls remain an
independent operator choice. See the official
[WSL command reference](https://learn.microsoft.com/en-us/windows/wsl/basic-commands)
and [advanced configuration reference](https://learn.microsoft.com/en-us/windows/wsl/wsl-config).

## Developer setup

From PowerShell in the repository root:

```powershell
npm run doctor
npm run setup
npm run dev:controller
```

In another PowerShell window:

```powershell
npm run dev
```

Open <http://localhost:3000/setup>. The default controller is
`http://127.0.0.1:8080`. Set `LOCAL_STUDIO_MODELS_DIR` before starting the
controller to place model weights on another drive or share. Drive-letter,
backslash, spaces, Unicode, and UNC path forms are preserved by the application;
access to an actual UNC share still depends on the current user's share and NTFS
permissions.

## Controller startup

The Windows installer is per-user and does not require elevation:

```powershell
pwsh -ExecutionPolicy Bypass -File .\scripts\install-controller.ps1 -Action Install
pwsh -ExecutionPolicy Bypass -File .\scripts\install-controller.ps1 -Action Status
pwsh -ExecutionPolicy Bypass -File .\scripts\install-controller.ps1 -Action Restart
pwsh -ExecutionPolicy Bypass -File .\scripts\install-controller.ps1 -Action Update
pwsh -ExecutionPolicy Bypass -File .\scripts\install-controller.ps1 -Action Remove
```

It prefers a per-user Scheduled Task. If Windows policy denies task creation,
it falls back to the current user's `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`
entry. The API key is stored in the installation `.env` file and is not placed
in the startup command or controller logs. Use `-InstallDir`, `-DataDir`,
`-ModelsDir`, `-HostAddress`, and `-Port` to override defaults.

The existing `scripts/install-controller.sh` remains the launchd/systemd
installer for macOS and Linux. Remote SSH deployment is unchanged.

## Windows desktop package

Build an unpacked developer package or an unsigned NSIS installer:

```powershell
npm --prefix frontend run desktop:pack:windows
npm --prefix frontend run desktop:dist:windows
npm --prefix frontend run desktop:smoke -- --app ".\frontend\dist-desktop\win-unpacked\Local Studio.exe" --expected-version 2.1.0
```

The package is intentionally unsigned and is not a published Windows release.
Windows signing, update-feed publication, and release automation are outside
this port. The existing macOS signing, notarization, DMG, updater, and release
flow is unchanged.

## Validation

```powershell
npm run check
npm run test:integration
```

The `windows-latest` CI job additionally installs locked dependencies, checks
the controller, agent runtime, and frontend, builds the application, creates an
unpacked Electron package, and runs its desktop smoke test without requiring a
GPU.

Real-host acceptance was completed on Windows x64 with an RTX 3090 and RTX
3080 Ti. It installed official llama.cpp `b10355`, downloaded a 105,454,432-byte
GGUF to an `F:` path containing spaces and Unicode, launched native CUDA
inference, served normal and SSE chat completions, recorded usage and logs, and
evicted the process tree cleanly. An ASCII-path NSIS install/smoke/uninstall also
passed. A bounded silent-install attempt to a custom destination containing
spaces and Unicode did not finish and was terminated, so that custom NSIS
destination is not yet claimed as validated.

The explicit WSL2 bridge was also exercised against Ubuntu on the same host. A
Linux HTTP fixture received a translated non-`C:` path containing spaces and
Unicode, preserved a Unicode environment value, became reachable through
Windows localhost, wrote controller-visible logs, survived a controller restart,
and was evicted through its persisted Linux process identity. A distribution
started by the bridge returned to `Stopped`; one that was already running was
left running. Ubuntu exposed both NVIDIA GPUs through WSL. Neither vLLM nor
SGLang was installed in that distribution, so real model inference through
those engines is not claimed yet; the missing-binary launch failed without
leaving Ubuntu running.

## Deferred work

- Signed and published Windows releases and updater metadata
- Native Windows vLLM, SGLang, or exllamav3 claims
- Real vLLM and SGLang model-server acceptance inside an operator-provisioned
  WSL2 distribution
- Hardware CI; GPU parsers and capability decisions use fixtures in CI
- A live UNC-share acceptance run
