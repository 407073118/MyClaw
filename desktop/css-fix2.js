const fs = require('fs');
let content = fs.readFileSync('src/renderer/pages/SiliconPersonWorkspacePage.tsx', 'utf8');

const regex = /\/\* ── Profile ── \*\/[\s\S]*?\/\* ── Shared ── \*\//;

const replacement = `/* ── Profile ── */
        .ws-profile-col { max-width: 900px; margin: 0 auto; width: 100%; }
        .ws-profile-grid { display: grid; grid-template-columns: 1fr; gap: 24px; }

        /* ── Form Card ── */
        .ws-form-card { display: flex; flex-direction: column; gap: 18px; }
        .ws-form-fields { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
        .ws-field { display: flex; flex-direction: column; gap: 8px; }
        .ws-field span { font-size: 0.8rem; font-weight: 700; color: var(--text-muted); }
        .ws-field--full { grid-column: 1 / -1; }
        .ws-field input, .ws-field textarea, .ws-field select { width: 100%; border: 1px solid var(--glass-border); border-radius: 8px; background: rgba(0,0,0,0.15); color: var(--text-primary); padding: 10px 14px; font: inherit; font-size: 13px; transition: all 0.25s cubic-bezier(0.2, 0.8, 0.2, 1); box-sizing: border-box; }
        .ws-field input:hover, .ws-field textarea:hover, .ws-field select:hover { border-color: rgba(255,255,255,0.12); background: rgba(0,0,0,0.25); }
        .ws-field input:focus, .ws-field textarea:focus, .ws-field select:focus { border-color: var(--accent-cyan); box-shadow: 0 0 0 3px rgba(16,163,127,0.15), inset 0 1px 2px rgba(0,0,0,0.2); outline: none; background: rgba(0,0,0,0.3); }
        .ws-field select { appearance: none; -webkit-appearance: none; padding-right: 36px; cursor: pointer; background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23888' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E"); background-repeat: no-repeat; background-position: right 14px center; background-size: 12px; }
        .ws-field select option { background: var(--bg-card); color: var(--text-primary); padding: 8px 12px; }
        .ws-path-display { width: 100%; padding: 10px 14px; border: 1px dashed var(--glass-border); border-radius: 8px; background: rgba(0,0,0,0.1); color: var(--text-muted); font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 0.78rem; line-height: 1.5; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; user-select: all; cursor: text; box-sizing: border-box; }
        
        /* ── Readonly Stats ── */
        .ws-readonly-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 16px; margin-top: 14px; }
        .ws-stat-cell { padding: 14px 16px; border-radius: 10px; border: 1px solid var(--glass-border); background: linear-gradient(145deg, rgba(255,255,255,0.03), transparent); display: flex; flex-direction: column; gap: 6px; }
        .ws-stat-label { font-size: 0.68rem; font-weight: 700; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em; }
        .ws-stat-value { font-size: 0.85rem; font-weight: 600; color: #e6edf3; word-break: break-all; }
        .ws-mono { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 0.78rem; }
        .ws-text-muted { color: var(--text-muted); }

        /* ── Capabilities ── */
        .ws-cap-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 20px; }
        .ws-bind-row { display: flex; gap: 8px; align-items: center; }
        .ws-bind-select { padding: 8px 14px; padding-right: 36px; border: 1px solid var(--glass-border); border-radius: 8px; background: var(--bg-base); color: var(--text-primary); font: inherit; font-size: 0.82rem; appearance: none; -webkit-appearance: none; cursor: pointer; background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23888' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E"); background-repeat: no-repeat; background-position: right 14px center; background-size: 12px; transition: border-color 0.2s, box-shadow 0.2s; }
        .ws-bind-select:hover { border-color: var(--glass-border-hover); background: rgba(255,255,255,0.02); }
        .ws-bind-select:focus { border-color: var(--accent-cyan); box-shadow: 0 0 0 3px rgba(16,163,127,0.14); outline: none; }
        .ws-bind-select option { background: var(--bg-card); color: var(--text-primary); }
        .ws-wf-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 16px; }
        .ws-wf-card { padding: 18px; border: 1px solid var(--glass-border); border-radius: var(--radius-xl); background: linear-gradient(145deg, var(--bg-base), rgba(0,0,0,0.2)); display: flex; align-items: center; justify-content: space-between; gap: 16px; transition: all 0.3s cubic-bezier(0.2, 0.8, 0.2, 1); box-shadow: 0 4px 12px rgba(0,0,0,0.1); }
        .ws-wf-card:hover { border-color: var(--glass-border-hover); transform: translateY(-2px); box-shadow: 0 8px 24px rgba(0,0,0,0.2); }
        .ws-wf-card-info { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
        .ws-wf-card-info strong { font-size: 0.9rem; font-weight: 600; color: #e6edf3; }
        .ws-wf-card-info span { font-size: 0.72rem; color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

        /* ── Binding Grid (Skills / MCP) ── */
        .ws-binding-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 16px; margin-top: 16px; }
        .ws-binding-card { display: flex; align-items: center; gap: 12px; padding: 16px 20px; border: 1px solid var(--glass-border); border-radius: var(--radius-xl); background: linear-gradient(145deg, var(--bg-base), rgba(0,0,0,0.2)); cursor: default; transition: all 0.3s cubic-bezier(0.2, 0.8, 0.2, 1); box-shadow: 0 4px 12px rgba(0,0,0,0.1); }
        .ws-binding-card:hover { border-color: rgba(255,255,255,0.15); transform: translateY(-2px); box-shadow: 0 8px 24px rgba(0,0,0,0.2); }
        .ws-binding-card.bound { border-color: rgba(16,163,127,0.3); background: linear-gradient(145deg, rgba(16,163,127,0.08), rgba(16,163,127,0.02)); box-shadow: 0 0 0 1px rgba(16,163,127,0.1), 0 4px 12px rgba(0,0,0,0.1); }
        .ws-binding-card.bound:hover { border-color: rgba(16,163,127,0.5); box-shadow: 0 0 0 1px rgba(16,163,127,0.2), 0 8px 24px rgba(0,0,0,0.2); }
        .ws-binding-card input[type="checkbox"] { accent-color: var(--accent-cyan); flex-shrink: 0; width: 16px; height: 16px; }
        .ws-binding-card-info { display: flex; flex-direction: column; gap: 4px; min-width: 0; flex: 1; }
        .ws-binding-card-info strong { font-size: 0.9rem; font-weight: 600; color: #e6edf3; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .ws-binding-card-info span { font-size: 0.72rem; color: #8b949e; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .ws-binding-card::before { content: ''; display: block; width: 4px; height: 100%; background: var(--accent-cyan); position: absolute; left: 0; top: 0; border-radius: 4px 0 0 4px; opacity: 0; transition: opacity 0.2s; }
        .ws-binding-card.bound::before { opacity: 1; }
        .ws-binding-card { position: relative; overflow: hidden; }

        /* ── Shared ── */`;

if (regex.test(content)) {
  content = content.replace(regex, replacement);
  fs.writeFileSync('src/renderer/pages/SiliconPersonWorkspacePage.tsx', content);
  console.log("CSS replaced!");
} else {
  console.log("Regex not found!");
}
