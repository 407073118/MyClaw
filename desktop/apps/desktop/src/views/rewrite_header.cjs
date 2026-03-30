const fs = require('fs');

const filePath = 'f:\\MyClaw\\desktop\\apps\\desktop\\src\\views\\ChatView.vue';
let content = fs.readFileSync(filePath, 'utf-8');

// 1. Replace the aside and header (Template)
const startTemplateIndex = content.indexOf('<aside class="session-rail">');
const endTemplateIndex = content.indexOf('<section class="timeline-panel"');

if (startTemplateIndex !== -1 && endTemplateIndex !== -1) {
  const newHeader = `<section class="chat-main">
      <header class="chat-title-header">
        <div class="header-left">
          <div class="session-dropdown-container">
            <button class="session-dropdown-trigger" aria-haspopup="listbox">
              <h1 class="header-title">{{ session?.title ?? "暂无会话" }}</h1>
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M6 9l6 6 6-6"/></svg>
            </button>

            <div class="session-dropdown-menu">
              <div class="dropdown-header">历史记录</div>
              <ul data-testid="session-list" class="session-list session-list-dropdown">
                <li v-for="item in workspace.sessions" :key="item.id">
                  <div :class="['session-row', { active: item.id === session?.id }]">
                    <button
                      :data-testid="\`session-item-\${item.id}\`"
                      :class="['session-item', { active: item.id === session?.id }]"
                      @click="workspace.selectSession(item.id)"
                    >
                      <div class="session-info">
                        <strong>{{ item.title }}</strong>
                        <span>{{ previewMessage(item) }}</span>
                      </div>
                    </button>
                    <button
                      :data-testid="\`session-delete-\${item.id}\`"
                      class="session-delete"
                      :disabled="isDeletingSession(item.id)"
                      @click="handleDeleteSession(item.id)"
                      title="删除会话"
                    >
                      <template v-if="isDeletingSession(item.id)">
                        <span class="loading-dots">...</span>
                      </template>
                      <svg v-else viewBox="0 0 24 24" width="14" height="14">
                        <path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>
                      </svg>
                    </button>
                  </div>
                </li>
              </ul>
            </div>
          </div>
        </div>

        <div class="header-right">
          <button
            data-testid="new-chat-button"
            class="primary new-chat-btn"
            :disabled="creatingSession"
            @click="createSession"
            title="新建对话"
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4"/></svg>
            <span>新对话</span>
          </button>
        </div>
      </header>

      `;
  content = content.substring(0, startTemplateIndex) + newHeader + content.substring(endTemplateIndex);
} else {
  console.log("Template part not found.");
}


// 2. Replace CSS for rail, session list, and media query
const cssStartIndex = content.indexOf('.session-rail {');
const cssEndIndex = content.indexOf('.timeline-panel {');
if (cssStartIndex !== -1 && cssEndIndex !== -1) {
  const newCss = `.chat-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  background: var(--bg-base);
  min-width: 0;
  position: relative;
}

.chat-title-header {
  padding: 20px 32px;
  border-bottom: 1px solid var(--glass-border);
  background: var(--bg-base);
  z-index: 30; /* Higher z-index for dropdown */
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.header-left {
  display: flex;
  align-items: center;
}

.session-dropdown-container {
  position: relative;
}

.session-dropdown-trigger {
  display: flex;
  align-items: center;
  gap: 8px;
  background: transparent;
  border: none;
  cursor: pointer;
  padding: 8px 12px;
  margin-left: -12px;
  border-radius: var(--radius-md);
  color: var(--text-primary);
  transition: background 0.2s;
}

.session-dropdown-trigger:hover,
.session-dropdown-container:focus-within .session-dropdown-trigger {
  background: var(--glass-reflection);
}

.header-title {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 300px;
}

.session-dropdown-menu {
  position: absolute;
  top: calc(100% + 8px);
  left: -12px;
  width: 320px;
  background: var(--bg-card);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-lg);
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.4);
  opacity: 0;
  visibility: hidden;
  transform: translateY(-8px);
  transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
  display: flex;
  flex-direction: column;
  max-height: 60vh;
}

.session-dropdown-container:hover .session-dropdown-menu,
.session-dropdown-container:focus-within .session-dropdown-menu {
  opacity: 1;
  visibility: visible;
  transform: translateY(0);
}

.dropdown-header {
  padding: 16px;
  border-bottom: 1px solid var(--glass-border);
  font-size: 12px;
  font-weight: 600;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.new-chat-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
}

.session-list-dropdown {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
  margin: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.session-item {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 0;
  padding: 12px;
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
  background: var(--glass-reflection);
  border-color: var(--glass-border);
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
  width: 32px;
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

`;
  content = content.substring(0, cssStartIndex) + newCss + content.substring(cssEndIndex);
} else {
  console.log("CSS part not found.");
}

const mediaQueryIndex = content.indexOf('@media (max-width: 960px) {');
if (mediaQueryIndex !== -1) {
  content = content.substring(0, mediaQueryIndex);
}

fs.writeFileSync(filePath, content, 'utf-8');
console.log('Complete');
