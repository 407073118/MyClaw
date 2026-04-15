const fs = require('fs');
const path = 'src/renderer/pages/ChatPage.tsx';
let content = fs.readFileSync(path, 'utf8');

// 1. Re-normalize the file by fixing the known corruption patterns.
// This is better than trying to guess line numbers.

// Fix the corrupted dispatchTraces area
const dispatchTracesBlock = `        {/* @ 投递痕迹卡片 */}
        {dispatchTraces.length > 0 && (
          <div className="dispatch-traces">
            {dispatchTraces.map((trace) => (
              <div key={trace.id} className="dispatch-trace-card">
                <span className="dispatch-trace-dot" />
                <span className="dispatch-trace-text">
                  已投递给 @{trace.personName}: {trace.content.length > 30 ? \`\${trace.content.slice(0, 30)}...\` : trace.content}
                </span>
                <button
                  type="button"
                  className="dispatch-trace-link"
                  onClick={() => workspace.setActiveSiliconPersonId(trace.personId)}
                >进入对话</button>
              </div>
            ))}
          </div>
        )}`;

// Fix the footer area
const footerBlock = `        {/* 输入区 */}
        <footer className="composer-panel">
          <div className="composer-container">
            {/* @ mention 目标指示器 */}
            {targetSiliconPerson && (
              <div data-testid="mention-target-indicator" className="mention-target-indicator">
                <span className="mention-target-label">投递给</span>
                <span className="mention-target-name">@{targetSiliconPerson.name}</span>
                <button
                  type="button"
                  className="mention-target-clear"
                  onClick={() => setTargetSiliconPersonId(null)}
                  title="取消投递"
                >
                  &times;
                </button>
              </div>
            )}

            {/* @ mention 弹出菜单 */}
            {mentionMenuOpen && filteredMentions.length > 0 && (
              <div className="slash-menu mention-menu" data-testid="mention-menu">
                {filteredMentions.map((person, idx) => (
                  <div
                    key={person.id}
                    ref={idx === mentionMenuIndex ? (el) => el?.scrollIntoView({ block: "nearest" }) : undefined}
                    className={\`slash-menu-item\${idx === mentionMenuIndex ? " active" : ""}\`}
                    onMouseDown={(e) => { e.preventDefault(); selectMentionItem(person); }}
                    onMouseEnter={() => setMentionMenuIndex(idx)}
                  >
                    <span className="mention-avatar">{(person.name || "?").charAt(0).toUpperCase()}</span>
                    <span className="slash-cmd">{person.name}</span>
                    <span className="slash-desc">{person.description.slice(0, 40)}</span>
                    <span className={\`mention-status mention-status-\${person.status}\`}>{person.status}</span>
                  </div>
                ))}
              </div>
            )}

            {slashMenuOpen && filteredSlash.length > 0 && (
              <div className="slash-menu">
                {filteredSlash.map((item, idx) => {
                  const prev = idx > 0 ? filteredSlash[idx - 1] : null;
                  return (
                    <React.Fragment key={item.id}>
                      {prev && prev.category !== item.category && <div className="slash-divider" />}
                      <div
                        ref={idx === slashIdx ? (el) => el?.scrollIntoView({ block: "nearest" }) : undefined}
                        className={\`slash-menu-item\${idx === slashIdx ? " active" : ""}\`}
                        onMouseDown={(e) => { e.preventDefault(); selectSlashItem(item); }}
                        onMouseEnter={() => setSlashMenuIndex(idx)}
                      >
                        <span className="slash-cmd">{item.label}</span>
                        <span className="slash-desc">{item.description}</span>
                        {item.category === "skill" && <span className="slash-badge">技能</span>}
                      </div>
                    </React.Fragment>
                  );
                })}
              </div>
            )}
            <textarea
              ref={composerRef}
              data-testid="composer-input"
              value={composerDraft}
              onChange={(e) => {
                const val = e.target.value;
                setComposerDraft(val);
                // 检测 @ 触发
                const atMatch = val.match(/@(\\S*)$/);
                if (atMatch && siliconPersons.length > 0) {
                  setMentionMenuOpen(true);
                  setMentionFilter(atMatch[1] ?? "");
                  setMentionMenuIndex(0);
                } else if (mentionMenuOpen) {
                  setMentionMenuOpen(false);
                  setMentionFilter("");
                }
              }}
              className="composer-input"
              placeholder={isRunBusy ? "正在响应..." : "输入消息 (Enter 发送, Shift+Enter 换行)，或输入 / 获取快捷命令"}
              disabled={isRunBusy}
              rows={1}
              onKeyDown={handleComposerKeyDown}
            />
            <div className="composer-toolbar">
              <div className="composer-toolbar-left">
                {(
                  <>
                    {(() => {
                      const reasoningSupported = currentModel?.discoveredCapabilities?.supportsReasoning !== false;
                      if (!reasoningSupported) return null;
                      const effortLevels = [
                        { key: "low", label: "快速", title: "快速回答" },
                        { key: "medium", label: "思考", title: "默认思考" },
                        { key: "high", label: "深度", title: "深度推理" },
                        { key: "xhigh", label: "极深", title: "极深推理（最大 thinking budget）" },
                      ] as const;
                      const currentEffort = (session?.runtimeIntent as Record<string, unknown> | undefined)?.reasoningEffort;
                      return (
                        <div className="effort-selector" data-testid="effort-selector">
                          {effortLevels.map(({ key, label, title }) => (
                            <button
                              key={key}
                              className={\`effort-btn\${currentEffort === key || (!currentEffort && key === "medium") ? " active" : ""}\`}
                              onClick={() => void workspace.updateSessionRuntimeIntent({ reasoningEffort: key })}
                              title={title}
                            >
                              {label}
                            </button>
                          ))}
                        </div>
                      );
                    })()}
                    <button
                      type="button"
                      data-testid="plan-mode-toggle"
                      className={\`effort-btn\${planModeEnabled ? " active" : ""}\`}
                      onClick={() => void workspace.updateSessionRuntimeIntent({
                        workflowMode: planModeEnabled ? "default" : "plan",
                        planModeEnabled: !planModeEnabled,
                      })}
                      title={planModeEnabled ? "关闭 Plan Mode" : "开启 Plan Mode"}
                    >
                      Plan
                    </button>
                  </>
                )}
              </div>
              {!isRunBusy ? (
                <button
                  data-testid="composer-submit"
                  className="submit-btn"
                  disabled={!composerDraft.trim() || !session}
                  onClick={() => void submitMessage()}
                  title="发送消息"
                >
                  <ArrowUp size={18} strokeWidth={2.5} />
                </button>
              ) : (
                <button
                  data-testid="composer-stop"
                  className="stop-btn"
                  disabled={!session || isRunCanceling}
                  onClick={() => void handleStopRun()}
                >
                  <Square size={14} fill="currentColor" strokeWidth={0} />
                </button>
              )}
            </div>
            {sessionTokenTotal > 0 && (
              <div className="session-token-total">
                会话总计: {sessionTokenTotal.toLocaleString()} tokens
              </div>
            )}
          </div>
        </footer>`;

// I will find the whole part from {dispatchTraces...} up to PlanSidePanel and replace it.
const startTag = '{/* @ 投递痕迹卡片 */}';
const endTag = '{/* Plan Mode 侧边面板 */}';

const startIndex = content.indexOf(startTag);
const endIndex = content.indexOf(endTag);

if (startIndex !== -1 && endIndex !== -1) {
    const combined = dispatchTracesBlock + '\n\n' + footerBlock + '\n\n      ';
    content = content.substring(0, startIndex) + combined + content.substring(endIndex);
}

fs.writeFileSync(path, content);
console.log('Super-fix applied successfully.');
