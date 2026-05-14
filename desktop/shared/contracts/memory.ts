export type MemoryRootMode = "managed" | "reference";

export type MemoryRootStatus = "idle" | "indexing" | "ready" | "error";

export type MemoryRoot = {
  id: string;
  path: string;
  displayName: string;
  mode: MemoryRootMode;
  status: MemoryRootStatus;
  fileCount: number;
  chunkCount: number;
  lastIndexedAt: string | null;
  createdAt: string;
  updatedAt: string;
  errorMessage?: string | null;
};

export type MemoryIndexStatus = {
  rootId: string;
  status: MemoryRootStatus;
  fileCount: number;
  chunkCount: number;
  pendingJobs: number;
  failedJobs: number;
  lastIndexedAt: string | null;
  errorMessage?: string | null;
};

export type AddMemoryRootInput = {
  path: string;
  mode: MemoryRootMode;
  displayName?: string;
};

export type CreateMemoryMemoInput = {
  rootId: string;
  title: string;
  content: string;
};

export type MemoryMemo = {
  rootId: string;
  path: string;
  relativePath: string;
  title: string;
  createdAt: string;
};

export type MemorySearchRequest = {
  query: string;
  rootIds?: string[];
  limit?: number;
};

export type MemorySearchResult = {
  id: string;
  rootId: string;
  rootDisplayName: string;
  path: string;
  relativePath: string;
  title: string;
  headingPath: string | null;
  locator: string;
  snippet: string;
  score: number;
  sha256: string;
  mtime: string;
  trustLevel: "managed" | "reference";
};

export type MemorySearchResponse = {
  query: string;
  items: MemorySearchResult[];
};

export type MemoryContextEvidence = MemorySearchResult & {
  evidenceId: string;
};

export type MemoryContextPackRequest = MemorySearchRequest & {
  tokenBudget?: number;
};

export type MemoryContextPack = {
  enabled: boolean;
  query: string;
  promptBlock: string;
  evidence: MemoryContextEvidence[];
  tokenEstimate: number;
};

export type MemoryCandidateType = "TodoCandidate" | "TagCandidate" | "SummaryCandidate" | "LongTermFactCandidate";

export type MemoryCandidateStatus = "pending" | "approved" | "rejected";

export type MemoryCandidate = {
  id: string;
  type: MemoryCandidateType;
  status: MemoryCandidateStatus;
  title: string;
  body: string;
  confidence: number;
  evidenceIds: string[];
  createdAt: string;
  updatedAt: string;
};
