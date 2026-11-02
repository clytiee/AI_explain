// history.js —— 划词AI释义 历史记录页逻辑
// 读取 chrome.storage.local["history"]，支持搜索、单条删除、清空、导出为 Markdown 文件。

const HISTORY_KEY = "history";
const EXPORT_OPTS_KEY = "exportOpts"; // 导出选项：是否包含 时间/来源页面/页面地址
const DISPLAY_OPTS_KEY = "displayOpts"; // 显示设置：页面背景色/原文背景色/字体颜色/字体大小/字体
const DISPLAY_PRESETS_KEY = "displayPresets"; // 已保存的显示样式组列表
const SOURCE_TEXTS_KEY = "sourceTexts"; // 来源主文：{ srcKey: 文本 }
const SHOW_MAIN_KEY = "showMainText"; // 是否显示来源主文
const AGG_KEY = "aggregate"; // 是否按来源聚合

const $ = (id) => document.getElementById(id);

let all = []; // 当前全部记录（新→旧）
let exportOpts = { time: true, pageTitle: true, pageUrl: true, compact: false, noSplit: false }; // 导出选项
let displayPresets = []; // [{ name, opts }] 已保存的样式组
let sourceTexts = {}; // { srcKey: 主文 } 按来源保存的主文
let mainModalKey = ""; // 当前正在编辑主文的 srcKey
let showMainText = true; // 列表是否显示来源主文
let aggregate = false; // 是否按来源聚合

// 显示设置默认值
const DEFAULT_DISPLAY = {
  pageBg: "#eef2ff",
  quoteBg: "#e0e7ff",
  fontColor: "#1f2937",
  fontSize: 13,
  fontFamily:
    "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', Roboto, sans-serif",
};
let displayOpts = { ...DEFAULT_DISPLAY };

// 字体预设选项（value 为空表示自定义）
const FONT_OPTIONS = [
  { label: "默认", value: DEFAULT_DISPLAY.fontFamily },
  { label: "无衬线", value: "sans-serif" },
  { label: "衬线", value: "Georgia, 'Times New Roman', serif" },
  { label: "微软雅黑", value: "'Microsoft YaHei', sans-serif" },
  { label: "宋体", value: "'SimSun', serif" },
  { label: "楷体", value: "'KaiTi', 'KaiTi_GB2312', serif" },
  { label: "等宽", value: "ui-monospace, SFMono-Regular, Consolas, 'Courier New', monospace" },
  { label: "自定义…", value: "" },
];

// 若字体与某个预设一致返回其值，否则返回 ""（表示自定义）
function matchFontPreset(font) {
  const f = (font || "").trim();
  const hit = FONT_OPTIONS.find((o) => o.value && o.value.trim() === f);
  return hit ? hit.value : "";
}

// 字体名用于 CSS font-family：含空格且未加引号的单字体名需加引号；
// 含逗号的字体栈（如下拉建议）原样保留
function toFontFamilyCss(v) {
  v = (v || "").trim();
  if (!v) return v;
  if (!v.includes(",") && !/^['"]/.test(v) && v.includes(" ")) return '"' + v + '"';
  return v;
}

// 推荐页面背景色（浅色、柔和、适合阅读）
const BG_RECOMMEND = [
  "#f6f7ff", // 极浅蓝紫
  "#eef2ff", // 浅蓝
  "#f0f9ff", // 极浅天蓝
  "#ecfdf5", // 极浅薄荷绿
  "#fefce8", // 极浅米黄
  "#fff7ed", // 极浅暖橙
  "#fdf2f8", // 极浅粉
  "#f5f5f4", // 中性暖灰
  "#f8fafc", // 冷白浅灰
  "#ffffff", // 纯白
];

// 推荐原文背景色（比页面背景更深，突出被选原文）
const QUOTE_RECOMMEND = [
  "#e0e7ff", // 浅靛（默认）
  "#dbeafe", // 浅蓝
  "#c7d2fe", // 靛蓝
  "#bae6fd", // 天蓝
  "#bbf7d0", // 薄荷绿
  "#fef08a", // 米黄
  "#fed7aa", // 暖橙
  "#fbcfe8", // 粉
  "#e2e8f0", // 冷灰
  "#ddd6fe", // 浅紫
];

function initColorSwatches(containerId, inputId, colors) {
  const box = $(containerId);
  colors.forEach((c) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "bg-swatch";
    b.style.background = c;
    b.title = c;
    b.addEventListener("click", () => {
      $(inputId).value = c;
      $(inputId).dispatchEvent(new Event("input", { bubbles: true })); // 复用已有持久化逻辑
    });
    box.appendChild(b);
  });
}

// 让色块高亮与当前对应取色器值一致的那块
function syncColorSwatches(containerId, inputId) {
  const cur = ($(inputId).value || "").toLowerCase();
  document.querySelectorAll("#" + containerId + " .bg-swatch").forEach((b) => {
    b.classList.toggle("active", b.title.toLowerCase() === cur);
  });
}

// 将显示设置写入 CSS 变量
function applyDisplay(d) {
  const s = document.documentElement.style;
  s.setProperty("--page-bg", d.pageBg);
  s.setProperty("--quote-bg", d.quoteBg);
  s.setProperty("--font-color", d.fontColor);
  s.setProperty("--font-size", d.fontSize + "px");
  s.setProperty("--font-family", toFontFamilyCss(d.fontFamily));
  $("optFontSizeVal").textContent = d.fontSize;
}

// 导出 HTML 时，把显示设置写成覆盖规则追加到样式末尾
function buildDisplayCss(d) {
  const ff = toFontFamilyCss(d.fontFamily);
  return (
    "body{background:" + d.pageBg + ";color:" + d.fontColor +
      ";font-family:" + ff + ";font-size:" + d.fontSize + "px}" +
    ".item-text{background:" + d.quoteBg + ";color:" + d.fontColor +
      ";font-size:" + d.fontSize + "px}" +
    ".item-answer{color:" + d.fontColor + ";font-size:" + d.fontSize + "px}"
  );
}

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
function initFontSelect() {
  const sel = $("optFontPreset");
  FONT_OPTIONS.forEach((f) => {
    const o = document.createElement("option");
    o.value = f.value;
    o.textContent = f.label;
    sel.appendChild(o);
  });
}

// 按当前 displayOpts 同步各显示控件
function syncDisplayControls() {
  $("optPageBg").value = displayOpts.pageBg;
  $("optQuoteBg").value = displayOpts.quoteBg;
  $("optFontColor").value = displayOpts.fontColor;
  $("optFontSize").value = displayOpts.fontSize;
  const storedFont = displayOpts.fontFamily || DEFAULT_DISPLAY.fontFamily;
  if (matchFontPreset(storedFont)) {
    $("optFontPreset").value = matchFontPreset(storedFont);
    $("optFontFamily").value = "";
  } else {
    $("optFontPreset").value = ""; // 自定义…
    $("optFontFamily").value = storedFont;
  }
  syncColorSwatches("bgSwatches", "optPageBg");
  syncColorSwatches("quoteSwatches", "optQuoteBg");
}

function refreshPresetSelect() {
  const sel = $("presetSelect");
  sel.innerHTML = "";
  const none = document.createElement("option");
  none.value = "";
  none.textContent = "（选择样式组）";
  sel.appendChild(none);
  displayPresets.forEach((p, i) => {
    const o = document.createElement("option");
    o.value = String(i);
    o.textContent = p.name;
    sel.appendChild(o);
  });
  sel.value = ""; // 默认回到「（选择样式组）」
}

// 保存当前显示设置为命名样式组
function saveDisplay() {
  const name = window.prompt("为当前显示设置命名，保存为样式组：", "");
  if (name === null) return; // 取消
  const n = name.trim();
  if (!n) {
    window.alert("名称不能为空。");
    return;
  }
  displayPresets.push({ name: n, opts: { ...displayOpts } });
  chrome.storage.local.set({ [DISPLAY_PRESETS_KEY]: displayPresets });
  refreshPresetSelect();
  $("presetSelect").value = String(displayPresets.length - 1);
}

// 套用选中的样式组
function applyPreset() {
  const v = $("presetSelect").value;
  if (v === "") return; // 未选择
  const i = Number(v);
  if (!Number.isInteger(i) || i < 0 || i >= displayPresets.length) return;
  displayOpts = { ...DEFAULT_DISPLAY, ...displayPresets[i].opts };
  syncDisplayControls();
  applyDisplay(displayOpts);
  chrome.storage.local.set({ [DISPLAY_OPTS_KEY]: displayOpts });
}

// 删除选中的样式组
function deletePreset() {
  const i = Number($("presetSelect").value);
  if (!Number.isInteger(i) || i < 0 || i >= displayPresets.length) {
    window.alert("请先选择一个样式组。");
    return;
  }
  if (!window.confirm("确定删除样式组「" + displayPresets[i].name + "」吗？")) return;
  displayPresets.splice(i, 1);
  chrome.storage.local.set({ [DISPLAY_PRESETS_KEY]: displayPresets });
  refreshPresetSelect();
}

function load() {
  chrome.storage.local.get(
    {
      [HISTORY_KEY]: [],
      [EXPORT_OPTS_KEY]: {},
      [DISPLAY_OPTS_KEY]: {},
      [DISPLAY_PRESETS_KEY]: [],
      [SOURCE_TEXTS_KEY]: {},
      [SHOW_MAIN_KEY]: true,
      [AGG_KEY]: false,
    },
    (res) => {
      all = Array.isArray(res[HISTORY_KEY]) ? res[HISTORY_KEY] : [];
      exportOpts = { ...exportOpts, ...(res[EXPORT_OPTS_KEY] || {}) };
      $("optTime").checked = exportOpts.time;
      $("optPageTitle").checked = exportOpts.pageTitle;
      $("optPageUrl").checked = exportOpts.pageUrl;
      $("optCompact").checked = exportOpts.compact;
      $("optNoSplit").checked = exportOpts.noSplit;

      displayOpts = { ...DEFAULT_DISPLAY, ...(res[DISPLAY_OPTS_KEY] || {}) };
      syncDisplayControls();
      applyDisplay(displayOpts);

      displayPresets = Array.isArray(res[DISPLAY_PRESETS_KEY]) ? res[DISPLAY_PRESETS_KEY] : [];
      refreshPresetSelect();

      sourceTexts = (res[SOURCE_TEXTS_KEY] && typeof res[SOURCE_TEXTS_KEY] === "object") ? res[SOURCE_TEXTS_KEY] : {};
      showMainText = res[SHOW_MAIN_KEY] !== false;
      syncMainBtn();
      aggregate = res[AGG_KEY] === true;
      syncAggBtn();

      render();
    }
  );
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

// 显示设置变更时即时生效并保存
function bindDisplay() {
  const persist = () => {
    displayOpts = {
      pageBg: $("optPageBg").value,
      quoteBg: $("optQuoteBg").value,
      fontColor: $("optFontColor").value,
      fontSize: Number($("optFontSize").value),
      fontFamily: $("optFontFamily").value,
    };
    applyDisplay(displayOpts);
    $("presetSelect").value = ""; // 手动调整后，样式组下拉不再指向任何已存组
    syncColorSwatches("bgSwatches", "optPageBg");
    syncColorSwatches("quoteSwatches", "optQuoteBg");
    chrome.storage.local.set({ [DISPLAY_OPTS_KEY]: displayOpts });
  };
  $("optPageBg").addEventListener("input", persist);
  $("optQuoteBg").addEventListener("input", persist);
  $("optFontColor").addEventListener("input", persist);
  $("optFontSize").addEventListener("input", persist);
  // 字体：预设下拉 + 自定义输入框
  $("optFontPreset").addEventListener("change", () => {
    const v = $("optFontPreset").value;
    if (v === "") {
      // 选中「自定义…」：保持现有字体，聚焦输入框让用户手输
      $("optFontFamily").focus();
      return;
    }
    $("optFontFamily").value = "";
    displayOpts.fontFamily = v;
    persist();
  });
  $("optFontFamily").addEventListener("input", () => {
    const raw = $("optFontFamily").value.trim();
    displayOpts.fontFamily = raw || DEFAULT_DISPLAY.fontFamily;
    $("optFontPreset").value = matchFontPreset(displayOpts.fontFamily);
    persist();
  });
  // 恢复默认显示样式（带确认）
  $("resetDisplay").addEventListener("click", () => {
    if (!window.confirm("确定恢复默认显示样式吗？当前自定义设置将被清除。")) return;
    displayOpts = { ...DEFAULT_DISPLAY };
    $("optPageBg").value = displayOpts.pageBg;
    $("optQuoteBg").value = displayOpts.quoteBg;
    $("optFontColor").value = displayOpts.fontColor;
    $("optFontSize").value = displayOpts.fontSize;
    $("optFontPreset").value = FONT_OPTIONS[0].value; // 默认
    $("optFontFamily").value = "";
    $("presetSelect").value = ""; // 恢复默认后不再指向已存样式组
    applyDisplay(displayOpts);
    chrome.storage.local.set({ [DISPLAY_OPTS_KEY]: displayOpts });
  });
}

// ---------- 渲染 ----------
// 按当前搜索框返回筛选后的记录；无关键字时返回全部
function filteredList() {
  const q = ($("search").value || "").trim().toLowerCase();
  return q
    ? all.filter(
        (e) =>
          (e.text || "").toLowerCase().includes(q) ||
          (e.answer || "").toLowerCase().includes(q) ||
          (e.pageTitle || "").toLowerCase().includes(q) ||
          (e.pageUrl || "").toLowerCase().includes(q)
      )
    : all;
}

function render() {
  const q = ($("search").value || "").trim().toLowerCase();
  // 有内容时显示搜索框右侧的清空按钮
  $("searchClear").style.display = q ? "flex" : "none";
  const list = filteredList();

  $("count").textContent =
    "共 " + list.length + " 条" +
    (aggregate ? " / " + new Set(list.map((e) => e.pageUrl || e.pageTitle || e.id)).size + " 组" : "") +
    (q ? "（已筛选）" : "");

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

  if (aggregate) {
    renderAggregated(list);
    return;
  }

  box.innerHTML = "";
  for (const e of list) {
    box.appendChild(buildItemCard(e));
  }
}

// 普通卡片（非聚合）：第一行 时间 + 来源按钮 + 来源 + 删除
function buildItemCard(e) {
  const item = document.createElement("div");
  item.className = "card";

  const srcKey = e.pageUrl || e.pageTitle || "";

  const head = document.createElement("div");
  head.className = "item-head";

  const timeEl = document.createElement("span");
  timeEl.className = "item-time";
  timeEl.textContent = formatTime(e.time);
  head.appendChild(timeEl);

  // 来源左侧的搜索图标：点击筛选同来源记录
  if (srcKey) {
    const srcBtn = document.createElement("button");
    srcBtn.type = "button";
    srcBtn.className = "item-src-search";
    srcBtn.title = "搜索同来源记录";
    srcBtn.innerHTML =
      '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>';
    srcBtn.addEventListener("click", () => {
      $("search").value = srcKey;
      render();
    });
    head.appendChild(srcBtn);

    // 来源主文按钮：编辑/查看该来源的主文
    const mainBtn = document.createElement("button");
    mainBtn.type = "button";
    mainBtn.className = "item-main-btn";
    mainBtn.title = "来源主文：为这个来源填写一段主文";
    mainBtn.textContent = "主文";
    mainBtn.addEventListener("click", () => openMainModal(srcKey));
    head.appendChild(mainBtn);

    const src = document.createElement("span");
    src.className = "item-src";
    if (e.pageUrl) {
      src.innerHTML =
        '来源：<a href="' + esc(e.pageUrl) + '" target="_blank" rel="noopener noreferrer">' +
        esc(e.pageTitle || safeHost(e.pageUrl)) + "</a>";
    } else {
      src.textContent = "来源：" + e.pageTitle;
    }
    head.appendChild(src);
  }

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

  // 同源主文：该来源保存过主文时，同源所有卡片都显示（受“显示/隐藏主文”开关控制）
  if (showMainText && sourceTexts[srcKey]) {
    const main = document.createElement("div");
    main.className = "item-main";
    main.textContent = sourceTexts[srcKey];
    item.appendChild(main);
  }

  item.appendChild(textEl);
  item.appendChild(ans);
  return item;
}

// ---------- 删除 / 清空 ----------
// ---------- 来源主文弹窗 ----------
function openMainModal(srcKey) {
  mainModalKey = srcKey;
  $("mainModalSrc").textContent = "来源：" + srcKey;
  $("mainModalText").value = sourceTexts[srcKey] || "";
  $("mainModal").hidden = false;
  $("mainModalText").focus();
}
function closeMainModal() {
  $("mainModal").hidden = true;
  mainModalKey = "";
}
function saveMainText() {
  const v = $("mainModalText").value.trim();
  if (v) sourceTexts[mainModalKey] = v;
  else delete sourceTexts[mainModalKey];
  chrome.storage.local.set({ [SOURCE_TEXTS_KEY]: sourceTexts }, () => {
    closeMainModal();
    render();
  });
}
function clearMainText() {
  if (!sourceTexts[mainModalKey]) {
    closeMainModal();
    return;
  }
  if (!window.confirm("确定清除该来源的主文吗？")) return;
  delete sourceTexts[mainModalKey];
  chrome.storage.local.set({ [SOURCE_TEXTS_KEY]: sourceTexts }, () => {
    closeMainModal();
    render();
  });
}
function bindMainModal() {
  $("mainModalSave").addEventListener("click", saveMainText);
  $("mainModalCancel").addEventListener("click", closeMainModal);
  $("mainModalClose").addEventListener("click", closeMainModal);
  $("mainModalClear").addEventListener("click", clearMainText);
  $("mainModal").addEventListener("click", (ev) => {
    if (ev.target === $("mainModal")) closeMainModal(); // 点击遮罩关闭
  });
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape" && !$("mainModal").hidden) closeMainModal();
  });
}

function syncMainBtn() {
  $("toggleMain").textContent = showMainText ? "隐藏主文" : "显示主文";
}

function toggleMain() {
  showMainText = !showMainText;
  chrome.storage.local.set({ [SHOW_MAIN_KEY]: showMainText });
  syncMainBtn();
  render();
}

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

// ---------- 按来源聚合 ----------
function groupRecords(list) {
  // 按来源分组：pageUrl 优先，其次 pageTitle，均无则按记录自身成组
  const groups = new Map();
  for (const e of list) {
    const key = e.pageUrl || e.pageTitle || "__no_" + e.id;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(e);
  }
  const entries = [...groups.entries()];
  // 组内按时间升序；组间按最晚时间降序
  entries.forEach(([, recs]) => recs.sort((a, b) => a.time - b.time));
  entries.sort((a, b) => {
    const ma = Math.max(...a[1].map((r) => r.time));
    const mb = Math.max(...b[1].map((r) => r.time));
    return mb - ma;
  });
  return entries;
}

function renderAggregated(list) {
  const box = $("list");
  box.innerHTML = "";
  const entries = groupRecords(list);

  for (const [key, recs] of entries) {
    // 来源只有一条记录时，保持普通卡片样式（时间 + 来源按钮 + 关闭）
    if (recs.length === 1) {
      box.appendChild(buildItemCard(recs[0]));
      continue;
    }
    const srcKey = key.startsWith("__no_") ? "" : key;
    const item = document.createElement("div");
    item.className = "card card-agg";

    // 头部：左记录数，右来源及按钮
    const head = document.createElement("div");
    head.className = "item-head item-head-agg";

    const countEl = document.createElement("span");
    countEl.className = "item-count";
    countEl.textContent = recs.length + " 条";
    head.appendChild(countEl);

    if (srcKey) {
      const group = document.createElement("span");
      group.className = "item-src-group";

      const srcBtn = document.createElement("button");
      srcBtn.type = "button";
      srcBtn.className = "item-src-search";
      srcBtn.title = "搜索同来源记录";
      srcBtn.innerHTML =
        '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>';
      srcBtn.addEventListener("click", () => {
        $("search").value = srcKey;
        render();
      });
      group.appendChild(srcBtn);

      const mainBtn = document.createElement("button");
      mainBtn.type = "button";
      mainBtn.className = "item-main-btn";
      mainBtn.title = "来源主文：为这个来源填写一段主文";
      mainBtn.textContent = "主文";
      mainBtn.addEventListener("click", () => openMainModal(srcKey));
      group.appendChild(mainBtn);

      const src = document.createElement("span");
      src.className = "item-src";
      const first = recs[0];
      if (first.pageUrl) {
        src.innerHTML =
          '来源：<a href="' + esc(first.pageUrl) + '" target="_blank" rel="noopener noreferrer">' +
          esc(first.pageTitle || safeHost(first.pageUrl)) + "</a>";
      } else {
        src.textContent = "来源：" + first.pageTitle;
      }
      group.appendChild(src);

      head.appendChild(group);
    }
    item.appendChild(head);

    // 主文只显示一次
    if (showMainText && sourceTexts[srcKey]) {
      const main = document.createElement("div");
      main.className = "item-main";
      main.textContent = sourceTexts[srcKey];
      item.appendChild(main);
    }

    // 多个原文排列在一个卡片里
    const items = document.createElement("div");
    items.className = "agg-items";
    for (const e of recs) {
      const gi = document.createElement("div");
      gi.className = "agg-item";

      const giHead = document.createElement("div");
      giHead.className = "agg-item-head";
      const t = document.createElement("span");
      t.className = "agg-item-time";
      t.textContent = formatTime(e.time);
      giHead.appendChild(t);
      const del = document.createElement("button");
      del.className = "item-del";
      del.title = "删除这条";
      del.textContent = "✕";
      del.addEventListener("click", () => removeOne(e.id));
      giHead.appendChild(del);
      gi.appendChild(giHead);

      const textEl = document.createElement("div");
      textEl.className = "item-text";
      textEl.textContent = "「" + (e.text || "") + "」";
      gi.appendChild(textEl);

      const ans = document.createElement("div");
      ans.className = "item-answer";
      ans.innerHTML = renderMarkdown(e.answer || "");
      gi.appendChild(ans);

      items.appendChild(gi);
    }
    item.appendChild(items);
    box.appendChild(item);
  }
}

function syncAggBtn() {
  $("toggleAgg").classList.toggle("active", aggregate);
}

function toggleAgg() {
  aggregate = !aggregate;
  chrome.storage.local.set({ [AGG_KEY]: aggregate });
  syncAggBtn();
  render();
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

// 聚合模式的 Markdown：每个来源一节，主文只出现一次，多条原文并列
function buildMarkdownAggregated(list) {
  const opts = exportOpts;
  const lines = [];
  lines.push("# 划词AI释义 · 历史记录（按来源聚合）");
  lines.push("");
  lines.push("共 " + list.length + " 条 / " + groupRecords(list).length + " 组 · 导出时间：" + formatTime(Date.now()));
  groupRecords(list).forEach(([key, recs], g) => {
    const srcKey = key.startsWith("__no_") ? "" : key;
    const first = recs[0];
    const title = first.pageTitle || first.pageUrl || "未命名来源";
    lines.push("");
    lines.push("---");
    lines.push("");
    lines.push("## " + (g + 1) + ". " + title);
    lines.push("");
    if (opts.pageUrl && first.pageUrl) lines.push("- **页面地址**：" + first.pageUrl);
    if (showMainText && sourceTexts[srcKey]) {
      lines.push("");
      lines.push(sourceTexts[srcKey]);
      lines.push("");
    }
    recs.forEach((e, j) => {
      lines.push("### " + (j + 1) + ". 「" + (e.text || "") + "」");
      if (opts.time) lines.push("- **时间**：" + formatTime(e.time));
      lines.push("");
      lines.push(e.answer || "");
      lines.push("");
    });
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
  if (!filteredList().length) {
    exportStatus("暂无记录可导出。", false);
    return;
  }
  const list = filteredList();
  const md = aggregate ? buildMarkdownAggregated(list) : buildMarkdown(list);
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
  exportStatus("已导出 " + list.length + " 条记录为 Markdown 文件：" + name, true);
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
.item-head-agg{justify-content:space-between}
.item-count{font-size:12px;color:var(--muted);flex:0 0 auto;white-space:nowrap}
.item-src-group{display:inline-flex;align-items:center;gap:10px;flex:0 1 auto;min-width:0}
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
.item-answer a:hover{text-decoration:underline}
.item-main{font-size:13px;color:#1f2937;background:rgba(99,102,241,0.07);border-left:3px solid #6366f1;border-radius:6px;padding:6px 10px;margin-bottom:8px;white-space:pre-wrap;word-break:break-word}
.item-main-label{font-size:11px;color:var(--muted);margin-bottom:2px}
.agg-items{display:flex;flex-direction:column;gap:10px}
.agg-item{border-top:1px dashed rgba(99,102,241,0.28);padding-top:10px}
.agg-item:first-child{border-top:none;padding-top:0}
.agg-item-head{display:flex;align-items:center;gap:8px;margin-bottom:6px}
.agg-item-time{font-size:12px;color:var(--muted)}`;

function buildCardsHtml(list) {
  const opts = exportOpts;
  // 勾选「卡片不跨页拆分」时，每张卡片前插入透明占位 div：
  // 打印时提供顶部空隙，并随卡片一起分页，不改动卡片自身样式
  const gap = opts.noSplit ? '<div class="card-gap"></div>' : "";
  return list.map((e) => gap + cardHtml(e)).join("\n");
}

// 普通单条卡片的 HTML（与页面非聚合卡片一致：时间 + 来源）
function cardHtml(e) {
  const opts = exportOpts;
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
    '<div class="card">' +
    '<div class="item-head">' + head.join("") + "</div>" +
    '<div class="item-text">「' + esc(e.text || "") + "」</div>" +
    '<div class="item-answer">' + renderMarkdown(e.answer || "") + "</div>" +
    "</div>"
  );
}

// 聚合模式的 HTML：一个来源一张卡片，主文只出现一次，多条原文并列
function buildCardsHtmlAggregated(list) {
  const opts = exportOpts;
  const gap = opts.noSplit ? '<div class="card-gap"></div>' : "";
  return groupRecords(list)
    .map(([key, recs]) => {
      // 来源只有一条记录时，保持普通卡片样式
      if (recs.length === 1) return gap + cardHtml(recs[0]);
      const srcKey = key.startsWith("__no_") ? "" : key;
      const first = recs[0];
      const head = [];
      head.push('<span class="item-count">' + recs.length + " 条</span>");
      // 来源：勾选「来源页面」才显示；「页面地址」决定是否带超链接
      if (opts.pageTitle && first.pageTitle) {
        if (opts.pageUrl && first.pageUrl) {
          head.push(
            '<span class="item-src-group"><span class="item-src">来源：<a href="' + esc(first.pageUrl) + '" target="_blank" rel="noopener noreferrer">' +
              esc(first.pageTitle) + "</a></span></span>"
          );
        } else {
          head.push('<span class="item-src-group"><span class="item-src">来源：' + esc(first.pageTitle) + "</span></span>");
        }
      }
      const main =
        showMainText && sourceTexts[srcKey]
          ? '<div class="item-main">' + esc(sourceTexts[srcKey]) + "</div>"
          : "";
      const items = recs
        .map((e) => {
          const itemHead = opts.time
            ? '<div class="agg-item-head"><span class="agg-item-time">' + esc(formatTime(e.time)) + "</span></div>"
            : "";
          return (
            '<div class="agg-item">' +
            itemHead +
            '<div class="item-text">「' + esc(e.text || "") + "」</div>" +
            '<div class="item-answer">' + renderMarkdown(e.answer || "") + "</div>" +
            "</div>"
          );
        })
        .join("\n");
      return (
        gap +
        '<div class="card card-agg">' +
        '<div class="item-head item-head-agg">' + head.join("") + "</div>" +
        main +
        '<div class="agg-items">' + items + "</div>" +
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
  if (!filteredList().length) {
    exportStatus("暂无记录可导出。", false);
    return;
  }
  const list = filteredList();
  // 勾选「卡片不跨页拆分」时，额外追加打印规则（不改动现有卡片样式）：
  // 卡片不跨页截断；每张卡片前的透明占位 div 提供 16px 顶部空隙
  // （与左右留白一致、露出页面背景色），并用 break-after:avoid 使其
  // 与下一张卡片同页，从而在被推到下一页顶部的卡片上方留出空白
  const noSplitCss = exportOpts.noSplit
    ? "\n@media print{.card{break-inside:avoid;page-break-inside:avoid}.card-gap{height:16px;break-after:avoid;page-break-after:avoid}}"
    : "";
  // 将显示设置（页面背景/原文背景/字体颜色/字号/字体）写入导出样式
  const displayCss = buildDisplayCss(displayOpts);
  const html =
    "<!DOCTYPE html>\n" +
    '<html lang="zh-CN">\n<head>\n' +
    '<meta charset="UTF-8" />\n' +
    '<meta name="viewport" content="width=device-width, initial-scale=1.0" />\n' +
    "<title>划词AI释义 · 历史记录</title>\n" +
    "<style>\n" + CARD_CSS + noSplitCss + displayCss + "\n</style>\n" +
    "</head>\n<body>\n" +
    '<div class="wrap">\n' +
    '<h1><span class="dot"></span>划词AI释义 · 历史记录</h1>\n' +
    '<p class="sub">共 ' + list.length + " 条 · 导出时间：" + formatTime(Date.now()) + "</p>\n" +
    (aggregate ? buildCardsHtmlAggregated(list) : buildCardsHtml(list)) +
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
  exportStatus("已导出 " + list.length + " 条记录为 HTML 文件：" + name, true);
}

function setStatus(text, ok) {
  const el = $("status");
  el.textContent = text;
  el.className = ok ? "ok" : "err";
}

// 事件
$("search").addEventListener("input", render);
$("searchClear").addEventListener("click", () => {
  $("search").value = "";
  render();
});
$("export").addEventListener("click", exportMd);
$("exportHtml").addEventListener("click", exportHtml);
$("clear").addEventListener("click", clearAll);
initFontSelect();
initColorSwatches("bgSwatches", "optPageBg", BG_RECOMMEND);
initColorSwatches("quoteSwatches", "optQuoteBg", QUOTE_RECOMMEND);
bindExportOpts();
bindDisplay();
$("saveDisplay").addEventListener("click", saveDisplay);
$("presetSelect").addEventListener("change", applyPreset);
$("deletePreset").addEventListener("click", deletePreset);
$("toggleMain").addEventListener("click", toggleMain);
$("toggleAgg").addEventListener("click", toggleAgg);
bindMainModal();

document.addEventListener("DOMContentLoaded", load);
