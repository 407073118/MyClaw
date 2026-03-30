const fs = require('fs');
const filePath = 'f:\\MyClaw\\desktop\\apps\\desktop\\src\\views\\ChatView.vue';
let content = fs.readFileSync(filePath, 'utf-8');

const styleIndex = content.indexOf('<style scoped>');
if (styleIndex !== -1) {
  const baseContent = content.substring(0, styleIndex);
  const newStyle = `<style scoped>
.chat-shell {
  display: flex;
  flex: 1;
  height: 100%;
  min-height: 0;
}

.session-rail {
  width: 280px;
  border-left: 1px solid var(--glass-border);
  background: var(--bg-sidebar);
  display: flex;
  flex-direction: column;
  order: 2;
}

.chat-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  background: var(--bg-base);
  min-width: 0;
  position: relative;
  order: 1;
}

.rail-header {
  padding: 24px 20px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  border-bottom: 1px solid var(--glass-border);
}

.eyebrow {
  margin: 0 0 6px;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  font-size: 11px;
  font-weight: 600;
}

.chat-title h1,
.rail-header h2 {
  margin: 0;
  color: var(--text-primary);
  font-size: 16px;
  font-weight: 600;
}

.new-chat-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 10px 16px;
}

.session-list {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
  margin: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.session-item {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 0;
  padding: 12px 14px;
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
  transition: all 0.2s ease;
}

.session-item:hover {
  background: var(--glass-reflection);
}

.session-item.active {
  background: var(--bg-card);
  border-color: var(--glass-border);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

.session-info {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
  flex: 1;
}

.session-info strong {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.session-info span {
  color: var(--text-secondary);
  font-size: 12px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.session-row {
  display: flex;
  align-items: stretch;
  gap: 4px;
}

.session-delete {
  width: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-md);
  border: 1px solid transparent;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  opacity: 0;
  transition: all 0.2s ease;
}

.session-row:hover .session-delete,
.session-row .session-delete:focus-within {
  opacity: 1;
}

.session-delete:hover:not(:disabled) {
  background: rgba(239, 68, 68, 0.1);
  color: #ef4444;
}

.chat-title {
  padding: 20px 32px;
  border-bottom: 1px solid var(--glass-border);
  background: var(--bg-base);
  z-index: 10;
}

.timeline-panel {
  flex: 1;
  overflow-y: auto;
  padding: 32px;
  scroll-behavior: smooth;
}

.timeline {
  display: flex;
  flex-direction: column;
  gap: 32px;
  max-width: 800px;
  margin: 0 auto;
}

/* Timeline Message Redesign */
.message-row {
  display: flex;
  align-items: flex-start;
  gap: 16px;
  width: 100%;
}

.message-avatar {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  background: var(--bg-card);
  border: 1px solid var(--glass-border);
  color: var(--text-primary);
}

.role-assistant .message-avatar {
  background: var(--glass-reflection);
  border-color: var(--glass-border);
  color: var(--accent-cyan);
}

.role-user .message-avatar {
  background: var(--text-primary);
  color: var(--bg-base);
}

.pending-avatar {
  animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: .5; }
}

.message-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.message-header {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 2px;
}

.message-content {
  line-height: 1.7;
  font-size: 14px;
  color: var(--text-primary);
}

.message-content :deep(p) {
  margin: 0 0 16px;
}

.message-content :deep(p):last-child {
  margin-bottom: 0;
}

.message-content :deep(ul),
.message-content :deep(ol) {
  margin: 0 0 16px;
  padding-left: 24px;
}

.message-content :deep(li) {
  margin-bottom: 6px;
}

.message-content :deep(code) {
  background: var(--glass-reflection);
  padding: 3px 6px;
  border-radius: 4px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 0.85em;
  color: var(--accent-cyan);
}

.message-content :deep(pre) {
  background: var(--bg-sidebar);
  padding: 16px;
  border-radius: var(--radius-lg);
  overflow-x: auto;
  margin: 16px 0;
  border: 1px solid var(--glass-border);
}

.message-content :deep(pre code) {
  background: transparent;
  padding: 0;
  color: inherit;
}

.message-content :deep(h1),
.message-content :deep(h2),
.message-content :deep(h3) {
  margin: 24px 0 12px;
  color: var(--text-primary);
  font-weight: 600;
}

.message-content :deep(blockquote) {
  border-left: 4px solid var(--accent-cyan);
  margin: 16px 0;
  padding-left: 16px;
  color: var(--text-secondary);
  background: var(--glass-reflection);
  padding-top: 8px;
  padding-bottom: 8px;
  border-radius: 0 var(--radius-md) var(--radius-md) 0;
}

/* Details Panel (Reasoning & Chains) */
.message-details {
  background: var(--bg-card);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-lg);
  overflow: hidden;
  margin-bottom: 8px;
  transition: all 0.2s ease;
}

.message-details[open] {
  border-color: var(--text-muted);
}

.details-summary {
  padding: 12px 16px;
  cursor: pointer;
  list-style: none; /* Hide default arrow in modern browsers */
  user-select: none;
  font-size: 12px;
  color: var(--text-secondary);
}

.details-summary::-webkit-details-marker {
  display: none;
}

.summary-inner {
  display: flex;
  align-items: center;
  gap: 8px;
}

.details-content {
  padding: 16px;
  border-top: 1px solid var(--glass-border);
  font-size: 13px;
  color: var(--text-secondary);
  line-height: 1.6;
}

.chain-logs {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.chain-log {
  display: flex;
  gap: 12px;
}

.chain-log code {
  color: var(--text-muted);
  white-space: nowrap;
}

.log-tool { color: var(--accent-cyan); }
.log-system { color: var(--text-muted); font-style: italic; }

.approval-card {
  display: grid;
  gap: 12px;
  padding: 20px;
  border-radius: var(--radius-lg);
  border: 1px solid var(--glass-border);
  background: var(--bg-card);
  margin-top: 8px;
}

.approval-card h3 {
  font-size: 15px;
  font-weight: 600;
  margin: 0;
}

.approval-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 4px;
}

.message-form {
  margin-top: 16px;
  padding: 20px;
  border-radius: var(--radius-lg);
  border: 1px solid var(--glass-border);
  background: var(--bg-card);
}

.message-form-title { font-size: 15px; font-weight: 600; margin: 0 0 8px; }
.message-form-description { color: var(--text-secondary); font-size: 13px; margin: 0 0 16px; }

.message-form-fields { display: flex; flex-direction: column; gap: 16px; }
.message-form-field { display: flex; flex-direction: column; gap: 8px; font-size: 13px; }
.message-form-field input,
.message-form-field textarea,
.message-form-field select {
  width: 100%; padding: 12px; border: 1px solid var(--glass-border);
  border-radius: var(--radius-md); background: var(--bg-base);
  color: var(--text-primary); font-size: 14px;
}
.message-form-field input:focus,
.message-form-field textarea:focus { border-color: var(--text-secondary); outline: none; }
.form-submit-btn { margin-top: 16px; }

.composer-panel {
  padding: 24px;
  background: linear-gradient(transparent, var(--bg-base) 15%);
  position: sticky;
  bottom: 0;
}

.composer-container {
  max-width: 800px;
  margin: 0 auto;
  background: var(--bg-card);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-lg);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
  display: flex;
  flex-direction: column;
  transition: border-color 0.2s;
}

.composer-container:focus-within {
  border-color: var(--text-muted);
}

.composer-input {
  width: 100%;
  padding: 16px 16px 12px;
  background: transparent;
  border: none;
  color: var(--text-primary);
  font-size: 14px;
  line-height: 1.6;
  resize: none;
  outline: none;
  min-height: 60px;
}

.composer-input::placeholder {
  color: var(--text-muted);
}

.composer-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 16px 16px;
}

.composer-hints {
  font-size: 12px;
  color: var(--text-muted);
}

.submit-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  padding: 0;
  border-radius: 8px;
}

.primary, .secondary {
  padding: 8px 16px;
  border-radius: var(--radius-md);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  border: 1px solid var(--glass-border);
  transition: all 0.2s ease;
}

.primary {
  background: var(--text-primary);
  color: var(--bg-base);
  border-color: var(--text-primary);
}

.primary:hover:not(:disabled) {
  opacity: 0.9;
  transform: translateY(-1px);
}

.secondary {
  background: transparent;
  color: var(--text-primary);
}

.secondary:hover:not(:disabled) {
  background: var(--glass-reflection);
}

.primary:disabled, .secondary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  transform: none;
}

.pulse-dot {
  width: 8px; height: 8px; border-radius: 50%; background: var(--text-muted);
}
.pulse-dot.active {
  background: var(--accent-cyan);
  box-shadow: 0 0 8px var(--accent-cyan);
}

.typing-dots { display: inline-flex; gap: 6px; padding: 12px 0; }
.typing-dots span { width: 6px; height: 6px; border-radius: 50%; background: var(--text-muted); animation: typing-bounce 1.4s infinite ease-in-out; }
.typing-dots span:nth-child(1) { animation-delay: -0.32s; }
.typing-dots span:nth-child(2) { animation-delay: -0.16s; }
@keyframes typing-bounce { 0%, 80%, 100% { transform: scale(0); opacity: 0.3; } 40% { transform: scale(1); opacity: 1; } }

.error-banner {
  max-width: 800px; margin: 0 auto 24px; padding: 14px 16px;
  border-radius: var(--radius-md); background: rgba(239, 68, 68, 0.1);
  border: 1px solid rgba(239, 68, 68, 0.2); color: #fca5a5; font-size: 13px;
}

.approval-modal-backdrop {
  position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
  padding: 24px; background: rgba(15, 23, 42, 0.6); backdrop-filter: blur(8px); z-index: 20;
}
.approval-modal-card {
  width: min(560px, 100%); display: grid; gap: 16px; padding: 32px;
  border-radius: var(--radius-lg); border: 1px solid var(--glass-border);
  background: var(--bg-card); box-shadow: 0 24px 80px rgba(0, 0, 0, 0.4);
}
.approval-modal-card h2 { margin: 0; color: var(--text-primary); font-size: 20px; line-height: 1.3; }
.approval-modal-card p { margin: 0; color: var(--text-secondary); line-height: 1.6; }

@media (max-width: 960px) {
  .chat-shell {
    flex-direction: column;
  }
  .session-rail {
    width: 100%;
    height: 300px;
    border-right: none;
    border-bottom: 1px solid var(--glass-border);
  }
}
</style>`;
  fs.writeFileSync(filePath, baseContent + newStyle, 'utf-8');
  console.log('Successfully updated styles in ChatView.vue');
} else {
  console.log('Error: <style scoped> tag not found.');
}
