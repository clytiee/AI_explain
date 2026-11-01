// history.js —— 划词AI释义 历史记录页逻辑
// 读取 chrome.storage.local["history"]，支持搜索、单条删除、清空、导出为 Markdown 文件。

const HISTORY_KEY = "history";
const EXPORT_OPTS_KEY = "exportOpts"; // 导出选项：是否包含 时间/来源页面/页面地址

const $ = (id) => document.getElementById(id);

let all = []; // 当前全部记录（新→旧）
let exportOpts = { time: true, pageTitle: true, pageUrl: true, compact: false, noSplit: false }; // 导出选项

// ---------- markdown → HTML（与浮层渲染一致） ----------
function esc(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function inline(s) {
  s = s.replace(/`([^`]+)`/g, (_, c) => "<code>" + esc(c) + "</code>");
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  s = s.replace(
    /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>'
  );
  return s;
}

function renderMarkdown(md) {
  const lines = String(md).split(/\r?\n/);
  const html = [];
  let inCode = false;
  let codeBuf = [];
  let list = null;

  const flushList = () => {
    if (list) {
      html.push("</" + list + ">");
      list = null;
    }
  };

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();

    if (/^```/.test(line)) {
      if (inCode) {
        html.push("<pre>" + esc(codeBuf.join("\n")) + "</pre>");
        codeBuf = [];
        inCode = false;
      } else {
        inCode = true;
      }
      continue;
    }
    if (inCode) {
      codeBuf.push(rawLine);
      continue;
    }
    if (!line.trim()) {
      flushList();
      continue;
    }

    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      flushList();
      const level = h[1].length;
      html.push("<h" + level + ">" + inline(esc(h[2])) + "</h" + level + ">");
      continue;
    }

    const quote = line.match(/^>\s?(.*)$/);
    if (quote) {
      flushList();
      html.push("<blockquote>" + inline(esc(quote[1])) + "</blockquote>");
      continue;
    }

    const ul = line.match(/^[-*+]\s+(.*)$/);
    if (ul) {
      if (list !== "ul") {
        flushList();
        html.push("<ul>");
        list = "ul";
      }
      html.push("<li>" + inline(esc(ul[1])) + "</li>");
      continue;
    }

    const ol = line.match(/^\d+[.)]\s+(.*)$/);
    if (ol) {
      if (list !== "ol") {
        flushList();
        html.push("<ol>");
        list = "ol";
      }
      html.push("<li>" + inline(esc(ol[1])) + "</li>");
      continue;
    }

    flushList();
    html.push("<p>" + inline(esc(line)) + "</p>");
  }

  if (inCode) html.push("<pre>" + esc(codeBuf.join("\n")) + "</pre>");
  flushList();
  return html.join("\n");
}

// ---------- 格式化 ----------
function pad(n) {
  return String(n).padStart(2, "0");
}

function formatTime(t) {
  const d = new Date(t);
  return (
    d.getFullYear() +
    "-" + pad(d.getMonth() + 1) +
    "-" + pad(d.getDate()) +
    " " + pad(d.getHours()) +
    ":" + pad(d.getMinutes()) +
    ":" + pad(d.getSeconds())
  );
}

function safeHost(u) {
  try {
    const url = new URL(u);
    return url.hostname;
  } catch {
    return u;
  }
}

// ---------- 加载 ----------
function load() {
  chrome.storage.local.get({ [HISTORY_KEY]: [], [EXPORT_OPTS_KEY]: {} }, (res) => {
    all = Array.isArray(res[HISTORY_KEY]) ? res[HISTORY_KEY] : [];
    exportOpts = { ...exportOpts, ...(res[EXPORT_OPTS_KEY] || {}) };
    $("optTime").checked = exportOpts.time;
    $("optPageTitle").checked = exportOpts.pageTitle;
    $("optPageUrl").checked = exportOpts.pageUrl;
    $("optCompact").checked = exportOpts.compact;
    $("optNoSplit").checked = exportOpts.noSplit;
    render();
  });
}

// 导出选项变更时即时生效并保存
function bindExportOpts() {
  const persist = () => {
    exportOpts = {
      time: $("optTime").checked,
      pageTitle: $("optPageTitle").checked,
      pageUrl: $("optPageUrl").checked,
      compact: $("optCompact").checked,
      noSplit: $("optNoSplit").checked,
    };
    chrome.storage.local.set({ [EXPORT_OPTS_KEY]: exportOpts });
  };
  $("optTime").addEventListener("change", persist);
  $("optPageTitle").addEventListener("change", persist);
  $("optPageUrl").addEventListener("change", persist);
  $("optCompact").addEventListener("change", persist);
  $("optNoSplit").addEventListener("change", persist);
}

// ---------- 渲染 ----------
function render() {
  const q = ($("search").value || "").trim().toLowerCase();
  const list = q
    ? all.filter(
        (e) =>
          (e.text || "").toLowerCase().includes(q) ||
          (e.answer || "").toLowerCase().includes(q)
      )
    : all;

  $("count").textContent = "共 " + list.length + " 条" + (q ? "（已筛选）" : "");

  const box = $("list");
  if (!list.length) {
    box.innerHTML =
      '<div class="empty">' +
      (q
        ? "没有匹配「" + esc(q) + "」的记录。"
        : "暂无历史记录。在网页上划词释义后，结果会自动保存在这里。") +
      "</div>";
    return;
  }

  box.innerHTML = "";
  for (const e of list) {
    const item = document.createElement("div");
    item.className = "card";

    const src = e.pageUrl
      ? '<span class="item-src">来源：<a href="' + esc(e.pageUrl) + '" target="_blank" rel="noopener noreferrer">' +
        esc(e.pageTitle || safeHost(e.pageUrl)) + "</a></span>"
      : "";

    const head = document.createElement("div");
    head.className = "item-head";
    head.innerHTML =
      '<span class="item-time">' + formatTime(e.time) + "</span>" + src;

    const del = document.createElement("button");
    del.className = "item-del";
    del.title = "删除这条";
    del.textContent = "✕";
    del.addEventListener("click", () => removeOne(e.id));
    head.appendChild(del);

    const textEl = document.createElement("div");
    textEl.className = "item-text";
    textEl.textContent = "「" + (e.text || "") + "」";

    const ans = document.createElement("div");
    ans.className = "item-answer";
    ans.innerHTML = renderMarkdown(e.answer || "");

    item.appendChild(head);
    item.appendChild(textEl);
    item.appendChild(ans);
    box.appendChild(item);
  }
}

// ---------- 删除 / 清空 ----------
function removeOne(id) {
  chrome.runtime.sendMessage({ type: "history-delete", id }, (res) => {
    if (res && res.ok) {
      all = all.filter((e) => e.id !== id);
      render();
      setStatus("已删除该条记录。", true);
    } else {
      setStatus("删除失败：" + ((res && res.error) || "未知错误"), false);
    }
  });
}

function clearAll() {
  if (!all.length) {
    setStatus("当前没有可清空的记录。", true);
    return;
  }
  if (!window.confirm("确定清空全部 " + all.length + " 条历史记录吗？此操作不可恢复。")) return;
  chrome.runtime.sendMessage({ type: "history-clear" }, (res) => {
    if (res && res.ok) {
      all = [];
      render();
      setStatus("已清空全部历史记录。", true);
    } else {
      setStatus("清空失败：" + ((res && res.error) || "未知错误"), false);
    }
  });
}

// ---------- 导出 Markdown ----------
// 紧凑模式：仅导出时间（放在原文右侧、右对齐），去掉「释义」标题行，原文下直接是释义内容
function buildMarkdown(list) {
  const opts = exportOpts;
  const lines = [];
  lines.push("# 划词AI释义 · 历史记录" + (opts.compact ? "（紧凑）" : ""));
  lines.push("");
  lines.push("共 " + list.length + " 条 · 导出时间：" + formatTime(Date.now()));
  list.forEach((e, i) => {
    lines.push("");
    if (opts.compact) {
      // 表格：左列原文，右列时间（右对齐）
      const text = String(e.text || "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
      lines.push("| " + (i + 1) + ". 「" + text + "」 | " + formatTime(e.time) + " |");
      lines.push("| :--- | ---: |");
      lines.push("");
      lines.push(e.answer || "");
      lines.push("");
    } else {
      lines.push("---");
      lines.push("");
      lines.push("## " + (i + 1) + ". 「" + (e.text || "") + "」");
      lines.push("");
      if (opts.time) lines.push("- **时间**：" + formatTime(e.time));
      if (opts.pageTitle && e.pageTitle) lines.push("- **来源页面**：" + e.pageTitle);
      if (opts.pageUrl && e.pageUrl) lines.push("- **页面地址**：" + e.pageUrl);
      lines.push("");
      lines.push(e.answer || ""); // 去掉「释义：」标题行，释义内容直接跟在其后
      lines.push("");
    }
  });
  return lines.join("\n");
}

function exportMd() {
  // 导出反馈显示在「导出为 MD」按钮下方
  const statusEl = $("exportStatus");
  const exportStatus = (text, ok) => {
    statusEl.textContent = text;
    statusEl.className = "export-status" + (ok ? " ok" : " err"); // 保留基础类，绿色/红色由 ok/err 决定
  };
  if (!all.length) {
    exportStatus("暂无记录可导出。", false);
    return;
  }
  const md = buildMarkdown(all);
  const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const d = new Date();
  const name =
    "划词释义历史_" +
    d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) +
    "_" + pad(d.getHours()) + pad(d.getMinutes()) +
    ".md";
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  exportStatus("已导出 " + all.length + " 条记录为 Markdown 文件：" + name, true);
}

// 导出为 HTML：样式复用历史页的原文卡片（含时间/来源/原文/释义），去掉删除按钮
const CARD_CSS = `:root{--primary:#4f46e5;--primary-soft:rgba(99,102,241,0.12);--border:#e5e7eb;--text:#1f2937;--muted:#6b7280}
*{box-sizing:border-box}
body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",Roboto,sans-serif;color:var(--text);background:linear-gradient(160deg,#f6f7ff,#eef2ff 60%,#f5f3ff);min-height:100vh;padding:32px 16px 60px}
.wrap{max-width:720px;margin:0 auto}
h1{font-size:20px;margin:0 0 4px;display:flex;align-items:center;gap:10px}
h1 .dot{width:12px;height:12px;border-radius:50%;background:linear-gradient(135deg,#6366f1,#a855f7)}
.sub{color:var(--muted);font-size:13px;margin:0 0 20px}
.card{background:rgba(255,255,255,0.88);-webkit-backdrop-filter:blur(14px);backdrop-filter:blur(14px);border:1px solid rgba(255,255,255,0.6);border-radius:16px;padding:16px 18px;margin-bottom:12px;box-shadow:0 8px 30px rgba(0,0,0,0.05)}
.item-head{display:flex;align-items:center;gap:10px;flex-wrap:nowrap;margin-bottom:8px}
.item-time{font-size:12px;color:var(--muted);flex:1 0 auto;white-space:nowrap}
.item-src{font-size:12px;color:var(--muted);flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.item-src a{color:var(--muted);text-decoration:none}
.item-src a:hover{color:var(--primary);text-decoration:underline}
.item-text{font-size:13px;font-weight:600;color:#374151;background:var(--primary-soft);border-radius:8px;padding:6px 10px;margin-bottom:8px;word-break:break-word}
.item-answer{font-size:13px;line-height:1.65;color:#1f2937}
.item-answer p{margin:4px 0}
.item-answer h1,.item-answer h2,.item-answer h3,.item-answer h4{margin:8px 0 4px;font-size:14px}
.item-answer ul,.item-answer ol{margin:4px 0;padding-left:20px}
.item-answer li{margin:2px 0}
.item-answer code{font-family:ui-monospace,SFMono-Regular,Consolas,"Courier New",monospace;font-size:12px;background:rgba(99,102,241,0.08);color:#4f46e5;padding:1px 4px;border-radius:4px}
.item-answer pre{background:rgba(31,41,55,0.06);padding:8px;border-radius:8px;overflow-x:auto;margin:6px 0}
.item-answer pre code{background:transparent;color:inherit;padding:0}
.item-answer blockquote{margin:6px 0;padding:2px 10px;border-left:3px solid #6366f1;color:#4b5563}
.item-answer a{color:#4f46e5;text-decoration:none}
.item-answer a:hover{text-decoration:underline}`;

function buildCardsHtml(list) {
  const opts = exportOpts;
  // 勾选「卡片不跨页拆分」时，每张卡片前插入透明占位 div：
  // 打印时提供顶部空隙，并随卡片一起分页，不改动卡片自身样式
  const gap = opts.noSplit ? '<div class="card-gap"></div>' : "";
  return list
    .map((e) => {
      const head = [];
      if (opts.time) head.push('<span class="item-time">' + esc(formatTime(e.time)) + "</span>");
      // 来源：勾选「来源页面」才显示；「页面地址」决定是否带超链接
      if (opts.pageTitle && e.pageTitle) {
        if (opts.pageUrl && e.pageUrl) {
          head.push(
            '<span class="item-src">来源：<a href="' + esc(e.pageUrl) + '" target="_blank" rel="noopener noreferrer">' +
              esc(e.pageTitle) + "</a></span>"
          );
        } else {
          head.push('<span class="item-src">来源：' + esc(e.pageTitle) + "</span>");
        }
      }
      return (
        gap +
        '<div class="card">' +
        '<div class="item-head">' + head.join("") + "</div>" +
        '<div class="item-text">「' + esc(e.text || "") + "」</div>" +
        '<div class="item-answer">' + renderMarkdown(e.answer || "") + "</div>" +
        "</div>"
      );
    })
    .join("\n");
}

function exportHtml() {
  const statusEl = $("exportStatus");
  const exportStatus = (text, ok) => {
    statusEl.textContent = text;
    statusEl.className = "export-status" + (ok ? " ok" : " err");
  };
  if (!all.length) {
    exportStatus("暂无记录可导出。", false);
    return;
  }
  // 勾选「卡片不跨页拆分」时，额外追加打印规则（不改动现有卡片样式）：
  // 卡片不跨页截断；每张卡片前的透明占位 div 提供 16px 顶部空隙
  // （与左右留白一致、露出页面背景色），并用 break-after:avoid 使其
  // 与下一张卡片同页，从而在被推到下一页顶部的卡片上方留出空白
  const noSplitCss = exportOpts.noSplit
    ? "\n@media print{.card{break-inside:avoid;page-break-inside:avoid}.card-gap{height:16px;break-after:avoid;page-break-after:avoid}}"
    : "";
  const html =
    "<!DOCTYPE html>\n" +
    '<html lang="zh-CN">\n<head>\n' +
    '<meta charset="UTF-8" />\n' +
    '<meta name="viewport" content="width=device-width, initial-scale=1.0" />\n' +
    "<title>划词AI释义 · 历史记录</title>\n" +
    "<style>\n" + CARD_CSS + noSplitCss + "\n</style>\n" +
    "</head>\n<body>\n" +
    '<div class="wrap">\n' +
    '<h1><span class="dot"></span>划词AI释义 · 历史记录</h1>\n' +
    '<p class="sub">共 ' + all.length + " 条 · 导出时间：" + formatTime(Date.now()) + "</p>\n" +
    buildCardsHtml(all) +
    "\n</div>\n</body>\n</html>";

  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const d = new Date();
  const name =
    "划词释义历史_" +
    d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) +
    "_" + pad(d.getHours()) + pad(d.getMinutes()) +
    ".html";
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  exportStatus("已导出 " + all.length + " 条记录为 HTML 文件：" + name, true);
}

function setStatus(text, ok) {
  const el = $("status");
  el.textContent = text;
  el.className = ok ? "ok" : "err";
}

// 事件
$("search").addEventListener("input", render);
$("export").addEventListener("click", exportMd);
$("exportHtml").addEventListener("click", exportHtml);
$("clear").addEventListener("click", clearAll);
bindExportOpts();

document.addEventListener("DOMContentLoaded", load);
