#!/usr/bin/env bash
# Local Studio controller installer — idempotent, single machine.
#
#   curl -fsSL https://raw.githubusercontent.com/jake-molnia/local-studio/main/scripts/install-controller.sh | bash
#   # or piped over ssh by the desktop app's "Deploy controller" flow.
#
# Env overrides:
#   LOCAL_STUDIO_DIR        source directory
#   LOCAL_STUDIO_DATA_DIR   persistent controller data directory
#   LOCAL_STUDIO_MODELS_DIR persistent model directory
#   LOCAL_STUDIO_HOST       controller bind host
#   LOCAL_STUDIO_PORT       controller port
#   LOCAL_STUDIO_REPO       git repo to clone
#
# Prints a final machine-readable line on success:
#   LOCAL_STUDIO_CONTROLLER {"url":"http://<host>:<port>","api_key":"<key>"}
set -euo pipefail

OS_NAME="$(uname -s)"
HOST_WAS_SET="${LOCAL_STUDIO_HOST+x}"
PORT_WAS_SET="${LOCAL_STUDIO_PORT+x}"
DATA_DIR_WAS_SET="${LOCAL_STUDIO_DATA_DIR+x}"
MODELS_DIR_WAS_SET="${LOCAL_STUDIO_MODELS_DIR+x}"
CONTROLLER_MODE_WAS_SET="${LOCAL_STUDIO_CONTROLLER_MODE+x}"
if [ "$OS_NAME" = "Darwin" ]; then
  DEFAULT_DIR="$HOME/Library/Application Support/Local Studio/controller-source"
  DEFAULT_DATA_DIR="$HOME/Library/Application Support/Local Studio/controller-data"
else
  DEFAULT_DIR="$HOME/local-studio"
  DEFAULT_DATA_DIR="$DEFAULT_DIR/data"
fi
DIR="${LOCAL_STUDIO_DIR:-$DEFAULT_DIR}"
DATA_DIR="${LOCAL_STUDIO_DATA_DIR:-$DEFAULT_DATA_DIR}"
MODELS_DIR="${LOCAL_STUDIO_MODELS_DIR:-$DATA_DIR/models}"
HOST="${LOCAL_STUDIO_HOST:-0.0.0.0}"
PORT="${LOCAL_STUDIO_PORT:-8080}"
CONTROLLER_MODE="${LOCAL_STUDIO_CONTROLLER_MODE:-standalone}"
REPO="${LOCAL_STUDIO_REPO:-https://github.com/jake-molnia/local-studio.git}"
ZIG_VERSION="0.16.0"
ZIG_CACHE="${XDG_CACHE_HOME:-$HOME/.cache}/local-studio/zig/$ZIG_VERSION"
ZIG_ROOT="$ZIG_CACHE/toolchain"
ZIG="$ZIG_ROOT/zig"
SECRETSPEC_VERSION="0.19.1"

log() { printf '[local-studio] %s\n' "$*"; }

# --- prerequisites -----------------------------------------------------------
command -v git >/dev/null 2>&1 || { log "git is required — install it and rerun"; exit 1; }
command -v curl >/dev/null 2>&1 || { log "curl is required — install it and rerun"; exit 1; }
command -v tar >/dev/null 2>&1 || { log "tar is required — install it and rerun"; exit 1; }

# --- source ------------------------------------------------------------------
if [ -d "$DIR/.git" ]; then
  log "updating existing checkout at $DIR"
  git -C "$DIR" pull --ff-only || log "pull failed (local changes?) — keeping current checkout"
elif [ -d "$DIR/controller" ]; then
  log "using existing non-git install at $DIR (left untouched)"
else
  log "cloning into $DIR"
  git clone --depth 1 "$REPO" "$DIR"
fi

case "$OS_NAME:$(uname -m)" in
  Darwin:arm64) ZIG_ARCHIVE="zig-aarch64-macos-$ZIG_VERSION.tar.xz"; ZIG_SHA256="b23d70deaa879b5c2d486ed3316f7eaa53e84acf6fc9cc747de152450d401489"; SECRETSPEC_ARTIFACT="secretspec-aarch64-apple-darwin"; SECRETSPEC_SHA256="076536200199540515ebdf929f7cb3f413d82be3524771a2a5975b80ca85d727" ;;
  Darwin:x86_64) ZIG_ARCHIVE="zig-x86_64-macos-$ZIG_VERSION.tar.xz"; ZIG_SHA256="0387557ed1877bc6a2e1802c8391953baddba76081876301c522f52977b52ba7"; SECRETSPEC_ARTIFACT="secretspec-x86_64-apple-darwin"; SECRETSPEC_SHA256="c622690f2c7037e113e94411311fe7f7158692f8e048d75fddec6e2933968228" ;;
  Linux:aarch64|Linux:arm64) ZIG_ARCHIVE="zig-aarch64-linux-$ZIG_VERSION.tar.xz"; ZIG_SHA256="ea4b09bfb22ec6f6c6ceac57ab63efb6b46e17ab08d21f69f3a48b38e1534f17"; SECRETSPEC_ARTIFACT="secretspec-aarch64-unknown-linux-gnu"; SECRETSPEC_SHA256="9b0804932f011ee13709d06a342cd7d30222a764bb62d343771964471b2a7e25" ;;
  Linux:x86_64|Linux:amd64) ZIG_ARCHIVE="zig-x86_64-linux-$ZIG_VERSION.tar.xz"; ZIG_SHA256="70e49664a74374b48b51e6f3fdfbf437f6395d42509050588bd49abe52ba3d00"; SECRETSPEC_ARTIFACT="secretspec-x86_64-unknown-linux-gnu"; SECRETSPEC_SHA256="9a0b5882532f5ffbb1c687d9284fa8041949962b05f14fc131050f86c70e1efc" ;;
  *) log "unsupported controller platform: $OS_NAME $(uname -m)"; exit 1 ;;
esac

sha256_file() {
  if command -v shasum >/dev/null 2>&1; then shasum -a 256 "$1" | awk '{print $1}'; else sha256sum "$1" | awk '{print $1}'; fi
}

mkdir -p "$ZIG_CACHE"
if [ ! -x "$ZIG" ]; then
  ZIG_DOWNLOAD="$ZIG_CACHE/$ZIG_ARCHIVE"
  log "downloading Zig $ZIG_VERSION"
  curl -fL "https://ziglang.org/download/$ZIG_VERSION/$ZIG_ARCHIVE" -o "$ZIG_DOWNLOAD.tmp"
  [ "$(sha256_file "$ZIG_DOWNLOAD.tmp")" = "$ZIG_SHA256" ] || { rm -f "$ZIG_DOWNLOAD.tmp"; log "Zig checksum mismatch"; exit 1; }
  mv "$ZIG_DOWNLOAD.tmp" "$ZIG_DOWNLOAD"
  rm -rf "$ZIG_ROOT.tmp" "$ZIG_ROOT"
  mkdir -p "$ZIG_ROOT.tmp"
  tar -xf "$ZIG_DOWNLOAD" -C "$ZIG_ROOT.tmp" --strip-components=1
  mv "$ZIG_ROOT.tmp" "$ZIG_ROOT"
fi
[ "$("$ZIG" version)" = "$ZIG_VERSION" ] || { log "invalid Zig toolchain at $ZIG"; exit 1; }

SECRETSPEC_CACHE="${XDG_CACHE_HOME:-$HOME/.cache}/local-studio/secretspec/$SECRETSPEC_VERSION/$SECRETSPEC_ARTIFACT"
SECRETSPEC_ARCHIVE="$SECRETSPEC_CACHE/$SECRETSPEC_ARTIFACT.tar.xz"
SECRETSPEC_BIN="$SECRETSPEC_CACHE/$SECRETSPEC_ARTIFACT/secretspec"
if [ ! -x "$SECRETSPEC_BIN" ]; then
  mkdir -p "$SECRETSPEC_CACHE"
  log "downloading SecretSpec $SECRETSPEC_VERSION"
  curl -fL "https://github.com/cachix/secretspec/releases/download/v$SECRETSPEC_VERSION/$SECRETSPEC_ARTIFACT.tar.xz" -o "$SECRETSPEC_ARCHIVE.tmp"
  [ "$(sha256_file "$SECRETSPEC_ARCHIVE.tmp")" = "$SECRETSPEC_SHA256" ] || { rm -f "$SECRETSPEC_ARCHIVE.tmp"; log "SecretSpec checksum mismatch"; exit 1; }
  mv "$SECRETSPEC_ARCHIVE.tmp" "$SECRETSPEC_ARCHIVE"
  tar -xf "$SECRETSPEC_ARCHIVE" -C "$SECRETSPEC_CACHE"
  chmod 755 "$SECRETSPEC_BIN"
fi

log "building Zig controller"
(cd "$DIR/controller" && "$ZIG" build -Doptimize=ReleaseSafe)

# --- config ------------------------------------------------------------------
ENV_FILE="$DIR/.env"
read_env_value() {
  grep "^$1=" "$ENV_FILE" 2>/dev/null | head -1 | cut -d= -f2-
}
write_env_value() {
  key="$1"
  value="$2"
  if grep -q "^$key=" "$ENV_FILE" 2>/dev/null; then
    awk -v key="$key" -v value="$value" 'index($0, key "=") == 1 { if (!written) print key "=" value; written=1; next } { print }' "$ENV_FILE" > "$ENV_FILE.tmp"
    mv "$ENV_FILE.tmp" "$ENV_FILE"
  else
    printf '%s=%s\n' "$key" "$value" >> "$ENV_FILE"
  fi
}
if [ -f "$ENV_FILE" ] && grep -q '^LOCAL_STUDIO_API_KEY=' "$ENV_FILE"; then
  API_KEY="$(read_env_value LOCAL_STUDIO_API_KEY)"
  log "reusing existing API key from .env"
else
  if command -v openssl >/dev/null 2>&1; then
    API_KEY="$(openssl rand -hex 32)"
  else
    API_KEY="$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')"
  fi
  printf 'LOCAL_STUDIO_API_KEY=%s\n' "$API_KEY" >> "$ENV_FILE"
  log "wrote $ENV_FILE"
fi
if [ -z "$HOST_WAS_SET" ] && grep -q '^LOCAL_STUDIO_HOST=' "$ENV_FILE"; then HOST="$(read_env_value LOCAL_STUDIO_HOST)"; fi
if [ -z "$PORT_WAS_SET" ] && grep -q '^LOCAL_STUDIO_PORT=' "$ENV_FILE"; then PORT="$(read_env_value LOCAL_STUDIO_PORT)"; fi
if [ -z "$CONTROLLER_MODE_WAS_SET" ] && grep -q '^LOCAL_STUDIO_CONTROLLER_MODE=' "$ENV_FILE"; then CONTROLLER_MODE="$(read_env_value LOCAL_STUDIO_CONTROLLER_MODE)"; fi
if [ -z "$DATA_DIR_WAS_SET" ]; then
  if grep -q '^LOCAL_STUDIO_DATA_DIR=' "$ENV_FILE"; then
    DATA_DIR="$(read_env_value LOCAL_STUDIO_DATA_DIR)"
  elif [ -d "$DIR/data" ]; then
    DATA_DIR="$DIR/data"
  fi
fi
if [ -z "$MODELS_DIR_WAS_SET" ]; then
  if grep -q '^LOCAL_STUDIO_MODELS_DIR=' "$ENV_FILE"; then
    MODELS_DIR="$(read_env_value LOCAL_STUDIO_MODELS_DIR)"
  else
    MODELS_DIR="$DATA_DIR/models"
  fi
fi
write_env_value LOCAL_STUDIO_HOST "$HOST"
write_env_value LOCAL_STUDIO_PORT "$PORT"
write_env_value LOCAL_STUDIO_CONTROLLER_MODE "$CONTROLLER_MODE"
write_env_value LOCAL_STUDIO_DATA_DIR "$DATA_DIR"
write_env_value LOCAL_STUDIO_MODELS_DIR "$MODELS_DIR"
mkdir -p "$DATA_DIR" "$MODELS_DIR"
chmod 600 "$ENV_FILE"
INSTALL_BIN="$DATA_DIR/bin/local-studio-controller"
mkdir -p "$(dirname "$INSTALL_BIN")"
cp "$DIR/controller/zig-out/bin/local-studio-controller" "$INSTALL_BIN.tmp"
chmod 755 "$INSTALL_BIN.tmp"
mv "$INSTALL_BIN.tmp" "$INSTALL_BIN"
INSTALL_SECRETSPEC="$DATA_DIR/bin/secretspec"
cp "$SECRETSPEC_BIN" "$INSTALL_SECRETSPEC.tmp"
chmod 755 "$INSTALL_SECRETSPEC.tmp"
mv "$INSTALL_SECRETSPEC.tmp" "$INSTALL_SECRETSPEC"

# --- service -----------------------------------------------------------------
started=""
if [ "$OS_NAME" = "Darwin" ]; then
  LABEL="org.local.studio.controller"
  PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
  LOG_FILE="$DATA_DIR/controller.log"
  xml_escape() {
    printf '%s' "$1" | sed 's/&/\&amp;/g; s/</\&lt;/g; s/>/\&gt;/g; s/"/\&quot;/g'
  }
  mkdir -p "$HOME/Library/LaunchAgents"
  CONTROLLER_XML="$(xml_escape "$INSTALL_BIN")"
  DIR_XML="$(xml_escape "$DIR")"
  DATA_XML="$(xml_escape "$DATA_DIR")"
  MODELS_XML="$(xml_escape "$MODELS_DIR")"
  LOG_XML="$(xml_escape "$LOG_FILE")"
  API_KEY_XML="$(xml_escape "$API_KEY")"
  PATH_XML="$(xml_escape "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin")"
  cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array><string>$CONTROLLER_XML</string></array>
  <key>WorkingDirectory</key><string>$DIR_XML</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>LOCAL_STUDIO_HOST</key><string>$(xml_escape "$HOST")</string>
    <key>LOCAL_STUDIO_PORT</key><string>$PORT</string>
    <key>LOCAL_STUDIO_CONTROLLER_MODE</key><string>$(xml_escape "$CONTROLLER_MODE")</string>
    <key>LOCAL_STUDIO_API_KEY</key><string>$API_KEY_XML</string>
    <key>LOCAL_STUDIO_DATA_DIR</key><string>$DATA_XML</string>
    <key>LOCAL_STUDIO_MODELS_DIR</key><string>$MODELS_XML</string>
    <key>PATH</key><string>$PATH_XML</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>5</integer>
  <key>StandardOutPath</key><string>$LOG_XML</string>
  <key>StandardErrorPath</key><string>$LOG_XML</string>
</dict>
</plist>
PLIST
  plutil -lint "$PLIST" >/dev/null
  SERVICE="gui/$(id -u)/$LABEL"
  launchctl bootout "$SERVICE" >/dev/null 2>&1 || true
  # bootout is asynchronous: bootstrap while the old service is still leaving
  # the domain and launchd answers "Bootstrap failed: 5: Input/output error",
  # which under set -e kills this script with the controller already stopped.
  # Wait for the service to actually be gone before bootstrapping.
  for _ in $(seq 1 50); do
    launchctl print "$SERVICE" >/dev/null 2>&1 || break
    sleep 0.2
  done
  launchctl bootstrap "gui/$(id -u)" "$PLIST"
  launchctl enable "$SERVICE"
  launchctl kickstart -k "$SERVICE"
  started="launchd"
elif command -v systemctl >/dev/null 2>&1 && [ -d /run/systemd/system ]; then
  UNIT_DIR="$HOME/.config/systemd/user"
  # Port-scoped unit name so multiple installs on one box never clobber each
  # other's service definition.
  UNIT_NAME="local-studio-controller-$PORT.service"
  mkdir -p "$UNIT_DIR"
  cat > "$UNIT_DIR/$UNIT_NAME" <<UNIT
[Unit]
Description=Local Studio Controller
After=network-online.target

[Service]
Type=simple
WorkingDirectory=$DIR
EnvironmentFile=$ENV_FILE
ExecStart=$INSTALL_BIN
Restart=on-failure
RestartSec=3
KillMode=mixed
TimeoutStopSec=15
StandardOutput=append:$DATA_DIR/controller.log
StandardError=append:$DATA_DIR/controller.log

[Install]
WantedBy=default.target
UNIT
  systemctl --user daemon-reload
  systemctl --user enable "$UNIT_NAME" >/dev/null 2>&1 || true
  # restart (not enable --now) so a rewritten unit definition always applies.
  systemctl --user restart "$UNIT_NAME"
  # Keep the service alive after logout where allowed (best effort).
  loginctl enable-linger "$USER" >/dev/null 2>&1 || true
  started="systemd"
else
  log "no systemd — starting with nohup"
  pkill -f "$INSTALL_BIN" 2>/dev/null || true
  (cd "$DIR" && setsid nohup env LOCAL_STUDIO_HOST="$HOST" LOCAL_STUDIO_PORT="$PORT" LOCAL_STUDIO_CONTROLLER_MODE="$CONTROLLER_MODE" LOCAL_STUDIO_API_KEY="$API_KEY" LOCAL_STUDIO_DATA_DIR="$DATA_DIR" LOCAL_STUDIO_MODELS_DIR="$MODELS_DIR" "$INSTALL_BIN" >> "$DATA_DIR/controller.log" 2>&1 < /dev/null &)
  started="nohup"
fi

# --- health ------------------------------------------------------------------
log "waiting for controller on :${PORT}…"
HEALTH_HOST="$HOST"
case "$HEALTH_HOST" in
  ""|"0.0.0.0"|"::") HEALTH_HOST="127.0.0.1" ;;
esac
HEALTH_URL_HOST="$HEALTH_HOST"
case "$HEALTH_URL_HOST" in
  *:*) HEALTH_URL_HOST="[$HEALTH_URL_HOST]" ;;
esac
for _ in $(seq 1 30); do
  if curl -fsS --max-time 2 "http://$HEALTH_URL_HOST:$PORT/health" >/dev/null 2>&1; then
    HOST_ADDR="$HOST"
    case "$HOST_ADDR" in
      ""|"0.0.0.0"|"::")
        HOST_ADDR=""
        if command -v tailscale >/dev/null 2>&1; then
          HOST_ADDR="$(tailscale ip -4 2>/dev/null | head -1 || true)"
        fi
        if [ -z "$HOST_ADDR" ]; then
          HOST_ADDR="$(hostname -I 2>/dev/null | awk '{print $1}' || true)"
        fi
        ;;
    esac
    [ -n "$HOST_ADDR" ] || HOST_ADDR="$(hostname)"
    HOST_URL_ADDR="$HOST_ADDR"
    case "$HOST_URL_ADDR" in
      *:*) HOST_URL_ADDR="[$HOST_URL_ADDR]" ;;
    esac
    log "controller healthy ($started)"
    printf 'LOCAL_STUDIO_CONTROLLER {"url":"http://%s:%s","api_key":"%s"}\n' "$HOST_URL_ADDR" "$PORT" "$API_KEY"
    exit 0
  fi
  sleep 2
done

log "controller did not become healthy in 60s — check $DATA_DIR/controller.log"
exit 1
