export type TimeOwnerScope = "personal" | "silicon_person";

export const TIME_OWNER_SCOPE_VALUES = [
  "personal",
  "silicon_person",
] as const satisfies readonly TimeOwnerScope[];

export type TimeEntitySource = "manual" | "meeting" | "agent" | "workflow" | "imported";

export const TIME_ENTITY_SOURCE_VALUES = [
  "manual",
  "meeting",
  "agent",
  "workflow",
  "imported",
] as const satisfies readonly TimeEntitySource[];

export type CalendarEventStatus = "tentative" | "confirmed" | "cancelled";

export const CALENDAR_EVENT_STATUS_VALUES = [
  "tentative",
  "confirmed",
  "cancelled",
] as const satisfies readonly CalendarEventStatus[];

export type CalendarEvent = {
  id: string;
  kind: "calendar_event";
  title: string;
  description?: string;
  startsAt: string;
  endsAt: string;
  timezone: string;
  ownerScope: TimeOwnerScope;
  ownerId?: string;
  status: CalendarEventStatus;
  source: TimeEntitySource;
  externalRef?: string;
  location?: string;
  createdAt: string;
  updatedAt: string;
};

export type TaskCommitmentStatus = "pending" | "scheduled" | "completed" | "cancelled";

export const TASK_COMMITMENT_STATUS_VALUES = [
  "pending",
  "scheduled",
  "completed",
  "cancelled",
] as const satisfies readonly TaskCommitmentStatus[];

export type TaskCommitmentPriority = "low" | "medium" | "high" | "urgent";

export const TASK_COMMITMENT_PRIORITY_VALUES = [
  "low",
  "medium",
  "high",
  "urgent",
] as const satisfies readonly TaskCommitmentPriority[];

export type TaskCommitment = {
  id: string;
  kind: "task_commitment";
  title: string;
  description?: string;
  dueAt?: string;
  durationMinutes?: number;
  timezone: string;
  ownerScope: TimeOwnerScope;
  ownerId?: string;
  priority: TaskCommitmentPriority;
  status: TaskCommitmentStatus;
  source: TimeEntitySource;
  externalRef?: string;
  createdAt: string;
  updatedAt: string;
};
