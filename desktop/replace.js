const fs = require('fs');
let content = fs.readFileSync('src/renderer/pages/SettingsPage.tsx', 'utf8');

const regex = /<p className="model-id"><span>ID:<\/span> \{profile\.model\}<\/p>[\s\S]*?<span>Thinking:<\/span> \{readBrMiniMaxRuntimeDiagnostics\(profile\)\.thinkingPath\}[\s\S]*?<\/p>[\s\S]*?\)}/;

const replacement = `<div className="model-metrics-grid">
                      <p className="model-metric"><span>Model ID</span> <strong className="metric-value">{profile.model || "--"}</strong></p>
                      <p className="model-metric"><span>Base URL</span> <strong className="metric-value">{profile.baseUrl || "--"}</strong></p>
                      {profile.providerFlavor === "br-minimax" && (
                        <p className="model-metric">
                          <span>Thinking</span> <strong className="metric-value">{readBrMiniMaxRuntimeDiagnostics(profile).thinkingPath || "--"}</strong>
                        </p>
                      )}
                    </div>`;

if (regex.test(content)) {
  content = content.replace(regex, replacement);
  fs.writeFileSync('src/renderer/pages/SettingsPage.tsx', content);
  console.log("Replaced using Regex!");
} else {
  console.log("Regex not found!");
}
