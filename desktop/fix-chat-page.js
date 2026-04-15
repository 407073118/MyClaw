const fs = require('fs');
const path = 'src/renderer/pages/ChatPage.tsx';
let content = fs.readFileSync(path, 'utf8');

// 1. Fix the corrupted dispatchTraces and mention-target-indicator area
const corruptedStart = '{/* @ 投递痕迹卡片 */}\n        {dispatchTraces.length > 0 && (\n                <span className="mention-target-name">';
// Since I don't know the exact whitespace/chars the tool might have messed up with, I'll use a regex for the corrupted part.

const corruptedRegex = /\{\/\* @ 鎶掗€掔棔杩瑰崱鐗? \*\/\}\s*\{dispatchTraces\.length > 0 && \(\s*<span className="mention-target-name">@\{targetSiliconPerson\.name\}<\/span>\s*<button\s*type="button"\s*className="mention-target-clear"\s*onClick=\{\(\) => setTargetSiliconPersonId\(null\)\}\s*title="鍙栨秷鎶掗€?">\s*&times;\s*<\/button>\s*<\/div>\s*\}\)/;

// Wait, the file has Chinese characters which might look garbled in my script if I'm not careful.
// I'll use string matching based on the line contents I viewed.

const lines = content.split('\n');
// Find the line with "鎶掗€掔棔杩瑰崱鐗?"
let startIndex = -1;
for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('{/* @ \u6295\u9012\u75d5\u8ff9\u5361\u7247 */')) {
        startIndex = i;
        break;
    }
}

if (startIndex !== -1) {
    // Reconstruct the intended code from startIndex to where mention-target-indicator was supposed to be.
    // The previous state had the footer starting after dispatchTraces.
    // I specify the correct block for both.
    
    const correctBlock = `        {/* @ 投递痕迹卡片 */}
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
        )}

        {/* 输入区 */}
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
            )}`;
            
    // Replace lines from startIndex to the line before mentionMenuOpen
    let endIndex = -1;
    for (let i = startIndex; i < lines.length; i++) {
        if (lines[i].includes('mentionMenuOpen')) {
            endIndex = i;
            break;
        }
    }
    
    if (endIndex !== -1) {
        lines.splice(startIndex, endIndex - startIndex, correctBlock);
    }
}

content = lines.join('\n');

// 2. Remove the hints and chips in the composer toolbar
content = content.replace(/\{!composerDraft \? \([\s\S]*?className="composer-hints">可用命令: \/skill, \/cmd, \/read, \/mcp<\/span>[\s\S]*?\) : \([\s\S]*?className="composer-hints"><\/span>[\s\S]*?\)\}/, '');
content = content.replace(/\{runtimeModelStatusItems\.length > 0 && \([\s\S]*?data-testid="chat-runtime-model-status"[\s\S]*?<\/div>[\s\S]*?\)\}/, '');

fs.writeFileSync(path, content);
console.log('ChatPage fixed successfully.');
