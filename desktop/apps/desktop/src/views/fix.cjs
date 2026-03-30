const fs = require('fs');
const filePath = 'f:\\MyClaw\\desktop\\apps\\desktop\\src\\views\\ChatView.vue';
let content = fs.readFileSync(filePath, 'utf-8');

const missingContents = `}

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
</style>
`;
fs.writeFileSync(filePath, content + missingContents, 'utf-8');
console.log('Fixed missing css');
