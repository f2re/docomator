export const SERVICE_NAMES = ["api", "worker"] as const;

export type ServiceName = (typeof SERVICE_NAMES)[number];
export type HealthState = "ok" | "degraded" | "error";

export interface HealthResponse {
  service: ServiceName;
  status: HealthState;
  version: string;
  timestamp: string;
  uptimeSeconds: number;
}

export interface ReadinessResponse extends HealthResponse {
  checks: Record<string, "ok" | "error">;
}

export interface ReleaseIdentityResponse {
  name: "docomator";
  version: string;
  gitCommit: string | null;
  releaseMetadataSha256: string | null;
  source: "development" | "installed";
}

export interface SystemInfoResponse {
  name: "docomator";
  version: string;
  architecture: "modular-monolith";
  runtime: {
    node: string;
    platform: NodeJS.Platform;
    arch: string;
  };
  features: {
    offlineFirst: true;
    localLlm: boolean;
    documentFormats: readonly ["docx", "xlsx"];
  };
}
