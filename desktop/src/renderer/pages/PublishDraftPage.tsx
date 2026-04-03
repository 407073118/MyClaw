import { useEffect, useMemo, useState } from "react";
import { useWorkspaceStore } from "../stores/workspace";

// ── Types ─────────────────────────────────────────────────────────────────────

interface PublishDraftRecord {
  id: string;
  kind: string;
  sourceId: string;
  filePath: string;
  manifest: {
    version: string;
  };
}

// ── PublishDraftPage ──────────────────────────────────────────────────────────

export default function PublishDraftPage() {
  const workspace = useWorkspaceStore();

  const [kind, setKind] = useState<"employee-package" | "workflow-package">("employee-package");
  const [sourceId, setSourceId] = useState("");
  const [version, setVersion] = useState("");
  const [isPublishing, setIsPublishing] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [draftFeedback, setDraftFeedback] = useState("");
  const [lastDraft, setLastDraft] = useState<PublishDraftRecord | null>(null);

  const sourceOptions = useMemo(() => {
    if (kind === "employee-package") {
      return workspace.employees.map((item) => ({
        id: item.id,
        label: `${item.name} (${item.status})`,
      }));
    }
    return workspace.workflows.map((item) => ({
      id: item.id,
      label: `${item.name} (${item.status})`,
    }));
  }, [kind, workspace.employees, workspace.workflows]);

  // Sync sourceId when sourceOptions changes
  useEffect(() => {
    if (!sourceOptions.length) {
      setSourceId("");
      return;
    }
    if (!sourceOptions.some((option) => option.id === sourceId)) {
      setSourceId(sourceOptions[0]?.id ?? "");
    }
  }, [sourceOptions]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reset feedback when kind changes
  useEffect(() => {
    setDraftFeedback("");
    setSubmitError("");
    setLastDraft(null);
    setVersion("");
  }, [kind]);

  useEffect(() => {
    if (!workspace.employees.length) {
      void workspace.loadEmployees();
    }
    if (!workspace.workflows.length) {
      void workspace.loadWorkflows();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /** 根据当前表单内容生成员工包或工作流包的发布草稿。 */
  async function handlePublish(e: React.FormEvent) {
    e.preventDefault();

    if (!sourceId.trim() || !version.trim()) {
      setSubmitError("Please select a source and specify a version.");
      return;
    }

    setIsPublishing(true);
    setSubmitError("");
    setDraftFeedback("");

    try {
      const payload = {
        kind,
        sourceId,
        version: version.trim(),
      } as const;

      console.info("[publish-draft-view] 开始创建发布草稿", payload);
      const { draft } = await workspace.createPublishDraft(payload);
      setLastDraft(draft as PublishDraftRecord);
      setDraftFeedback(`Draft "${draft.id}" staged at ${draft.filePath}`);
      console.info("[publish-draft-view] 发布草稿创建完成", {
        id: draft.id,
        kind: draft.kind,
        sourceId: draft.sourceId,
        filePath: draft.filePath,
      });
      setVersion("");
    } catch (error) {
      console.error("[publish-draft-view] 发布草稿创建失败", error);
      setSubmitError(
        error instanceof Error ? error.message : "Failed to create publish draft.",
      );
    } finally {
      setIsPublishing(false);
    }
  }

  return (
    <main data-testid="publish-draft-view" className="page-container publish-draft-page">
      <header className="page-header">
        <p className="eyebrow">Publish Draft</p>
        <h2>Create a shareable package snapshot</h2>
        <p className="subtitle">
          Capture the manifest that powers your employee or workflow, then publish a lightweight
          draft that can be reviewed or uploaded to the cloud hub later.
        </p>
      </header>

      <section className="publish-card">
        <form data-testid="publish-draft-form" className="publish-form" onSubmit={handlePublish}>
          <label className="field">
            <span>Package Target</span>
            <select
              data-testid="publish-draft-kind"
              value={kind}
              onChange={(e) =>
                setKind(e.target.value as "employee-package" | "workflow-package")
              }
              disabled={isPublishing}
            >
              <option value="employee-package">Employee Package</option>
              <option value="workflow-package">Workflow Package</option>
            </select>
          </label>

          <label className="field">
            <span>Source</span>
            <select
              data-testid="publish-draft-source"
              value={sourceId}
              onChange={(e) => setSourceId(e.target.value)}
              disabled={isPublishing || sourceOptions.length === 0}
            >
              {sourceOptions.length === 0 ? (
                <option disabled value="">
                  No items available
                </option>
              ) : (
                sourceOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))
              )}
            </select>
          </label>

          <label className="field">
            <span>Version</span>
            <input
              data-testid="publish-draft-version"
              type="text"
              placeholder="e.g. 1.0.0"
              value={version}
              onChange={(e) => setVersion(e.target.value)}
              disabled={isPublishing}
            />
          </label>

          <button
            data-testid="publish-draft-submit"
            className="primary"
            type="submit"
            disabled={isPublishing || !sourceId}
          >
            {isPublishing ? "Publishing…" : "Create publish draft"}
          </button>
        </form>

        <div className="status-panel">
          {draftFeedback ? (
            <p className="status success" data-testid="publish-draft-feedback">
              {draftFeedback}
            </p>
          ) : submitError ? (
            <p className="status error" data-testid="publish-draft-error">
              {submitError}
            </p>
          ) : null}

          {lastDraft && (
            <ul className="draft-details">
              <li>
                <strong>Id:</strong> {lastDraft.id}
              </li>
              <li>
                <strong>Kind:</strong> {lastDraft.kind}
              </li>
              <li>
                <strong>Source:</strong> {lastDraft.sourceId}
              </li>
              <li>
                <strong>Version:</strong> {lastDraft.manifest.version}
              </li>
            </ul>
          )}
        </div>
      </section>

      <style>{`
        .publish-draft-page {
          display: flex;
          flex-direction: column;
          gap: 24px;
          padding: 40px 48px;
        }

        .page-header {
          max-width: 720px;
        }

        .eyebrow {
          color: var(--text-muted);
          text-transform: uppercase;
          letter-spacing: 0.1em;
          font-size: 11px;
          font-weight: 600;
          margin-bottom: 8px;
          display: block;
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

        .publish-card {
          border-radius: var(--radius-lg);
          padding: 32px;
          background: linear-gradient(135deg, rgba(59,130,246,0.12), rgba(14,165,233,0.06));
          border: 1px solid var(--glass-border);
          display: grid;
          grid-template-columns: minmax(0, 1fr);
          gap: 24px;
          transition: border-color 0.2s, box-shadow 0.2s;
        }

        .publish-card:hover {
          border-color: rgba(16, 163, 127, 0.3);
          box-shadow: 0 4px 16px rgba(0,0,0,0.2);
        }

        .publish-form {
          display: grid;
          gap: 16px;
        }

        .field {
          display: flex;
          flex-direction: column;
          gap: 8px;
          color: var(--text-secondary);
        }

        .field span {
          font-weight: 600;
        }

        .field select, .field input {
          border: 1px solid var(--glass-border);
          border-radius: var(--radius-md);
          background: var(--bg-base);
          padding: 10px 12px;
          font: inherit;
          color: var(--text-primary);
          outline: none;
          transition: border-color 0.2s, box-shadow 0.2s;
        }

        .field select:focus, .field input:focus {
          border-color: var(--accent-cyan);
          box-shadow: 0 0 0 3px rgba(16,163,127,0.14);
        }

        button.primary {
          border: none;
          background: var(--accent-primary);
          color: var(--accent-text);
          padding: 12px 18px;
          border-radius: 999px;
          font-weight: 600;
          cursor: pointer;
          font: inherit;
          transition: all 0.2s;
        }

        button.primary:hover:not(:disabled) {
          filter: brightness(1.1);
          transform: translateY(-1px);
        }

        button.primary:disabled {
          opacity: 0.7;
          cursor: not-allowed;
        }

        .status-panel {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        .status {
          margin: 0;
          font-size: 0.95rem;
        }

        .status.success { color: var(--status-green); }
        .status.error { color: var(--status-red); }

        .draft-details {
          list-style: none;
          margin: 0;
          padding: 0;
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
          gap: 8px;
          font-size: 0.9rem;
          color: var(--text-secondary);
        }

        .draft-details li {
          padding: 8px 12px;
          border-radius: var(--radius-md);
          transition: background 0.2s;
        }

        .draft-details li:hover {
          background: rgba(255,255,255,0.03);
        }

        .draft-details strong { color: var(--text-primary); }

        @media (max-width: 768px) {
          .publish-draft-page { padding: 24px; }
        }
      `}</style>
    </main>
  );
}
