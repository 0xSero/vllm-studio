# ADR-001: Scientific Workbench and KubeRay Boundary

Date: 2026-07-27
Status: Accepted for the first vertical slice
Classification: C2

## Context

Scientists need an interactive notebook environment that can use governed datasets, approved AI models, and elastic Ray compute without requiring direct Kubernetes access. The appliance must preserve C2 handling controls and produce enough evidence to reconstruct how an experiment ran.

Direct notebook access to the Kubernetes API would combine exploratory code execution with infrastructure authority. Accepting arbitrary RayJob or pod manifests would also bypass compute quotas, image policy, network policy, dataset leases, and approval checks.

## Decision

Local Studio is the workbench control plane. KubeRay is the distributed execution plane.

The workbench owns notebook lifecycle, compute profiles, dataset attachments, model references, approvals, job submission, and experiment receipts. A scientist selects from governed inputs; the controller validates the canonical contract and generates the Kubernetes resources.

Notebook pods execute user code but receive no general Kubernetes credentials. They submit work through the workbench API. The workbench creates RayJob resources through a dedicated service identity whose permissions are limited to the managed workbench namespaces and resource types.

Each model is referenced by a qualified `provider_id/model_id`. TensorPrime is an OpenAI-compatible provider, and its endpoint configuration remains outside notebook content. Model routing must not silently fall back to a different provider or local model.

Datasets are attached read-only with version, digest, purpose, classification, and lease expiry. Compute uses named profiles with bounded CPU, memory, GPU, worker count, runtime, idle timeout, network policy, and classification ceiling.

Every accepted submission produces an experiment receipt containing the notebook and environment digests, dataset and model references, Ray job identity, policy decisions, approvals, artifact digests, timing, outcome, and resource usage.

## Trust boundaries

- Browser to workbench API: authenticated user identity, project authorization, and C2 session controls.
- Workbench API to Kubernetes: dedicated workload identity, namespace scope, admission policy, and auditable resource creation.
- Notebook to datasets: expiring read-only attachment, purpose binding, and digest verification.
- Notebook and Ray workers to models: approved egress path and qualified model identity.
- Runtime to artifact storage: project-scoped write identity and immutable receipt linkage.

## Consequences

- Scientists cannot submit arbitrary Kubernetes manifests through the workbench.
- Compute policy remains centrally enforceable and reusable across notebook and batch workloads.
- KubeRay reconciliation and scheduling stay outside the application domain.
- Interactive notebook startup depends on control-plane admission and cluster capacity.
- A complete experiment can be replayed only when referenced images, datasets, models, parameters, seeds, and artifacts remain available.

## First vertical slice

The first slice defines and tests the canonical C2 contracts for notebook sessions, compute profiles and leases, dataset attachments, qualified models, RayJob submissions, and experiment receipts.

Runtime APIs, Kubernetes reconciliation, notebook UI, identity integration, storage, and cluster deployment are subsequent slices and are not claimed by this decision.
