# Scientific Workbench Status

Checkpoint: 2026-07-27  
Branch: `feat/scientific-workbench`  
Classification: C2

## Completed slices

- Governed notebook, compute, dataset, model, RayJob, and experiment-receipt contracts.
- RayJob admission and constrained `ray.io/v1` resource generation.
- cortAIx scientific console at `/science`.
- Effect-native KubeRay server-side apply and explicit status reconciliation.
- Terminal experiment-receipt finalization with measured resource usage, artifact digests, policy decisions, approvals, timing, and cluster identity.
- Governed Jupyter notebook inspection, revision-bound cell changes and bounded execution.
- Agent tools for notebook inspection, scientist-approved cell changes and scientist-approved execution.
- Expandable agent notebook orb on `/science` with live cell source, kernel output and interaction evidence.

## Runtime configuration

The controller enables the KubeRay gateway only when these values are present:

```text
LOCAL_STUDIO_KUBERAY_API_URL
LOCAL_STUDIO_KUBERAY_TOKEN_FILE
LOCAL_STUDIO_KUBERAY_CA_FILE
```

The CA file is optional when the Kubernetes API certificate is already trusted. The token file must contain a non-empty workload identity token.

Python notebook execution uses an unprivileged, network-disabled SmolVM guest. Build the pinned local image:

```text
npm run build:notebook-python-image
```

The command writes the ignored artifact to `data/python-notebook-image.tar` and prints the complete digest-bound value to place in `.env.local`:

```text
LOCAL_STUDIO_NOTEBOOK_PYTHON_IMAGE=/absolute/path/to/data/python-notebook-image.tar@sha256:<digest>
```

The related controller settings are:

```text
LOCAL_STUDIO_NOTEBOOK_ROOT
LOCAL_STUDIO_NOTEBOOK_PYTHON
LOCAL_STUDIO_NOTEBOOK_SMOLVM
LOCAL_STUDIO_NOTEBOOK_NODE_IMAGE
LOCAL_STUDIO_NOTEBOOK_PYTHON_IMAGE
```

`LOCAL_STUDIO_NOTEBOOK_PYTHON_IMAGE` must reference a local `.tar` and include its SHA-256 digest. Python execution fails closed when the value is missing, remote, or mismatched. Existing inspection and Node.js notebook routing remain available independently.

## Local acceptance

Run the complete repository gate:

```text
npm run check
```

Start the controller:

```text
cd controller
LOCAL_STUDIO_DISABLE_METRICS=true bun src/main.ts
```

Start the cortAIx appliance:

```text
LOCAL_STUDIO_APPLIANCE=cortaix-factory npm run dev
```

Acceptance targets:

- Controller health: `http://127.0.0.1:8080/health`
- Scientific console: `http://127.0.0.1:3000/science`

## Return path

1. Configure the KubeRay API URL and workload identity files.
2. Submit one admitted RayJob through the workbench API.
3. Reconcile it through running to a terminal state.
4. Finalize and retrieve its experiment receipt.
5. Add automatic reconciliation with bounded retries and controller shutdown cancellation.
6. Surface live job state and receipts in the scientific console.
7. Bind notebook operations to authenticated scientist and project identities.
8. Persist notebook interaction events into experiment receipts.

No live-cluster acceptance is recorded until steps 1–4 succeed against the intended KubeRay cluster.
