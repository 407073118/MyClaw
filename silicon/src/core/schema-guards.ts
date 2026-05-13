import { isCapabilityId } from "../policy/policy-engine.js";
import type { ApprovalRequest, ApprovalStatus } from "./approval-store.js";
import type { HeartbeatState } from "./heartbeat-state.js";
import type { MemoryEventType, MemoryJournalEntry } from "./memory-store.js";
import type { EmployeeProfile, EmployeeProfileStatus } from "./profile-store.js";
import type { ScheduledTask, ScheduledTaskStatus } from "./schedule-store.js";
import type { EmployeeTask, EmployeeTaskStatus } from "./task-store.js";
import type { EmployeeTodo, EmployeeTodoStatus } from "./todo-store.js";

const TASK_STATUSES = new Set<EmployeeTaskStatus>([
  "queued",
  "waiting_approval",
  "running",
  "succeeded",
  "failed",
  "blocked",
  "cancelled",
]);

const APPROVAL_STATUSES = new Set<ApprovalStatus>(["requested", "approved", "denied"]);
const MEMORY_EVENT_TYPES = new Set<MemoryEventType>([
  "approval_requested",
  "approval_denied",
  "policy_denied",
  "task_succeeded",
  "task_blocked",
  "task_failed",
]);
const PROFILE_STATUSES = new Set<EmployeeProfileStatus>(["idle", "running", "waiting_approval", "failed"]);
const SCHEDULE_STATUSES = new Set<ScheduledTaskStatus>(["scheduled", "dispatched", "cancelled"]);
const TASK_RUN_HISTORY_STATUSES = new Set(["succeeded", "blocked", "failed"]);
const HEARTBEAT_STATUSES = new Set(["alive", "running", "waiting_approval", "failed"]);
const HEARTBEAT_EVENT_TYPES = new Set([
  "noop",
  "approval_requested",
  "approval_denied",
  "policy_denied",
  "processed_task",
  "blocked_task",
  "run_started",
  "task_observed",
  "artifact_written",
  "review_written",
  "run_succeeded",
  "run_blocked",
]);
const TODO_STATUSES = new Set<EmployeeTodoStatus>([
  "open",
  "waiting_approval",
  "running",
  "done",
  "failed",
  "blocked",
  "cancelled",
]);

/** 校验员工 task JSON 结构，坏记录必须 fail closed。 */
export function assertEmployeeTask(value: unknown): asserts value is EmployeeTask {
  const task = assertRecord(value, "EmployeeTask");
  assertSchemaVersion(task, "EmployeeTask");
  assertString(task.id, "EmployeeTask.id");
  assertString(task.title, "EmployeeTask.title");
  assertString(task.instruction, "EmployeeTask.instruction");
  assertString(task.createdAt, "EmployeeTask.createdAt");
  assertString(task.updatedAt, "EmployeeTask.updatedAt");
  if (!TASK_STATUSES.has(task.status as EmployeeTaskStatus)) {
    throw new Error(`Invalid EmployeeTask.status: ${String(task.status)}`);
  }
  const attempt = task.attempt;
  if (attempt !== undefined && (!isNumber(attempt) || !Number.isInteger(attempt) || attempt < 1)) {
    throw new Error("Invalid EmployeeTask.attempt");
  }
  if (task.requestedCapability !== undefined && (!isString(task.requestedCapability) || !isCapabilityId(task.requestedCapability))) {
    throw new Error(`Invalid EmployeeTask.requestedCapability: ${String(task.requestedCapability)}`);
  }
  assertOptionalString(task.approvalId, "EmployeeTask.approvalId");
  assertOptionalString(task.runId, "EmployeeTask.runId");
  assertOptionalString(task.artifactPath, "EmployeeTask.artifactPath");
  assertOptionalString(task.reviewPath, "EmployeeTask.reviewPath");
  assertOptionalString(task.errorMessage, "EmployeeTask.errorMessage");
  if (task.runHistory !== undefined) {
    if (!Array.isArray(task.runHistory)) {
      throw new Error("Invalid EmployeeTask.runHistory");
    }
    for (const [index, entryValue] of task.runHistory.entries()) {
      const entry = assertRecord(entryValue, `EmployeeTask.runHistory[${index}]`);
      assertString(entry.runId, `EmployeeTask.runHistory[${index}].runId`);
      assertString(entry.finishedAt, `EmployeeTask.runHistory[${index}].finishedAt`);
      if (!TASK_RUN_HISTORY_STATUSES.has(String(entry.status))) {
        throw new Error(`Invalid EmployeeTask.runHistory[${index}].status`);
      }
      assertOptionalString(entry.artifactPath, `EmployeeTask.runHistory[${index}].artifactPath`);
      assertOptionalString(entry.reviewPath, `EmployeeTask.runHistory[${index}].reviewPath`);
    }
  }
}

/** 校验员工 todo 投影 JSON 结构，确保 doctor 能识别坏投影记录。 */
export function assertEmployeeTodo(value: unknown): asserts value is EmployeeTodo {
  const todo = assertRecord(value, "EmployeeTodo");
  assertSchemaVersion(todo, "EmployeeTodo");
  assertString(todo.id, "EmployeeTodo.id");
  assertString(todo.taskId, "EmployeeTodo.taskId");
  assertString(todo.title, "EmployeeTodo.title");
  assertString(todo.createdAt, "EmployeeTodo.createdAt");
  assertString(todo.updatedAt, "EmployeeTodo.updatedAt");
  if (todo.source !== "inbox_task") {
    throw new Error(`Invalid EmployeeTodo.source: ${String(todo.source)}`);
  }
  if (!TODO_STATUSES.has(todo.status as EmployeeTodoStatus)) {
    throw new Error(`Invalid EmployeeTodo.status: ${String(todo.status)}`);
  }
}

/** 校验 heartbeat state JSON 结构，避免坏 tickCount 被继续累加。 */
export function assertHeartbeatState(value: unknown): asserts value is HeartbeatState {
  const state = assertRecord(value, "HeartbeatState");
  assertSchemaVersion(state, "HeartbeatState");
  if (!HEARTBEAT_STATUSES.has(String(state.status))) {
    throw new Error(`Invalid HeartbeatState.status: ${String(state.status)}`);
  }
  if (!isNumber(state.tickCount) || !Number.isInteger(state.tickCount) || state.tickCount < 0) {
    throw new Error("Invalid HeartbeatState.tickCount");
  }
  assertNullableString(state.lastBeatAt, "HeartbeatState.lastBeatAt");
  assertNullableString(state.nextBeatAt, "HeartbeatState.nextBeatAt");
  if (state.lastResult !== undefined) {
    const result = assertRecord(state.lastResult, "HeartbeatState.lastResult");
    assertNonNegativeInteger(result.processed, "HeartbeatState.lastResult.processed");
    assertNonNegativeInteger(result.approvals, "HeartbeatState.lastResult.approvals");
    assertNonNegativeInteger(result.denied, "HeartbeatState.lastResult.denied");
    assertNonNegativeInteger(result.events, "HeartbeatState.lastResult.events");
  }
}

/** 校验 heartbeat events.jsonl 中的单条事件，保证 doctor 能定位坏事件。 */
export function assertHeartbeatEvent(value: unknown): asserts value is Record<string, unknown> {
  const event = assertRecord(value, "HeartbeatEvent");
  assertSchemaVersion(event, "HeartbeatEvent");
  assertString(event.type, "HeartbeatEvent.type");
  assertString(event.createdAt, "HeartbeatEvent.createdAt");
  assertString(event.message, "HeartbeatEvent.message");
  if (!HEARTBEAT_EVENT_TYPES.has(String(event.type))) {
    throw new Error(`Invalid HeartbeatEvent.type: ${String(event.type)}`);
  }
}

/** 校验审批请求 JSON 结构，坏记录必须 fail closed。 */
export function assertApprovalRequest(value: unknown): asserts value is ApprovalRequest {
  const approval = assertRecord(value, "ApprovalRequest");
  assertSchemaVersion(approval, "ApprovalRequest");
  assertString(approval.id, "ApprovalRequest.id");
  assertString(approval.taskId, "ApprovalRequest.taskId");
  assertString(approval.reason, "ApprovalRequest.reason");
  assertString(approval.createdAt, "ApprovalRequest.createdAt");
  assertString(approval.updatedAt, "ApprovalRequest.updatedAt");
  if (!isString(approval.capability) || !isCapabilityId(approval.capability)) {
    throw new Error(`Invalid ApprovalRequest.capability: ${String(approval.capability)}`);
  }
  if (!APPROVAL_STATUSES.has(approval.status as ApprovalStatus)) {
    throw new Error(`Invalid ApprovalRequest.status: ${String(approval.status)}`);
  }
}

/** 校验 memory journal 单行结构，坏记录必须 fail closed。 */
export function assertMemoryJournalEntry(value: unknown): asserts value is MemoryJournalEntry {
  const entry = assertRecord(value, "MemoryJournalEntry");
  assertSchemaVersion(entry, "MemoryJournalEntry");
  assertString(entry.eventId, "MemoryJournalEntry.eventId");
  assertString(entry.subjectId, "MemoryJournalEntry.subjectId");
  assertString(entry.summary, "MemoryJournalEntry.summary");
  assertString(entry.createdAt, "MemoryJournalEntry.createdAt");
  if (!MEMORY_EVENT_TYPES.has(entry.type as MemoryEventType)) {
    throw new Error(`Invalid MemoryJournalEntry.type: ${String(entry.type)}`);
  }
  if (!isNumber(entry.confidence) || entry.confidence < 0 || entry.confidence > 1) {
    throw new Error("Invalid MemoryJournalEntry.confidence");
  }
}

/** 校验员工 profile JSON 结构。 */
export function assertEmployeeProfile(value: unknown): asserts value is EmployeeProfile {
  const profile = assertRecord(value, "EmployeeProfile");
  assertSchemaVersion(profile, "EmployeeProfile");
  assertString(profile.employeeId, "EmployeeProfile.employeeId");
  assertString(profile.displayName, "EmployeeProfile.displayName");
  assertString(profile.definitionId, "EmployeeProfile.definitionId");
  assertString(profile.createdAt, "EmployeeProfile.createdAt");
  assertString(profile.updatedAt, "EmployeeProfile.updatedAt");
  if (!PROFILE_STATUSES.has(profile.status as EmployeeProfileStatus)) {
    throw new Error(`Invalid EmployeeProfile.status: ${String(profile.status)}`);
  }
}

/** 校验 scheduled task JSON 结构。 */
export function assertScheduledTask(value: unknown): asserts value is ScheduledTask {
  const schedule = assertRecord(value, "ScheduledTask");
  assertSchemaVersion(schedule, "ScheduledTask");
  assertString(schedule.id, "ScheduledTask.id");
  assertString(schedule.title, "ScheduledTask.title");
  assertString(schedule.instruction, "ScheduledTask.instruction");
  assertString(schedule.dueAt, "ScheduledTask.dueAt");
  assertString(schedule.createdAt, "ScheduledTask.createdAt");
  assertString(schedule.updatedAt, "ScheduledTask.updatedAt");
  if (!SCHEDULE_STATUSES.has(schedule.status as ScheduledTaskStatus)) {
    throw new Error(`Invalid ScheduledTask.status: ${String(schedule.status)}`);
  }
  if (schedule.requestedCapability !== undefined && (!isString(schedule.requestedCapability) || !isCapabilityId(schedule.requestedCapability))) {
    throw new Error(`Invalid ScheduledTask.requestedCapability: ${String(schedule.requestedCapability)}`);
  }
}

/** 解析 JSON 并为错误补充记录类型，方便 doctor 汇总坏记录。 */
export function parseJsonRecord(raw: string, recordType: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid ${recordType} JSON: ${message}`);
  }
}

function assertRecord(value: unknown, recordType: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Invalid ${recordType}: expected object`);
  }
  return value as Record<string, unknown>;
}

function assertSchemaVersion(value: Record<string, unknown>, recordType: string): void {
  if (value.schemaVersion !== 1) {
    throw new Error(`Invalid ${recordType}.schemaVersion`);
  }
}

function assertString(value: unknown, name: string): void {
  if (!isString(value) || value.length === 0) {
    throw new Error(`Invalid ${name}`);
  }
}

function assertOptionalString(value: unknown, name: string): void {
  if (value !== undefined && !isString(value)) {
    throw new Error(`Invalid ${name}`);
  }
}

function assertNullableString(value: unknown, name: string): void {
  if (value !== null && !isString(value)) {
    throw new Error(`Invalid ${name}`);
  }
}

function assertNonNegativeInteger(value: unknown, name: string): void {
  if (!isNumber(value) || !Number.isInteger(value) || value < 0) {
    throw new Error(`Invalid ${name}`);
  }
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
