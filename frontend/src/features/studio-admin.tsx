"use client";
import { Schema } from "effect";
import { useState } from "react";
import { useMountSubscription } from "@/hooks/use-mount-subscription";
import { ErrorText, JsonView } from "./studio-ui";
import { records, request, useJson, type Json, type RecordJson } from "./studio-api";

const MutationResponseSchema = Schema.Record(Schema.String, Schema.Unknown);
const decodeMutationResponse = Schema.decodeUnknownSync(MutationResponseSchema, {
  onExcessProperty: "preserve",
});
const isString = Schema.is(Schema.String);
function text(value: Json | undefined): string {
  return isString(value) ? value : "";
}
function jsonBody(value: RecordJson, method = "POST"): RequestInit {
  return { method, headers: { "content-type": "application/json" }, body: JSON.stringify(value) };
}

export function RecipeManager() {
  const state = useJson("/api/proxy/recipes");
  const status = useJson("/api/proxy/status");
  const [id, setId] = useState("");
  const [name, setName] = useState("");
  const [model, setModel] = useState("");
  const [backend, setBackend] = useState("llamacpp");
  const [message, setMessage] = useState("");
  const [pinnedRecipes, setPinnedRecipes] = useState<Set<string>>(new Set());
  useMountSubscription(() => {
    const saved = localStorage.getItem("local-studio-pinned-recipes");
    if (!saved) return;
    try {
      const decoded = Schema.decodeUnknownOption(Schema.Array(Schema.String))(JSON.parse(saved));
      if (decoded._tag === "Some") setPinnedRecipes(new Set(decoded.value));
    } catch {
      setMessage("Saved recipe pins are invalid");
    }
  }, []);
  const togglePin = (recipeId: string) => {
    setPinnedRecipes((current) => {
      const next = new Set(current);
      if (next.has(recipeId)) next.delete(recipeId);
      else next.add(recipeId);
      localStorage.setItem("local-studio-pinned-recipes", JSON.stringify([...next]));
      return next;
    });
  };
  const run = async (path: `/api/${string}`, init?: RequestInit) => {
    try {
      decodeMutationResponse(await request(path, init));
      setMessage("Recipe state reconciled with the controller");
      await Promise.all([state.reload(), status.reload()]);
    } catch (value) {
      setMessage(value instanceof Error ? value.message : String(value));
    }
  };
  const draft: RecordJson = {
    id: id || name.toLowerCase().replaceAll(" ", "-"),
    name,
    model_path: model,
    backend,
  };
  return (
    <article>
      <h2>Recipe editor</h2>
      <div className="row">
        <input value={id} onChange={(event) => setId(event.target.value)} placeholder="Recipe id" />
        <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Name" />
        <input
          value={model}
          onChange={(event) => setModel(event.target.value)}
          placeholder="Local model path"
        />
        <select value={backend} onChange={(event) => setBackend(event.target.value)}>
          <option value="vllm">vLLM</option>
          <option value="sglang">SGLang</option>
          <option value="llamacpp">llama.cpp</option>
          <option value="mlx">MLX</option>
        </select>
        <button
          onClick={() =>
            run(
              id ? `/api/proxy/recipes/${encodeURIComponent(id)}` : "/api/proxy/recipes",
              jsonBody(draft, id ? "PUT" : "POST"),
            )
          }
        >
          {id ? "Save recipe" : "Create recipe"}
        </button>
      </div>
      <ErrorText value={message || state.error || status.error} />
      {records(state.data, "recipes")
        .sort(
          (left, right) =>
            Number(pinnedRecipes.has(text(right.id))) - Number(pinnedRecipes.has(text(left.id))),
        )
        .map((recipe) => {
          const recipeId = text(recipe.id);
          const label = text(recipe.name) || recipeId;
          return (
            <div className="item" key={recipeId}>
              <span>
                {label} · {text(recipe.status)}
              </span>
              <button
                onClick={() => {
                  setId(recipeId);
                  setName(label);
                  setModel(text(recipe.model_path));
                  setBackend(text(recipe.backend) || "llamacpp");
                }}
              >
                Edit
              </button>
              <button onClick={() => togglePin(recipeId)}>
                {pinnedRecipes.has(recipeId) ? "Unpin" : "Pin"}
              </button>
              <button
                onClick={() =>
                  run(`/api/proxy/launch/${encodeURIComponent(recipeId)}`, { method: "POST" })
                }
              >
                Launch
              </button>
              <button
                onClick={() =>
                  run(`/api/proxy/recipes/${encodeURIComponent(recipeId)}`, { method: "DELETE" })
                }
              >
                Delete
              </button>
            </div>
          );
        })}
      <JsonView value={status.data} />
    </article>
  );
}

export function MachineManager() {
  const rigs = useJson("/api/proxy/studio/rigs");
  const targets = useJson("/api/proxy/runtime/targets");
  const providers = useJson("/api/agent/providers");
  const [rigId, setRigId] = useState("");
  const [nodeId, setNodeId] = useState("");
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [message, setMessage] = useState("");
  const run = async (path: `/api/${string}`, init?: RequestInit) => {
    try {
      decodeMutationResponse(await request(path, init));
      setMessage("Machine configuration saved locally");
      await Promise.all([rigs.reload(), targets.reload(), providers.reload()]);
    } catch (value) {
      setMessage(value instanceof Error ? value.message : String(value));
    }
  };
  return (
    <article>
      <h2>Rigs, nodes, runtimes & providers</h2>
      <div className="row">
        <input
          value={rigId}
          onChange={(event) => setRigId(event.target.value)}
          placeholder="Rig id for edit"
        />
        <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Name" />
        <button
          onClick={() =>
            run(
              rigId
                ? `/api/proxy/studio/rigs/${encodeURIComponent(rigId)}`
                : "/api/proxy/studio/rigs",
              jsonBody({ name }, rigId ? "PUT" : "POST"),
            )
          }
        >
          Save rig
        </button>
        <button
          onClick={() =>
            run(`/api/proxy/studio/rigs/${encodeURIComponent(rigId)}`, { method: "DELETE" })
          }
        >
          Delete rig
        </button>
      </div>
      <div className="row">
        <input
          value={nodeId}
          onChange={(event) => setNodeId(event.target.value)}
          placeholder="Node id for edit"
        />
        <input
          value={address}
          onChange={(event) => setAddress(event.target.value)}
          placeholder="Node address"
        />
        <button
          onClick={() =>
            run(
              nodeId
                ? `/api/proxy/studio/rigs/${encodeURIComponent(rigId)}/nodes/${encodeURIComponent(nodeId)}`
                : `/api/proxy/studio/rigs/${encodeURIComponent(rigId)}/nodes`,
              jsonBody({ name, address }, nodeId ? "PUT" : "POST"),
            )
          }
        >
          Save node
        </button>
        <button
          onClick={() =>
            run(
              `/api/proxy/studio/rigs/${encodeURIComponent(rigId)}/nodes/${encodeURIComponent(nodeId)}`,
              { method: "DELETE" },
            )
          }
        >
          Delete node
        </button>
      </div>
      {records(targets.data, "targets").map((target) => {
        const targetId = text(target.id);
        return (
          <div className="item" key={targetId}>
            <span>{text(target.name) || targetId}</span>
            <button
              onClick={() =>
                run(`/api/proxy/runtime/targets/${encodeURIComponent(targetId)}/select`, {
                  method: "POST",
                })
              }
            >
              Select runtime
            </button>
          </div>
        );
      })}
      <p>
        Provider accounts are created and removed through explicit sign-in and sign-out in
        Integrations. Secrets stay in the local vault.
      </p>
      <ErrorText value={message || rigs.error || targets.error || providers.error} />
      <JsonView value={rigs.data} />
      <JsonView value={providers.data} />
    </article>
  );
}

export function DesktopManager() {
  const bridge = globalThis.window?.localStudioDesktop;
  const [path, setPath] = useState("");
  const [projectId, setProjectId] = useState("");
  const [deployHost, setDeployHost] = useState("");
  const [hotkey, setHotkey] = useState("");
  const [output, setOutput] = useState<Json | null>(null);
  const [deployLog, setDeployLog] = useState<string[]>([]);
  const [error, setError] = useState("");
  useMountSubscription(
    () =>
      bridge?.controllerDeploy.onLog((line) =>
        setDeployLog((lines) => [
          ...lines,
          line.replace(/(api[_ -]?key[=: ]+)\S+/gi, "$1[stored]"),
        ]),
      ),
    [bridge],
  );
  const call = async (operation: () => Promise<object | string | number | boolean | null>) => {
    try {
      setOutput(JSON.stringify(await operation()));
      setError("");
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    }
  };
  const copyPairingCredential = async () => {
    if (!bridge) return;
    await call(async () => {
      const result = await bridge.getKittylitterPairingJson();
      if (!result.ok || !result.pairingJson)
        return { ok: false, error: result.error ?? "Pairing credential unavailable" };
      const copied = await bridge.copyKittylitterPairingJson(result.pairingJson);
      return { ok: copied.ok, credentialCopied: copied.ok, error: copied.error ?? null };
    });
  };
  const deploy = async () => {
    if (!bridge || !deployHost.trim()) return;
    setDeployLog([]);
    await call(async () => {
      const result = await bridge.controllerDeploy.start({ host: deployHost });
      if (!result.ok) return { ok: false, error: result.error ?? "Deployment failed" };
      if (!result.url || !result.apiKey)
        return { ok: false, error: "Deployment omitted credentials" };
      await request("/api/settings", jsonBody({ backendUrl: result.url, apiKey: result.apiKey }));
      return { ok: true, url: result.url, credentialStored: true };
    });
  };
  if (!bridge)
    return (
      <article>
        <h2>Desktop bridge</h2>
        <p>
          Desktop-only project, preference, update, quick panel, open, and reveal controls appear in
          the packaged app.
        </p>
      </article>
    );
  return (
    <article>
      <h2>Desktop bridge</h2>
      <div className="row">
        <button onClick={() => call(() => bridge.openDirectory())}>Add project folder</button>
        <button onClick={() => call(() => bridge.listProjects())}>List projects</button>
        <input
          value={projectId}
          onChange={(event) => setProjectId(event.target.value)}
          placeholder="Project id"
        />
        <button onClick={() => call(() => bridge.removeProject(projectId))}>Remove project</button>
        <input
          value={path}
          onChange={(event) => setPath(event.target.value)}
          placeholder="Local path"
        />
        <button onClick={() => call(() => bridge.openPath(path))}>Open</button>
        <button onClick={() => call(() => bridge.revealPath(path))}>Reveal</button>
      </div>
      <div className="row">
        <button onClick={() => call(() => bridge.getRuntime())}>Desktop runtime</button>
        <button onClick={() => call(() => bridge.terminal.status())}>Terminal status</button>
        <button onClick={() => call(() => bridge.loadUiPreferences())}>Load preferences</button>
        <button
          onClick={() =>
            call(() =>
              bridge
                .saveUiPreferences({ theme: document.documentElement.dataset.theme ?? "dark" })
                .then(() => true),
            )
          }
        >
          Save preferences
        </button>
        <button onClick={() => call(() => bridge.getUpdateStatus())}>Check updates</button>
        <button onClick={() => call(() => bridge.startUpdate())}>Install update</button>
      </div>
      <div className="row">
        <input
          value={hotkey}
          onChange={(event) => setHotkey(event.target.value)}
          placeholder="Quick panel hotkey"
        />
        <button onClick={() => call(() => bridge.quickPanel.getHotkey())}>Get hotkey</button>
        <button onClick={() => call(() => bridge.quickPanel.setHotkey(hotkey))}>Set hotkey</button>
        <button onClick={() => call(() => bridge.quickPanel.expand().then(() => true))}>
          Open quick panel
        </button>
        <button onClick={() => call(() => bridge.quickPanel.dismiss().then(() => true))}>
          Dismiss quick panel
        </button>
        <button onClick={copyPairingCredential}>Copy KittyLitter pairing credential</button>
        <button
          onClick={() =>
            call(() => bridge.quickPanel.focusMainAndNavigate(projectId).then(() => true))
          }
        >
          Open project in main window
        </button>
      </div>
      <div className="row">
        <input
          value={deployHost}
          onChange={(event) => setDeployHost(event.target.value)}
          placeholder="SSH host for controller"
        />
        <button onClick={deploy}>Deploy controller and store credential</button>
      </div>
      {deployLog.length ? (
        <pre aria-label="Controller deployment log">{deployLog.join("\n")}</pre>
      ) : null}
      <ErrorText value={error} />
      {output === null ? null : <JsonView value={output} />}
    </article>
  );
}

export function NormalizedUsage({ value }: { value: Json | null }) {
  const [view, setView] = useState<"models" | "activity" | "controller" | "errors">("models");
  const root = records([value], "value")[0] ?? {};
  const controller = records([root.controller ?? null], "value")[0] ?? {};
  const rows =
    view === "models"
      ? records(root, "by_model")
      : view === "activity"
        ? records(root, "daily")
        : view === "controller"
          ? records(controller, "by_path")
          : records(controller, "recent_errors");
  return (
    <article>
      <div className="tabs">
        {(["models", "activity", "controller", "errors"] as const).map((name) => (
          <button key={name} onClick={() => setView(name)}>
            {name}
          </button>
        ))}
      </div>
      <p>
        Normalized {view} view · {rows.length} rows · controller metrics included
      </p>
      <JsonView
        value={view === "controller" ? (controller.totals ?? null) : (root.totals ?? null)}
      />
      <JsonView value={rows} />
    </article>
  );
}
