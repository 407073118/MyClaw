export type EmployeePackageManifest = {
  kind: "employee-package";
  name: string;
  version: string;
  description: string;
  role: string;
  defaultWorkflowIds?: string[];
};

export type WorkflowPackageManifest = {
  kind: "workflow-package";
  name: string;
  version: string;
  description: string;
  entryWorkflowId: string;
};
