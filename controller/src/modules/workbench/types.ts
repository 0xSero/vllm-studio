import type { ScientificRayJobSubmission } from "@local-studio/contracts/scientific-workbench";
import type { EnterprisePrincipalScope } from "@local-studio/contracts/enterprise-auth";

export type ScientificRayJobResource = {
  apiVersion: "ray.io/v1";
  kind: "RayJob";
  metadata: {
    name: string;
    namespace: string;
    labels: Record<string, string>;
    annotations: Record<string, string>;
  };
  spec: {
    entrypoint: string;
    shutdownAfterJobFinishes: true;
    ttlSecondsAfterFinished: number;
    rayClusterSpec: {
      headGroupSpec: ScientificRayPodGroup;
      workerGroupSpecs: Array<
        ScientificRayPodGroup & {
          groupName: string;
          replicas: number;
          minReplicas: number;
          maxReplicas: number;
        }
      >;
    };
  };
};

export type ScientificRayPodGroup = {
  rayStartParams: Record<string, string>;
  template: {
    spec: {
      automountServiceAccountToken: false;
      containers: Array<{
        name: "ray";
        image: string;
        resources: {
          requests: Record<string, string>;
          limits: Record<string, string>;
        };
        env: Array<{ name: string; value: string }>;
      }>;
    };
  };
};

export type ScientificRayJobRecord = {
  id: string;
  state: "queued" | "submitted" | "running" | "succeeded" | "failed" | "suspended";
  submission: ScientificRayJobSubmission;
  admission_principal?: EnterprisePrincipalScope;
  resource: ScientificRayJobResource;
  admitted_at: string;
  submitted_at?: string;
  reconciled_at?: string;
  cluster?: {
    uid: string | null;
    resource_version: string | null;
    job_status: string | null;
    deployment_status: string | null;
    message: string | null;
    started_at: string | null;
    ended_at: string | null;
    resource_usage?: {
      cpu_seconds: number;
      gpu_seconds: number;
      peak_memory_gb: number;
    };
    artifact_digests?: string[];
    policy_decision_ids?: string[];
    apim_correlation_ids?: string[];
    agent_ids?: string[];
  };
};

export type ScientificFoundryInvocationEvidence = {
  id: string;
  submission_id: string;
  principal: EnterprisePrincipalScope;
  kind: "model" | "agent";
  provider_id: string;
  resource_id: string;
  correlation_id: string;
  observed_at: string;
};
