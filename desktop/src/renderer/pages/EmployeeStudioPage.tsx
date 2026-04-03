import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { useWorkspaceStore } from "../stores/workspace";

export default function EmployeeStudioPage() {
  const { id: employeeId = "" } = useParams<{ id: string }>();
  const workspace = useWorkspaceStore();

  const employee = useMemo(
    () => workspace.employees.find((item) => item.id === employeeId) ?? null,
    [workspace.employees, employeeId],
  );

  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [selectedWorkflowId, setSelectedWorkflowId] = useState("");

  // Draft state — mirrors employee
  const [draftName, setDraftName] = useState("");
  const [draftDescription, setDraftDescription] = useState("");
  const [draftStatus, setDraftStatus] = useState<"draft" | "active" | "archived">("draft");
  const [draftSource, setDraftSource] = useState<"personal" | "enterprise" | "hub">("personal");
  const [draftWorkflowIds, setDraftWorkflowIds] = useState<string[]>([]);

  // Sync draft from employee whenever employee changes
  useEffect(() => {
    if (!employee) return;
    setDraftName(employee.name);
    setDraftDescription(employee.description);
    setDraftStatus(employee.status);
    setDraftSource(employee.source);
    setDraftWorkflowIds([...employee.workflowIds]);
  }, [employee]);

  useEffect(() => {
    async function init() {
      if (employeeId) {
        await workspace.loadEmployeeById(employeeId);
      }
      if (workspace.workflows.length === 0) {
        await workspace.loadWorkflows();
      }
    }
    init();
  }, [employeeId]); // eslint-disable-line react-hooks/exhaustive-deps

  function bindWorkflow() {
    if (!selectedWorkflowId || draftWorkflowIds.includes(selectedWorkflowId)) return;
    setDraftWorkflowIds((prev) => [...prev, selectedWorkflowId]);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!employeeId) return;

    setSaveError("");
    setIsSaving(true);
    try {
      await workspace.updateEmployee(employeeId, {
        name: draftName.trim(),
        description: draftDescription.trim(),
        status: draftStatus,
        source: draftSource,
        workflowIds: [...draftWorkflowIds],
      });
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Save employee failed.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <main data-testid="employee-studio-view" className="page-container studio-page">
      <header className="page-header">
        <p className="eyebrow">Employee Studio</p>
        <h2>{draftName || employee?.name || "Employee Studio"}</h2>
        <p className="subtitle">
          Role card, workflow bindings, SOP, memory, and pending work all stay attached to the same employee unit.
        </p>
      </header>

      <section className="studio-grid">
        <form data-testid="employee-studio-save" className="studio-card studio-form" onSubmit={handleSave}>
          <h3>Role Card</h3>
          <label className="field">
            <span>Name</span>
            <input
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              data-testid="employee-studio-name"
              type="text"
            />
          </label>
          <label className="field">
            <span>Description</span>
            <textarea
              value={draftDescription}
              onChange={(e) => setDraftDescription(e.target.value)}
              data-testid="employee-studio-description"
              rows={4}
            />
          </label>
          <label className="field">
            <span>Status</span>
            <select
              value={draftStatus}
              onChange={(e) => setDraftStatus(e.target.value as "draft" | "active" | "archived")}
              data-testid="employee-studio-status"
            >
              <option value="draft">draft</option>
              <option value="active">active</option>
              <option value="archived">archived</option>
            </select>
          </label>

          <div className="binding-row">
            <label className="field binding-field">
              <span>Bind Workflow</span>
              <select
                value={selectedWorkflowId}
                onChange={(e) => setSelectedWorkflowId(e.target.value)}
                data-testid="employee-studio-workflow-select"
              >
                <option value="">Select workflow</option>
                {workspace.workflows.map((workflow) => (
                  <option key={workflow.id} value={workflow.id}>
                    {workflow.name}
                  </option>
                ))}
              </select>
            </label>
            <button
              data-testid="employee-studio-bind-workflow"
              className="secondary"
              type="button"
              onClick={bindWorkflow}
            >
              Bind
            </button>
          </div>

          {draftWorkflowIds.length > 0 && (
            <ul className="binding-list">
              {draftWorkflowIds.map((workflowId) => (
                <li key={workflowId}>{workflowId}</li>
              ))}
            </ul>
          )}

          {saveError && <p className="error-copy">{saveError}</p>}
          <button className="primary" type="submit" disabled={isSaving}>
            Save Employee
          </button>
        </form>

        <aside className="studio-sidebar">
          <section className="studio-card">
            <h3>SOP summary</h3>
            <p>Capture the role card and checklist here before expanding into full SOP editing.</p>
          </section>
          <section className="studio-card">
            <h3>Memory summary</h3>
            <p>Recent employee memory snapshots will appear here once runs begin writing back context.</p>
          </section>
          <section className="studio-card">
            <h3>Pending work summary</h3>
            <p>Future follow-ups and heartbeat-resumable commitments will be surfaced in this panel.</p>
          </section>
        </aside>
      </section>

      <style>{`
        .studio-page {
          padding: 40px 48px;
          display: flex;
          flex-direction: column;
          gap: 24px;
        }

        .page-header {
          max-width: 760px;
        }

        .eyebrow {
          color: var(--text-muted);
          text-transform: uppercase;
          letter-spacing: 0.1em;
          font-size: 11px;
          font-weight: 600;
          margin-bottom: 8px;
        }

        h2 {
          font-size: 24px;
          font-weight: 600;
          color: var(--text-primary);
          margin: 0 0 8px;
        }

        .subtitle {
          color: var(--text-secondary);
          font-size: 14px;
          line-height: 1.6;
          margin: 0;
        }

        .studio-grid {
          display: grid;
          grid-template-columns: minmax(0, 1.2fr) minmax(300px, 0.8fr);
          gap: 20px;
        }

        .studio-form, .studio-sidebar {
          display: flex;
          flex-direction: column;
          gap: 16px;
        }

        .studio-card {
          border: 1px solid var(--glass-border);
          border-radius: var(--radius-lg);
          background: var(--bg-card);
          padding: 20px;
          transition: border-color 0.2s, box-shadow 0.2s;
        }

        .studio-card:hover {
          border-color: var(--text-muted);
          box-shadow: 0 2px 8px rgba(0,0,0,0.15);
        }

        .studio-card h3 {
          margin: 0 0 12px;
          color: var(--text-primary);
          font-size: 17px;
        }

        .studio-card p {
          color: var(--text-secondary);
          margin: 0;
          font-size: 14px;
          line-height: 1.6;
        }

        .field {
          display: flex;
          flex-direction: column;
          gap: 8px;
          color: var(--text-secondary);
        }

        .field input, .field textarea, .field select {
          width: 100%;
          border: 1px solid var(--glass-border);
          border-radius: var(--radius-md);
          background: var(--bg-base);
          color: var(--text-primary);
          padding: 10px 12px;
          font: inherit;
          transition: border-color 0.2s, box-shadow 0.2s;
        }

        .field input:focus, .field textarea:focus, .field select:focus {
          border-color: var(--accent-cyan);
          box-shadow: 0 0 0 3px rgba(16,163,127,0.14);
        }

        .binding-row {
          display: flex;
          gap: 12px;
          align-items: end;
        }

        .binding-field { flex: 1; }

        .binding-list {
          margin: 0;
          padding-left: 18px;
          color: var(--text-secondary);
        }

        .primary, .secondary {
          border-radius: 999px;
          padding: 10px 14px;
          font: inherit;
          cursor: pointer;
          transition: all 0.2s;
        }

        .primary {
          border: none;
          background: var(--accent-primary);
          color: var(--accent-text);
        }

        .primary:hover:not(:disabled) {
          filter: brightness(1.1);
          transform: translateY(-1px);
        }

        .secondary {
          border: 1px solid var(--glass-border);
          background: transparent;
          color: var(--text-primary);
        }

        .secondary:hover {
          background: rgba(255,255,255,0.04);
          border-color: var(--text-muted);
        }

        .primary:disabled {
          opacity: 0.65;
          cursor: not-allowed;
        }

        .error-copy {
          margin: 0;
          color: var(--status-red);
        }

        @media (max-width: 960px) {
          .studio-page { padding: 24px; }
          .studio-grid { grid-template-columns: 1fr; }
        }
      `}</style>
    </main>
  );
}
