import Link from "next/link";
import {
  CheckCircle2,
  DownloadCloud,
  HardDrive,
  PlugZap,
  ServerCog,
  TerminalSquare,
  Zap,
  type LucideIcon,
} from "@/ui/icon-registry";
import styles from "./landing.module.css";

type Screenshot = { src: string; title: string; meta: string; alt: string };

const screenshots: Screenshot[] = [
  {
    src: "/marketing/screenshots/status-dashboard.png",
    title: "Telemetry",
    meta: "live app capture",
    alt: "Local Studio status dashboard showing controllers, decode metrics, VRAM, power, and GPU rows.",
  },
  {
    src: "/marketing/screenshots/discover-models.png",
    title: "Models",
    meta: "live app capture",
    alt: "Local Studio Discover Models screen showing searchable model rows and download actions.",
  },
  {
    src: "/marketing/screenshots/system-settings.png",
    title: "Runtime",
    meta: "live app capture",
    alt: "Local Studio System settings showing installed inference engines and service topology.",
  },
  {
    src: "/marketing/screenshots/model-library.png",
    title: "Fit",
    meta: "live app capture",
    alt: "Local Studio model library with hardware profile, model results, and downloads.",
  },
];

const capabilities: Array<{ icon: LucideIcon; title: string; copy: string }> = [
  {
    icon: ServerCog,
    title: "Controllers",
    copy: "Local or remote. Same status, launch, logs, metrics, and proxy surface.",
  },
  {
    icon: HardDrive,
    title: "Models",
    copy: "Find, fit, download, launch, evict. VRAM stays visible the whole way.",
  },
  {
    icon: PlugZap,
    title: "Agents",
    copy: "Pi runtime, skills, browser, files, terminal, and project state — in one session.",
  },
];

const GITHUB_REPO = "https://github.com/sybil-solutions/local-studio";

const downloads = [
  {
    title: "GitHub",
    copy: "Source, releases, and changelog. Clone, install, and run the controller and frontend.",
    href: GITHUB_REPO,
    meta: ["source", "releases", "changelog"],
  },
  {
    title: "Build from source",
    copy: "Prerequisites, quick start, engine installs, and the desktop shell — step by step.",
    href: "/docs",
    meta: ["setup", "guide"],
  },
];

function LandingNav() {
  return (
    <header className={styles.nav}>
      <Link href="/landing" className={styles.brand} aria-label="Local Studio">
        <span className={styles.mark}>LS</span>
        <span>Local Studio</span>
      </Link>
      <nav className={styles.navLinks} aria-label="Landing navigation">
        <Link href="/landing#product">Product</Link>
        <Link href="/docs">Docs</Link>
        <Link href="/landing#downloads">Download</Link>
        <Link
          className={styles.navCta}
          href={GITHUB_REPO}
          prefetch={false}
          target="_blank"
          rel="noopener noreferrer"
        >
          <DownloadCloud size={16} aria-hidden="true" />
          Get the app
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

export function LandingPage() {
  return (
    <main className={styles.shell}>
      <LandingNav />

      <section className={styles.hero} aria-labelledby="landing-title">
        <div className={styles.heroImage} aria-hidden="true">
          <img src="/marketing/screenshots/status-dashboard.png" alt="" />
        </div>
        <div className={styles.heroScrim} aria-hidden="true" />
        <div className={styles.heroInner}>
          <div className={styles.heroLayout}>
            <div className={styles.heroCopyColumn}>
              <p className={styles.eyebrow}>Local inference control plane</p>
              <h1 id="landing-title" className={styles.heroTitle}>
                Local Studio
              </h1>
              <p className={styles.heroCopy}>
                One operating surface for controllers, GPUs, models, providers, and agents. Launch
                self-hosted backends, watch the hardware, and route it all through an
                OpenAI-compatible proxy.
              </p>
              <div className={styles.heroActions}>
                <Link
                  className={styles.button}
                  href={GITHUB_REPO}
                  prefetch={false}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <DownloadCloud size={18} aria-hidden="true" />
                  Get the app
                </Link>
                <Link className={styles.ghostButton} href="/docs">
                  <TerminalSquare size={18} aria-hidden="true" />
                  Read the docs
                </Link>
              </div>
            </div>
            <div className={styles.heroPreview}>
              <ScreenshotFrame screenshot={screenshots[0]} priority />
            </div>
          </div>
          <div className={styles.metricStrip} aria-label="Local Studio product scope">
            <div className={styles.metric}>
              <span className={styles.metricLabel}>Serve</span>
              <span className={styles.metricValue}>vLLM / SGLang / MLX / llama.cpp</span>
            </div>
            <div className={styles.metric}>
              <span className={styles.metricLabel}>Control</span>
              <span className={styles.metricValue}>local or remote</span>
            </div>
            <div className={styles.metric}>
              <span className={styles.metricLabel}>Route</span>
              <span className={styles.metricValue}>OpenAI-compatible</span>
            </div>
            <div className={styles.metric}>
              <span className={styles.metricLabel}>Tool</span>
              <span className={styles.metricValue}>Pi + local tools</span>
            </div>
          </div>
        </div>
      </section>

      <section id="product" className={styles.section} aria-labelledby="product-title">
        <div className={styles.sectionHeader}>
          <div>
            <p className={styles.sectionKicker}>Actual app, no mock glass</p>
            <h2 id="product-title" className={styles.sectionTitle}>
              The machine stays in frame.
            </h2>
          </div>
          <p className={styles.sectionLead}>
            Status, runtime, models, agents. The working surfaces are the pitch — these are
            unretouched captures of the live app.
          </p>
        </div>
        <div className={styles.screenshotGrid}>
          <ScreenshotFrame screenshot={screenshots[0]} priority />
          <div className={styles.stack}>
            {screenshots.slice(1, 3).map((s) => (
              <ScreenshotFrame key={s.src} screenshot={s} />
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
          Control the stack before the stack controls you.
        </blockquote>
        <ul className={styles.terminalList}>
          <li>{"GET /status -> active model, pid, backend, port"}</li>
          <li>{"GET /gpus -> VRAM, power, temperature, utilization"}</li>
          <li>{"POST /studio/providers -> route provider/model requests"}</li>
          <li>{"GET /v1/chat/completions -> OpenAI-compatible"}</li>
        </ul>
      </section>

      <section className={styles.section} aria-labelledby="gallery-title">
        <div className={styles.sectionHeader}>
          <div>
            <p className={styles.sectionKicker}>Operator surfaces</p>
            <h2 id="gallery-title" className={styles.sectionTitle}>
              Runtime. Fit. Tools.
            </h2>
          </div>
          <p className={styles.sectionLead}>
            The app is for the moment when a model, a GPU box, and an agent all need the same truth.
          </p>
        </div>
        <div className={styles.screenshotGrid}>
          <ScreenshotFrame screenshot={screenshots[3]} />
          <div className={styles.stack}>
            <ScreenshotFrame screenshot={screenshots[1]} />
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
                Download the app. Point it at the machines.
              </h2>
            </div>
            <p className={styles.sectionLead}>
              Mac artifacts are served here. For controller, provider, and agent setup,
              <Link href="/docs" style={{ color: "inherit", textDecoration: "underline" }}>
                {" "}
                read the docs
              </Link>
              .
            </p>
          </div>
          <div className={styles.downloadGrid}>
            {downloads.map((d) => (
              <article className={styles.downloadCard} key={d.title}>
                <div className={styles.capabilityIcon}>
                  <DownloadCloud size={18} aria-hidden="true" />
                </div>
                <h3>{d.title}</h3>
                <p>{d.copy}</p>
                <div className={styles.downloadMeta}>
                  {d.meta.map((item) => (
                    <span className={styles.pill} key={item}>
                      {item}
                    </span>
                  ))}
                </div>
                <div className={styles.downloadActions}>
                  <Link
                    className={styles.ghostButton}
                    href={d.href}
                    prefetch={false}
                    target={d.href.startsWith("http") ? "_blank" : undefined}
                    rel={d.href.startsWith("http") ? "noopener noreferrer" : undefined}
                  >
                    {d.href.startsWith("http") ? "Open GitHub" : "Read the docs"}
                  </Link>
                </div>
              </article>
            ))}
            <article className={styles.downloadCard}>
              <div className={styles.capabilityIcon}>
                <Zap size={18} aria-hidden="true" />
              </div>
              <h3>Docs</h3>
              <p>
                Prerequisites, quick start, runtime backends, remote/LAN, and the agent surface.
              </p>
              <div className={styles.downloadMeta}>
                <span className={styles.pill}>setup</span>
                <span className={styles.pill}>guide</span>
              </div>
              <div className={styles.downloadActions}>
                <Link className={styles.ghostButton} href="/docs">
                  Read the docs
                </Link>
              </div>
            </article>
          </div>
        </div>
      </section>

      <footer className={styles.footer}>
        <span>Local Studio</span>
        <span>Desktop / web / controller / CLI / Pi</span>
      </footer>
    </main>
  );
}

const tocSections = [
  { id: "prerequisites", label: "Prerequisites" },
  { id: "quick-start", label: "Quick start" },
  { id: "setup-wizard", label: "Setup wizard" },
  { id: "runtime-backends", label: "Runtime backends" },
  { id: "agent-runtime", label: "Agent runtime" },
  { id: "remote-lan", label: "Remote / LAN" },
  { id: "validation", label: "Validation" },
];

const setupSteps = [
  { code: "npm run doctor", note: "preflight: toolchain, ports, directories, network" },
  { code: "cd controller && bun install && bun src/main.ts", note: "controller on 127.0.0.1:8080" },
  { code: "cd frontend && npm ci && npm run dev", note: "frontend on :3000, then open /setup" },
];

const backends = [
  {
    name: "vLLM",
    desc: "CUDA throughput serving through configured, discovered, system, Docker, or bundled targets.",
  },
  {
    name: "SGLang",
    desc: "Structured and multi-turn serving through discovered or configured Python targets.",
  },
  {
    name: "llama.cpp",
    desc: "GGUF models through the llama-server binary. Great for CPU and modest hardware.",
  },
  { name: "MLX", desc: "Apple Silicon serving through mlx_lm.server. The default path on Mac." },
];

const validationSteps = [
  "Settings switches controllers and the runtime state updates.",
  "System shows installed engines and the active service topology.",
  "A model launches through a recipe and /status reflects it.",
  "/v1/chat/completions works locally and through a provider route.",
  "/agent completes a turn using the selected model and local tools.",
];

export function DocsPage() {
  return (
    <main className={styles.shell}>
      <LandingNav />
      <div className={styles.docsLayout}>
        <aside className={styles.toc}>
          <p className={styles.tocLabel}>On this page</p>
          <ul className={styles.tocList}>
            {tocSections.map((s) => (
              <li key={s.id}>
                <Link href={`/docs#${s.id}`}>{s.label}</Link>
              </li>
            ))}
          </ul>
        </aside>
        <article className={styles.docsContent}>
          <p className={styles.eyebrow}>Setup guide</p>
          <h1 className={styles.sectionTitle} style={{ marginTop: "0.6rem" }}>
            Get Local Studio running
          </h1>
          <p className={styles.sectionLead} style={{ marginBottom: "2.5rem" }}>
            Local Studio is a local-first workstation for running, managing, and using self-hosted
            LLM backends. Two modules share one controller API: a Bun/Hono backend and a Next.js +
            React frontend with an Electron desktop shell.
          </p>

          <section className={styles.docsSection} id="prerequisites">
            <h2>Prerequisites</h2>
            <ul>
              <li>
                <strong>Bun 1.x</strong> — for the controller.
              </li>
              <li>
                <strong>Node.js 20+ and npm</strong> — for the frontend.
              </li>
              <li>
                <strong>Python 3.10+ on PATH</strong> — engine installs use <code>uv</code> when
                present, pip otherwise.
              </li>
              <li>
                <strong>Git</strong>.
              </li>
              <li>
                <strong>NVIDIA driver + CUDA</strong> for vLLM/SGLang on Linux. Apple Silicon uses
                the MLX backend.
              </li>
            </ul>
          </section>

          <section className={styles.docsSection} id="quick-start">
            <h2>Quick start</h2>
            <p>
              Run the preflight check first — it verifies toolchain, ports, directories, and
              network:
            </p>
            <pre className={styles.codeBlock}>npm run doctor</pre>
            <p>
              Start the controller (listens on <code>127.0.0.1:8080</code>; data dir and SQLite are
              created automatically, model weights live in <code>LOCAL_STUDIO_MODELS_DIR</code>,
              default <code>/models</code>):
            </p>
            <pre className={styles.codeBlock}>
              cd controller &amp;&amp; bun install &amp;&amp; bun src/main.ts
            </pre>
            <p>
              Start the frontend in a second terminal, then open{" "}
              <code>http://localhost:3000/setup</code>:
            </p>
            <pre className={styles.codeBlock}>
              cd frontend &amp;&amp; npm ci &amp;&amp; npm run dev
            </pre>
            <div className={styles.callout}>
              <CheckCircle2 size={16} aria-hidden="true" />
              <p>
                <code>npm ci</code> runs a postinstall patch against{" "}
                <code>@earendil-works/pi-ai</code>. If that step prints a warning, agent streaming
                may misrender — re-run <code>npm ci</code> to fix it.
              </p>
            </div>
          </section>

          <section className={styles.docsSection} id="setup-wizard">
            <h2>Setup wizard</h2>
            <p>
              The first-run <code>/setup</code> wizard walks through choosing a models directory,
              installing an engine, downloading a model, launching it, and benchmarking. Engine
              installs (vLLM/SGLang/MLX) land in{" "}
              <code>&lt;data dir&gt;/runtime/venvs/&lt;backend&gt;-latest</code>.
            </p>
          </section>

          <section className={styles.docsSection} id="runtime-backends">
            <h2>Runtime backends</h2>
            <p>Recipes launch through the controller runtime layer. Wired backend families:</p>
            <ul>
              {backends.map((b) => (
                <li key={b.name}>
                  <strong>{b.name}</strong> — {b.desc}
                </li>
              ))}
            </ul>
            <p>
              Runtime target discovery is surfaced in Settings; selections persist in the controller
              data directory.
            </p>
          </section>

          <section className={styles.docsSection} id="agent-runtime">
            <h2>Agent runtime</h2>
            <p>
              The agent surface lives at <code>/agent</code> in the frontend. It uses
              <code>@earendil-works/pi-coding-agent</code> through the frontend runtime rather than
              shelling out to a separate agent process. Agent skills and extensions are loaded by
              the frontend runtime and surfaced in the session UI.
            </p>
            <p>
              Agent file operations are local-only, stored under <code>data/agentfs</code>.
            </p>
          </section>

          <section className={styles.docsSection} id="remote-lan">
            <h2>Remote / LAN deployment</h2>
            <p>
              The controller binds <code>127.0.0.1</code> by default. Binding a non-loopback host
              (e.g. <code>LOCAL_STUDIO_HOST=0.0.0.0</code>) requires{" "}
              <code>LOCAL_STUDIO_API_KEY</code> — startup throws without it. On a trusted LAN you
              may instead set
              <code>LOCAL_STUDIO_ALLOW_UNAUTHENTICATED=true</code> to opt out of authentication.
            </p>
            <p>
              Point the frontend at a remote controller with <code>BACKEND_URL</code> or{" "}
              <code>NEXT_PUBLIC_API_URL</code> (default <code>http://localhost:8080</code>).
              Configure <code>.env.local</code> first (see <code>.env.example</code>):
            </p>
            <pre className={styles.codeBlock}>
              REMOTE_HOST=192.168.x.x REMOTE_USER=username REMOTE_PATH=/home/user/project #
              Optional: REMOTE_SSH_KEY (defaults to ~/.ssh/id_ed25519)
            </pre>
            <pre className={styles.codeBlock}>
              ./scripts/deploy-remote.sh controller # sync + build + restart controller
              ./scripts/deploy-remote.sh frontend # sync + build + restart frontend
              ./scripts/deploy-remote.sh status # inspect remote processes
            </pre>
            <p>
              Local daemon helper: <code>./scripts/daemon.sh {`{start|stop|status}`}</code>.
            </p>
          </section>

          <section className={styles.docsSection} id="validation">
            <h2>Validation</h2>
            <p>After setup, confirm the stack is healthy:</p>
            <ul>
              {validationSteps.map((v) => (
                <li key={v}>{v}</li>
              ))}
            </ul>
            <pre className={styles.codeBlock}>
              npm run check # contracts + structure + frontend quality + controller typecheck npm
              run test:e2e # controller integration + frontend e2e
            </pre>
            <p>
              For the full agent runbook — controllers, providers, runtimes, and Pi sessions — see
              <Link href="/agents" style={{ color: "inherit", textDecoration: "underline" }}>
                {" "}
                the agents page
              </Link>
              .
            </p>
          </section>
        </article>
      </div>
      <footer className={styles.footer}>
        <span>Local Studio docs</span>
        <span>Desktop / web / controller / CLI / Pi</span>
      </footer>
    </main>
  );
}
