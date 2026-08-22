{ lib, pkgs, ... }:

let
  bunVersion = "1.3.14";
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
    pkgs.curl
    pkgs.git
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
      "controller/package.json"
      "controller/bun.lock"
      "controller/contracts/package.json"
      "frontend/package.json"
      "frontend/package-lock.json"
      "services/agent-runtime/package.json"
      "services/agent-runtime/bun.lock"
      "shared/package.json"
      "shared/bun.lock"
    ];
    before = [
      "devenv:enterShell"
      "devenv:processes:head-node"
    ]
    ++ lib.optionals pkgs.stdenv.hostPlatform.isDarwin [
      "devenv:processes:desktop"
    ];
  };

  processes.head-node = {
    cwd = "./controller";
    exec = ''
      if ! ${lib.getExe pkgs.python311} -c 'import socket; connection = socket.socket(); connection.bind(("127.0.0.1", 8080)); connection.close()' 2>/dev/null; then
        echo "Port 8080 is already in use" >&2
        exit 1
      fi
      exec bun run dev
    '';
    env.LOCAL_STUDIO_PORT = "8080";
    restart.on = "never";
    ready = {
      exec = "${lib.getExe pkgs.curl} --fail --silent --output /dev/null http://127.0.0.1:8080/health";
      period = 1;
      timeout = 120;
    };
  };

  processes.desktop = lib.mkIf pkgs.stdenv.hostPlatform.isDarwin {
    exec = ''
      if ! ${lib.getExe pkgs.python311} -c 'import socket; connection = socket.socket(); connection.bind(("127.0.0.1", 3000)); connection.close()' 2>/dev/null; then
        echo "Port 3000 is already in use" >&2
        exit 1
      fi
      exec npm --prefix frontend run desktop:dev
    '';
    after = [ "devenv:processes:head-node@ready" ];
    env.PORT = "3000";
    restart.on = "never";
    ready = {
      exec = "${lib.getExe pkgs.curl} --fail --silent --output /dev/null http://127.0.0.1:3000/";
      initial_delay = 2;
      period = 1;
      timeout = 120;
    };
  };
}
