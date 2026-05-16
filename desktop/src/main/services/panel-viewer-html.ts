/** 构建右侧文件查看器的独立 HTML 应用。 */
export function buildPanelViewerHtml(): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'self' myclaw-file: myclaw-vendor: blob:; img-src 'self' myclaw-file: data:; media-src 'self' myclaw-file:; font-src 'self' myclaw-vendor: data:; worker-src 'self' myclaw-vendor: blob:; style-src 'unsafe-inline' myclaw-vendor:; script-src 'unsafe-inline' myclaw-vendor:;">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>MyClaw Viewer</title>
  <style>
    :root { color-scheme: dark; --bg: #0c0c0d; --panel: #121316; --line: rgba(255,255,255,.1); --muted: #a1a1aa; --text: #f4f4f5; --soft: #d4d4d8; --accent: #67e8f9; }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; background: var(--bg); color: var(--text); font-family: "Microsoft YaHei UI", "Segoe UI", system-ui, sans-serif; }
    .viewer { min-height: 100vh; display: flex; flex-direction: column; }
    .meta { min-height: 42px; display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 8px 12px; border-bottom: 1px solid var(--line); background: rgba(255,255,255,.025); }
    .chips { display: flex; align-items: center; gap: 6px; min-width: 0; }
    .chip { height: 22px; display: inline-flex; align-items: center; padding: 0 8px; border: 1px solid var(--line); border-radius: 6px; color: var(--muted); background: rgba(255,255,255,.04); font-size: 11px; font-weight: 700; white-space: nowrap; }
    .actions { display: flex; gap: 6px; flex-shrink: 0; }
    button { height: 28px; display: inline-flex; align-items: center; justify-content: center; padding: 0 9px; border: 1px solid var(--line); border-radius: 6px; background: rgba(255,255,255,.035); color: var(--soft); font: inherit; font-size: 12px; font-weight: 650; cursor: pointer; }
    button:hover { background: rgba(255,255,255,.075); color: var(--text); }
    .path { flex-shrink: 0; padding: 8px 12px; border-bottom: 1px solid rgba(255,255,255,.06); color: var(--muted); font-family: "Cascadia Code", ui-monospace, monospace; font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .body { flex: 1; min-height: 0; overflow: auto; }
    .markdown { width: min(100%, 880px); margin: 0 auto; padding: 26px 30px 42px; line-height: 1.72; font-size: 14px; overflow-wrap: break-word; }
    .markdown h1 { font-size: 24px; margin: 0 0 18px; }
    .markdown h2 { font-size: 19px; margin: 28px 0 12px; }
    .markdown h3 { font-size: 16px; margin: 22px 0 10px; }
    .code { margin: 0; min-height: 100%; padding: 16px 18px 36px; font-family: "Cascadia Code", "Fira Code", ui-monospace, monospace; font-size: 12px; line-height: 1.65; color: var(--soft); white-space: pre-wrap; overflow-wrap: anywhere; }
    .monaco-lite { display: grid; grid-template-columns: auto minmax(0, 1fr); min-height: 100%; font-family: "Cascadia Code", ui-monospace, monospace; font-size: 12px; line-height: 1.65; }
    .lines { padding: 16px 10px 36px 14px; color: #71717a; text-align: right; border-right: 1px solid rgba(255,255,255,.06); user-select: none; }
    .codepane { margin: 0; padding: 16px 18px 36px; color: var(--soft); white-space: pre; overflow: auto; }
    .monaco-host { width: 100%; height: 100%; min-height: 520px; }
    .pdf-toolbar { position: sticky; top: 0; z-index: 2; display: flex; align-items: center; gap: 8px; height: 38px; padding: 0 12px; border-bottom: 1px solid var(--line); background: rgba(18,19,22,.96); color: var(--muted); font-size: 12px; font-weight: 700; }
    .pdf-pages { display: grid; gap: 14px; justify-items: center; padding: 18px; background: #09090b; }
    .pdf-pages canvas { max-width: 100%; height: auto; background: white; box-shadow: 0 8px 28px rgba(0,0,0,.35); }
    .table-wrap { min-height: 100%; overflow: auto; padding: 14px; }
    table { border-collapse: collapse; min-width: 100%; font-size: 12px; }
    th, td { max-width: 280px; padding: 8px 10px; border: 1px solid rgba(255,255,255,.08); color: var(--soft); text-align: left; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    th { position: sticky; top: 0; background: var(--panel); color: var(--text); z-index: 1; }
    .stage { height: 100%; min-height: 260px; display: flex; align-items: center; justify-content: center; padding: 18px; background: #0b0b0d; }
    .stage img, .stage video { max-width: 100%; max-height: 100%; object-fit: contain; }
    .stage audio { width: min(100%, 460px); }
    .empty { min-height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; padding: 28px; text-align: center; color: var(--muted); }
    .empty h3 { margin: 0; color: var(--text); font-size: 16px; }
    .empty p { margin: 0; max-width: 44ch; color: var(--soft); line-height: 1.6; font-size: 13px; }
  </style>
</head>
<body>
  <div id="root" class="viewer"><main class="body"><section class="empty"><h3>等待文件预览</h3></section></main></div>
  <script>
    const root = document.getElementById("root");
    window.myClawPanel?.onMessage((message) => {
      if (!message || message.type !== "skill-data") return;
      render(message.payload || {});
    });

    function render(payload) {
      if (payload.panelKind !== "file-viewer") {
        root.innerHTML = '<main class="body"><section class="empty"><h3>无法加载文件预览</h3></section></main>';
        return;
      }
      root.innerHTML =
        '<header class="meta"><div class="chips"><span class="chip">' + esc(payload.viewerKind || "file") + '</span><span class="chip">' + formatBytes(payload.sizeBytes || 0) + '</span>' + (payload.truncated ? '<span class="chip">已截断</span>' : '') + '</div>' +
        '<div class="actions"><button data-action="openExternal">用本地应用打开</button><button data-action="reveal">定位文件</button></div></header>' +
        '<div class="path" title="' + esc(payload.path || "") + '">' + esc(payload.path || "") + '</div><main class="body">' + body(payload) + '</main>';
      root.querySelector('[data-action="openExternal"]')?.addEventListener("click", () => window.myClawPanel.invokeAction("file-viewer:open-external", { path: payload.path }));
      root.querySelector('[data-action="reveal"]')?.addEventListener("click", () => window.myClawPanel.invokeAction("file-viewer:reveal", { path: payload.path }));
      if (["json", "text", "code"].includes(payload.viewerKind)) {
        mountMonaco(payload.viewerKind === "json" ? formatJson(payload.content || "") : (payload.content || ""), languageFor(payload));
      }
      if (payload.viewerKind === "pdf" && payload.previewUrl) {
        mountPdf(payload.previewUrl);
      }
    }

    function body(payload) {
      const content = payload.content || "";
      if (payload.documentError && !content) return fallback(payload, payload.documentError);
      switch (payload.viewerKind) {
        case "markdown":
        case "document":
        case "spreadsheet":
        case "slides":
          return content ? '<article class="markdown">' + markdown(content) + '</article>' : fallback(payload, "该文档可用本地应用打开。");
        case "json":
          return editor(formatJson(content), "json");
        case "text":
        case "code":
          return editor(content, payload.viewerKind);
        case "table":
          return content ? table(content, payload.ext === ".tsv" ? "\\t" : ",") : fallback(payload);
        case "image":
          return payload.previewUrl ? '<div class="stage"><img src="' + attr(payload.previewUrl) + '" alt="' + attr(payload.fileName || "") + '"></div>' : fallback(payload);
        case "pdf":
          return payload.previewUrl ? '<div class="pdf-toolbar" id="pdfStatus">PDF.js 正在加载…</div><div class="pdf-pages" id="pdfPages"></div>' : fallback(payload);
        case "media":
          if (!payload.previewUrl) return fallback(payload);
          return String(payload.mimeType || "").startsWith("video/")
            ? '<div class="stage"><video src="' + attr(payload.previewUrl) + '" controls></video></div>'
            : '<div class="stage"><audio src="' + attr(payload.previewUrl) + '" controls></audio></div>';
        default:
          return fallback(payload);
      }
    }

    function editor(content, kind) {
      const language = kind === "json" ? "json" : "plaintext";
      return '<div id="monacoHost" class="monaco-host" data-language="' + attr(language) + '" data-editor="monaco"></div><noscript>' + editorFallback(content) + '</noscript>';
    }

    function editorFallback(content) {
      const lines = String(content || "").split(/\\r?\\n/);
      return '<div class="monaco-lite"><div class="lines">' + lines.map((_, i) => i + 1).join("<br>") + '</div><pre class="codepane"><code>' + esc(content) + '</code></pre></div>';
    }

    function table(content, separator) {
      const rows = String(content).split(/\\r?\\n/).filter(Boolean).slice(0, 200).map((line) => line.split(separator));
      if (!rows.length) return '<section class="empty">空表格</section>';
      const head = rows[0];
      return '<div class="table-wrap"><table><thead><tr>' + head.map((cell, i) => '<th>' + esc(cell || ('Column ' + (i + 1))) + '</th>').join("") + '</tr></thead><tbody>' +
        rows.slice(1).map((row) => '<tr>' + head.map((_, i) => '<td>' + esc(row[i] || "") + '</td>').join("") + '</tr>').join("") + '</tbody></table></div>';
    }

    function markdown(content) {
      return esc(content)
        .replace(/^# (.*)$/gm, '<h1>$1</h1>')
        .replace(/^## (.*)$/gm, '<h2>$1</h2>')
        .replace(/^### (.*)$/gm, '<h3>$1</h3>')
        .replace(/\\n\\n/g, '</p><p>')
        .replace(/^/, '<p>')
        .replace(/$/, '</p>');
    }

    function fallback(payload, message) {
      return '<section class="empty"><h3>' + esc(payload.fileName || "文件") + '</h3><p>' + esc(message || "当前格式不支持内嵌预览。") + '</p></section>';
    }

    async function mountMonaco(value, language) {
      const host = document.getElementById("monacoHost");
      if (!host) return;
      try {
        await loadScriptOnce("myclaw-vendor://monaco/vs/loader.js", () => window.require);
        window.MonacoEnvironment = {
          getWorkerUrl() { return "myclaw-vendor://monaco/vs/base/worker/workerMain.js"; }
        };
        window.require.config({ paths: { vs: "myclaw-vendor://monaco/vs" } });
        await new Promise((resolve) => window.require(["vs/editor/editor.main"], resolve));
        window.monaco.editor.create(host, {
          value,
          language,
          theme: "vs-dark",
          readOnly: true,
          automaticLayout: true,
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          fontFamily: '"Cascadia Code", "Fira Code", ui-monospace, monospace',
          fontSize: 12,
          lineHeight: 20,
        });
      } catch (error) {
        host.outerHTML = editorFallback(value);
      }
    }

    async function mountPdf(url) {
      const status = document.getElementById("pdfStatus");
      const pages = document.getElementById("pdfPages");
      if (!status || !pages) return;
      try {
        await loadScriptOnce("myclaw-vendor://pdfjs/pdf.min.js", () => window.pdfjsLib);
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = "myclaw-vendor://pdfjs/pdf.worker.min.js";
        const pdf = await window.pdfjsLib.getDocument(url).promise;
        status.textContent = "PDF.js · " + pdf.numPages + " 页";
        pages.innerHTML = "";
        for (let index = 1; index <= pdf.numPages; index += 1) {
          const page = await pdf.getPage(index);
          const viewport = page.getViewport({ scale: 1.25 });
          const canvas = document.createElement("canvas");
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          pages.appendChild(canvas);
          await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
        }
      } catch (error) {
        status.textContent = "PDF.js 加载失败，可用本地应用打开。";
      }
    }

    function loadScriptOnce(src, ready) {
      if (ready && ready()) return Promise.resolve();
      return new Promise((resolve, reject) => {
        const existing = document.querySelector('script[src="' + src + '"]');
        if (existing) {
          existing.addEventListener("load", resolve, { once: true });
          existing.addEventListener("error", reject, { once: true });
          return;
        }
        const script = document.createElement("script");
        script.src = src;
        script.onload = resolve;
        script.onerror = reject;
        document.head.appendChild(script);
      });
    }

    function languageFor(payload) {
      if (payload.viewerKind === "json") return "json";
      const ext = String(payload.ext || "").replace(/^\\./, "");
      return ({ ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript", css: "css", scss: "scss", html: "html", htm: "html", json: "json", py: "python", rs: "rust", go: "go", java: "java", cs: "csharp", cpp: "cpp", c: "c", sql: "sql", md: "markdown", yaml: "yaml", yml: "yaml", xml: "xml" })[ext] || "plaintext";
    }

    function formatJson(content) { try { return JSON.stringify(JSON.parse(content), null, 2); } catch { return content; } }
    function formatBytes(size) { if (!Number.isFinite(size) || size <= 0) return "0 B"; const units = ["B","KB","MB","GB"]; let value = size, index = 0; while (value >= 1024 && index < units.length - 1) { value /= 1024; index += 1; } return (value >= 10 ? value.toFixed(0) : value.toFixed(1)) + " " + units[index]; }
    function esc(value) { return String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch])); }
    function attr(value) { return esc(value); }
  </script>
</body>
</html>`;
}
