export type ArtifactScopeKind =
  | "session"
  | "workflowRun"
  | "siliconPerson"
  | "turnOutcome";

export type ArtifactLifecycle =
  | "working"
  | "ready"
  | "final"
  | "superseded"
  | "archived"
  | "failed";

export type ArtifactStatus =
  | "planned"
  | "materializing"
  | "ready"
  | "failed";

export type ArtifactRelation =
  | "primary_output"
  | "secondary_output"
  | "reference"
  | "input_material"
  | "pinned";

export type ArtifactStorageClass = "workspace" | "artifact" | "cache";

export type ArtifactKind =
  | "doc"
  | "image"
  | "code"
  | "dataset"
  | "archive"
  | "log"
  | "other";

export type ArtifactScopeRef = {
  scopeKind: ArtifactScopeKind;
  scopeId: string;
};

export type ArtifactRecord = {
  id: string;
  title: string;
  kind: ArtifactKind;
  mimeType: string | null;
  storageClass: ArtifactStorageClass;
  lifecycle: ArtifactLifecycle;
  status: ArtifactStatus;
  relativePath: string;
  sizeBytes: number | null;
  sha256: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
  lastOpenedAt: string | null;
  openCount: number;
};

export type ArtifactLink = ArtifactScopeRef & {
  artifactId: string;
  relation: ArtifactRelation;
  isPrimary: boolean;
  createdAt: string;
};

export type ArtifactEventType =
  | "artifact.created"
  | "artifact.updated"
  | "artifact.completed"
  | "artifact.failed"
  | "artifact.linked";

export type ArtifactEventRecord = {
  id: string;
  artifactId: string;
  eventType: ArtifactEventType;
  payload: Record<string, unknown> | null;
  createdAt: string;
};

export type ArtifactScopeItem = ArtifactRecord & {
  links: ArtifactLink[];
};
