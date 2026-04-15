const fs = require('fs');
let content = fs.readFileSync('src/renderer/pages/SettingsPage.tsx', 'utf8');

const regex = /\.model-cards-container \{ display: grid; grid-template-columns: minmax\(0, 1fr\); gap: 18px; margin: 0 auto 32px; padding: 0 32px; max-width: 1040px; \}[\s\S]*?\.model-card\.is-active \.primary-ghost\.disabled \{ color: var\(--status-green\); font-weight: 700; border-color: transparent; cursor: default; \}/;

const replacement = `.model-cards-container { display: grid; grid-template-columns: repeat(auto-fill, minmax(360px, 1fr)); gap: 24px; margin: 0 auto 32px; padding: 0 32px; max-width: 1040px; }
        .model-card { background: linear-gradient(145deg, var(--bg-card), rgba(0,0,0,0.3)); border: 1px solid var(--glass-border); border-radius: var(--radius-xl); display: flex; flex-direction: column; transition: all 0.3s cubic-bezier(0.25, 0.8, 0.25, 1); backdrop-filter: var(--blur-std); -webkit-backdrop-filter: var(--blur-std); overflow: hidden; position: relative; }
        .model-card:hover { border-color: var(--glass-border-hover); transform: translateY(-4px); box-shadow: 0 12px 24px -10px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.1); background: linear-gradient(145deg, var(--bg-card), rgba(0,0,0,0.1)); }
        .model-card.is-active { border-color: var(--status-green); background: linear-gradient(145deg, rgba(46,160,67,0.06), rgba(46,160,67,0.01)); box-shadow: 0 0 0 1px rgba(46,160,67,0.3), inset 0 1px 0 rgba(255,255,255,0.05); }
        .model-card::before { content: ''; position: absolute; top: 0; left: 0; right: 0; height: 1px; background: linear-gradient(90deg, transparent, rgba(255,255,255,0.15), transparent); opacity: 0; transition: opacity 0.3s; }
        .model-card:hover::before { opacity: 1; }
        .card-status-bar { padding: 16px 20px; display: flex; justify-content: space-between; align-items: center; gap: 12px; border-bottom: 1px solid rgba(255,255,255,0.04); flex-wrap: wrap; background: rgba(0,0,0,0.15); }
        .status-badge { display: inline-flex; align-items: center; gap: 8px; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; }
        .status-badge.active { color: #3fb950; text-shadow: 0 0 10px rgba(63,185,80,0.3); }
        .status-badge.inactive { color: var(--text-muted); }
        .dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; box-shadow: 0 0 8px currentColor; }
        .card-actions-mini { display: flex; gap: 6px; }
        .icon-btn { width: 32px; height: 32px; border-radius: 8px; border: 1px solid transparent; background: transparent; color: var(--text-muted); display: flex; align-items: center; justify-content: center; cursor: pointer; transition: all 0.2s; }
        .icon-btn:hover { background: rgba(255,255,255,0.08); color: var(--text-primary); border-color: rgba(255,255,255,0.1); }
        .card-body { padding: 24px 20px; flex: 1; display: flex; flex-direction: column; }
        .model-info { display: flex; flex-direction: column; gap: 16px; }
        .model-name-block { display: flex; flex-direction: column; gap: 12px; margin-bottom: 4px; }
        .model-name-title-row { display: flex; align-items: center; gap: 8px; min-width: 0; }
        .model-name-tags-row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
        .provider-tag, .route-tag, .route-source-tag, .capability-source-tag { font-size: 10px; font-weight: 700; padding: 4px 10px; border-radius: 6px; text-transform: uppercase; letter-spacing: 0.05em; line-height: 1; border: 1px solid transparent; display: inline-block; }
        .provider-tag { background: rgba(255,255,255,0.06); border-color: rgba(255,255,255,0.1); color: var(--text-secondary); }
        .route-tag { background: rgba(16,163,127,0.1); border-color: rgba(16,163,127,0.2); color: #34d399; }
        .route-source-tag { background: rgba(245,158,11,0.1); border-color: rgba(245,158,11,0.2); color: #fbbf24; }
        .capability-source-tag { background: rgba(59,130,246,0.1); border-color: rgba(96,165,250,0.2); color: #93c5fd; }
        .model-info strong { font-size: 18px; line-height: 1.3; color: #e6edf3; font-weight: 600; letter-spacing: -0.01em; }
        .model-metrics-grid { display: flex; flex-direction: column; gap: 8px; }
        .model-info p.model-metric { font-size: 12px; margin: 0; display: flex; flex-direction: column; gap: 4px; color: #8b949e; background: rgba(0,0,0,0.2); padding: 10px 12px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.03); }
        .model-info p.model-metric span { color: #7d8590; font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em; font-weight: 700; width: auto; }
        .model-info p.model-metric strong.metric-value { font-size: 13px; font-weight: 500; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; color: #c9d1d9; word-break: break-all; }
        .connectivity-info { margin-top: 16px; padding-top: 16px; border-top: 1px dashed rgba(255,255,255,0.1); font-size: 12px; display: flex; align-items: center; gap: 8px; }
        .status-text { display: flex; align-items: center; gap: 6px; font-weight: 500; color: var(--text-secondary); }
        .status-text::before { content: ''; width: 6px; height: 6px; border-radius: 50%; background: var(--text-muted); }
        .status-text.ok { color: #3fb950; }
        .status-text.ok::before { background: #3fb950; box-shadow: 0 0 8px rgba(63,185,80,0.4); }
        .card-footer-actions { padding: 16px 20px; background: rgba(0,0,0,0.2); border-top: 1px solid rgba(255,255,255,0.04); margin-top: auto; }
        .primary-ghost { background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.1); color: #c9d1d9; width: 100%; padding: 10px; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer; transition: all 0.2s; letter-spacing: 0.02em; }
        .primary-ghost:hover:not(.disabled) { background: rgba(63,185,80,0.1); color: #3fb950; border-color: rgba(63,185,80,0.3); box-shadow: 0 0 12px rgba(63,185,80,0.15); }
        .model-card.is-active .primary-ghost.disabled { background: transparent; color: #3fb950; font-weight: 600; border-color: transparent; cursor: default; }`;

if (regex.test(content)) {
  content = content.replace(regex, replacement);
  fs.writeFileSync('src/renderer/pages/SettingsPage.tsx', content);
  console.log("CSS substituted!");
} else {
  console.log("CSS Regex not found!");
}
