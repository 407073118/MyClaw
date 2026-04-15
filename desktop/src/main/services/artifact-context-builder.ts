import type { ArtifactRecord, ArtifactScopeKind } from "@shared/contracts";

import type { ArtifactRegistry } from "./artifact-registry";

type BuildArtifactContextInput = {
  artifactRegistry?: Pick<ArtifactRegistry, "listArtifactsByScope"> | null;
  sessionId?: string | null;
  workflowRunId?: string | null;
  siliconPersonId?: string | null;
  limit?: number;
};

/** 鎶?scope 鍚嶇О鏄犲皠涓?prompt 鍙鐨勬枃鏈紝甯姪妯″瀷鐞嗚В鏂囦欢褰掑睘銆?*/
function scopeLabel(scopeKind: ArtifactScopeKind): string {
  return ({
    session: "session",
    workflowRun: "workflow run",
    siliconPerson: "silicon person",
    turnOutcome: "turn outcome",
  } as Record<ArtifactScopeKind, string>)[scopeKind] ?? scopeKind;
}

/** 鎸夋浘鍙備笌鐨?scope 鑱氬悎鏂囦欢锛屽幓閲嶅悗鎻愪緵缁欐ā鍨嬩綔涓哄伐浣滆祫浜у皬缁撱€?*/
function collectArtifacts(input: BuildArtifactContextInput): Array<ArtifactRecord & { scopes: string[] }> {
  if (!input.artifactRegistry || typeof input.artifactRegistry.listArtifactsByScope !== "function") {
    return [];
  }
  const buckets: Array<{ scopeKind: ArtifactScopeKind; scopeId: string }> = [];
  if (input.sessionId) buckets.push({ scopeKind: "session", scopeId: input.sessionId });
  if (input.workflowRunId) buckets.push({ scopeKind: "workflowRun", scopeId: input.workflowRunId });
  if (input.siliconPersonId) buckets.push({ scopeKind: "siliconPerson", scopeId: input.siliconPersonId });

  const artifactMap = new Map<string, ArtifactRecord & { scopes: string[] }>();
  for (const bucket of buckets) {
    const scopedArtifacts = input.artifactRegistry.listArtifactsByScope(bucket);
    for (const artifact of scopedArtifacts) {
      const existing = artifactMap.get(artifact.id);
      const scopeEntry = `${scopeLabel(bucket.scopeKind)}:${bucket.scopeId}`;
      if (existing) {
        if (!existing.scopes.includes(scopeEntry)) {
          existing.scopes.push(scopeEntry);
        }
        continue;
      }
      artifactMap.set(artifact.id, { ...artifact, scopes: [scopeEntry] });
    }
  }
  return [...artifactMap.values()]
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, input.limit ?? 8);
}

/** 鏋勫缓鍙互鐩存帴鍐欏叆 system prompt 鐨?artifact 涓婁笅鏂囷紝璁╂ā鍨嬫妸宸ヤ綔鏂囦欢褰撲綔涓€绛夊璞°€?*/
export function buildArtifactContextBlock(input: BuildArtifactContextInput): string | null {
  const artifacts = collectArtifacts(input);
  if (artifacts.length === 0) {
    return null;
  }

  const lines = [
    "Treat work files as first-class artifacts rather than raw file paths.",
    "Prefer reusing or updating an existing artifact before creating a duplicate.",
    "When producing a deliverable, clearly distinguish draft/working files from final output.",
    "",
    "Available work artifacts:",
  ];

  for (const artifact of artifacts) {
    lines.push(
      `- [${artifact.id}] ${artifact.title} | kind=${artifact.kind} | lifecycle=${artifact.lifecycle} | status=${artifact.status} | path=${artifact.relativePath} | scopes=${artifact.scopes.join(", ")}`,
    );
  }

  return lines.join("\n");
}
