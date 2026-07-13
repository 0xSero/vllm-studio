import Link from "next/link";
import {
  Boxes,
  CheckCircle2,
  DownloadCloud,
  Gauge,
  Network,
  TerminalSquare,
  Zap,
} from "lucide-react";

import { LandingNav, ScreenshotFrame, screenshots } from "./landing-page";
import styles from "./landing.module.css";

const dltl = `DLTL: Local Studio multi-controller setup

Role:
Operate on the real install. Use live controller URLs. Do not expose secrets.

Hard rules:
- Never use max_tokens.
- For vLLM/SGLang, never add --disable-cuda-graphs or --enforce-eager.
- Do not bypass SSH host-key verification.
- Keep keys in env, secure local files, or app settings.

Controller setup:
1. Verify each controller with GET /status, /gpus, /config, /v1/models.
2. Local default: http://localhost:8080.
3. Remote GPU boxes expose controller API, not raw inference ports.
4. Add each URL in Settings -> Connection. Keep all saved controllers.
5. Switch active target and confirm Settings -> System runtime state.

Provider setup:
1. Providers are OpenAI-compatible /v1 upstreams.
2. Create through the active controller:
   POST /studio/providers
   {
     "id": "local-lmstudio",
     "name": "LM Studio",
     "base_url": "https://provider.example/v1",
     "api_key": "$PROVIDER_API_KEY",
     "enabled": true
   }
3. Verify GET /studio/providers and /studio/provider-models.
4. Route as model: "provider-id/model-name".

Runtime map:
- vLLM: CUDA throughput.
- SGLang: structured and multi-turn serving.
- llama.cpp: GGUF / llama-server.
- MLX: Apple Silicon.
- Launch through recipes/UI. Do not make chat proxy calls silently launch models.

Agent setup:
1. Open /agent.
2. Pick the controller model or provider/model route.
3. Smoke test: model, controller, browser, files, and terminal.

Acceptance checks:
- Settings switches controllers.
- System shows runtime state.
- /studio/provider-models lists enabled upstreams.
- /v1/chat/completions works locally and through one provider route.
- /agent can complete a turn using the selected model and local tools.
- No secrets in diff, logs, screenshots, or commits.`;

const setupChecks = [
  "Controllers stay saved; switching is non-destructive.",
  "Provider keys live in controller config, not prompts.",
  "provider/model routes to that provider.",
  "Default model names hit the active backend.",
  "Pi sessions load selected skills and local tools.",
];

export function AgentsPage() {
  return (
    <main className={styles.shell}>
      <LandingNav />
      <section className={styles.agentHero} aria-labelledby="agents-title">
        <p className={styles.eyebrow}>Agent field note</p>
        <h1 id="agents-title" className={styles.agentTitle}>
          Set up the stack.
        </h1>
        <p className={styles.agentLead}>
          A compact DLTL for controllers, providers, runtimes, and Pi.
        </p>
        <div className={styles.heroActions}>
          <Link className={styles.button} href="/api/downloads/mac-dmg" prefetch={false} download>
            <DownloadCloud size={18} aria-hidden="true" />
            Download app
          </Link>
          <Link className={styles.ghostButton} href="/landing">
            <Gauge size={18} aria-hidden="true" />
            Back to overview
          </Link>
        </div>
      </section>

      <section className={styles.agentGrid} aria-label="Agent setup instructions">
        <aside className={styles.agentPanel}>
          <div className={styles.capabilityIcon}>
            <Network size={18} aria-hidden="true" />
          </div>
          <h2>Scope</h2>
          <p>Multi-controller. Multi-provider. Runtime-aware. Local-tool aware.</p>
          <div className={styles.checklist}>
            {setupChecks.map((check) => (
              <div className={styles.checkItem} key={check}>
                <CheckCircle2 size={16} aria-hidden="true" />
                <span>{check}</span>
              </div>
            ))}
          </div>

          <h3 style={{ marginTop: "1.4rem" }}>Useful probes</h3>
          <pre className={styles.compactBlock}>{`curl -s "$LOCAL_STUDIO_URL/status"
curl -s "$LOCAL_STUDIO_URL/gpus"
curl -s "$LOCAL_STUDIO_URL/config"
curl -s "$LOCAL_STUDIO_URL/studio/providers"
curl -s "$LOCAL_STUDIO_URL/studio/provider-models"`}</pre>
        </aside>

        <article className={styles.steps}>
          <div className={styles.stepsHeader}>
            <span className={styles.smallCaps}>Agent instructions</span>
            <span className={styles.pill}>DLTL</span>
          </div>
          <pre className={styles.codeBlock}>{dltl}</pre>
        </article>
      </section>

      <section className={styles.section} aria-labelledby="agent-screenshots-title">
        <div className={styles.sectionHeader}>
          <div>
            <p className={styles.sectionKicker}>Where to look</p>
            <h2 id="agent-screenshots-title" className={styles.sectionTitle}>
              Runtime. Agent. Models.
            </h2>
          </div>
          <p className={styles.sectionLead}>The setup path is visible in the app.</p>
        </div>
        <div className={styles.screenshotGrid}>
          <ScreenshotFrame screenshot={screenshots[2]} />
          <div className={styles.stack}>
            <ScreenshotFrame screenshot={screenshots[3]} />
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
              copy: "Lifecycle, logs, metrics, recipes, provider config, proxy.",
            },
            {
              icon: Zap,
              title: "Providers",
              copy: "OpenAI-compatible upstreams addressed as provider/model.",
            },
            {
              icon: TerminalSquare,
              title: "Pi agents",
              copy: "Skills, project context, browser, files, terminal.",
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
        <span>Controllers, providers, runtimes, Pi</span>
      </footer>
    </main>
  );
}
