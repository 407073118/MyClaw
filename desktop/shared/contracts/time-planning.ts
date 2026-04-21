import type { AvailabilityPolicy } from "./time-orchestration";
import type { CalendarEvent, TaskCommitment } from "./calendar";

export type TimeboxPlanningEvent = Pick<CalendarEvent, "id" | "title" | "startsAt" | "endsAt">;

export type TimeboxPlanningCommitment = Pick<
  TaskCommitment,
  "id" | "title" | "dueAt" | "durationMinutes" | "priority"
>;

export type SuggestedTimebox = {
  commitmentId: string;
  title: string;
  startsAt: string;
  endsAt: string;
  timezone: string;
};

export type PlanTimeboxesInput = {
  events: TimeboxPlanningEvent[];
  commitments: TimeboxPlanningCommitment[];
  timezone: string;
  availabilityPolicy?: AvailabilityPolicy | null;
  now?: string;
};
