import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useWorkspaceStore } from "../stores/workspace";

export default function EmployeesPage() {
  const workspace = useWorkspaceStore();
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  useEffect(() => {
    if (workspace.siliconPersons.length > 0) return;
    workspace.loadSiliconPersons().catch((error: unknown) => {
      setLoadError(error instanceof Error ? error.message : "加载硅基员工列表失败。");
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    const trimmedName = name.trim();
    const trimmedDescription = description.trim();

    if (!trimmedName || !trimmedDescription) {
      setCreateError("名称和职责描述不能为空。");
      return;
    }

    setCreateError("");
    setIsCreating(true);
    try {
      await workspace.createSiliconPerson({
        name: trimmedName,
        title: trimmedName,
        description: trimmedDescription,
      });
      setName("");
      setDescription("");
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : "创建硅基员工失败。");
    } finally {
      setIsCreating(false);
    }
  }

  return (
    <main data-testid="silicon-person-entry-view" className="page-container">
      <header className="page-header">
        <div className="header-text">
          <span className="eyebrow">Silicon Person</span>
          <h2 className="page-title">硅基员工</h2>
          <p className="page-subtitle">
            这里是硅基员工入口页，用来创建身份并进入每位员工的私域工作空间。
          </p>
        </div>
      </header>

      <section className="library-content">
        <article className="create-card">
          <h3>创建硅基员工</h3>
          <form data-testid="silicon-person-create-form" className="create-form" onSubmit={handleCreate}>
            <label className="field">
              <span>名称</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                data-testid="silicon-person-create-name"
                type="text"
                placeholder="Ada"
              />
            </label>
            <label className="field">
              <span>职责描述</span>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                data-testid="silicon-person-create-description"
                rows={3}
                placeholder="负责承接主聊天分发，并在私域空间内持续推进任务。"
              />
            </label>
            {createError && <p className="error-copy">{createError}</p>}
            <button className="primary" type="submit" disabled={isCreating}>
              创建硅基员工
            </button>
          </form>
        </article>

        <article className="list-card">
          <h3>本地硅基员工</h3>
          {loadError ? (
            <p className="error-copy">{loadError}</p>
          ) : workspace.siliconPersons.length === 0 ? (
            <p className="empty-copy">还没有硅基员工。先创建一个身份，再开始协作。</p>
          ) : (
            <ul className="library-list">
              {workspace.siliconPersons.map((siliconPerson) => (
                <li
                  key={siliconPerson.id}
                  data-testid={`silicon-person-card-${siliconPerson.id}`}
                  className="library-item"
                >
                  <div className="item-header">
                    <strong>{siliconPerson.title || siliconPerson.name}</strong>
                    <span className="meta-pill">{siliconPerson.status}</span>
                  </div>
                  <p className="item-summary">{siliconPerson.description}</p>
                  <div className="item-footer">
                    <span className="meta-pill">{siliconPerson.source}</span>
                    <Link
                      to={`/employees/${siliconPerson.id}`}
                      data-testid={`silicon-person-open-${siliconPerson.id}`}
                      className="open-link"
                    >
                      打开工作空间
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </article>
      </section>

      <style>{`
        .page-container {
          height: 100%;
          overflow-y: auto;
        }

        .page-header {
          margin-bottom: 28px;
        }

        .eyebrow {
          display: inline-block;
          margin-bottom: 8px;
          color: var(--accent-cyan, #67e8f9);
          font-size: 12px;
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }

        .page-title {
          margin: 0;
          color: var(--text-primary, #fff);
          font-size: 28px;
        }

        .page-subtitle {
          margin: 10px 0 0;
          max-width: 620px;
          color: var(--text-secondary, #b0b0b8);
          line-height: 1.7;
        }

        .library-content {
          display: grid;
          grid-template-columns: minmax(280px, 340px) minmax(0, 1fr);
          gap: 20px;
        }

        .create-card, .list-card {
          border: 1px solid var(--glass-border);
          border-radius: var(--radius-xl);
          background: var(--bg-card);
          padding: 20px;
          backdrop-filter: var(--blur-std);
          -webkit-backdrop-filter: var(--blur-std);
          box-shadow: var(--shadow-card), var(--glass-inner-glow);
        }

        .create-card h3, .list-card h3 {
          margin: 0 0 14px;
          color: var(--text-primary);
          font-size: 17px;
        }

        .create-form {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        .field {
          display: flex;
          flex-direction: column;
          gap: 8px;
          color: var(--text-secondary);
        }

        .field input, .field textarea {
          width: 100%;
          border: 1px solid var(--glass-border);
          border-radius: var(--radius-md);
          background: var(--bg-base);
          color: var(--text-primary);
          padding: 10px 12px;
          font: inherit;
          transition: border-color 0.2s, box-shadow 0.2s;
        }

        .field input:focus, .field textarea:focus {
          border-color: var(--accent-cyan);
          box-shadow: 0 0 0 3px rgba(16,163,127,0.14);
        }

        .primary {
          border: none;
          border-radius: 999px;
          padding: 10px 14px;
          background: var(--accent-primary);
          color: var(--accent-text);
          font: inherit;
          cursor: pointer;
          transition: all 0.2s;
        }

        .primary:hover:not(:disabled) {
          filter: brightness(1.1);
          transform: translateY(-1px);
        }

        .primary:disabled {
          opacity: 0.65;
          cursor: not-allowed;
        }

        .library-list {
          list-style: none;
          padding: 0;
          margin: 0;
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        .library-item {
          border: 1px solid var(--glass-border);
          border-radius: var(--radius-lg);
          background: var(--bg-base);
          padding: 14px;
          display: flex;
          flex-direction: column;
          gap: 10px;
          transition: border-color 0.2s, box-shadow 0.2s, transform 0.2s;
          backdrop-filter: var(--blur-std);
          -webkit-backdrop-filter: var(--blur-std);
        }

        .library-item:hover {
          border-color: var(--glass-border-hover);
          box-shadow: var(--shadow-card), var(--glass-inner-glow);
          transform: translateY(-1px);
        }

        .item-header, .item-footer {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
        }

        .item-summary, .empty-copy {
          color: var(--text-secondary);
          margin: 0;
        }

        .meta-pill {
          border: 1px solid var(--glass-border);
          border-radius: 999px;
          padding: 4px 10px;
          font-size: 12px;
          color: var(--text-primary);
          transition: all 0.2s;
        }

        .meta-pill:hover {
          background: rgba(255,255,255,0.04);
          border-color: var(--text-muted);
        }

        .open-link {
          color: var(--text-primary);
          text-decoration: none;
          border: 1px solid var(--glass-border);
          border-radius: 999px;
          padding: 4px 10px;
          font-size: 12px;
          transition: all 0.2s;
        }

        .open-link:hover {
          background: rgba(255,255,255,0.06);
          border-color: var(--accent-cyan);
          color: var(--accent-cyan);
        }

        .error-copy {
          margin: 0;
          color: var(--status-red);
        }

        @media (max-width: 900px) {
          .library-content {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </main>
  );
}
