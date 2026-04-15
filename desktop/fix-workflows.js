const fs = require('fs');
let content = fs.readFileSync('src/renderer/pages/WorkflowsPage.tsx', 'utf8');

// Replace main tag
content = content.replace(
  '<main data-testid="workflows-view" className="page-container">',
  '<main data-testid="workflows-view" className="page-container" style={{ height: "100%", overflowY: "auto" }}>'
);

// Remove duplicate CSS block
const cssToRemove = `        .page-container {
          height: 100%;
          overflow-y: auto;
        }

        .page-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 20px;
          margin-bottom: 28px;
        }

        .header-text { min-width: 0; }

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

        .header-actions { flex-shrink: 0; }
`;

content = content.replace(cssToRemove, '');
fs.writeFileSync('src/renderer/pages/WorkflowsPage.tsx', content);
console.log("WorkflowsPage updated.");
