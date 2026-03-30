const fs = require('fs');

const filePath = 'f:\\MyClaw\\desktop\\apps\\desktop\\src\\views\\ChatView.vue';
let content = fs.readFileSync(filePath, 'utf-8');

// 1. Replace the refs
const refsTarget = `const timelinePanelRef = ref<HTMLElement | null>(null);`;
const refsReplacement = `const timelinePanelRef = ref<HTMLElement | null>(null);
const submittedFormIds = ref<string[]>([]);
const formErrors = ref<Record<string, string>>({});`;
content = content.replace(refsTarget, refsReplacement);

// 2. Replace submitA2UiForm function
const submitA2UiFormTarget = `async function submitA2UiForm(message: ChatMessage) {
  if (message.ui?.kind !== "form") {
    return;
  }

  const missingField = findMissingRequiredField(message.id, message.ui);
  if (missingField) {
    sendError.value = \`请填写 \${missingField.label}\`;
    return;
  }

  const payload = createFormSubmissionPayload(message.id, message.ui);
  const sent = await sendMessageToRuntime(payload);

  if (sent) {
    const { [message.id]: _removed, ...rest } = formDrafts.value;
    formDrafts.value = rest;
  }
}`;

const submitA2UiFormReplacement = `async function submitA2UiForm(message: ChatMessage) {
  if (message.ui?.kind !== "form") {
    return;
  }

  const missingField = findMissingRequiredField(message.id, message.ui);
  if (missingField) {
    formErrors.value[message.id] = \`必填项不能为空：\${missingField.label}\`;
    return;
  }
  
  formErrors.value[message.id] = "";

  const payload = createFormSubmissionPayload(message.id, message.ui);
  const sent = await sendMessageToRuntime(payload);

  if (sent) {
    submittedFormIds.value.push(message.id);
    const { [message.id]: _removed, ...rest } = formDrafts.value;
    formDrafts.value = rest;
  }
}`;
content = content.replace(submitA2UiFormTarget, submitA2UiFormReplacement);

// 3. Replace HTML Template
const tplStart = `<article\n                  v-if="message.ui?.kind === 'form'"`
const tplEnd = `</article>`;
// Finding the specific article for A2UI Form
const tplStartIndex = content.indexOf(tplStart);
if (tplStartIndex !== -1) {
  const tplEndIndex = content.indexOf(tplEnd, tplStartIndex) + tplEnd.length;
  
  const newTpl = `<article
                  v-if="message.ui?.kind === 'form'"
                  :data-testid="\`ui-form-\${message.id}\`"
                  :class="['message-form', { 'form-submitted': submittedFormIds.includes(message.id) }]"
                >
                  <div class="message-form-header">
                     <svg class="form-icon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
                     <div class="form-title-group">
                       <h3 class="message-form-title">{{ message.ui.title }}</h3>
                       <p v-if="message.ui.description" class="message-form-description">{{ message.ui.description }}</p>
                     </div>
                  </div>

                  <fieldset :disabled="submittedFormIds.includes(message.id) || sending" class="message-form-fieldset">
                    <div class="message-form-fields">
                      <label
                        v-for="field in message.ui.fields"
                        :key="\`\${message.id}-\${field.name}\`"
                        class="message-form-field"
                      >
                        <span>
                          {{ field.label }}
                          <em v-if="field.required" class="required-mark">*</em>
                        </span>

                        <select
                          v-if="field.input === 'select'"
                          :data-testid="\`ui-field-\${message.id}-\${field.name}\`"
                          :value="readFormFieldValue(message.id, field.name)"
                          @change="handleSelectFieldChange(message.id, field.name, $event)"
                        >
                          <option value="">请选择</option>
                          <option
                            v-for="option in field.options ?? []"
                            :key="\`\${message.id}-\${field.name}-\${option.value}\`"
                            :value="option.value"
                          >
                            {{ option.label }}
                          </option>
                        </select>

                        <textarea
                          v-else-if="field.input === 'textarea'"
                          :data-testid="\`ui-field-\${message.id}-\${field.name}\`"
                          :placeholder="field.placeholder ?? ''"
                          :value="readFormFieldValue(message.id, field.name)"
                          rows="3"
                          @input="handleTextFieldInput(message.id, field.name, $event)"
                        />

                        <input
                          v-else
                          :data-testid="\`ui-field-\${message.id}-\${field.name}\`"
                          :placeholder="field.placeholder ?? ''"
                          :value="readFormFieldValue(message.id, field.name)"
                          @input="handleTextFieldInput(message.id, field.name, $event)"
                        />
                      </label>
                    </div>

                    <div v-if="formErrors[message.id]" class="form-inline-error">
                      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                      {{ formErrors[message.id] }}
                    </div>

                    <div class="message-form-footer">
                      <button
                        v-if="!submittedFormIds.includes(message.id)"
                        :data-testid="\`ui-submit-\${message.id}\`"
                        class="primary form-submit-btn"
                        @click="submitA2UiForm(message)"
                      >
                        {{ sending ? '提交中...' : (message.ui.submitLabel ?? "提交表单") }}
                      </button>
                      <div v-else class="form-success-badge">
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6L9 17l-5-5"/></svg>
                        已提交
                      </div>
                    </div>
                  </fieldset>
                </article>`;
  
  content = content.substring(0, tplStartIndex) + newTpl + content.substring(tplEndIndex);
}

// 4. Replace CSS
const cssTarget = `.message-form {
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
.form-submit-btn { margin-top: 16px; }`;

const cssReplacement = `.message-form {
  margin-top: 16px;
  background: var(--bg-card);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-lg);
  overflow: hidden;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.15);
  transition: all 0.3s ease;
}

.message-form-header {
  padding: 16px 20px;
  border-bottom: 1px solid var(--glass-border);
  background: rgba(255, 255, 255, 0.03);
  display: flex;
  align-items: flex-start;
  gap: 12px;
}

.form-icon {
  color: var(--accent-cyan);
  margin-top: 2px;
  flex-shrink: 0;
}

.form-title-group {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.message-form-title { font-size: 15px; font-weight: 600; margin: 0; color: var(--text-primary); }
.message-form-description { color: var(--text-secondary); font-size: 13px; margin: 0; line-height: 1.5; }

.message-form-fieldset {
  padding: 20px;
  border: none;
  margin: 0;
  transition: opacity 0.3s ease;
}

.message-form-fieldset:disabled {
  opacity: 0.6;
}

.message-form-fields { display: flex; flex-direction: column; gap: 16px; }
.message-form-field { display: flex; flex-direction: column; gap: 8px; font-size: 13px; }
.message-form-field input,
.message-form-field textarea,
.message-form-field select {
  width: 100%; padding: 12px; border: 1px solid var(--glass-border);
  border-radius: var(--radius-md); background: var(--bg-base);
  color: var(--text-primary); font-size: 14px;
  transition: all 0.2s ease;
}
.message-form-field input:focus,
.message-form-field textarea:focus,
.message-form-field select:focus {
  border-color: var(--accent-cyan);
  box-shadow: 0 0 0 2px rgba(45, 212, 191, 0.15);
  outline: none;
}

.form-inline-error {
  margin-top: 16px;
  display: flex;
  align-items: center;
  gap: 8px;
  color: #ef4444;
  font-size: 13px;
  background: rgba(239, 68, 68, 0.1);
  padding: 10px 14px;
  border-radius: var(--radius-md);
  border: 1px solid rgba(239, 68, 68, 0.2);
}

.message-form-footer {
  margin-top: 24px;
  display: flex;
  justify-content: flex-end;
}

.form-submit-btn {
  width: 100%;
  display: flex;
  justify-content: center;
  align-items: center;
  padding: 12px 16px;
}

.form-success-badge {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  width: 100%;
  padding: 12px 16px;
  background: rgba(16, 185, 129, 0.1);
  color: #10b981;
  border-radius: var(--radius-md);
  border: 1px solid rgba(16, 185, 129, 0.2);
  font-size: 14px;
  font-weight: 500;
}`;

content = content.replace(cssTarget, cssReplacement);

fs.writeFileSync(filePath, content, 'utf-8');
console.log('Complete rewrite_a2ui');
