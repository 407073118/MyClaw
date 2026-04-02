import { ipcMain } from "electron";
import { randomUUID } from "node:crypto";

import type { LocalEmployeeSummary } from "@shared/contracts";

import type { RuntimeContext } from "../services/runtime-context";
import { saveEmployee } from "../services/state-persistence";

export function registerEmployeeHandlers(ctx: RuntimeContext): void {
  // List all local employees
  ipcMain.handle("employee:list", async (): Promise<LocalEmployeeSummary[]> => {
    return ctx.state.employees;
  });

  // Get a single employee by ID
  ipcMain.handle(
    "employee:get",
    async (_event, employeeId: string): Promise<LocalEmployeeSummary> => {
      const employee = ctx.state.employees.find((e) => e.id === employeeId);
      if (!employee) {
        throw new Error(`Employee not found: ${employeeId}`);
      }
      return employee;
    },
  );

  // Create a new employee
  ipcMain.handle(
    "employee:create",
    async (
      _event,
      input: { name: string; description: string; [key: string]: unknown },
    ): Promise<{ employee: LocalEmployeeSummary; items: LocalEmployeeSummary[] }> => {
      const employee: LocalEmployeeSummary = {
        id: randomUUID(),
        name: input.name,
        description: input.description,
        status: "draft",
        source: "personal",
        workflowIds: [],
        updatedAt: new Date().toISOString(),
      };
      ctx.state.employees.push(employee);
      saveEmployee(ctx.runtime.paths, employee).catch((err) => {
        console.error("[employee:create] failed to persist employee", employee.id, err);
      });
      return { employee, items: [...ctx.state.employees] };
    },
  );

  // Update an existing employee
  ipcMain.handle(
    "employee:update",
    async (
      _event,
      employeeId: string,
      input: Partial<LocalEmployeeSummary>,
    ): Promise<{ employee: LocalEmployeeSummary }> => {
      const index = ctx.state.employees.findIndex((e) => e.id === employeeId);
      if (index === -1) {
        throw new Error(`Employee not found: ${employeeId}`);
      }
      const updated: LocalEmployeeSummary = {
        ...ctx.state.employees[index],
        ...input,
        id: employeeId,
      };
      ctx.state.employees[index] = updated;
      saveEmployee(ctx.runtime.paths, updated).catch((err) => {
        console.error("[employee:update] failed to persist employee", employeeId, err);
      });
      return { employee: updated };
    },
  );
}
