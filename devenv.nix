{ config, lib, pkgs, ... }:

let
  bunVersion = "1.3.14";
  opencodeVersion = "0.0.0-beta-18286";
  claudeVersion = "2.1.232";
  fxVersion = "0.0.6";
  bunSources = {
    aarch64-darwin = pkgs.fetchurl {
      url = "https://github.com/oven-sh/bun/releases/download/bun-v${bunVersion}/bun-darwin-aarch64.zip";
      hash = "sha256-2LliIYKK1vl6x6wKt+lYcjQa92MAHogD6CZ2UsJlJiA=";
    };
    aarch64-linux = pkgs.fetchurl {
      url = "https://github.com/oven-sh/bun/releases/download/bun-v${bunVersion}/bun-linux-aarch64.zip";
      hash = "sha256-on/7Y6gxA3WDbg1vZorhf6jY0YuIw3yCHGUzGXOhmjs=";
    };
    x86_64-linux = pkgs.fetchurl {
      url = "https://github.com/oven-sh/bun/releases/download/bun-v${bunVersion}/bun-linux-x64.zip";
      hash = "sha256-lR7iruhV8IWVruxiJSJqKY0/6oOj3NZGXAnLzN9+hI8=";
    };
  };
  system = pkgs.stdenv.hostPlatform.system;
  opencodeSources = {
    aarch64-darwin = pkgs.fetchurl {
      url = "https://registry.npmjs.org/@opencode-ai/cli-darwin-arm64/-/cli-darwin-arm64-${opencodeVersion}.tgz";
      hash = "sha256-I2rbaFBcoFdwpwC6118Tw9ri+EWi8J5QfToAEf73qLs=";
    };
    x86_64-darwin = pkgs.fetchurl {
      url = "https://registry.npmjs.org/@opencode-ai/cli-darwin-x64/-/cli-darwin-x64-${opencodeVersion}.tgz";
      hash = "sha256-CrQgWFZtwTmdNXYn5hi7UliGyTFBZt30rBsMecBfqxI=";
    };
    aarch64-linux = pkgs.fetchurl {
      url = "https://registry.npmjs.org/@opencode-ai/cli-linux-arm64/-/cli-linux-arm64-${opencodeVersion}.tgz";
      hash = "sha256-5hl2b0xxO5DI770SrfBo64JQjLKtxLIP62UqYNnATfk=";
    };
    x86_64-linux = pkgs.fetchurl {
      url = "https://registry.npmjs.org/@opencode-ai/cli-linux-x64/-/cli-linux-x64-${opencodeVersion}.tgz";
      hash = "sha256-XlyYHmBbuowUWpXy3GqBno9jOnHpvDw40cm5hsWSjVU=";
    };
  };
  claudeSources = {
    aarch64-darwin = pkgs.fetchurl {
      url = "https://registry.npmjs.org/@anthropic-ai/claude-code-darwin-arm64/-/claude-code-darwin-arm64-${claudeVersion}.tgz";
      hash = "sha256-WknorImLj3R4gpjxyP9cXKz3K+kVYTtBdxG4H4rdoo8=";
    };
    x86_64-darwin = pkgs.fetchurl {
      url = "https://registry.npmjs.org/@anthropic-ai/claude-code-darwin-x64/-/claude-code-darwin-x64-${claudeVersion}.tgz";
      hash = "sha256-FQKcyKBeKPRDqT26SyyABMWTR549wzTID+8ZpJdDzq8=";
    };
    aarch64-linux = pkgs.fetchurl {
      url = "https://registry.npmjs.org/@anthropic-ai/claude-code-linux-arm64/-/claude-code-linux-arm64-${claudeVersion}.tgz";
      hash = "sha256-lzIhif88iE6G0ropgdIcmHTKeCYai/9lpO9vZz75j6Y=";
    };
    x86_64-linux = pkgs.fetchurl {
      url = "https://registry.npmjs.org/@anthropic-ai/claude-code-linux-x64/-/claude-code-linux-x64-${claudeVersion}.tgz";
      hash = "sha256-yw6vqRnfPPxP8d4q4+J/8hovEUmlqtCPeFDECk/UD44=";
    };
  };
  fxSources = {
    aarch64-darwin = pkgs.fetchurl {
      url = "https://releases.fx.sh/v${fxVersion}/fx-macos-aarch64.tar.gz";
      hash = "sha256-n8GNXDQpraslTMK2JslnnoZr4mSW4J1764dU9sHFhsk=";
    };
    x86_64-darwin = pkgs.fetchurl {
      url = "https://releases.fx.sh/v${fxVersion}/fx-macos-x86_64.tar.gz";
      hash = "sha256-7vDya/QZ0w4Hv8TDROU3TdFw0McR+ZZcsLCK/HTk4/w=";
    };
    aarch64-linux = pkgs.fetchurl {
      url = "https://releases.fx.sh/v${fxVersion}/fx-linux-aarch64.tar.gz";
      hash = "sha256-Df1TIkxezt5gG7jOZJ+E+rbbBaOa+81bOeYJGDP2xNc=";
    };
    x86_64-linux = pkgs.fetchurl {
      url = "https://releases.fx.sh/v${fxVersion}/fx-linux-x86_64.tar.gz";
      hash = "sha256-Eg+pkt+Mr5guF8qenjlmx5Cw0VBIBRHq9ROS5moPC4Q=";
    };
  };
  opencode = pkgs.stdenvNoCC.mkDerivation {
    pname = "opencode2";
    version = opencodeVersion;
    src = opencodeSources.${system} or (throw "OpenCode ${opencodeVersion} is unavailable for ${system}");
    sourceRoot = "package";
    installPhase = ''
      runHook preInstall
      install -Dm755 bin/opencode2 $out/bin/opencode2
      runHook postInstall
    '';
  };
  claude = pkgs.stdenvNoCC.mkDerivation {
    pname = "claude-code";
    version = claudeVersion;
    src = claudeSources.${system} or (throw "Claude Code ${claudeVersion} is unavailable for ${system}");
    sourceRoot = "package";
    installPhase = ''
      runHook preInstall
      install -Dm755 claude $out/bin/claude
      runHook postInstall
    '';
  };
  fx = pkgs.stdenvNoCC.mkDerivation {
    pname = "fx-agent";
    version = fxVersion;
    src = fxSources.${system} or (throw "FX ${fxVersion} is unavailable for ${system}");
    sourceRoot = ".";
    installPhase = ''
      runHook preInstall
      install -Dm755 fx $out/bin/fx
      runHook postInstall
    '';
  };
  controllerPort = 8082;
  localNodePort = 8083;
  frontendPort = 3100;
  controllerUrl = "http://127.0.0.1:${toString controllerPort}";
  localNodeUrl = "http://127.0.0.1:${toString localNodePort}";
  frontendUrl = "http://127.0.0.1:${toString frontendPort}";
  localStudioState = "${config.devenv.state}/local-studio";
  headDataDir = "${localStudioState}/head";
  frontendDataDir = "${localStudioState}/frontend";
  localNodeDataDir = "${localStudioState}/local-node";
  modelsDir = "${localStudioState}/models";
  desktopUserDataDir = "${localStudioState}/electron";
  zigController = "./controller/zig-out/bin/local-studio-controller";
  portPreflight = ports: ''
    ${lib.getExe pkgs.python311} -c '
    import socket, sys
    ports = [${lib.concatMapStringsSep ", " toString ports}]
    busy = []
    sockets = []
    for port in ports:
        listener = socket.socket()
        listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            listener.bind(("127.0.0.1", port))
        except OSError:
            busy.append(port)
            listener.close()
        else:
            sockets.append(listener)
    for listener in sockets:
        listener.close()
    if busy:
        print("Local Studio development ports already in use: " + ", ".join(map(str, busy)) + ". Stop the existing dev stack before starting another one.", file=sys.stderr)
        raise SystemExit(1)
    '
  '';
  bun = pkgs.bun.overrideAttrs (previous: {
    version = bunVersion;
    src = bunSources.${system} or (throw "Bun ${bunVersion} is unavailable for ${system}");
    passthru = previous.passthru // {
      sources = bunSources;
    };
  });
in
{
  packages = [
    claude
    pkgs.curl
    pkgs.git
    opencode
    fx
  ];

  languages.javascript = {
    enable = true;
    package = pkgs.nodejs_22;
    lsp.enable = false;
    npm.enable = true;
    bun = {
      enable = true;
      package = bun;
    };
  };

  languages.python = {
    enable = true;
    package = pkgs.python311;
    lsp.enable = false;
    uv.enable = true;
  };

  tasks."local-studio:setup" = {
    exec = "npm run setup";
    execIfModified = [
      "package.json"
      "controller/bridges/cursor/package.json"
      "controller/bridges/cursor/bun.lock"
      "contracts/package.json"
      "contracts/bun.lock"
      "frontend/package.json"
      "frontend/package-lock.json"
      "shared/package.json"
      "shared/bun.lock"
    ];
    before = [
      "devenv:enterShell"
      "devenv:processes:head-node"
    ]
    ++ lib.optionals pkgs.stdenv.hostPlatform.isDarwin [
      "devenv:processes:local-node"
      "devenv:processes:frontend"
      "devenv:processes:electron"
    ];
  };

  processes.head-node = {
    exec = ''
      ${portPreflight [ controllerPort ]}
      ${lib.optionalString pkgs.stdenv.hostPlatform.isDarwin ''
        npm --prefix frontend run desktop:build:main
        export LOCAL_STUDIO_BUNDLED_CHROMIUM_PATH="$PWD/frontend/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron"
        export LOCAL_STUDIO_BROWSER_HOST_SCRIPT="$PWD/frontend/desktop/dist/browser-host.js"
      ''}
      node controller/toolchain.mjs build -Doptimize=ReleaseSafe
      exec ${zigController} --mode head --host 127.0.0.1 --port ${toString controllerPort}
    '';
    env = {
      LOCAL_STUDIO_CONTROLLER_MODE = "head";
      LOCAL_STUDIO_DATA_DIR = headDataDir;
      LOCAL_STUDIO_DAYTONA_SNAPSHOT = "local-studio-worker-dev-cca810bc5db6c571404d5951648473a32afd44cd";
      LOCAL_STUDIO_MODELS_DIR = modelsDir;
      LOCAL_STUDIO_PORT = toString controllerPort;
    };
    restart.on = "never";
    ready = {
      exec = "${lib.getExe pkgs.curl} --fail --silent --output /dev/null ${controllerUrl}/health";
      period = 1;
      timeout = 120;
    };
  };

  processes.local-node = lib.mkIf pkgs.stdenv.hostPlatform.isDarwin {
    exec = ''
      set -eu
      ${portPreflight [ localNodePort ]}
      export LOCAL_STUDIO_BUNDLED_CHROMIUM_PATH="$PWD/frontend/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron"
      export LOCAL_STUDIO_BROWSER_HOST_SCRIPT="$PWD/frontend/desktop/dist/browser-host.js"
      ${zigController} --mode worker --host 127.0.0.1 --port ${toString localNodePort} &
      local_node_pid=$!
      stop_local_node() {
        kill -TERM "$local_node_pid" 2>/dev/null || true
      }
      trap stop_local_node INT TERM EXIT
      until ${lib.getExe pkgs.curl} --fail --silent --output /dev/null ${localNodeUrl}/health; do
        if ! kill -0 "$local_node_pid" 2>/dev/null; then
          wait "$local_node_pid"
          exit $?
        fi
        sleep 0.2
      done
      ${lib.getExe pkgs.curl} --fail --silent --output /dev/null \
        --request PUT \
        --header 'Content-Type: application/json' \
        --data '{"name":"Devenv Head","url":"${controllerUrl}","apiKey":"local-studio","nodeAddress":"${localNodeUrl}","nodeApiKey":"local-studio"}' \
        ${localNodeUrl}/api/agent/head-connection
      wait "$local_node_pid"
      local_node_status=$?
      trap - INT TERM EXIT
      exit "$local_node_status"
    '';
    after = [ "devenv:processes:head-node@ready" ];
    env = {
      LOCAL_STUDIO_CONTROLLER_MODE = "worker";
      LOCAL_STUDIO_CLAUDE_BIN = "${claude}/bin/claude";
      LOCAL_STUDIO_DATA_DIR = localNodeDataDir;
      LOCAL_STUDIO_FX_BIN = "${fx}/bin/fx";
      LOCAL_STUDIO_FRONTEND_BASE = frontendUrl;
      LOCAL_STUDIO_MODELS_DIR = modelsDir;
      LOCAL_STUDIO_OPENCODE_BIN = "${opencode}/bin/opencode2";
      LOCAL_STUDIO_PORT = toString localNodePort;
    };
    restart.on = "never";
    ready = {
      exec = "${lib.getExe pkgs.curl} --fail --silent ${localNodeUrl}/api/agent/head-connection | ${lib.getExe pkgs.python311} -c 'import json, sys; payload = json.load(sys.stdin); raise SystemExit(0 if payload.get(\"connected\") and payload.get(\"url\") == \"${controllerUrl}\" else 1)'";
      period = 1;
      timeout = 120;
    };
  };

  processes.frontend = lib.mkIf pkgs.stdenv.hostPlatform.isDarwin {
    cwd = "./frontend";
    exec = ''
      ${portPreflight [ frontendPort ]}
      exec ./node_modules/.bin/next dev -p ${toString frontendPort}
    '';
    after = [
      "devenv:processes:head-node@ready"
      "devenv:processes:local-node@ready"
    ];
    env = {
      BACKEND_URL = localNodeUrl;
      LOCAL_STUDIO_BACKEND_URL = localNodeUrl;
      LOCAL_STUDIO_DATA_DIR = frontendDataDir;
      LOCAL_STUDIO_DISABLE_LEGACY_SETTINGS_MIGRATION = "1";
      LOCAL_STUDIO_CONTROLLER_URL = controllerUrl;
      LOCAL_STUDIO_PROXY_OVERRIDE_ALLOWLIST = "${localNodeUrl},${controllerUrl}";
      NEXT_PUBLIC_BACKEND_URL = localNodeUrl;
      NEXT_PUBLIC_LOCAL_STUDIO_CONTROLLER_URL = localNodeUrl;
      NEXT_PUBLIC_LOCAL_STUDIO_HEAD_URL = controllerUrl;
      NEXT_DIST_DIR = ".next-dev";
    };
    restart.on = "never";
    ready = {
      exec = "${lib.getExe pkgs.curl} --fail --silent --output /dev/null ${frontendUrl}/";
      initial_delay = 2;
      period = 1;
      timeout = 120;
    };
  };

  processes.electron = lib.mkIf pkgs.stdenv.hostPlatform.isDarwin {
    exec = ''
      npm --prefix frontend run desktop:build:main
      exec npm --prefix frontend run desktop:start
    '';
    after = [ "devenv:processes:frontend@ready" ];
    env = {
      LOCAL_STUDIO_DESKTOP_APP_NAME = "Local Studio Devenv";
      LOCAL_STUDIO_DESKTOP_CONTROLLER_PORT = toString localNodePort;
      LOCAL_STUDIO_DESKTOP_DEV_SERVER_URL = frontendUrl;
      LOCAL_STUDIO_DESKTOP_USER_DATA_DIR = desktopUserDataDir;
    };
    restart.on = "never";
  };
}
