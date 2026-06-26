import Link from "next/link";
import {
  Boxes,
  CheckCircle2,
  DownloadCloud,
  ExternalLink,
  Gauge,
  GitFork,
  HardDrive,
  Network,
  PlugZap,
  ServerCog,
  TerminalSquare,
  Zap,
  type LucideIcon,
} from "@/ui/icon-registry";
import styles from "./marketing.module.css";

type Screenshot = {
  src: string;
  title: string;
  meta: string;
  alt: string;
};

const screenshots: Screenshot[] = [
  {
    src: "/marketing/screenshots/status-dashboard.png",
    title: "Controller telemetry",
    meta: "real vLLM Studio screenshot",
    alt: "vLLM Studio status dashboard showing controllers, decode metrics, VRAM, power, and GPU rows.",
  },
  {
    src: "/marketing/screenshots/discover-models.png",
    title: "Model discovery",
    meta: "real vLLM Studio screenshot",
    alt: "vLLM Studio Discover Models screen showing searchable model rows and download actions.",
  },
  {
    src: "/marketing/screenshots/system-settings.png",
    title: "Runtime settings",
    meta: "real vLLM Studio screenshot",
    alt: "vLLM Studio System settings showing installed inference engines and service topology.",
  },
  {
    src: "/marketing/screenshots/model-library.png",
    title: "Hardware fit",
    meta: "real vLLM Studio screenshot",
    alt: "vLLM Studio model library with hardware profile, model results, and downloads.",
  },
  {
    src: "/marketing/screenshots/plugins.png",
    title: "Agent plugins",
    meta: "real vLLM Studio screenshot",
    alt: "vLLM Studio Plugins page showing MCP custom server and registry source settings.",
  },
];

const capabilities: Array<{ icon: LucideIcon; title: string; copy: string }> = [
  {
    icon: ServerCog,
    title: "Controller-first operations",
    copy: "Run one local controller or switch across GPU hosts. Status, launches, logs, usage, recipes, and proxy routes stay behind one clean control surface.",
  },
  {
    icon: HardDrive,
    title: "Model lifecycle without ceremony",
    copy: "Discover models, download weights, manage runtime targets, launch recipes, evict processes, and keep hardware fit visible before a model burns VRAM.",
  },
  {
    icon: PlugZap,
    title: "Agents with MCP routing",
    copy: "The agent surface uses the Pi runtime and local MCP registry so tools, skills, prompt templates, browser control, and project state are all reachable from the same workspace.",
  },
];

const downloads = [
  {
    title: "macOS Apple Silicon DMG",
    copy: "Signed desktop app bundle packaged from this repo's current v0.2.9 arm64 artifact.",
    href: "/api/downloads/mac-dmg",
    meta: ["macOS", "arm64", "DMG"],
  },
  {
    title: "macOS Apple Silicon ZIP",
    copy: "Portable app archive for users who prefer to inspect or move the bundle manually.",
    href: "/api/downloads/mac-zip",
    meta: ["macOS", "arm64", "ZIP"],
  },
  {
    title: "Agent setup runbook",
    copy: "A DLTL-style instruction page for connecting controllers, providers, runtime backends, MCP servers, and Pi agent sessions.",
    href: "/agents",
    meta: ["DLTL", "controllers", "providers"],
  },
];

function MarketingNav() {
  return (
    <header className={styles.nav}>
      <Link href="/download" className={styles.brand} aria-label="vLLM Studio download page">
        <span className={styles.mark}>vS</span>
        <span>vLLM Studio</span>
      </Link>
      <nav className={styles.navLinks} aria-label="Marketing navigation">
        <Link href="/download#product">Product</Link>
        <Link href="/download#downloads">Downloads</Link>
        <Link href="/agents">Agents</Link>
        <Link className={styles.navCta} href="/api/downloads/mac-dmg" prefetch={false} download>
          <DownloadCloud size={16} aria-hidden="true" />
          Download
        </Link>
      </nav>
    </header>
  );
}

function ScreenshotFrame({
  screenshot,
  priority = false,
}: {
  screenshot: Screenshot;
  priority?: boolean;
}) {
  return (
    <figure className={styles.frame}>
      <figcaption className={styles.frameHeader}>
        <span>{screenshot.title}</span>
        <span>{screenshot.meta}</span>
      </figcaption>
      <img src={screenshot.src} alt={screenshot.alt} loading={priority ? "eager" : "lazy"} />
    </figure>
  );
}

export function MarketingLandingPage() {
  return (
    <main className={styles.shell}>
      <MarketingNav />

      <section className={styles.hero} aria-labelledby="landing-title">
        <div className={styles.heroImage} aria-hidden="true">
          <img src="/marketing/screenshots/status-dashboard.png" alt="" />
        </div>
        <div className={styles.heroScrim} aria-hidden="true" />
        <div className={styles.heroInner}>
          <p className={styles.eyebrow}>Local-first LLM operations</p>
          <h1 id="landing-title" className={styles.heroTitle}>
            vLLM Studio
          </h1>
          <p className={styles.heroCopy}>
            A desktop and web control plane for self-hosted inference: launch models, watch GPU
            state, switch controllers, route OpenAI-compatible providers, and hand real tools to
            agents without losing the machine-level picture.
          </p>
          <div className={styles.heroActions}>
            <Link className={styles.button} href="/api/downloads/mac-dmg" prefetch={false} download>
              <DownloadCloud size={18} aria-hidden="true" />
              Download for Mac
            </Link>
            <Link className={styles.ghostButton} href="/agents">
              <TerminalSquare size={18} aria-hidden="true" />
              Agent setup
            </Link>
          </div>
          <div className={styles.metricStrip} aria-label="vLLM Studio product scope">
            <div className={styles.metric}>
              <span className={styles.metricLabel}>Backends</span>
              <span className={styles.metricValue}>vLLM / SGLang / MLX / llama.cpp</span>
            </div>
            <div className={styles.metric}>
              <span className={styles.metricLabel}>Controller</span>
              <span className={styles.metricValue}>local or remote</span>
            </div>
            <div className={styles.metric}>
              <span className={styles.metricLabel}>Proxy</span>
              <span className={styles.metricValue}>OpenAI-compatible</span>
            </div>
            <div className={styles.metric}>
              <span className={styles.metricLabel}>Agents</span>
              <span className={styles.metricValue}>Pi + MCP</span>
            </div>
          </div>
        </div>
      </section>

      <section id="product" className={styles.section} aria-labelledby="product-title">
        <div className={styles.sectionHeader}>
          <div>
            <p className={styles.sectionKicker}>Real interface, real machine state</p>
            <h2 id="product-title" className={styles.sectionTitle}>
              The product is the proof.
            </h2>
          </div>
          <p className={styles.sectionLead}>
            The funnel uses actual vLLM Studio screenshots from the installed app. Dense status
            rows, runtime targets, model discovery, and plugin wiring are not illustrations; they
            are the operating surface.
          </p>
        </div>
        <div className={styles.screenshotGrid}>
          <ScreenshotFrame screenshot={screenshots[0]} priority />
          <div className={styles.stack}>
            {screenshots.slice(1, 3).map((screenshot) => (
              <ScreenshotFrame key={screenshot.src} screenshot={screenshot} />
            ))}
          </div>
        </div>
      </section>

      <section className={styles.section} aria-label="Capabilities">
        <div className={styles.capabilityGrid}>
          {capabilities.map(({ icon: Icon, title, copy }) => (
            <article className={styles.capability} key={title}>
              <div className={styles.capabilityIcon}>
                <Icon size={18} aria-hidden="true" />
              </div>
              <h3>{title}</h3>
              <p>{copy}</p>
            </article>
          ))}
        </div>
      </section>

      <section className={`${styles.section} ${styles.quoteBand}`} aria-label="Operating thesis">
        <blockquote className={styles.quote}>
          Local inference gets good when controllers, models, and agents share the same map.
        </blockquote>
        <ul className={styles.terminalList}>
          <li>{"GET /status -> active model, pid, backend, port"}</li>
          <li>{"GET /gpus -> VRAM, power, temperature, utilization"}</li>
          <li>{"POST /studio/providers -> route provider/model requests"}</li>
          <li>{"GET /studio/provider-models -> inspect enabled upstreams"}</li>
        </ul>
      </section>

      <section className={styles.section} aria-labelledby="gallery-title">
        <div className={styles.sectionHeader}>
          <div>
            <p className={styles.sectionKicker}>Screenshots included</p>
            <h2 id="gallery-title" className={styles.sectionTitle}>
              From runtime to agent tools.
            </h2>
          </div>
          <p className={styles.sectionLead}>
            Operators can see the path from a GPU host to a running model to an agent workspace:
            controller connection, runtime installation, model fit, provider routing, and MCP.
          </p>
        </div>
        <div className={styles.screenshotGrid}>
          <ScreenshotFrame screenshot={screenshots[3]} />
          <div className={styles.stack}>
            <ScreenshotFrame screenshot={screenshots[4]} />
            <ScreenshotFrame screenshot={screenshots[2]} />
          </div>
        </div>
      </section>

      <section id="downloads" className={styles.wideBand} aria-labelledby="downloads-title">
        <div className={styles.section}>
          <div className={styles.sectionHeader}>
            <div>
              <p className={styles.sectionKicker}>Download</p>
              <h2 id="downloads-title" className={styles.sectionTitle}>
                Start with the desktop app. Add controllers as your fleet grows.
              </h2>
            </div>
            <p className={styles.sectionLead}>
              The current local artifacts are served through the app, while the agent page gives a
              concrete setup path for local, remote, and provider-backed inference.
            </p>
          </div>
          <div className={styles.downloadGrid}>
            {downloads.map((download) => {
              const isExternal = download.href.startsWith("http");
              const Icon = download.href === "/agents" ? GitFork : DownloadCloud;
              return (
                <article className={styles.downloadCard} key={download.title}>
                  <div className={styles.capabilityIcon}>
                    <Icon size={18} aria-hidden="true" />
                  </div>
                  <h3>{download.title}</h3>
                  <p>{download.copy}</p>
                  <div className={styles.downloadMeta}>
                    {download.meta.map((item) => (
                      <span className={styles.pill} key={item}>
                        {item}
                      </span>
                    ))}
                  </div>
                  <div className={styles.downloadActions}>
                    {isExternal ? (
                      <a className={styles.ghostButton} href={download.href}>
                        {download.href === "/agents" ? "Open page" : "Download"}
                        <ExternalLink size={15} aria-hidden="true" />
                      </a>
                    ) : (
                      <Link
                        className={styles.ghostButton}
                        href={download.href}
                        prefetch={false}
                        download={download.href.startsWith("/api/downloads")}
                      >
                        {download.href === "/agents" ? "Open page" : "Download"}
                      </Link>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      </section>

      <footer className={styles.footer}>
        <span>vLLM Studio v0.2.9</span>
        <span>Desktop, web UI, controller API, CLI, Pi agent runtime</span>
      </footer>
    </main>
  );
}

const dltl = `DLTL: Configure vLLM Studio for multiple controllers, providers, and agents

Role:
You are an implementation agent operating on a real vLLM Studio install. Work against the live machine, live controller URLs, and current repo state. Never print, commit, or hardcode credentials.

Hard rules:
- Never use max_tokens.
- With vLLM or SGLang, never add --disable-cuda-graphs and never add --enforce-eager.
- Do not bypass SSH host-key verification.
- Prefer stored controller/provider settings, environment variables, or local secure files over inline secrets.

Goal:
Create a usable multi-controller, multi-provider vLLM Studio setup. The human should be able to switch between local and remote controllers, route provider/model requests, launch or inspect vLLM/SGLang/llama.cpp/MLX recipes, and run Pi agent sessions with MCP tools selected in the composer.

Controller setup:
1. Start or verify each controller. Local default is http://localhost:8080. Remote GPU controllers should expose the controller API, not the raw inference port.
2. For every controller, verify GET /status, GET /gpus, GET /config, and GET /v1/models. If auth is enabled, send X-API-Key.
3. In the app, open Settings -> Connection. Add each controller URL with a human-readable name and its API key if required.
4. Switch the active controller with the radio selector, then run the connection test. Do not delete other saved controllers.
5. Confirm Settings -> System shows runtime targets for vLLM, SGLang, llama.cpp, or MLX as appropriate for that host.

Provider setup:
1. Treat providers as OpenAI-compatible upstreams with a /v1 API. Examples can include another vLLM Studio controller proxy, LM Studio, Ollama's OpenAI-compatible endpoint, or a cloud provider.
2. Create providers through the controller API:
   POST /studio/providers
   {
     "id": "short-id",
     "name": "Human name",
     "base_url": "https://provider.example/v1",
     "api_key": "$PROVIDER_API_KEY",
     "enabled": true
   }
3. Verify GET /studio/providers returns the provider with has_api_key: true.
4. Verify GET /studio/provider-models lists reachable models for enabled providers.
5. Route a provider model by requesting model: "short-id/model-name". The controller strips "short-id/" and forwards the request to that provider.

Runtime setup:
1. Use vLLM recipes for CUDA-oriented high-throughput serving.
2. Use SGLang recipes for structured generation or multi-turn serving where that backend fits.
3. Use llama.cpp recipes for GGUF and CPU/Metal/CUDA llama-server flows.
4. Use MLX recipes on Apple Silicon.
5. Launch models through the controller recipe/runtime endpoints or the app UI. Chat proxy calls should not silently switch or launch models.

Agent and MCP setup:
1. Open Plugins -> Custom and add MCP servers by command, args, env, and tags.
2. Keep secrets in env/local secure files. Do not paste provider keys into prompts or logs.
3. Open /agent. Select the controller-backed model or provider/model route the agent should use.
4. Select the MCP tools the session needs in the composer. Keep the tool set narrow enough to audit.
5. Send a smoke prompt that asks the agent to list its active model, controller, and available MCP tools.

Acceptance checks:
- Settings -> Connection lists every controller and can switch active targets.
- Settings -> System shows runtime state for the active controller.
- GET /studio/provider-models returns provider model IDs for enabled providers.
- /v1/chat/completions works for the active local model and for at least one provider/model route.
- /agent can complete a turn using the selected model and selected MCP tools.
- No credentials appear in git diff, terminal logs, screenshots, or committed files.`;

const setupChecks = [
  "Controller URLs are normalized without trailing /v1 in the saved controller list.",
  "Provider base URLs include the upstream /v1 path when the upstream expects it.",
  "The active controller API key is sent as X-API-Key; provider keys stay inside controller provider config.",
  "A requested model shaped as provider/model routes to the provider; default model names route to the active inference backend.",
  "The Pi agent runtime runs inside the frontend process and uses MCP servers selected through the app's plugin surface.",
];

export function AgentsPage() {
  return (
    <main className={styles.shell}>
      <MarketingNav />
      <section className={styles.agentHero} aria-labelledby="agents-title">
        <p className={styles.eyebrow}>DLTL runbook</p>
        <h1 id="agents-title" className={styles.agentTitle}>
          Agents that can set the machine up.
        </h1>
        <p className={styles.agentLead}>
          This page is written for another coding agent. It tells the agent how to wire vLLM Studio
          across controllers, OpenAI-compatible providers, runtime backends, MCP tools, and Pi agent
          sessions without leaking secrets or breaking serving assumptions.
        </p>
        <div className={styles.heroActions}>
          <Link className={styles.button} href="/api/downloads/mac-dmg" prefetch={false} download>
            <DownloadCloud size={18} aria-hidden="true" />
            Download app
          </Link>
          <Link className={styles.ghostButton} href="/download">
            <Gauge size={18} aria-hidden="true" />
            Back to funnel
          </Link>
        </div>
      </section>

      <section className={styles.agentGrid} aria-label="Agent setup instructions">
        <aside className={styles.agentPanel}>
          <div className={styles.capabilityIcon}>
            <Network size={18} aria-hidden="true" />
          </div>
          <h2>Scope</h2>
          <p>
            The target configuration has one or more controllers, multiple OpenAI-compatible
            providers, managed runtime targets, and an agent workspace that can choose MCP tools.
          </p>
          <div className={styles.checklist}>
            {setupChecks.map((check) => (
              <div className={styles.checkItem} key={check}>
                <CheckCircle2 size={16} aria-hidden="true" />
                <span>{check}</span>
              </div>
            ))}
          </div>

          <h3 style={{ marginTop: "1.4rem" }}>Useful probes</h3>
          <pre className={styles.compactBlock}>{`curl -s "$VLLM_STUDIO_URL/status"
curl -s "$VLLM_STUDIO_URL/gpus"
curl -s "$VLLM_STUDIO_URL/config"
curl -s "$VLLM_STUDIO_URL/studio/providers"
curl -s "$VLLM_STUDIO_URL/studio/provider-models"`}</pre>
        </aside>

        <article className={styles.steps}>
          <div className={styles.stepsHeader}>
            <span className={styles.smallCaps}>Copy into an agent task</span>
            <span className={styles.pill}>DLTL</span>
          </div>
          <pre className={styles.codeBlock}>{dltl}</pre>
        </article>
      </section>

      <section className={styles.section} aria-labelledby="agent-screenshots-title">
        <div className={styles.sectionHeader}>
          <div>
            <p className={styles.sectionKicker}>Screenshots agents should recognize</p>
            <h2 id="agent-screenshots-title" className={styles.sectionTitle}>
              Controllers, runtimes, plugins.
            </h2>
          </div>
          <p className={styles.sectionLead}>
            These are the relevant real vLLM Studio surfaces for the runbook: system runtime state,
            plugin registration, and model search/download.
          </p>
        </div>
        <div className={styles.screenshotGrid}>
          <ScreenshotFrame screenshot={screenshots[2]} />
          <div className={styles.stack}>
            <ScreenshotFrame screenshot={screenshots[4]} />
            <ScreenshotFrame screenshot={screenshots[1]} />
          </div>
        </div>
      </section>

      <section className={styles.section} aria-label="Agent architecture quick map">
        <div className={styles.capabilityGrid}>
          {[
            {
              icon: Boxes,
              title: "Controllers",
              copy: "Bun/Hono controller APIs own lifecycle, logs, metrics, recipes, provider config, and the OpenAI-compatible proxy.",
            },
            {
              icon: Zap,
              title: "Providers",
              copy: "Enabled provider rows expose remote OpenAI-compatible model lists and route chat by provider/model naming.",
            },
            {
              icon: TerminalSquare,
              title: "Pi agents",
              copy: "The frontend runtime starts Pi sessions, loads selected MCP servers, and keeps project context inside the app workspace.",
            },
          ].map(({ icon: Icon, title, copy }) => (
            <article className={styles.capability} key={title}>
              <div className={styles.capabilityIcon}>
                <Icon size={18} aria-hidden="true" />
              </div>
              <h3>{title}</h3>
              <p>{copy}</p>
            </article>
          ))}
        </div>
      </section>

      <footer className={styles.footer}>
        <span>Agent setup page</span>
        <span>Controllers, providers, runtimes, MCP, Pi</span>
      </footer>
    </main>
  );
}
