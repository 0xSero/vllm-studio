import { app } from "electron";
import { isDevChannelBuild } from "../app-identity";
import { autoUpdater } from "electron-updater";
import { DESKTOP_CONFIG } from "../configs";
import {
  DesktopUpdateChannelSchema,
  type DesktopUpdateChannel,
  type DesktopUpdateSnapshot,
} from "../types";
import { log } from "../helpers/logger";
import { isLoopbackHttpUrl } from "../helpers/url";
import { getStoredUpdateChannel, setStoredUpdateChannel } from "./desktop-settings";
import { UpdateInstallIntent } from "./update-install-intent";
import { Schema } from "effect";

const NIGHTLY_UPDATE_URL = "https://github.com/jake-molnia/local-studio/releases/download/nightly";

function selectedUpdateChannel(): DesktopUpdateChannel {
  const fallback = /-nightly(?:\.|$)/.test(app.getVersion()) ? "nightly" : "stable";
  return getStoredUpdateChannel(fallback);
}

let latestUpdateState: DesktopUpdateSnapshot = {
  channel: selectedUpdateChannel(),
  status: "idle",
};
const installIntent = new UpdateInstallIntent();

function setUpdateState(nextState: Omit<DesktopUpdateSnapshot, "channel">): void {
  latestUpdateState = { channel: selectedUpdateChannel(), ...nextState };
}

function setUpdateError(error: unknown): void {
  installIntent.clear();
  const message = String(error);
  setUpdateState({ status: "error", message });
  log.error(`Auto update error: ${message}`);
}

function resolveFeedUrl(): string | null {
  const raw = process.env.LOCAL_STUDIO_UPDATE_URL?.trim();
  if (!raw) return null;
  // Refuse cleartext update feeds — auto-update over http is trivially
  // MITM-able into shipping an arbitrary binary. Allow http only for loopback
  // (local testing of an update server).
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "https:" && !isLoopbackHttpUrl(raw)) {
      log.warn(`[update] Ignoring non-https update feed: ${parsed.protocol}//${parsed.host}`);
      return null;
    }
  } catch {
    log.warn("[update] Ignoring malformed LOCAL_STUDIO_UPDATE_URL");
    return null;
  }
  return raw.replace(/\/+$/, "");
}

function ensureFeedConfigured(channel: DesktopUpdateChannel): { ok: true; url: string } {
  const feedUrl = resolveFeedUrl();
  if (feedUrl) {
    autoUpdater.setFeedURL({
      provider: "generic",
      url: feedUrl,
      channel: "latest",
    });
    return { ok: true, url: feedUrl };
  }

  if (channel === "nightly") {
    autoUpdater.setFeedURL({
      provider: "generic",
      url: NIGHTLY_UPDATE_URL,
      channel: "latest",
    });
    return { ok: true, url: NIGHTLY_UPDATE_URL };
  }

  // Default feed: the public GitHub releases, which ship latest-mac.yml plus
  // signed zip/dmg assets. electron-updater verifies the download's code
  // signature against the running app before installing.
  autoUpdater.setFeedURL({
    provider: "github",
    owner: "jake-molnia",
    repo: "local-studio",
  });
  return { ok: true, url: "github:jake-molnia/local-studio" };
}

function configureUpdater(channel: DesktopUpdateChannel): { ok: true; url: string } {
  autoUpdater.allowPrerelease = channel === "nightly";
  autoUpdater.allowDowngrade = false;
  return ensureFeedConfigured(channel);
}

export function getUpdateState(): DesktopUpdateSnapshot {
  return latestUpdateState;
}

function installDownloadedUpdate(): void {
  autoUpdater.quitAndInstall();
}

export async function checkForUpdates(force = false): Promise<DesktopUpdateSnapshot> {
  if (DESKTOP_CONFIG.disableAutoUpdate) {
    setUpdateState({
      status: "error",
      message: "Auto update disabled by LOCAL_STUDIO_DESKTOP_DISABLE_AUTO_UPDATE",
    });
    return latestUpdateState;
  }

  // Dev-channel builds install via the dev mirror, never the stable releases —
  // the default GitHub feed would happily "update" them onto stable. An
  // explicit LOCAL_STUDIO_UPDATE_URL override still wins for feed testing.
  if (isDevChannelBuild && !resolveFeedUrl()) {
    setUpdateState({
      status: "idle",
      message: "Dev-channel builds do not auto-update from stable releases",
    });
    return latestUpdateState;
  }

  configureUpdater(selectedUpdateChannel());

  if (!app.isPackaged && !force) {
    setUpdateState({
      status: "idle",
      message: "Auto updates are only available in packaged builds",
    });
    return latestUpdateState;
  }

  try {
    setUpdateState({ status: "checking" });
    const result = await autoUpdater.checkForUpdates();
    if (result?.downloadPromise) void result.downloadPromise.catch(setUpdateError);
    // An unpackaged app resolves null without emitting any status event; leave
    // "checking" behind and the renderer would poll forever.
    if (!result && latestUpdateState.status === "checking") {
      setUpdateState({ status: "idle", message: "Updater unavailable in this build" });
    }
    return latestUpdateState;
  } catch (error) {
    setUpdateState({
      status: "error",
      message: String(error),
    });
    return latestUpdateState;
  }
}

export async function startUpdate(): Promise<DesktopUpdateSnapshot> {
  const action = installIntent.request(latestUpdateState.status);
  if (action === "install") {
    installDownloadedUpdate();
    return latestUpdateState;
  }
  if (action === "wait") return latestUpdateState;

  const snapshot = await checkForUpdates(true);
  if (
    snapshot.status === "idle" ||
    snapshot.status === "not-available" ||
    snapshot.status === "error"
  ) {
    installIntent.clear();
  }
  return snapshot;
}

export async function setUpdateChannel(channel: unknown): Promise<DesktopUpdateSnapshot> {
  if (!Schema.is(DesktopUpdateChannelSchema)(channel)) {
    setUpdateError("Invalid desktop update channel");
    return latestUpdateState;
  }

  if (
    latestUpdateState.status === "checking" ||
    latestUpdateState.status === "available" ||
    latestUpdateState.status === "downloading" ||
    latestUpdateState.status === "downloaded"
  ) {
    return {
      ...latestUpdateState,
      message: "Finish the current update before changing channels",
    };
  }

  if (channel === selectedUpdateChannel()) return latestUpdateState;

  setStoredUpdateChannel(channel);
  installIntent.clear();
  setUpdateState({ status: "idle" });
  const feed = configureUpdater(channel);
  log.info(`[update] Channel: ${channel}; feed: ${feed.url}`);
  return checkForUpdates();
}

export function initializeAutoUpdates(): void {
  if (DESKTOP_CONFIG.disableAutoUpdate) {
    log.warn("Auto update disabled by environment flag");
    return;
  }

  if (isDevChannelBuild && !resolveFeedUrl()) {
    setUpdateState({ status: "idle", message: "Dev channel: auto-update disabled" });
    log.info("[update] Dev-channel build; skipping stable release feed");
    return;
  }

  const channel = selectedUpdateChannel();
  const feed = configureUpdater(channel);
  log.info(`[update] Channel: ${channel}; feed: ${feed.url}`);

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.autoRunAppAfterInstall = true;

  autoUpdater.on("checking-for-update", () => {
    setUpdateState({ status: "checking" });
    log.info("Checking for updates");
  });

  autoUpdater.on("update-available", (info) => {
    setUpdateState({ status: "available", version: info.version });
    log.info(`Update available: ${info.version}`);
  });

  autoUpdater.on("update-not-available", (info) => {
    installIntent.clear();
    setUpdateState({ status: "not-available", version: info.version });
    log.info("No update available");
  });

  autoUpdater.on("download-progress", (progress) => {
    setUpdateState({
      status: "downloading",
      version: latestUpdateState.version,
      message: `${progress.percent.toFixed(1)}%`,
      progress: progress.percent,
    });
  });

  autoUpdater.on("update-downloaded", (info) => {
    setUpdateState({ status: "downloaded", version: info.version });
    log.info(`Update downloaded: ${info.version}`);
    if (installIntent.downloadCompleted()) {
      log.info(`Restarting to install update: ${info.version}`);
      installDownloadedUpdate();
    }
  });

  autoUpdater.on("error", (error) => {
    setUpdateError(error);
  });

  if (app.isPackaged) {
    setTimeout(() => {
      void checkForUpdates().catch((error) => {
        log.error(`Background update check failed: ${String(error)}`);
      });
    }, 4_000);
  }
}
