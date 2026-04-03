export const EmployeePackageSource = {
  Personal: "personal",
  Enterprise: "enterprise",
  Hub: "hub",
} as const;

export type EmployeePackageSource =
  (typeof EmployeePackageSource)[keyof typeof EmployeePackageSource];

export const EmployeeStatus = {
  Draft: "draft",
  Active: "active",
  Archived: "archived",
} as const;

export type EmployeeStatus = (typeof EmployeeStatus)[keyof typeof EmployeeStatus];

export type LocalEmployeeSummary = {
  id: string;
  name: string;
  description: string;
  status: EmployeeStatus;
  source: EmployeePackageSource;
  workflowIds: string[];
  updatedAt: string;
};
