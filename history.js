// history.js —— 划词AI释义 历史记录页逻辑
// 读取 chrome.storage.local["history"]，支持搜索、单条删除、清空、导出为 Markdown 文件。

const HISTORY_KEY = "history";
const EXPORT_OPTS_KEY = "exportOpts"; // 导出选项：是否包含 时间/来源页面/页面地址
const DISPLAY_OPTS_KEY = "displayOpts"; // 显示设置：页面背景色/原文背景色/字体颜色/字体大小/字体
const DISPLAY_PRESETS_KEY = "displayPresets"; // 已保存的显示样式组列表
const SOURCE_TEXTS_KEY = "sourceTexts"; // 来源主文：{ srcKey: 文本 }
const SHOW_MAIN_KEY = "showMainText"; // 是否显示来源主文
const AGG_KEY = "aggregate"; // 是否按来源聚合
const SETTINGS_HIDDEN_KEY = "settingsHidden"; // 是否隐藏所有设置
const AGG_ORDER_KEY = "aggOrder"; // 聚合模式下每来源记录的手工排序（{ srcKey: [记录id] }）

const $ = (id) => document.getElementById(id);

let all = []; // 当前全部记录（新→旧）
let exportOpts = { time: true, pageTitle: true, pageUrl: true, count: true, sep: true, compact: false, noSplit: false }; // 导出选项
let displayPresets = []; // [{ name, opts }] 已保存的样式组
let sourceTexts = {}; // { srcKey: 主文 } 按来源保存的主文
let mainModalKey = ""; // 当前正在编辑主文的 srcKey
let showMainText = true; // 列表是否显示来源主文
let aggregate = false; // 是否按来源聚合
let settingsHidden = false; // 是否隐藏所有设置
let aggOrder = {}; // 聚合模式下每来源记录的手工排序
const PAGE_SIZE = 10; // 历史页分页：每页记录/组数
let page = 1; // 当前页码

// 显示设置默认值
const DEFAULT_DISPLAY = {
  pageBg: "#eef2ff",
  quoteBg: "#e0e7ff",
  mainBg: "#f4f4fe",
  fontColor: "#1f2937",
  fontSize: 13,
  lineHeight: 1.2,
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

// 当前有效字体：优先预设下拉，否则自定义输入框，最后回退默认
function currentFontFamily() {
  const p = $("optFontPreset").value;
  if (p) return p;
  const c = $("optFontFamily").value.trim();
  return c || DEFAULT_DISPLAY.fontFamily;
}

// 把 hex 颜色按 HSL 降低明度 amt（0~1），返回同色相的加深色
function darken(hex, amt) {
  hex = (hex || "#fff").replace("#", "");
  if (hex.length === 3) hex = hex.split("").map((c) => c + c).join("");
  const r = parseInt(hex.slice(0, 2), 16) / 255;
  const g = parseInt(hex.slice(2, 4), 16) / 255;
  const b = parseInt(hex.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
    else if (max === g) h = ((b - r) / d + 2) * 60;
    else h = ((r - g) / d + 4) * 60;
  }
  const L = Math.max(0.04, l - amt);
  const c = (1 - Math.abs(2 * L - 1)) * s;
  const hh = ((h % 360) + 360) % 360 / 60;
  const x = c * (1 - Math.abs((hh % 2) - 1));
  let r1 = 0, g1 = 0, b1 = 0;
  if (hh < 1) { r1 = c; g1 = x; }
  else if (hh < 2) { r1 = x; g1 = c; }
  else if (hh < 3) { g1 = c; b1 = x; }
  else if (hh < 4) { g1 = x; b1 = c; }
  else if (hh < 5) { r1 = x; b1 = c; }
  else { r1 = c; b1 = x; }
  const m = L - c / 2;
  const toHex = (n) =>
    Math.round(Math.min(255, Math.max(0, (n + m) * 255)))
      .toString(16).padStart(2, "0");
  return "#" + toHex(r1) + toHex(g1) + toHex(b1);
}

// 三个背景色共用的推荐调色盘（25 色，浅色柔和、适合背景；按色相环排列）
const BG_PALETTE = [
  "#fef2f2", // 极浅红（红）
  "#fff7ed", // 极浅暖橙（橙）
  "#ffedd5", // 浅暖橙（橙）
  "#fefce8", // 极浅米黄（黄）
  "#fef9c3", // 浅黄（黄）
  "#f0fdf4", // 极浅绿（绿）
  "#ecfdf5", // 极浅薄荷（绿/青）
  "#d1fae5", // 薄荷（青）
  "#f0f9ff", // 极浅天蓝（青/蓝）
  "#e0f2fe", // 浅天蓝（蓝）
  "#eff6ff", // 极浅蓝（蓝）
  "#eef2ff", // 浅蓝靛（蓝/靛）
  "#e0e7ff", // 浅靛（靛）
  "#ddd6fe", // 靛（靛/紫）
  "#ede9fe", // 极浅薰衣草（紫）
  "#f3e8ff", // 浅薰衣草（紫）
  "#fae8ff", // 浅粉紫（紫/品红）
  "#fdf2f8", // 极浅粉（品红）
  "#fce7f3", // 浅粉（品红）
  "#faf5ff", // 极浅紫白（紫白）
  "#f5f5f4", // 中性暖灰（灰）
  "#f1f5f9", // 浅灰蓝（灰蓝）
  "#f8fafc", // 冷白浅灰（灰）
  "#fafafa", // 暖白（白）
  "#ffffff", // 纯白（白）
];

// 推荐字体颜色（深色、适合正文阅读）
const FONT_RECOMMEND = [
  "#000000", // 纯黑
  "#374151", // 深灰
  "#1e3a8a", // 深蓝
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
  s.setProperty("--main-bg", d.mainBg);
  s.setProperty("--main-border", darken(d.mainBg, 0.12));
  s.setProperty("--font-color", d.fontColor);
  s.setProperty("--font-size", d.fontSize + "px");
  s.setProperty("--font-family", toFontFamilyCss(d.fontFamily));
  s.setProperty("--line-height", d.lineHeight);
  $("optFontSizeVal").textContent = d.fontSize;
  $("optLineHeightVal").textContent = d.lineHeight;
}

// 导出 HTML 时，把显示设置写成覆盖规则追加到样式末尾
function buildDisplayCss(d) {
  const ff = toFontFamilyCss(d.fontFamily);
  return (
    "body{background:" + d.pageBg + ";color:" + d.fontColor +
      ";font-family:" + ff + ";font-size:" + d.fontSize + "px}" +
    ".item-text{background:" + d.quoteBg + ";color:" + d.fontColor +
      ";font-size:" + d.fontSize + "px}" +
    ".item-answer{color:" + d.fontColor + ";font-size:" + d.fontSize +
      "px;line-height:" + d.lineHeight + "}" +
    ".item-main{background:" + d.mainBg + ";color:" + d.fontColor +
      ";border-left:3px solid " + darken(d.mainBg, 0.12) + "}"
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
  $("optMainBg").value = displayOpts.mainBg;
  $("optFontColor").value = displayOpts.fontColor;
  $("optFontSize").value = displayOpts.fontSize;
  $("optLineHeight").value = displayOpts.lineHeight;
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
  syncColorSwatches("mainSwatches", "optMainBg");
  syncColorSwatches("fontSwatches", "optFontColor");
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
      [SETTINGS_HIDDEN_KEY]: false,
      [AGG_ORDER_KEY]: {},
    },
    (res) => {
      all = Array.isArray(res[HISTORY_KEY]) ? res[HISTORY_KEY] : [];
      exportOpts = { ...exportOpts, ...(res[EXPORT_OPTS_KEY] || {}) };
      $("optTime").checked = exportOpts.time;
      $("optPageTitle").checked = exportOpts.pageTitle;
      $("optPageUrl").checked = exportOpts.pageUrl;
      $("optCount").checked = exportOpts.count;
      $("optSep").checked = exportOpts.sep;
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
      settingsHidden = res[SETTINGS_HIDDEN_KEY] === true;
      syncSettingsBtn();
      aggOrder = (res[AGG_ORDER_KEY] && typeof res[AGG_ORDER_KEY] === "object") ? res[AGG_ORDER_KEY] : {};

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
      count: $("optCount").checked,
      sep: $("optSep").checked,
      compact: $("optCompact").checked,
      noSplit: $("optNoSplit").checked,
    };
    chrome.storage.local.set({ [EXPORT_OPTS_KEY]: exportOpts });
  };
  $("optTime").addEventListener("change", persist);
  $("optPageTitle").addEventListener("change", persist);
  $("optPageUrl").addEventListener("change", persist);
  $("optCount").addEventListener("change", persist);
  $("optSep").addEventListener("change", persist);
  $("optCompact").addEventListener("change", persist);
  $("optNoSplit").addEventListener("change", persist);
}

// 显示设置变更时即时生效并保存
function bindDisplay() {
  const persist = () => {
    displayOpts = {
      pageBg: $("optPageBg").value,
      quoteBg: $("optQuoteBg").value,
      mainBg: $("optMainBg").value,
      fontColor: $("optFontColor").value,
      fontSize: Number($("optFontSize").value),
      lineHeight: Number($("optLineHeight").value),
      fontFamily: currentFontFamily(),
    };
    applyDisplay(displayOpts);
    $("presetSelect").value = ""; // 手动调整后，样式组下拉不再指向任何已存组
    syncColorSwatches("bgSwatches", "optPageBg");
    syncColorSwatches("quoteSwatches", "optQuoteBg");
    syncColorSwatches("mainSwatches", "optMainBg");
    syncColorSwatches("fontSwatches", "optFontColor");
    chrome.storage.local.set({ [DISPLAY_OPTS_KEY]: displayOpts });
  };
  $("optPageBg").addEventListener("input", persist);
  $("optQuoteBg").addEventListener("input", persist);
  $("optMainBg").addEventListener("input", persist);
  $("optFontColor").addEventListener("input", persist);
  $("optFontSize").addEventListener("input", persist);
  $("optLineHeight").addEventListener("input", persist);
  // 字体：预设下拉 + 自定义输入框
  $("optFontPreset").addEventListener("change", () => {
    if ($("optFontPreset").value === "") {
      // 选中「自定义…」：保持现有字体，聚焦输入框让用户手输
      $("optFontFamily").focus();
      return;
    }
    $("optFontFamily").value = "";
    persist();
  });
  $("optFontFamily").addEventListener("input", () => {
    const raw = $("optFontFamily").value.trim();
    $("optFontPreset").value = matchFontPreset(raw || DEFAULT_DISPLAY.fontFamily);
    persist();
  });
  // 恢复默认显示样式（带确认）
  $("resetDisplay").addEventListener("click", () => {
    if (!window.confirm("确定恢复默认显示样式吗？当前自定义设置将被清除。")) return;
    displayOpts = { ...DEFAULT_DISPLAY };
    $("optPageBg").value = displayOpts.pageBg;
    $("optQuoteBg").value = displayOpts.quoteBg;
    $("optMainBg").value = displayOpts.mainBg;
    $("optFontColor").value = displayOpts.fontColor;
    $("optFontSize").value = displayOpts.fontSize;
    $("optLineHeight").value = displayOpts.lineHeight;
    $("optFontPreset").value = FONT_OPTIONS[0].value; // 默认
    $("optFontFamily").value = "";
    $("presetSelect").value = ""; // 恢复默认后不再指向已存样式组
    syncColorSwatches("bgSwatches", "optPageBg");
    syncColorSwatches("quoteSwatches", "optQuoteBg");
    syncColorSwatches("mainSwatches", "optMainBg");
    syncColorSwatches("fontSwatches", "optFontColor");
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
    renderPager(0);
    return;
  }

  if (aggregate) {
    renderAggregated(list);
    return;
  }

  box.innerHTML = "";
  const pages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
  if (page > pages) page = pages;
  const slice = list.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  for (const e of slice) {
    box.appendChild(buildItemCard(e));
  }
  renderPager(list.length);
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
  const rec = all.find((e) => e.id === id);
  const hint = rec && rec.text ? rec.text.slice(0, 24) : "该条记录";
  if (!window.confirm("确定删除这条记录吗？「" + hint + "…」")) return;
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
  entries.forEach(([key, recs]) => {
    recs.sort((a, b) => a.time - b.time);
    const srcKey = key.startsWith("__no_") ? "" : key;
    const order = aggOrder[srcKey];
    if (order && Array.isArray(order) && order.length) {
      const byId = new Map(recs.map((r) => [r.id, r]));
      const seen = new Set();
      const ordered = [];
      for (const id of order) {
        const r = byId.get(id);
        if (r && !seen.has(id)) { ordered.push(r); seen.add(id); }
      }
      for (const r of recs) if (!seen.has(r.id)) ordered.push(r);
      recs.splice(0, recs.length, ...ordered);
    }
  });
  entries.sort((a, b) => {
    const ma = Math.max(...a[1].map((r) => r.time));
    const mb = Math.max(...b[1].map((r) => r.time));
    return mb - ma;
  });
  return entries;
}

// 聚合模式下移动某条记录在其来源内的位置，并持久化手工排序
function moveInOrder(srcKey, index, dir, recs) {
  const target = index + dir;
  if (target < 0 || target >= recs.length) return;
  [recs[index], recs[target]] = [recs[target], recs[index]];
  aggOrder[srcKey] = recs.map((r) => r.id);
  chrome.storage.local.set({ [AGG_ORDER_KEY]: aggOrder });
  render();
}

// 翻页后跳转到列表顶部
function jumpTop() {
  const list = $("list");
  if (list && list.scrollIntoView) list.scrollIntoView({ block: "start" });
}

// 渲染分页条，超过一页时显示「上一页 / 第 x / N 页 / 下一页」
function renderPager(total) {
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (page > pages) page = pages;
  const pager = $("pager");
  pager.innerHTML = "";
  if (pages <= 1) return;
  const prev = document.createElement("button");
  prev.className = "page-btn";
  prev.textContent = "‹ 上一页";
  prev.disabled = page <= 1;
  prev.addEventListener("click", () => { if (page > 1) { page--; render(); jumpTop(); } });
  pager.appendChild(prev);
  const info = document.createElement("span");
  info.className = "page-info";
  info.textContent = "第 " + page + " / " + pages + " 页";
  pager.appendChild(info);
  const next = document.createElement("button");
  next.className = "page-btn";
  next.textContent = "下一页 ›";
  next.disabled = page >= pages;
  next.addEventListener("click", () => { if (page < pages) { page++; render(); jumpTop(); } });
  pager.appendChild(next);
}

function renderAggregated(list) {
  const box = $("list");
  box.innerHTML = "";
  const entries = groupRecords(list);
  const pages = Math.max(1, Math.ceil(entries.length / PAGE_SIZE));
  if (page > pages) page = pages;
  const slice = entries.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  for (const [key, recs] of slice) {
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
    for (let idx = 0; idx < recs.length; idx++) {
      const e = recs[idx];
      const gi = document.createElement("div");
      gi.className = "agg-item";

      const giHead = document.createElement("div");
      giHead.className = "agg-item-head";
      const t = document.createElement("span");
      t.className = "agg-item-time";
      t.textContent = formatTime(e.time);
      giHead.appendChild(t);
      const up = document.createElement("button");
      up.className = "item-move";
      up.title = "上移";
      up.textContent = "↑";
      up.disabled = idx === 0;
      up.addEventListener("click", () => moveInOrder(srcKey, idx, -1, recs));
      giHead.appendChild(up);
      const down = document.createElement("button");
      down.className = "item-move";
      down.title = "下移";
      down.textContent = "↓";
      down.disabled = idx === recs.length - 1;
      down.addEventListener("click", () => moveInOrder(srcKey, idx, 1, recs));
      giHead.appendChild(down);
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
  renderPager(entries.length);
}

function syncAggBtn() {
  $("toggleAgg").classList.toggle("active", aggregate);
  // 条数、分隔线仅聚合模式有意义：关闭聚合时隐藏对应复选框
  ["optCount", "optSep"].forEach((id) => {
    const w = $(id).closest("label");
    if (w) w.style.display = aggregate ? "" : "none";
  });
}

function toggleAgg() {
  aggregate = !aggregate;
  chrome.storage.local.set({ [AGG_KEY]: aggregate });
  syncAggBtn();
  page = 1;
  render();
}

function syncSettingsBtn() {
  $("toggleSettings").textContent = settingsHidden ? "显示设置" : "隐藏设置";
  $("settingsArea").style.display = settingsHidden ? "none" : "";
}

function toggleSettings() {
  settingsHidden = !settingsHidden;
  chrome.storage.local.set({ [SETTINGS_HIDDEN_KEY]: settingsHidden });
  syncSettingsBtn();
}

function clearAll() {
  if (!all.length) {
    setStatus("当前没有可清空的记录。", true);
    return;
  }
  if (window.prompt('清空全部历史记录不可恢复。请输入"清空全部"以确认：') !== "清空全部") return;
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
      if (showMainText && sourceTexts[e.pageUrl || e.pageTitle || ""]) {
        lines.push(sourceTexts[e.pageUrl || e.pageTitle || ""]);
        lines.push("");
      }
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
      if (showMainText && sourceTexts[e.pageUrl || e.pageTitle || ""]) {
        lines.push(sourceTexts[e.pageUrl || e.pageTitle || ""]);
        lines.push("");
      }
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
    if (opts.count) lines.push("- **条数**：" + recs.length);
    lines.push("");
    if (opts.pageUrl && first.pageUrl) lines.push("- **页面地址**：" + first.pageUrl);
    if (showMainText && sourceTexts[srcKey]) {
      lines.push("");
      lines.push(sourceTexts[srcKey]);
      lines.push("");
    }
    recs.forEach((e, j) => {
      if (opts.sep && j > 0) lines.push("---");
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
.item-main-label{font-size:11px;color:var(--muted);margin-bottom:2px}.agg-items.no-sep .agg-item{border-top:none;padding-top:0}
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
  const srcKey = e.pageUrl || e.pageTitle || "";
  const main =
    showMainText && sourceTexts[srcKey]
      ? '<div class="item-main">' + esc(sourceTexts[srcKey]) + "</div>"
      : "";
  return (
    '<div class="card">' +
    '<div class="item-head">' + head.join("") + "</div>" +
    main +
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
      if (opts.count) head.push('<span class="item-count">' + recs.length + " 条</span>");
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
        '<div class="agg-items' + (opts.sep ? "" : " no-sep") + '">' + items + "</div>" +
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
$("search").addEventListener("input", () => { page = 1; render(); });
$("searchClear").addEventListener("click", () => {
  $("search").value = "";
  page = 1;
  render();
});
$("export").addEventListener("click", exportMd);
$("exportHtml").addEventListener("click", exportHtml);
$("clear").addEventListener("click", clearAll);
initFontSelect();
initColorSwatches("bgSwatches", "optPageBg", BG_PALETTE);
initColorSwatches("quoteSwatches", "optQuoteBg", BG_PALETTE);
initColorSwatches("mainSwatches", "optMainBg", BG_PALETTE);
initColorSwatches("fontSwatches", "optFontColor", FONT_RECOMMEND);
bindExportOpts();
bindDisplay();
$("saveDisplay").addEventListener("click", saveDisplay);
$("presetSelect").addEventListener("change", applyPreset);
$("deletePreset").addEventListener("click", deletePreset);
$("toggleMain").addEventListener("click", toggleMain);
$("toggleAgg").addEventListener("click", toggleAgg);
$("toggleSettings").addEventListener("click", toggleSettings);
bindMainModal();

document.addEventListener("DOMContentLoaded", load);
