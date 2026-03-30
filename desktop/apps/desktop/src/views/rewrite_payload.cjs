const fs = require('fs');

const filePath = 'f:\\MyClaw\\desktop\\apps\\desktop\\src\\views\\ChatView.vue';
let content = fs.readFileSync(filePath, 'utf-8');

// 1. Update parsedMessages computed

const parsedMessagesTarget = `const parsedMessages = computed(() => {
  const s = session.value;
  if (!s) return [];
  
  return s.messages.map((msg) => {
    if (!msg || typeof msg.content !== "string") return msg;

    const a2uiMatch = msg.content.match(/\`\`\`a2ui\\s*([\\s\\S]*?)\\s*\`\`\`/);`;

const parsedMessagesReplacement = `const parsedMessages = computed(() => {
  const s = session.value;
  if (!s) return [];
  
  return s.messages.map((msg) => {
    if (!msg || typeof msg.content !== "string") return msg;

    const a2uiSubmitMatch = msg.content.match(/^\\[A2UI_FORM:([a-zA-Z0-9_-]+)\\]\\s*(.*)$/);
    if (a2uiSubmitMatch && msg.role === "user") {
       return {
         ...msg,
         content: "",
         uiSubmitResult: {
           id: a2uiSubmitMatch[1],
           pairs: a2uiSubmitMatch[2]
         }
       };
    }

    const a2uiMatch = msg.content.match(/\`\`\`a2ui\\s*([\\s\\S]*?)\\s*\`\`\`/);`;

content = content.replace(parsedMessagesTarget, parsedMessagesReplacement);

// 2. Update the HTML template
const htmlTarget = `<div class="message-content" v-html="renderMarkdown(message.content)"></div>`;

const htmlReplacement = `<div v-if="message.content" class="message-content" v-html="renderMarkdown(message.content)"></div>
                
                <article v-if="message.uiSubmitResult" class="form-submission-summary">
                  <div class="summary-header">
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><path d="M22 4L12 14.01l-3-3"/></svg>
                    <span>已提交表单</span>
                  </div>
                  <div class="summary-body">
                    <div v-for="(pair, idx) in message.uiSubmitResult.pairs.split('; ')" :key="idx" class="summary-pair">
                      <span class="pair-key">{{ pair.split('=')[0] }}:</span>
                      <span class="pair-val">{{ pair.split('=')[1] }}</span>
                    </div>
                  </div>
                </article>`;

content = content.replace(htmlTarget, htmlReplacement);

// 3. Append CSS at the end
const cssAddition = `
.form-submission-summary {
  background: var(--bg-card);
  border: 1px solid rgba(16, 185, 129, 0.2);
  border-radius: var(--radius-lg);
  overflow: hidden;
  max-width: 90%;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);
  margin-top: 4px;
}

.role-user .form-submission-summary {
  border-radius: var(--radius-lg) var(--radius-lg) 4px var(--radius-lg);
  border-color: rgba(16, 185, 129, 0.3);
}

.summary-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 16px;
  background: rgba(16, 185, 129, 0.1);
  color: #10b981;
  font-size: 13px;
  font-weight: 600;
  border-bottom: 1px solid rgba(16, 185, 129, 0.1);
}

.summary-body {
  padding: 12px 16px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.summary-pair {
  display: flex;
  font-size: 13px;
  line-height: 1.5;
}

.pair-key {
  color: var(--text-secondary);
  width: 90px;
  flex-shrink: 0;
}

.pair-val {
  color: var(--text-primary);
  font-weight: 500;
  word-break: break-all;
}
</style>
`;

content = content.replace('</style>', cssAddition);

fs.writeFileSync(filePath, content, 'utf-8');
console.log('Completed form submitted replacement');
