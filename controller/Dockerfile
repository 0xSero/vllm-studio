FROM node:22-bookworm AS build

RUN apt-get update && apt-get install -y --no-install-recommends xz-utils && rm -rf /var/lib/apt/lists/*

WORKDIR /source
COPY controller ./controller
COPY contracts ./contracts
RUN node controller/toolchain.mjs build -Doptimize=ReleaseSafe

FROM node:22-bookworm-slim

ARG TARGETARCH
ARG PI_VERSION=0.73.1
ARG CODEX_VERSION=0.150.0
ARG OPENCODE_VERSION=0.0.0-beta-18286
ARG CLAUDE_VERSION=2.1.232
ARG FX_VERSION=0.0.6
ARG BUN_VERSION=1.4.0
ARG DENO_VERSION=2.9.5
ARG PNPM_VERSION=11.24.0
ARG YARN_VERSION=4.18.0
ARG UV_VERSION=0.11.7

RUN apt-get update && apt-get install -y --no-install-recommends \
    autoconf \
    automake \
    bash \
    build-essential \
    bzip2 \
    ca-certificates \
    cargo \
    chromium \
    clang \
    cmake \
    composer \
    curl \
    default-jdk-headless \
    dnsutils \
    fd-find \
    file \
    fzf \
    gdb \
    git \
    git-lfs \
    golang-go \
    iproute2 \
    iputils-ping \
    jq \
    less \
    libtool \
    lld \
    lsof \
    make \
    maven \
    netcat-openbsd \
    ninja-build \
    openssh-client \
    patch \
    php-cli \
    pkg-config \
    procps \
    python3 \
    python3-dev \
    python3-pip \
    python3-venv \
    ripgrep \
    rsync \
    ruby-full \
    rustc \
    shellcheck \
    sqlite3 \
    tmux \
    tree \
    unzip \
    vim-tiny \
    xz-utils \
    zip \
    zsh \
    && rm -rf /var/lib/apt/lists/* \
    && ln -s /usr/bin/fdfind /usr/local/bin/fd \
    && git lfs install --system
RUN npm install --global \
    "@mariozechner/pi-coding-agent@${PI_VERSION}" \
    "@openai/codex@${CODEX_VERSION}" \
    "bun@${BUN_VERSION}" \
    "deno@${DENO_VERSION}" \
    && npm cache clean --force
RUN corepack prepare "pnpm@${PNPM_VERSION}" --activate \
    && corepack prepare "yarn@${YARN_VERSION}" --activate
RUN python3 -m pip install --break-system-packages --no-cache-dir "uv==${UV_VERSION}"
RUN set -eu; \
    case "$TARGETARCH" in \
      amd64) package_arch="x64"; fx_arch="x86_64" ;; \
      arm64) package_arch="arm64"; fx_arch="aarch64" ;; \
      *) exit 1 ;; \
    esac; \
    work_dir="$(mktemp -d)"; \
    curl -fsSL "https://registry.npmjs.org/@opencode-ai/cli-linux-${package_arch}/-/cli-linux-${package_arch}-${OPENCODE_VERSION}.tgz" -o "$work_dir/opencode.tgz"; \
    mkdir "$work_dir/opencode"; \
    tar -xzf "$work_dir/opencode.tgz" -C "$work_dir/opencode"; \
    install -m 0755 "$work_dir/opencode/package/bin/opencode2" /usr/local/bin/opencode2; \
    curl -fsSL "https://registry.npmjs.org/@anthropic-ai/claude-code-linux-${package_arch}/-/claude-code-linux-${package_arch}-${CLAUDE_VERSION}.tgz" -o "$work_dir/claude.tgz"; \
    mkdir "$work_dir/claude"; \
    tar -xzf "$work_dir/claude.tgz" -C "$work_dir/claude"; \
    install -m 0755 "$work_dir/claude/package/claude" /usr/local/bin/claude; \
    curl -fsSL "https://releases.fx.sh/v${FX_VERSION}/fx-linux-${fx_arch}.tar.gz" -o "$work_dir/fx.tgz"; \
    tar -xzf "$work_dir/fx.tgz" -C "$work_dir"; \
    install -m 0755 "$work_dir/fx" /usr/local/bin/fx; \
    rm -rf "$work_dir"

COPY --from=build /source/controller/zig-out/bin/local-studio-controller /usr/local/bin/local-studio-controller
COPY --from=build /source/controller/zig-out/bin/secretspec /usr/local/bin/secretspec
COPY --from=build /root/.cache/local-studio/zig/0.16.0/toolchain /opt/zig

ENV LOCAL_STUDIO_CONTROLLER_MODE=standalone
ENV LOCAL_STUDIO_DATA_DIR=/data
ENV LOCAL_STUDIO_MODELS_DIR=/models
ENV LOCAL_STUDIO_BUNDLED_CHROMIUM_PATH=/usr/bin/chromium
ENV PATH=/opt/zig:${PATH}

EXPOSE 8080

USER node
WORKDIR /home/node

ENTRYPOINT ["local-studio-controller"]
