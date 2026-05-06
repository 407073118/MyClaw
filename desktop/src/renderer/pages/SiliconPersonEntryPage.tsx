import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useWorkspaceStore } from "../stores/workspace";
import { MessageSquare, Plus, Settings2, Users } from "lucide-react";

const STATUS_LABEL: Record<string, string> = {
  idle: "空闲",
  running: "运行中",
  needs_approval: "待审批",
  done: "已完成",
  error: "异常",
  canceling: "取消中",
  canceled: "已取消",
};

const STATUS_VARIANT: Record<string, string> = {
  idle: "muted",
  running: "accent",
  needs_approval: "yellow",
  done: "green",
  error: "red",
  canceling: "yellow",
  canceled: "muted",
};

const SOURCE_LABEL: Record<string, string> = {
  enterprise: "企业",
  hub: "Hub",
  personal: "个人",
};

function getAvatarColor(name: string): string {
  const colors = ["#10b981", "#3b82f6", "#8b5cf6", "#f59e0b", "#ef4444", "#ec4899", "#06b6d4", "#84cc16"];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length];
}

export default function SiliconPersonEntryPage() {
  const workspace = useWorkspaceStore();
  const navigate = useNavigate();

  const [loadError, setLoadError] = useState<string | null>(null);
  useEffect(() => {
    if (workspace.siliconPersons.length > 0) return;
    workspace.loadSiliconPersons().catch((err) => {
      console.error("[SiliconPersonEntryPage] 加载硅基员工列表失败", err);
      setLoadError(err instanceof Error ? err.message : "加载失败");
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /** 切换共享聊天对象，并进入主聊天容器。 */
  function handleOpenChat(personId: string) {
    console.info("[SiliconPersonEntryPage] 切换硅基员工聊天对象", {
      siliconPersonId: personId,
    });
    workspace.setActiveSiliconPersonId(personId);
    navigate("/");
  }

  /** 打开硅基员工配置工作台，不影响当前共享聊天对象。 */
  function handleOpenStudio(personId: string) {
    console.info("[SiliconPersonEntryPage] 打开硅基员工配置工作台", {
      siliconPersonId: personId,
    });
    navigate(`/employees/${personId}/studio`);
  }

  return (
    <div className="page-shell" data-testid="silicon-person-entry-view">
      <header className="page-header page-header--sticky">
        <div className="page-header__lead">
          <div className="page-header__eyebrow">
            <Users size={14} />
            <span>Silicon Person</span>
          </div>
          <h2 className="page-header__title">硅基员工</h2>
          <p className="page-header__subtitle">
            管理你的硅基员工，点击名称进入共享聊天对话。
          </p>
        </div>
        <div className="page-header__actions">
          <button
            type="button"
            className="btn-primary"
            data-testid="silicon-person-create-btn"
            onClick={() => navigate("/employees/new")}
          >
            <Plus size={14} />
            新建硅基员工
          </button>
        </div>
      </header>

      <main className="page-content">
        {loadError ? (
          <div className="banner banner--error">
            <span>加载失败：{loadError}</span>
          </div>
        ) : null}

        {workspace.siliconPersons.length === 0 ? (
          <section className="empty-state">
            <Users size={32} className="empty-state__icon" />
            <h3 className="empty-state__title">还没有硅基员工</h3>
            <p className="empty-state__body">
              点击右上角「新建硅基员工」开始创建第一位。
            </p>
            <button
              type="button"
              className="btn-primary"
              onClick={() => navigate("/employees/new")}
            >
              <Plus size={14} />
              新建硅基员工
            </button>
          </section>
        ) : (
          <div className="list-rows">
            {workspace.siliconPersons.map((person) => {
              const statusVariant = STATUS_VARIANT[person.status] ?? "muted";
              const statusLabel = STATUS_LABEL[person.status] ?? person.status;
              const sourceLabel = SOURCE_LABEL[person.source] ?? person.source;

              return (
                <article
                  key={person.id}
                  className="list-row list-row--with-avatar list-row--with-description"
                  data-testid={`silicon-person-card-${person.id}`}
                >
                  <div className="list-row__lead">
                    <div
                      className="list-row__avatar"
                      style={{ background: getAvatarColor(person.name) }}
                      aria-hidden="true"
                    >
                      {person.name[0]}
                    </div>
                  </div>

                  <div className="list-row__main">
                    <div className="list-row__title-row">
                      <Link
                        to="/"
                        className="list-row__title"
                        onClick={() => workspace.setActiveSiliconPersonId(person.id)}
                      >
                        {person.name}
                      </Link>
                      <span className={`tag tag--${statusVariant}`}>{statusLabel}</span>
                      <span className="tag tag--muted">{sourceLabel}</span>
                      {person.hasUnread && person.unreadCount > 0 && (
                        <span
                          className="tag tag--accent"
                          title={`${person.unreadCount} 条未读消息`}
                        >
                          {person.unreadCount}
                        </span>
                      )}
                    </div>
                    <div className="list-row__description">
                      {person.description || person.title || "暂无职责描述"}
                    </div>
                  </div>

                  <div className="list-row__trailing">
                    <button
                      type="button"
                      className="btn-primary"
                      data-testid={`silicon-person-open-${person.id}`}
                      onClick={() => handleOpenChat(person.id)}
                    >
                      <MessageSquare size={14} />
                      进入对话
                    </button>
                    <button
                      type="button"
                      className="btn-toolbar"
                      data-testid={`silicon-person-manage-${person.id}`}
                      onClick={() => handleOpenStudio(person.id)}
                    >
                      <Settings2 size={14} />
                      配置
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
