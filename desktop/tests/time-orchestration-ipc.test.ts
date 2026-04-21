import { beforeEach, describe, expect, it, vi } from "vitest";

const handleMock = vi.fn();

vi.mock("electron", () => ({
  ipcMain: {
    handle: handleMock,
  },
}));

function findHandler(channel: string) {
  const matched = handleMock.mock.calls.find(([registeredChannel]) => registeredChannel === channel);
  if (!matched) {
    throw new Error(`handler not found: ${channel}`);
  }
  return matched[1] as (...args: unknown[]) => Promise<unknown>;
}

describe("time orchestration IPC", () => {
  beforeEach(() => {
    handleMock.mockClear();
  });

  it("lists reminders and returns today brief payloads", async () => {
    const listReminders = vi.fn(async () => [{
      id: "rem-1",
      kind: "reminder",
      title: "Call doctor",
      triggerAt: "2026-04-20T07:00:00.000Z",
      timezone: "Asia/Shanghai",
      ownerScope: "personal",
      status: "scheduled",
      source: "manual",
      createdAt: "2026-04-18T00:00:00.000Z",
      updatedAt: "2026-04-18T00:00:00.000Z",
    }]);
    const getTodayBrief = vi.fn(async () => ({
      generatedAt: "2026-04-20T00:00:00.000Z",
      timezone: "Asia/Shanghai",
      items: [{ id: "rem-1", kind: "reminder", title: "Call doctor", summary: "07:00 reminder" }],
    }));

    const { registerTimeOrchestrationHandlers } = await import("../src/main/ipc/time-orchestration");
    registerTimeOrchestrationHandlers({
      services: {
        timeStore: {
          listReminders,
        },
        timeApplication: {
          getTodayBrief,
        },
      },
    } as any);

    const listRemindersHandler = findHandler("time:list-reminders");
    const getTodayBriefHandler = findHandler("time:get-today-brief");

    const remindersPayload = await listRemindersHandler(null);
    const todayBriefPayload = await getTodayBriefHandler(null);

    expect(listReminders).toHaveBeenCalled();
    expect(getTodayBrief).toHaveBeenCalled();
    expect(remindersPayload).toEqual({
      items: [expect.objectContaining({ id: "rem-1", title: "Call doctor" })],
    });
    expect(todayBriefPayload).toEqual({
      brief: expect.objectContaining({
        timezone: "Asia/Shanghai",
        items: [expect.objectContaining({ id: "rem-1" })],
      }),
    });
  });
});
