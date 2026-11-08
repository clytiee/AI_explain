// history.js —— 划词AI释义 历史记录页逻辑
// 读取 chrome.storage.local["history"]，支持搜索、单条删除、清空、导出为 Markdown 文件。

const HISTORY_KEY = "history";
const EXPORT_OPTS_KEY = "exportOpts"; // 导出选项：是否包含 时间/来源页面/页面地址
const DISPLAY_OPTS_KEY = "displayOpts"; // 显示设置：页面背景色/原文背景色/字体颜色/字体大小/字体
const TPL_OVERRIDES_KEY = "tplStyleOverrides"; // 各模板下用户改过的样式字段（空表示没改，用模板原样式）
const DISPLAY_PRESETS_KEY = "displayPresets"; // 已保存的显示样式组列表
const SOURCE_TEXTS_KEY = "sourceTexts"; // 来源主文：{ srcKey: 文本 }
const SHOW_MAIN_KEY = "showMainText"; // 是否显示来源主文
const AGG_KEY = "aggregate"; // 是否按来源聚合
const SETTINGS_HIDDEN_KEY = "settingsHidden"; // 是否隐藏所有设置
const READONLY_KEY = "readOnly"; // 只读模式（默认 false＝编辑模式）
const AGG_ORDER_KEY = "aggOrder"; // 聚合模式下每来源记录的手工排序（{ srcKey: [记录id] }）
const STYLE_TPL_KEY = "styleTemplate"; // 列表风格模板（见 STYLE_TEMPLATES）
const STYLE_PANEL_KEY = "stylePanelOpen"; // 设置区里字体/颜色/圆角面板是否展开（默认收起）

const $ = (id) => document.getElementById(id);

let all = []; // 当前全部记录（新→旧）
let exportOpts = { time: true, pageTitle: true, pageUrl: true, count: true, tags: true, sep: true, compact: false, noSplit: false, printBlack: true, backup: false }; // 导出选项
let displayPresets = []; // [{ name, opts }] 已保存的样式组
let sourceTexts = {}; // { srcKey: 主文 } 按来源保存的主文
let mainModalKey = ""; // 当前正在编辑主文的 srcKey
let showMainText = true; // 列表是否显示来源主文
let aggregate = false; // 是否按来源聚合
let settingsHidden = false; // 是否隐藏所有设置
let readOnly = false; // 只读模式：卡片里不显示任何操作图标
let aggOrder = {}; // 聚合模式下每来源记录的手工排序
const PAGE_SIZE = 10; // 历史页分页：每页记录/组数
let page = 1; // 当前页码
const UNTAGGED = " __untagged__"; // 标签筛选里的「无标签」伪标签（带空格，不会撞真实标签名）
let tagFilter = []; // 标签筛选（默认单选取一个；选了「或 / 且」后可多选；「无标签」用 UNTAGGED 表示）
let tagMode = ""; // 多选标签之间的关系："or"=命中任意一个，"and"=必须全部命中，空=未选模式（单选取一个）
let titleRules = []; // 来源标题替换规则（来自 config.titleRules）：[{ prefix, from, to }]

// 显示设置默认值
// 字体设置分三个作用域：原文（fontXxx）、释义（ansFontXxx）、主文（mainFontXxx）
const DEFAULT_DISPLAY = {
  pageBg: "#eef2ff",
  quoteBg: "#e0e7ff",
  mainBg: "#f4f4fe",
  extractBg: "#eff6ff",
  fontColor: "#1f2937",
  fontSize: 13,
  lineHeight: 1.2,
  ansFontColor: "#1f2937",
  ansFontSize: 13,
  ansLineHeight: 1.2,
  mainFontColor: "#1f2937",
  mainFontSize: 13,
  mainLineHeight: 1.7,
  // 卡片与导出里的时间格式：second 到秒 / date 到日 / short 精简 YY/M/D
  timeDisplay: "second",
  cardRadius: 16,
  quoteRadius: 8,
  extractRadius: 0,
  fontFamily:
    "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', Roboto, sans-serif",
  ansFontFamily:
    "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', Roboto, sans-serif",
  mainFontFamily:
    "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', Roboto, sans-serif",
};

// 字体作用域：tab → 字段名映射
const FONT_SCOPES = {
  quote: { family: "fontFamily", color: "fontColor", size: "fontSize", line: "lineHeight", label: "原文" },
  answer: { family: "ansFontFamily", color: "ansFontColor", size: "ansFontSize", line: "ansLineHeight", label: "释义" },
  main: { family: "mainFontFamily", color: "mainFontColor", size: "mainFontSize", line: "mainLineHeight", label: "主文" },
};
let fontScope = "quote";
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

// 由浅色背景生成“引文左边框”的深色：固定低明度并压低饱和度，
// 避免直接用 darken 把浅色压成鲜艳的亮色（浅色底明度高、饱和低，只降明度会变鲜艳）
function deepBorder(hex) {
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
  const L = 0.45;              // 明度：太深会发黑，取偏亮的中深色
  const S = Math.min(s, 0.5);  // 控制饱和度，避免过艳
  const c = (1 - Math.abs(2 * L - 1)) * S;
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
  "#dcfce7", // 浅绿（绿）
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
  { c: "#000000", name: "纯黑" },
  { c: "#374151", name: "深灰" },
  { c: "#1e3a8a", name: "深蓝" },
];

// 各模板用到的字体颜色（[{c,name}]），随模板切换刷新到字体颜色快捷色块
let tplFontPalette = [];

// 字体颜色快捷色块：常驻推荐色 + 当前模板在「当前作用域」用到的字色
function refreshFontSwatches() {
  const box = $("fontSwatches");
  if (!box) return;
  const colors = FONT_RECOMMEND.slice();
  const scopeLabel = (FONT_SCOPES[fontScope] || FONT_SCOPES.quote).label;
  const push = (item) => {
    const v = String(item.c || "").trim().toLowerCase();
    if (!/^#[0-9a-f]{6}$/.test(v)) return;
    if (colors.some((x) => String(x.c).toLowerCase() === v)) return;
    colors.push({ c: v, name: item.name || "" });
  };
  tplFontPalette.filter((p) => String(p.name || "").indexOf(scopeLabel) >= 0).forEach(push);
  box.innerHTML = "";
  initColorSwatches("fontSwatches", "optFontColor", colors);
  syncColorSwatches("fontSwatches", "optFontColor");
}

function initColorSwatches(containerId, inputId, colors) {
  const box = $(containerId);
  colors.forEach((item) => {
    const c = typeof item === "string" ? item : item.c;
    const name = typeof item === "string" ? "" : item.name || "";
    const b = document.createElement("button");
    b.type = "button";
    b.className = "bg-swatch";
    b.style.background = c;
    b.dataset.color = String(c).toLowerCase();
    b.title = name ? name + "（" + c + "）" : c;
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
    b.classList.toggle("active", (b.dataset.color || b.title).toLowerCase() === cur);
  });
}

// 将显示设置写入 CSS 变量
function applyDisplay(d) {
  const s = document.documentElement.style;
  s.setProperty("--page-bg", d.pageBg);
  s.setProperty("--quote-bg", d.quoteBg);
  s.setProperty("--extract-bg", d.extractBg);
  s.setProperty("--extract-border", deepBorder(d.extractBg));
  s.setProperty("--main-bg", d.mainBg);
  s.setProperty("--main-border", darken(d.mainBg, 0.12));
  s.setProperty("--font-color", d.fontColor);
  s.setProperty("--font-size", d.fontSize + "px");
  s.setProperty("--font-family", toFontFamilyCss(d.fontFamily));
  s.setProperty("--line-height", d.lineHeight);
  s.setProperty("--ans-font-color", d.ansFontColor || DEFAULT_DISPLAY.ansFontColor);
  s.setProperty("--ans-font-size", (d.ansFontSize || DEFAULT_DISPLAY.ansFontSize) + "px");
  s.setProperty("--ans-font-family", toFontFamilyCss(d.ansFontFamily || d.fontFamily));
  s.setProperty("--ans-line-height", d.ansLineHeight || DEFAULT_DISPLAY.ansLineHeight);
  s.setProperty("--main-font-color", d.mainFontColor || DEFAULT_DISPLAY.mainFontColor);
  s.setProperty("--main-font-size", (d.mainFontSize || DEFAULT_DISPLAY.mainFontSize) + "px");
  s.setProperty("--main-font-family", toFontFamilyCss(d.mainFontFamily || d.fontFamily));
  s.setProperty("--main-line-height", d.mainLineHeight || DEFAULT_DISPLAY.mainLineHeight);
  s.setProperty("--card-radius", (Number(d.cardRadius) || 0) + "px");
  s.setProperty("--quote-radius", (Number(d.quoteRadius) || 0) + "px");
  s.setProperty("--extract-radius", (Number(d.extractRadius) || 0) + "px");
  syncFontScopeValues(d);
  $("optCardRadiusVal").textContent = Number(d.cardRadius) || 0;
  $("optQuoteRadiusVal").textContent = Number(d.quoteRadius) || 0;
  $("optExtractRadiusVal").textContent = Number(d.extractRadius) || 0;
}

// 字体作用域里的两个数值标签（跟着当前 tab 走）
function syncFontScopeValues(d) {
  const sc = FONT_SCOPES[fontScope] || FONT_SCOPES.quote;
  const size = d[sc.size] || DEFAULT_DISPLAY[sc.size];
  const line = d[sc.line] || DEFAULT_DISPLAY[sc.line];
  if ($("optFontSizeVal")) $("optFontSizeVal").textContent = size;
  if ($("optLineHeightVal")) $("optLineHeightVal").textContent = line;
}

// ---------- 模板样式 ↔ 样式设置 ----------
// 选中某个风格模板后，把该模板实际的底色/字号/行高等读进样式设置面板；
// 用户在面板上的改动只作为「覆盖层」记录（tplOverrides[模板]），生成一条更高优先级的 CSS，
// 不改动模板本身的 CSS。没改过的字段不生成覆盖，模板原样式原封不动。

let tplOverrides = {}; // { 模板 id: { 字段: 值 } }
let tplSnapshot = { ...DEFAULT_DISPLAY }; // 当前模板的原始样式快照（面板的「模板默认值」）
let glassDisplay = { ...DEFAULT_DISPLAY }; // 默认模板自己的显示设置（其它模板下 displayOpts 会换成模板值）

// 面板里可调、且能映射到模板样式的字段
const SNAP_KEYS = [
  "pageBg", "quoteBg", "extractBg", "mainBg",
  // 原文
  "fontFamily", "fontColor", "fontSize", "lineHeight",
  // 释义
  "ansFontFamily", "ansFontColor", "ansFontSize", "ansLineHeight",
  // 主文
  "mainFontFamily", "mainFontColor", "mainFontSize", "mainLineHeight",
  // 圆角
  "cardRadius", "quoteRadius", "extractRadius",
];

function parseCssColor(c) {
  const m = String(c || "").match(/^rgba?\([\s]*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+))?[\s]*\)$/i);
  if (!m) return null;
  return { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] };
}

function blendColor(fg, bg) {
  if (!fg) return bg;
  if (fg.a >= 1) return fg;
  return {
    r: fg.r * fg.a + bg.r * (1 - fg.a),
    g: fg.g * fg.a + bg.g * (1 - fg.a),
    b: fg.b * fg.a + bg.b * (1 - fg.a),
    a: 1,
  };
}

function colorToHex(c) {
  const n = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
  return "#" + n(c.r) + n(c.g) + n(c.b);
}

function cssPx(v) {
  const n = parseFloat(v);
  return isNaN(n) ? 0 : Math.round(n * 10) / 10;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

// 离屏探针：用真实 DOM 让模板 CSS 生效，再读计算样式
function templateProbe() {
  let p = document.getElementById("tplProbe");
  if (p) return p;
  p = document.createElement("div");
  p.id = "tplProbe";
  p.style.cssText = "position:absolute;left:-9999px;top:0;visibility:hidden;pointer-events:none;width:600px";
  p.innerHTML =
    '<div class="card">' +
    '<div class="item-text">探针文字</div>' +
    '<div class="item-text item-text-extract">探针文字</div>' +
    '<div class="item-main">探针文字</div>' +
    '<div class="item-answer"><p>探针文字</p></div>' +
    "</div>";
  document.body.appendChild(p);
  return p;
}

function captureTemplateStyle() {
  const probe = templateProbe();
  const card = probe.querySelector(".card");
  const q = probe.querySelector(".item-text");
  const ex = probe.querySelector(".item-text-extract");
  const mn = probe.querySelector(".item-main");
  const listEl = $("list") || document.body;
  const cs = (el) => getComputedStyle(el);

  const white = { r: 255, g: 255, b: 255, a: 1 };
  const page = blendColor(parseCssColor(cs(listEl).backgroundColor), white);
  const cardBg = blendColor(parseCssColor(cs(card).backgroundColor), page);
  const quoteBg = blendColor(parseCssColor(cs(q).backgroundColor), cardBg);
  const extractBg = blendColor(parseCssColor(cs(ex).backgroundColor), cardBg);
  const mainBg = blendColor(parseCssColor(cs(mn).backgroundColor), cardBg);

  const fs = parseFloat(cs(q).fontSize) || 13;
  const lh = cs(q).lineHeight;
  const lineHeight = lh === "normal" ? 1.5 : round2(parseFloat(lh) / fs);
  const mfs = parseFloat(cs(mn).fontSize) || 13;
  const mlh = cs(mn).lineHeight;
  const mainLineHeight = mlh === "normal" ? 1.7 : round2(parseFloat(mlh) / mfs);

  const answerColor = colorToHex(parseCssColor(cs(probe.querySelector(".item-answer")).color) || { r: 31, g: 41, b: 55, a: 1 });
  const mainColor = colorToHex(parseCssColor(cs(mn).color) || { r: 31, g: 41, b: 55, a: 1 });
  const textColor = colorToHex(parseCssColor(cs(q).color) || { r: 31, g: 41, b: 55, a: 1 });
  const an = probe.querySelector(".item-answer");
  const afs = parseFloat(cs(an).fontSize) || 13;
  const alh = cs(an).lineHeight;
  return {
    palette: [
      { c: textColor, name: "模板原文色" },
      { c: answerColor, name: "模板释义色" },
      { c: mainColor, name: "模板主文色" },
    ],
    pageBg: colorToHex(page),
    quoteBg: colorToHex(quoteBg),
    extractBg: colorToHex(extractBg),
    mainBg: colorToHex(mainBg),
    // 原文
    fontColor: textColor,
    fontSize: Math.round(fs),
    lineHeight,
    fontFamily: cs(q).fontFamily,
    // 释义
    ansFontColor: answerColor,
    ansFontSize: Math.round(afs),
    ansLineHeight: alh === "normal" ? 1.5 : round2(parseFloat(alh) / afs),
    ansFontFamily: cs(an).fontFamily,
    // 主文
    mainFontColor: mainColor,
    mainFontSize: Math.round(mfs),
    mainLineHeight,
    mainFontFamily: cs(mn).fontFamily,
    cardRadius: cssPx(cs(card).borderTopLeftRadius),
    quoteRadius: cssPx(cs(q).borderTopLeftRadius),
    extractRadius: cssPx(cs(ex).borderTopLeftRadius),
  };
}

// 覆盖层 CSS：选择器比模板规则更具体（多一层 .card / #list），所以一定盖得住
function tplOverrideCss(id, ov, forExport) {
  const sel = 'body[data-tpl="' + id + '"] ';
  const parts = [];
  if (ov.pageBg) {
    parts.push(forExport ? "body{background:" + ov.pageBg + "}" : sel + "#list{background:" + ov.pageBg + "}");
  }
  if (ov.quoteBg) parts.push(sel + ".card .item-text{background:" + ov.quoteBg + "}");
  if (ov.extractBg) parts.push(sel + ".item-text-extract{background:" + ov.extractBg + "}");
  // 原文
  if (ov.fontColor) parts.push(sel + ".card .item-text{color:" + ov.fontColor + "}");
  if (ov.fontSize) parts.push(sel + ".card .item-text{font-size:" + ov.fontSize + "px}");
  if (ov.lineHeight) parts.push(sel + ".card .item-text{line-height:" + ov.lineHeight + "}");
  if (ov.fontFamily) parts.push(sel + ".card .item-text{font-family:" + toFontFamilyCss(ov.fontFamily) + "}");
  // 释义
  if (ov.ansFontColor) parts.push(sel + ".card .item-answer{color:" + ov.ansFontColor + "}");
  if (ov.ansFontSize) parts.push(sel + ".card .item-answer{font-size:" + ov.ansFontSize + "px}");
  if (ov.ansLineHeight) parts.push(sel + ".card .item-answer{line-height:" + ov.ansLineHeight + "}");
  if (ov.ansFontFamily)
    parts.push(sel + ".card .item-answer{font-family:" + toFontFamilyCss(ov.ansFontFamily) + "}");
  // 主文
  if (ov.mainFontColor) parts.push(sel + ".card .item-main{color:" + ov.mainFontColor + "}");
  if (ov.mainFontSize) parts.push(sel + ".card .item-main{font-size:" + ov.mainFontSize + "px}");
  if (ov.mainLineHeight) parts.push(sel + ".card .item-main{line-height:" + ov.mainLineHeight + "}");
  if (ov.mainFontFamily)
    parts.push(sel + ".card .item-main{font-family:" + toFontFamilyCss(ov.mainFontFamily) + "}");
  if (ov.cardRadius !== undefined) parts.push(sel + ".card{border-radius:" + (Number(ov.cardRadius) || 0) + "px}");
  if (ov.quoteRadius !== undefined) parts.push(sel + ".card .item-text{border-radius:" + (Number(ov.quoteRadius) || 0) + "px}");
  if (ov.extractRadius !== undefined)
    parts.push(sel + ".item-text-extract{border-radius:" + (Number(ov.extractRadius) || 0) + "px}");
  return parts.join("\n");
}

function injectTemplateOverrideStyle() {
  let style = document.getElementById("tplOverrideStyle");
  if (!style) {
    style = document.createElement("style");
    style.id = "tplOverrideStyle";
    document.head.appendChild(style);
  }
  const ov = styleTemplate === "glass" ? null : tplOverrides[styleTemplate];
  style.textContent = ov && Object.keys(ov).length ? tplOverrideCss(styleTemplate, ov, false) : "";
}

// 数值型字段允许一点取整误差（滑块步长、计算后的 line-height 小数）
function styleValueDiffers(key, a, b) {
  if (a === undefined || b === undefined) return false;
  if (typeof a === "number" || typeof b === "number") {
    const x = Number(a);
    const y = Number(b);
    if (!isFinite(x) || !isFinite(y)) return true;
    const tol = key === "lineHeight" || key === "mainLineHeight" ? 0.06 : 0.6;
    return Math.abs(x - y) > tol;
  }
  return String(a || "").trim().toLowerCase() !== String(b || "").trim().toLowerCase();
}

// 当前面板值与「模板默认值」的差异（默认模板以 DEFAULT_DISPLAY 为基准）
function currentStyleDiff() {
  const base = styleTemplate === "glass" ? DEFAULT_DISPLAY : tplSnapshot;
  const diff = {};
  SNAP_KEYS.forEach((k) => {
    if (styleValueDiffers(k, displayOpts[k], base[k])) diff[k] = displayOpts[k];
  });
  return diff;
}

function updateStyleModifiedHint() {
  const hint = $("styleModified");
  if (!hint) return;
  const modified = Object.keys(currentStyleDiff()).length > 0;
  hint.hidden = !modified;
}

// 切换模板后，把该模板的默认样式灌进面板（叠加该模板已保存的改动）
function syncTemplateStyleState() {
  const keepTimeDisplay = displayOpts && displayOpts.timeDisplay;
  if (styleTemplate === "glass") {
    tplSnapshot = { ...DEFAULT_DISPLAY };
    tplFontPalette = [];
    displayOpts = { ...DEFAULT_DISPLAY, ...glassDisplay, ...(tplOverrides.glass || {}) };
  } else {
    // 先把 CSS 变量还原成默认，避免上一个模板/设置的值被读进快照
    applyDisplay(DEFAULT_DISPLAY);
    tplSnapshot = captureTemplateStyle();
    tplFontPalette = Array.isArray(tplSnapshot.palette) ? tplSnapshot.palette : [];
    delete tplSnapshot.palette; // palette 只给色块用，不进显示设置
    displayOpts = { ...DEFAULT_DISPLAY, ...tplSnapshot, ...(tplOverrides[styleTemplate] || {}) };
  }
  if (keepTimeDisplay) displayOpts.timeDisplay = keepTimeDisplay;
  if (styleTemplate === "glass") glassDisplay = { ...displayOpts };
  applyDisplay(displayOpts);
  syncDisplayControls();
  refreshFontSwatches();
  injectTemplateOverrideStyle();
  updateStyleModifiedHint();
  if (styleTemplate === "glass") chrome.storage.local.set({ [DISPLAY_OPTS_KEY]: glassDisplay });
}

// 导出 HTML 时，把显示设置写成覆盖规则追加到样式末尾
function buildDisplayCss(d) {
  const ff = toFontFamilyCss(d.fontFamily);
  const aff = toFontFamilyCss(d.ansFontFamily || d.fontFamily);
  const mff = toFontFamilyCss(d.mainFontFamily || d.fontFamily);
  const cardR = Number(d.cardRadius) || 0;
  const quoteR = Number(d.quoteRadius) || 0;
  const extractR = Number(d.extractRadius) || 0;
  return (
    "body{background:" + d.pageBg + ";color:" + d.fontColor +
      ";font-family:" + ff + ";font-size:" + d.fontSize + "px}" +
    ".card{border-radius:" + cardR + "px}" +
    ".item-text{background:" + d.quoteBg + ";color:" + d.fontColor +
      ";font-size:" + d.fontSize + "px;line-height:" + d.lineHeight +
      ";font-family:" + ff + ";border-radius:" + quoteR + "px}" +
    // 释义：独立作用域的字体/颜色/大小/行高
    ".item-answer{color:" + (d.ansFontColor || d.fontColor) +
      ";font-size:" + (d.ansFontSize || d.fontSize) + "px" +
      ";line-height:" + (d.ansLineHeight || d.lineHeight) +
      ";font-family:" + aff + "}" +
    // 主文：独立作用域的字体/颜色/大小/行高
    ".item-main{background:" + d.mainBg + ";color:" + (d.mainFontColor || d.fontColor) +
      ";border-left:3px solid " + darken(d.mainBg, 0.12) +
      ";font-size:" + (d.mainFontSize || DEFAULT_DISPLAY.mainFontSize) + "px" +
      ";line-height:" + (d.mainLineHeight || DEFAULT_DISPLAY.mainLineHeight) +
      ";font-family:" + mff + "}" +
    // 明细主文：同一底色淡出（默认模板按用户设置的主文底色算）
    ".item-main-dim{background:color-mix(in srgb," + d.mainBg + " 40%,transparent)" +
      ";border-left-color:color-mix(in srgb," + darken(d.mainBg, 0.12) + " 35%,transparent)}" +
    // 摘录记录：左侧深色竖线的引文样式，底色与主文不同，置于最后确保覆盖上面的原文底色
    ".item-text-extract{background:" + d.extractBg +
      ";border-left:3px solid " + deepBorder(d.extractBg) +
      ";border-radius:" + extractR + "px;padding-left:12px;font-weight:normal}"
  );
}

// ---------- 列表风格模板 ----------
// 每个模板是一段 CSS，选择器统一以 body[data-tpl="id"] 开头：历史页与导出的 HTML 都挂这个属性，
// 所以同一份样式两处通用（导出时按当前模板取其中一段写进导出文件）。
const STYLE_TEMPLATES = [
  { id: "glass", name: "默认", desc: "毛玻璃淡紫，默认观感", css: "" },
  {
    id: "doc",
    name: "文档",
    desc: "白底细边框 + 左侧色条",
    css:
      'body[data-tpl="doc"] #list{background:#f7f8fa}' +
      'body[data-tpl="doc"] .card{background:#fff;border:1px solid #e6e8ee;border-left:3px solid #6366f1;' +
      "border-radius:6px;box-shadow:none;-webkit-backdrop-filter:none;backdrop-filter:none}" +
      'body[data-tpl="doc"] .item-src{color:#4b5563}' +
      'body[data-tpl="doc"] .item-src a{color:#4b5563}' +
      'body[data-tpl="doc"] .item-text{background:transparent;border:0;border-radius:0;padding:0;margin:6px 0 8px;' +
      "font-size:14px;line-height:1.7;color:#111827;font-weight:400}" +
      // 竖线只在卡片左侧保留一根 3px 粗色条；原文/摘录/主文的左线改成 1px 细线，靠底色区分层级
      'body[data-tpl="doc"] .item-text-extract{background:rgba(134,185,139,.08)!important;border-left:1px solid #a8cfad;' +
      "padding:6px 0 6px 12px;border-radius:0}" +
      'body[data-tpl="doc"] .item-answer{line-height:1.75;color:#1f2937}' +
      'body[data-tpl="doc"] .item-answer p{margin:0 0 6px}' +
      'body[data-tpl="doc"] .item-tag{background:#f1f3f7;border-color:#e6e8ee;color:#55607a}' +
      'body[data-tpl="doc"] .item-main{background:#f7f9fd;border-left:1px solid #dfe3f0;border-radius:4px;' +
      "padding:6px 10px;color:#4b5563;font-size:13px;line-height:1.7}",
  },
  {
    id: "quote",
    name: "引用",
    desc: "无卡片底色，原文加引文竖线",
    css:
      'body[data-tpl="quote"] #list{background:#fff}' +
      'body[data-tpl="quote"] .card{background:transparent;border:0;border-bottom:1px dashed #e5e7eb;' +
      "border-radius:0;box-shadow:none;padding:14px 2px 16px;-webkit-backdrop-filter:none;backdrop-filter:none}" +
      'body[data-tpl="quote"] .item-src{color:#7a8394}' +
      'body[data-tpl="quote"] .item-src a{color:#7a8394}' +
      'body[data-tpl="quote"] .item-text{background:transparent;border:0;border-left:3px solid #d7dbe3;' +
      "border-radius:0;padding:2px 0 2px 12px;font-size:15px;line-height:1.75;color:#374151;" +
      "font-family:Georgia,'Songti SC','SimSun',serif;font-weight:400}" +
      'body[data-tpl="quote"] .item-text-extract{background:transparent!important;border-left:3px solid #d7dbe3;' +
      "padding-left:12px}" +
      'body[data-tpl="quote"] .item-answer{line-height:1.75}' +
      'body[data-tpl="quote"] .item-answer p{margin:0 0 6px}' +
      'body[data-tpl="quote"] .item-tag{background:transparent;border:1px solid #e1e5ec;color:#6b7280}' +
      'body[data-tpl="quote"] .item-main{background:transparent;border-left:3px solid #e5e7eb;border-radius:0;' +
      "color:#6b7280;font-size:13px;line-height:1.75;padding:2px 0 2px 12px}",
  },
  {
    id: "compact",
    name: "紧凑",
    desc: "无卡片、细分隔线、释义两行截断",
    css:
      'body[data-tpl="compact"] #list{background:#fff}' +
      'body[data-tpl="compact"] .card{background:transparent;border:0;border-bottom:1px solid #eef0f4;' +
      "border-radius:0;box-shadow:none;padding:10px 2px;-webkit-backdrop-filter:none;backdrop-filter:none}" +
      'body[data-tpl="compact"] .item-head{margin-bottom:4px;font-size:11px}' +
      'body[data-tpl="compact"] .item-text{background:transparent;border:0;padding:0;margin:4px 0;' +
      "font-weight:400;font-size:13px;line-height:1.6;border-radius:0}" +
      'body[data-tpl="compact"] .item-text-extract{background:transparent!important;border-left:2px solid #d7dbe3;' +
      "padding-left:10px}" +
      'body[data-tpl="compact"] .item-answer{font-size:12px;color:#6b7280;line-height:1.65;display:-webkit-box;' +
      "-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}" +
      'body[data-tpl="compact"] .item-answer p{margin:0}' +
      'body[data-tpl="compact"] .item-tag{background:transparent;border:1px dashed #d6dae3;color:#8b93a3}' +
      'body[data-tpl="compact"] .item-main{background:transparent;border-left:2px solid #eef0f4;border-radius:0;' +
      "color:#8b93a3;font-size:12px;line-height:1.65}",
  },
  {
    id: "paper",
    name: "米纸",
    desc: "米色纸底 + 衬线字，适合诗词古籍",
    css:
      'body[data-tpl="paper"] #list{background:#f6f0e2;font-family:Georgia,\'Songti SC\',\'SimSun\',serif;' +
      "padding:18px;border-radius:10px}" +
      'body[data-tpl="paper"] .card{background:#fffdf7;border:0;border-radius:3px;' +
      "box-shadow:0 2px 0 rgba(180,160,120,.18),0 10px 24px rgba(120,100,70,.08);" +
      "-webkit-backdrop-filter:none;backdrop-filter:none}" +
      'body[data-tpl="paper"] .item-time{color:#a89878}' +
      'body[data-tpl="paper"] .item-src{color:#6d5f47}' +
      'body[data-tpl="paper"] .item-src a{color:#6d5f47}' +
      'body[data-tpl="paper"] .item-text{background:transparent;border:0;border-radius:0;padding:0;margin:6px 0 10px;' +
      "font-size:15px;line-height:1.9;color:#3f3527;font-weight:400}" +
      'body[data-tpl="paper"] .item-text-extract{background:transparent!important;border-left:2px solid #d9c8a2;' +
      "padding-left:12px}" +
      'body[data-tpl="paper"] .item-answer{color:#4a4032;line-height:1.85}' +
      'body[data-tpl="paper"] .item-answer p{margin:0 0 7px}' +
      // 衬线字体下标签文字会偏上，用行内 flex + 稍大行高把文字压回垂直居中
      'body[data-tpl="paper"] .item-tag{background:rgba(200,86,74,.04);border:1px solid #c8564a;color:#b04a3e;border-radius:3px;' +
      "display:inline-flex;align-items:center;line-height:1.5;padding:1px 7px 0px}" +
      'body[data-tpl="paper"] .item-main{background:rgba(120,100,70,.07);border-left:3px solid #d9c8a2;border-radius:3px;' +
      "color:#5b4f3c;font-size:13px;line-height:1.85}",
  },
  {
    id: "sticky",
    name: "便签",
    desc: "淡黄便签、轻微旋转，手账感",
    css:
      'body[data-tpl="sticky"] #list{background:#eef1f5;padding:18px;border-radius:12px}' +
      'body[data-tpl="sticky"] .card{background:#fffbe8;border:0;border-top:3px solid #f5d76e;border-radius:4px;' +
      "box-shadow:0 8px 18px rgba(120,110,60,.14);" +
      "-webkit-backdrop-filter:none;backdrop-filter:none}" +
      'body[data-tpl="sticky"] .item-src{color:#7a6c46}' +
      'body[data-tpl="sticky"] .item-src a{color:#7a6c46}' +
      'body[data-tpl="sticky"] .item-text{background:transparent;border:0;border-radius:0;padding:0;margin:6px 0 8px;' +
      "font-size:15px;line-height:1.8;color:#4a3f22;font-weight:400}" +
      'body[data-tpl="sticky"] .item-text-extract{background:transparent!important;border-left:2px solid #e0c463;' +
      "padding-left:12px}" +
      'body[data-tpl="sticky"] .item-answer{line-height:1.8}' +
      'body[data-tpl="sticky"] .item-answer p{margin:0 0 6px}' +
      'body[data-tpl="sticky"] .item-tag{background:rgba(245,215,110,.55);border-color:rgba(210,180,80,.5);color:#6b5a1f}' +
      'body[data-tpl="sticky"] .item-main{background:rgba(245,215,110,.22);border-left:3px solid #e0c463;border-radius:3px;' +
      "color:#5a4c22;font-size:13px;line-height:1.8}",
  },
  {
    id: "dark",
    name: "夜间",
    desc: "深底低饱和，长时阅读",
    css:
      'body[data-tpl="dark"] #list{background:#0f1115;color:#e5e7eb;padding:18px;border-radius:14px}' +
      'body[data-tpl="dark"] .card{background:#1a1d24;border:1px solid #262a34;border-radius:10px;' +
      "box-shadow:none;-webkit-backdrop-filter:none;backdrop-filter:none}" +
      'body[data-tpl="dark"] .item-time{color:#6b7280}' +
      'body[data-tpl="dark"] .item-src{color:#9aa3b2}' +
      'body[data-tpl="dark"] .item-src a{color:#9aa3b2}' +
      'body[data-tpl="dark"] .item-text{background:#23262f;border:0;border-radius:8px;padding:8px 10px;' +
      "font-size:14px;line-height:1.7;color:#e5e7eb;font-weight:400}" +
      'body[data-tpl="dark"] .item-text-extract{background:#1f2731!important;border-left:3px solid #4b6572;' +
      "border-radius:0;padding-left:12px}" +
      'body[data-tpl="dark"] .item-answer{color:#d1d5db;line-height:1.75}' +
      'body[data-tpl="dark"] .item-answer p{margin:0 0 6px}' +
      'body[data-tpl="dark"] .item-tag{background:rgba(129,140,248,.18);border-color:rgba(129,140,248,.35);color:#a5b4fc}' +
      'body[data-tpl="dark"] .item-main{background:#20242d;color:#cbd5e1;border-left:3px solid #3b4252;' +
      "border-radius:8px;font-size:13px;line-height:1.75}",
  },
  {
    id: "news",
    name: "报纸",
    desc: "双线分隔、衬线标题、正文双栏",
    css:
      'body[data-tpl="news"] #list{background:#fbfaf7}' +
      'body[data-tpl="news"] .card{background:transparent;border:0;border-top:3px double #cfcbc2;' +
      "border-radius:0;box-shadow:none;padding:10px 0 2px;-webkit-backdrop-filter:none;backdrop-filter:none}" +
      'body[data-tpl="news"] .item-meta{font-family:Georgia,\'Songti SC\',\'SimSun\',serif;font-size:11px;color:#6b6257;' +
      "padding-bottom:6px;border-bottom:1px solid #d9d4ca;margin-bottom:10px}" +
      'body[data-tpl="news"] .item-time{color:#6b6257}' +
      'body[data-tpl="news"] .item-src{color:#6b6257}' +
      'body[data-tpl="news"] .item-src a{color:#6b6257}' +
      'body[data-tpl="news"] .item-text{background:transparent;border:0;border-radius:0;padding:0;margin:10px 0;' +
      "font-family:Georgia,'Songti SC','SimSun',serif;font-size:16px;line-height:1.85;color:#211d18;font-weight:600}" +
      'body[data-tpl="news"] .item-text-extract{background:transparent!important;border:0;padding-left:0}' +
      'body[data-tpl="news"] .item-answer{font-family:Georgia,\'Songti SC\',\'SimSun\',serif;color:#332e28;' +
      "font-size:13px;line-height:1.8;column-count:2;column-gap:22px}" +
      'body[data-tpl="news"] .item-answer p{margin:0 0 6px}' +
      'body[data-tpl="news"] .item-tag{background:transparent;border:1px solid #cfcbc2;color:#6b6257;border-radius:2px}' +
      'body[data-tpl="news"] .item-main{background:transparent;border-left:3px solid #cfcbc2;border-radius:0;' +
      "font-family:Georgia,'Songti SC','SimSun',serif;color:#4a443c;font-size:13px;line-height:1.8}",
  },
  {
    id: "grid",
    name: "格线",
    desc: "浅蓝格线 + 楷体，笔记观感",
    css:
      'body[data-tpl="grid"] #list{background:#fdfcf8;' +
      // 用 repeating-linear-gradient 画格，避免 background-size 百分比在不同场景下只出一方向的线
      "background-image:repeating-linear-gradient(to bottom,rgba(120,170,220,.28) 0 1px,transparent 1px 25px)," +
      "repeating-linear-gradient(to right,rgba(120,170,220,.2) 0 1px,transparent 1px 25px);" +
      "padding:18px;border-radius:10px}" +
      'body[data-tpl="grid"] .card{background:rgba(255,255,255,.72);border:0;border-radius:6px;' +
      "box-shadow:0 1px 0 rgba(120,150,190,.16);-webkit-backdrop-filter:none;backdrop-filter:none}" +
      'body[data-tpl="grid"] .item-time{color:#7b8da3}' +
      'body[data-tpl="grid"] .item-src{color:#5b6f88}' +
      'body[data-tpl="grid"] .item-src a{color:#5b6f88}' +
      'body[data-tpl="grid"] .item-text{background:transparent;border:0;border-radius:0;padding:0;margin:6px 0;' +
      "font-family:'Kaiti SC','KaiTi','STKaiti',Georgia,serif;font-size:16px;line-height:25px;color:#1f3550;font-weight:400}" +
      'body[data-tpl="grid"] .item-text-extract{background:transparent!important;border-left:2px solid #a8c6e2;' +
      "padding-left:10px}" +
      'body[data-tpl="grid"] .item-answer{color:#33465c;line-height:25px;font-size:13px}' +
      'body[data-tpl="grid"] .item-answer p{margin:0 0 4px}' +
      'body[data-tpl="grid"] .item-tag{background:rgba(120,170,220,.16);border-color:rgba(120,170,220,.4);color:#40607f}' +
      'body[data-tpl="grid"] .item-main{background:rgba(120,170,220,.1);border-left:2px solid #a8c6e2;border-radius:4px;' +
      "color:#33465c;font-size:13px;line-height:1.75}",
  },
  {
    id: "ruled",
    name: "横线",
    desc: "白底横线本，文字正好落在横线上方",
    css:
      // 页面不铺格子，只靠每个文字块自带的 25px 横线
      'body[data-tpl="ruled"] #list{background:#f7f8fa}' +
      'body[data-tpl="ruled"] .card{background:#fff;border:1px solid #e9edf3;border-radius:4px;' +
      "box-shadow:0 1px 0 rgba(120,150,190,.1);-webkit-backdrop-filter:none;backdrop-filter:none;" +
      "padding:12px 16px 10px}" +
      'body[data-tpl="ruled"] .item-time{color:#7b8da3}' +
      'body[data-tpl="ruled"] .item-src{color:#5b6f88}' +
      'body[data-tpl="ruled"] .item-src a{color:#5b6f88}' +
      // 行高 25px，横线画在每行底部 2px（transparent 0 23px → 线 23~25px），字正好压在线上面一点
      'body[data-tpl="ruled"] .item-text{background-image:' +
      "repeating-linear-gradient(to bottom,transparent 0 23px,rgba(120,170,220,.38) 23px 25px);" +
      "background-origin:content-box;border:0;border-radius:0;padding:0;margin:0 0 4px;" +
      "font-family:'Kaiti SC','KaiTi','STKaiti',Georgia,serif;font-size:16px;line-height:25px;color:#1f3550;font-weight:400}" +
      'body[data-tpl="ruled"] .item-text-extract{background-image:' +
      "repeating-linear-gradient(to bottom,transparent 0 23px,rgba(120,170,220,.38) 23px 25px)!important;" +
      "background-origin:content-box;border-left:2px solid #a8c6e2;padding-left:10px}" +
      'body[data-tpl="ruled"] .item-answer{background-image:' +
      "repeating-linear-gradient(to bottom,transparent 0 23px,rgba(120,170,220,.38) 23px 25px);" +
      "background-origin:content-box;color:#33465c;line-height:25px;font-size:13px}" +
      // 段落间不留 margin，横线才能连续不错位
      'body[data-tpl="ruled"] .item-answer p{margin:0}' +
      'body[data-tpl="ruled"] .item-tag{background:rgba(120,170,220,.16);border-color:rgba(120,170,220,.4);color:#40607f}' +
      'body[data-tpl="ruled"] .item-main{background:rgba(120,170,220,.1);border-left:2px solid #a8c6e2;border-radius:4px;' +
      "color:#33465c;font-size:13px;line-height:25px}",
  },
  {
    id: "mono",
    name: "等宽",
    desc: "等宽字体、细描边，适合科技",
    css:
      'body[data-tpl="mono"] #list{background:#f4f5f7}' +
      'body[data-tpl="mono"] .card{background:#fff;border:0;border-radius:2px;' +
      "box-shadow:0 0 0 1px #e3e6ea;-webkit-backdrop-filter:none;backdrop-filter:none;" +
      'font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,"Noto Sans Mono CJK SC",monospace}' +
      'body[data-tpl="mono"] .item-time{color:#7b8494}' +
      'body[data-tpl="mono"] .item-src{color:#5f6b7d}' +
      'body[data-tpl="mono"] .item-src a{color:#5f6b7d}' +
      'body[data-tpl="mono"] .item-text{background:transparent;border:0;border-left:2px solid #d5dae2;border-radius:0;' +
      "padding:0 0 0 10px;margin:8px 0;font-size:13.5px;line-height:1.75;color:#111827;font-weight:400}" +
      'body[data-tpl="mono"] .item-text-extract{background:transparent!important;border-left:2px solid #b8c2cf;' +
      "padding-left:10px}" +
      'body[data-tpl="mono"] .item-answer{font-size:12.5px;line-height:1.8;color:#3f4756}' +
      'body[data-tpl="mono"] .item-answer p{margin:0 0 5px}' +
      'body[data-tpl="mono"] .item-tag{background:#f0f2f5;border:1px solid #e3e6ea;color:#6b7485;border-radius:2px}' +
      'body[data-tpl="mono"] .item-main{background:#fafbfc;border-left:2px solid #d5dae2;border-radius:2px;' +
      "color:#3f4756;font-size:12.5px;line-height:1.8}",
  },
  {
    id: "kraft",
    name: "牛皮",
    desc: "牛皮色 + 纤维纹理，手账摘抄",
    css:
      'body[data-tpl="kraft"] #list{background:#d9c3a1;padding:18px;border-radius:10px}' +
      'body[data-tpl="kraft"] .card{background:#e8d6b8;border:0;border-radius:3px;' +
      "box-shadow:0 3px 0 rgba(120,92,54,.22),0 10px 22px rgba(90,68,38,.16);" +
      "background-image:repeating-linear-gradient(115deg,rgba(255,255,255,.06) 0 2px,rgba(120,92,54,.05) 2px 4px);" +
      "-webkit-backdrop-filter:none;backdrop-filter:none}" +
      'body[data-tpl="kraft"] .item-time{color:#8a6f45}' +
      'body[data-tpl="kraft"] .item-src{color:#6a5230}' +
      'body[data-tpl="kraft"] .item-src a{color:#6a5230}' +
      'body[data-tpl="kraft"] .item-text{background:transparent;border:0;border-radius:0;padding:0;margin:8px 0 10px;' +
      "font-family:Georgia,'Songti SC','SimSun',serif;font-size:15px;line-height:1.85;color:#3d2f1a;font-weight:600}" +
      'body[data-tpl="kraft"] .item-text-extract{background:transparent!important;border-left:2px solid #c2a274;' +
      "padding-left:12px}" +
      'body[data-tpl="kraft"] .item-answer{color:#4a3a23;line-height:1.8}' +
      'body[data-tpl="kraft"] .item-answer p{margin:0 0 6px}' +
      'body[data-tpl="kraft"] .item-tag{background:rgba(106,82,48,.14);border:1px solid rgba(106,82,48,.35);color:#59421f;border-radius:3px}' +
      'body[data-tpl="kraft"] .item-main{background:rgba(106,82,48,.12);border-left:3px solid #c2a274;border-radius:3px;' +
      "color:#4a3a23;font-size:13px;line-height:1.8}",
  },
  {
    id: "ink",
    name: "水墨",
    desc: "米白纸底 + 楷体疏字距，诗词古文",
    css:
      'body[data-tpl="ink"] #list{background:#f8f4ea;' +
      "background-image:radial-gradient(circle at 18% 12%,#fdfbf5 0%,#f8f4ea 55%,#f2ece0 100%);" +
      "padding:18px;border-radius:10px}" +
      'body[data-tpl="ink"] .card{background:rgba(255,255,255,.55);border:0;border-radius:4px;' +
      "box-shadow:0 1px 14px rgba(120,110,90,.08);-webkit-backdrop-filter:none;backdrop-filter:none}" +
      'body[data-tpl="ink"] .item-time{color:#9c9284}' +
      'body[data-tpl="ink"] .item-src{color:#6d6455}' +
      'body[data-tpl="ink"] .item-src a{color:#6d6455}' +
      'body[data-tpl="ink"] .item-text{background:transparent;border:0;border-radius:0;padding:0;margin:8px 0 10px;' +
      "font-family:'STKaiti','Kaiti SC','KaiTi',Georgia,serif;font-size:17px;line-height:1.95;color:#23211d;" +
      'letter-spacing:.5px;font-weight:400}' +
      'body[data-tpl="ink"] .item-text-extract{background:transparent!important;border:0;padding-left:0}' +
      'body[data-tpl="ink"] .item-answer{font-family:\'STKaiti\',\'Kaiti SC\',\'KaiTi\',Georgia,serif;' +
      "color:#3c3831;line-height:1.95;letter-spacing:.3px}" +
      'body[data-tpl="ink"] .item-answer p{margin:0 0 7px}' +
      'body[data-tpl="ink"] .item-tag{background:transparent;border:1px solid rgba(120,110,90,.4);color:#6d6455;border-radius:2px}' +
      'body[data-tpl="ink"] .item-main{background:rgba(120,110,90,.08);border-left:3px solid #cfc6b4;border-radius:3px;' +
      "color:#3c3831;font-size:13px;line-height:1.95}",
  },
  {
    id: "warmdark",
    name: "暖夜",
    desc: "深棕底暖字，不用纯黑不刺眼",
    css:
      'body[data-tpl="warmdark"] #list{background:#1c1a17;color:#e8dcc4;padding:18px;border-radius:14px}' +
      'body[data-tpl="warmdark"] .card{background:#26231e;border:1px solid #332f28;border-radius:12px;' +
      "box-shadow:none;-webkit-backdrop-filter:none;backdrop-filter:none}" +
      'body[data-tpl="warmdark"] .item-time{color:#8a8175}' +
      'body[data-tpl="warmdark"] .item-src{color:#c9bda6}' +
      'body[data-tpl="warmdark"] .item-src a{color:#c9bda6}' +
      'body[data-tpl="warmdark"] .item-text{background:#2f2b24;border:0;border-radius:8px;padding:8px 10px;' +
      "font-size:14.5px;line-height:1.75;color:#e8dcc4;font-weight:400}" +
      'body[data-tpl="warmdark"] .item-text-extract{background:#332e26!important;border-left:3px solid #6b6152;' +
      "border-radius:0;padding-left:12px}" +
      'body[data-tpl="warmdark"] .item-answer{color:#d6c9b0;line-height:1.8}' +
      'body[data-tpl="warmdark"] .item-answer p{margin:0 0 6px}' +
      'body[data-tpl="warmdark"] .item-tag{background:rgba(201,189,166,.14);border:1px solid rgba(201,189,166,.22);color:#cbbda0}' +
      'body[data-tpl="warmdark"] .item-main{background:#302b23;color:#d6c9b0;border-left:3px solid #6b6152;' +
      "border-radius:8px;font-size:13px;line-height:1.8}",
  },
  {
    id: "legal",
    name: "美式拍纸簿",
    desc: "淡黄纸 + 蓝横线 + 左侧淡红边线",
    css:
      'body[data-tpl="legal"] #list{background:#fdf6c8}' +
      // 卡片无底色，左侧红色边线用伪元素画，不占排版空间
      'body[data-tpl="legal"] .card{background:transparent;border:0;border-radius:0;box-shadow:none;' +
      "padding:8px 16px 8px 44px;position:relative;-webkit-backdrop-filter:none;backdrop-filter:none}" +
      'body[data-tpl="legal"] .card::before{content:"";position:absolute;left:30px;top:0;bottom:0;width:1px;' +
      "background:rgba(200,80,70,.32)}" +
      'body[data-tpl="legal"] .item-time{color:#7a6a3a}' +
      'body[data-tpl="legal"] .item-src{color:#7a6a3a}' +
      'body[data-tpl="legal"] .item-src a{color:#7a6a3a}' +
      // 横线只画在文字块上，行高与格距同为 25px，字落在横线上方
      'body[data-tpl="legal"] .item-text{background:transparent;border:0;border-radius:0;padding:0;margin:0 0 4px;' +
      "font-size:14.5px;line-height:25px;color:#26386b;font-weight:400;" +
      "background-image:repeating-linear-gradient(to bottom,transparent 0 24px,rgba(90,140,190,.5) 24px 25px);" +
      "background-origin:content-box;background-clip:content-box;background-position:0 -1px}" +
      'body[data-tpl="legal"] .item-text-extract{background-color:transparent!important;border-left:2px solid rgba(200,80,70,.35);' +
      "padding-left:10px}" +
      'body[data-tpl="legal"] .item-answer{color:#2f3b56;font-size:13px;line-height:25px;' +
      "background-image:repeating-linear-gradient(to bottom,transparent 0 24px,rgba(90,140,190,.5) 24px 25px);" +
      "background-origin:content-box;background-clip:content-box;background-position:0 -1px}" +
      'body[data-tpl="legal"] .item-answer p{margin:0}' +
      'body[data-tpl="legal"] .item-tag{background:rgba(90,140,190,.14);border-color:rgba(90,140,190,.4);color:#46618c}' +
      'body[data-tpl="legal"] .item-main{background:rgba(90,140,190,.1);border-left:2px solid #a8c6e2;border-radius:0;' +
      "color:#2f3b56;font-size:13px;line-height:25px}",
  },
  {
    id: "seyes",
    name: "法式 Seyès",
    desc: "白纸 + 横竖网格，主横线加重",
    css:
      'body[data-tpl="seyes"] #list{background:#fff}' +
      'body[data-tpl="seyes"] .card{background:#fff;border:1px solid #eceff4;border-radius:4px;' +
      "box-shadow:none;padding:12px 14px;-webkit-backdrop-filter:none;backdrop-filter:none}" +
      'body[data-tpl="seyes"] .item-time{color:#6b7280}' +
      'body[data-tpl="seyes"] .item-src{color:#5b6472}' +
      'body[data-tpl="seyes"] .item-src a{color:#5b6472}' +
      'body[data-tpl="seyes"] .item-text{background:transparent;border:0;border-radius:0;padding:0;margin:0 0 4px;' +
      "font-family:'Kaiti SC','KaiTi','STKaiti',Georgia,serif;font-size:15px;line-height:25px;color:#14181f;" +
      "font-weight:400;background-image:" +
      "repeating-linear-gradient(to bottom,transparent 0 24px,rgba(120,120,120,.5) 24px 25px)," +
      "repeating-linear-gradient(to right,transparent 0 24px,rgba(140,170,210,.16) 24px 25px);" +
      "background-origin:content-box;background-clip:content-box;background-position:0 -1px,0 0}" +
      'body[data-tpl="seyes"] .item-text-extract{background-color:transparent!important;border-left:2px solid #a8c6e2;' +
      "padding-left:10px}" +
      'body[data-tpl="seyes"] .item-answer{color:#2b3442;font-size:13px;line-height:25px;' +
      "font-family:'Kaiti SC','KaiTi','STKaiti',Georgia,serif;background-image:" +
      "repeating-linear-gradient(to bottom,transparent 0 24px,rgba(120,120,120,.5) 24px 25px)," +
      "repeating-linear-gradient(to right,transparent 0 24px,rgba(140,170,210,.16) 24px 25px);" +
      "background-origin:content-box;background-clip:content-box;background-position:0 -1px,0 0}" +
      'body[data-tpl="seyes"] .item-answer p{margin:0}' +
      'body[data-tpl="seyes"] .item-tag{background:rgba(140,170,210,.16);border:1px solid rgba(140,170,210,.5);color:#4a6a8f}' +
      'body[data-tpl="seyes"] .item-main{background:rgba(140,170,210,.12);border-left:2px solid #a8c6e2;border-radius:2px;' +
      "color:#2b3442;font-size:13px;line-height:25px}",
  },
  {
    id: "carre",
    name: "欧式方格本",
    desc: "米白纸 + 浅灰方格，密排笔记",
    css:
      'body[data-tpl="carre"] #list{background:#fbf7ee}' +
      'body[data-tpl="carre"] .card{background:#fffdf8;border:1px solid #ece5d8;border-radius:4px;' +
      "box-shadow:none;padding:12px 14px;-webkit-backdrop-filter:none;backdrop-filter:none}" +
      'body[data-tpl="carre"] .item-time{color:#7a7566}' +
      'body[data-tpl="carre"] .item-src{color:#6b6455}' +
      'body[data-tpl="carre"] .item-src a{color:#6b6455}' +
      // 方格 10px，行高 20px（两格），字压在每个第二格横线上
      'body[data-tpl="carre"] .item-text{background:transparent;border:0;border-radius:0;padding:0;margin:0 0 4px;' +
      "font-size:14.5px;line-height:20px;color:#2c2a24;font-weight:400;background-image:" +
      "repeating-linear-gradient(to bottom,transparent 0 9px,rgba(120,140,160,.22) 9px 10px)," +
      "repeating-linear-gradient(to right,transparent 0 9px,rgba(120,140,160,.22) 9px 10px);" +
      "background-origin:content-box;background-clip:content-box}" +
      'body[data-tpl="carre"] .item-text-extract{background-color:transparent!important;border-left:2px solid #b9c6d4;' +
      "padding-left:10px}" +
      'body[data-tpl="carre"] .item-answer{color:#3a3730;font-size:13px;line-height:20px;' +
      "background-image:" +
      "repeating-linear-gradient(to bottom,transparent 0 9px,rgba(120,140,160,.22) 9px 10px)," +
      "repeating-linear-gradient(to right,transparent 0 9px,rgba(120,140,160,.22) 9px 10px);" +
      "background-origin:content-box;background-clip:content-box}" +
      'body[data-tpl="carre"] .item-answer p{margin:0}' +
      'body[data-tpl="carre"] .item-tag{background:rgba(120,140,160,.14);border:1px solid rgba(120,140,160,.35);color:#5a6472}' +
      'body[data-tpl="carre"] .item-main{background:rgba(120,140,160,.1);border-left:2px solid #b9c6d4;border-radius:2px;' +
      "color:#3a3730;font-size:13px;line-height:20px}",
  },
  {
    id: "dots",
    name: "欧式点阵本",
    desc: "米灰纸 + 20px 点阵，格线最轻",
    css:
      'body[data-tpl="dots"] #list{background:#f3efe6}' +
      'body[data-tpl="dots"] .card{background:#fbf9f4;border:1px solid #e8e2d6;border-radius:4px;' +
      "box-shadow:none;padding:12px 14px;-webkit-backdrop-filter:none;backdrop-filter:none}" +
      'body[data-tpl="dots"] .item-time{color:#6f6a5c}' +
      'body[data-tpl="dots"] .item-src{color:#5f5a4c}' +
      'body[data-tpl="dots"] .item-src a{color:#5f5a4c}' +
      // 点距 20px、行高 20px；点整体下移 10px 落在字下方（实测调好的值）
      // 原文与释义块都贴合排（margin:0），行高都是 20px，点阵才能从上一块无缝延续，
      // 否则两块衔接处会挤出一对几乎重叠的点行
      'body[data-tpl="dots"] .item-text{background:transparent;border:0;border-radius:0;padding:0;margin:0;' +
      "font-size:14.5px;line-height:20px;color:#23221d;font-weight:400;background-image:" +
      "radial-gradient(circle,rgba(90,90,80,.38) 0 1px,transparent 1px);" +
      "background-size:20px 20px;background-origin:content-box;background-clip:content-box;background-position:0 10px}" +
      'body[data-tpl="dots"] .item-text-extract{background-color:transparent!important;border-left:2px solid #cfc7b6;' +
      "padding-left:10px}" +
      'body[data-tpl="dots"] .item-answer{margin:0;color:#35332b;font-size:13px;line-height:20px;background-image:' +
      "radial-gradient(circle,rgba(90,90,80,.38) 0 1px,transparent 1px);" +
      "background-size:20px 20px;background-origin:content-box;background-clip:content-box;background-position:0 10px}" +
      'body[data-tpl="dots"] .item-answer p{margin:0}' +
      'body[data-tpl="dots"] .item-tag{background:rgba(90,90,80,.1);border:1px solid rgba(90,90,80,.3);color:#5a564a}' +
      'body[data-tpl="dots"] .item-main{background:rgba(90,90,80,.08);border-left:2px solid #cfc7b6;border-radius:2px;' +
      "color:#35332b;font-size:13px;line-height:20px}",
  },
  {
    id: "typer",
    name: "打字机稿纸",
    desc: "米灰纸、等宽字体、红色标签栏与页码",
    css:
      'body[data-tpl="typer"] #list{background:#f4f1e8}' +
      'body[data-tpl="typer"] .card{background:#fbf9f2;border:1px solid #ddd7c6;border-radius:0;' +
      "box-shadow:0 1px 0 #fff inset,0 1px 2px rgba(0,0,0,.04);padding:12px 16px 14px;" +
      "-webkit-backdrop-filter:none;backdrop-filter:none}" +
      // 卡片顶部红色小标签栏，仿打字稿抬头
      'body[data-tpl="typer"] .card::before{content:"TYPESCRIPT\\00B7 划词释义";display:block;' +
      "font-family:'Courier New',ui-monospace,monospace;font-size:10px;letter-spacing:.18em;" +
      "color:#9a3b2f;border-bottom:1px solid #e8c9c1;padding-bottom:5px;margin:0 0 9px}" +
      'body[data-tpl="typer"] .item-time{color:#6f6a5b;font-family:"Courier New",ui-monospace,monospace;' +
      "letter-spacing:.02em}" +
      'body[data-tpl="typer"] .item-src{color:#6f6a5b;font-family:"Courier New",ui-monospace,monospace}' +
      'body[data-tpl="typer"] .item-src a{color:#6f6a5b;text-decoration:underline dotted}' +
      'body[data-tpl="typer"] .item-text{background:transparent;border:0;border-radius:0;padding:0;margin:0 0 4px;' +
      "font-family:'Courier New',ui-monospace,Consolas,monospace;font-size:14px;line-height:24px;color:#3c3a33;" +
      "letter-spacing:.01em;font-weight:400}" +
      'body[data-tpl="typer"] .item-text-extract{background-color:transparent!important;border-left:2px solid #cfc6ad;' +
      "padding-left:10px}" +
      'body[data-tpl="typer"] .item-answer{color:#4a473e;font-size:12.5px;line-height:24px;margin-top:6px;' +
      "font-family:'Courier New',ui-monospace,Consolas,monospace}" +
      'body[data-tpl="typer"] .item-answer p{margin:0}' +
      // 不用边框，标签用 [ ] 括起来，更像打字稿上的标注
      'body[data-tpl="typer"] .item-tag{background:transparent;border:0;border-radius:0;padding:0;color:#6f6a5b;' +
      "font-family:'Courier New',ui-monospace,monospace;display:inline-block;line-height:1.5}" +
      'body[data-tpl="typer"] .item-tag::before{content:"["}' +
      'body[data-tpl="typer"] .item-tag::after{content:"]"}' +
      'body[data-tpl="typer"] .item-main{background:#f2eee2;border-left:2px solid #cfc6ad;border-radius:0;' +
      "color:#4a473e;font-size:12.5px;line-height:24px;font-family:'Courier New',ui-monospace,monospace}",
  },
  {
    id: "book",
    name: "书页",
    desc: "窄栏居中、衬线正文、首字下沉、页眉细线",
    css:
      'body[data-tpl="book"] #list{background:#efeae0}' +
      'body[data-tpl="book"] .card{background:#fffdf8;border:1px solid #e6e0d3;border-radius:0;' +
      "box-shadow:0 1px 3px rgba(0,0,0,.05);padding:20px 30px 24px;-webkit-backdrop-filter:none;backdrop-filter:none}" +
      // 时间来源行居中，做成页眉，下面一条细线
      'body[data-tpl="book"] .item-meta{justify-content:center;font-size:11px;color:#8a8578;letter-spacing:.1em;' +
      "border-bottom:1px solid #e6e0d3;padding-bottom:7px;margin-bottom:12px}" +
      'body[data-tpl="book"] .item-time{color:#8a8578;letter-spacing:.1em}' +
      'body[data-tpl="book"] .item-src{color:#8a8578;letter-spacing:.1em;flex:0 1 auto;text-align:center}' +
      'body[data-tpl="book"] .item-src a{color:#8a8578}' +
      'body[data-tpl="book"] .item-text{background:transparent;border:0;border-radius:0;padding:0;margin:0;' +
      "font-family:Georgia,'Songti SC','SimSun',serif;font-size:16px;line-height:1.9;color:#2b2a26;" +
      "font-weight:400;text-align:justify}" +
      'body[data-tpl="book"] .item-text-extract{background-color:transparent!important;border:0;padding-left:0}' +
      'body[data-tpl="book"] .item-answer{color:#3b3a34;font-size:13.5px;line-height:1.95;margin-top:12px;' +
      "font-family:Georgia,'Songti SC','SimSun',serif;text-align:justify}" +
      'body[data-tpl="book"] .item-answer p{margin:0 0 8px}' +
      // 首段首字下沉
      'body[data-tpl="book"] .item-answer p:first-of-type::first-letter{float:left;font-size:30px;line-height:26px;' +
      "padding-right:4px;font-weight:600;color:#6b4a2f}" +
      'body[data-tpl="book"] .item-tag{background:transparent;border:0;border-bottom:1px solid #d8d2c3;' +
      "border-radius:0;padding:0 2px;color:#8a8578}" +
      'body[data-tpl="book"] .item-main{background:#faf7f0;border:0;border-left:2px solid #ddd6c6;border-radius:0;' +
      "color:#3b3a34;font-size:13px;line-height:1.95;font-family:Georgia,'Songti SC','SimSun',serif}",
  },
  {
    id: "magazine",
    name: "杂志双栏",
    desc: "粗黑标题条、正文两栏、栏间细线",
    css:
      'body[data-tpl="magazine"] #list{background:#f2f2f0}' +
      'body[data-tpl="magazine"] .card{background:#fff;border:0;border-top:2px solid #d8dbdf;' +
      "border-radius:0;box-shadow:none;padding:16px 18px 18px;-webkit-backdrop-filter:none;backdrop-filter:none}" +
      'body[data-tpl="magazine"] .item-time{color:#8b8f96;font-size:11px;letter-spacing:.04em}' +
      'body[data-tpl="magazine"] .item-src{color:#8b8f96;font-size:11px;letter-spacing:.04em}' +
      'body[data-tpl="magazine"] .item-src a{color:#8b8f96}' +
      'body[data-tpl="magazine"] .item-text{background:transparent;border:0;border-radius:0;padding:0;' +
      "margin:0 0 8px;font-family:'Songti SC','SimSun',Georgia,serif;font-size:17px;line-height:1.45;" +
      "color:#16181d;font-weight:600}" +
      'body[data-tpl="magazine"] .item-text-extract{background-color:transparent!important;border-left:0;padding-left:0}' +
      // 正文排两栏，栏间一条细分割线
      'body[data-tpl="magazine"] .item-answer{font-size:12.5px;line-height:1.75;color:#45484f;margin-top:8px;' +
      "column-count:2;column-gap:22px;column-rule:1px solid #eceef0;text-align:justify}" +
      'body[data-tpl="magazine"] .item-answer p{margin:0 0 6px}' +
      'body[data-tpl="magazine"] .item-tag{background:#f1f2f4;border:0;border-radius:2px;color:#4b5058}' +
      'body[data-tpl="magazine"] .item-main{background:#f7f7f5;border-left:2px solid #c9ccd2;border-radius:0;' +
      "color:#45484f;font-size:12.5px;line-height:1.75}",
  },
  {
    id: "terminal",
    name: "终端暗色",
    desc: "深灰底、等宽、青绿字与 $ › 前缀",
    css:
      'body[data-tpl="terminal"] #list{background:#12161a;color:#c8d1d9;padding:18px;border-radius:14px}' +
      'body[data-tpl="terminal"] .card{background:#171c21;border:1px solid #232a30;border-radius:6px;' +
      "box-shadow:none;padding:12px 14px;-webkit-backdrop-filter:none;backdrop-filter:none;" +
      "font-family:ui-monospace,'Cascadia Mono',Consolas,monospace}" +
      'body[data-tpl="terminal"] .item-time{color:#4f7f6a;font-size:11.5px}' +
      'body[data-tpl="terminal"] .item-src{color:#6f7b86;font-size:11.5px}' +
      'body[data-tpl="terminal"] .item-src a{color:#6f7b86}' +
      'body[data-tpl="terminal"] .item-text{background:transparent;border:0;border-radius:0;padding:0;margin:0 0 8px;' +
      "color:#c8d1d9;font-size:13.5px;line-height:1.8;font-weight:400}" +
      'body[data-tpl="terminal"] .item-text::before{content:"$ ";color:#4f9f7f}' +
      'body[data-tpl="terminal"] .item-text-extract{background-color:transparent!important;border-left:2px solid #2b343b;' +
      "padding-left:10px}" +
      'body[data-tpl="terminal"] .item-answer{color:#9fb3a8;font-size:12.5px;line-height:1.85}' +
      'body[data-tpl="terminal"] .item-answer p{margin:0}' +
      'body[data-tpl="terminal"] .item-answer p::before{content:"\u203A ";color:#3f6f5f}' +
      'body[data-tpl="terminal"] .item-answer b{color:#7fd0a8;font-weight:500}' +
      'body[data-tpl="terminal"] .item-tag{background:#1e262c;border:1px solid #2b343b;border-radius:3px;color:#7f9199}' +
      'body[data-tpl="terminal"] .item-main{background:#1b2127;border-left:2px solid #2b343b;border-radius:3px;' +
      "color:#9fb3a8;font-size:12.5px;line-height:1.85}",
  },
  {
    id: "cards",
    name: "卡片墙",
    desc: "浅色悬浮卡、只有投影、轻微错落",
    css:
      // 列表改两栏栅格，记录像卡片墙一样并排；卡片 min-width:0 防止长内容把栏撑出容器
      'body[data-tpl="cards"] #list{background:#eceef2;display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);' +
      "gap:12px;align-items:start}" +
      'body[data-tpl="cards"] .card{background:#fff;border:1px solid rgba(15,23,42,.04);border-radius:10px;' +
      "box-shadow:0 2px 8px rgba(15,23,42,.08);padding:12px 14px;min-width:0;" +
      "-webkit-backdrop-filter:none;backdrop-filter:none}" +
      // 轻微错落，模拟便签贴墙
      'body[data-tpl="cards"] .card:nth-child(odd){transform:rotate(-.35deg)}' +
      'body[data-tpl="cards"] .card:nth-child(even){transform:rotate(.4deg)}' +
      'body[data-tpl="cards"] .item-time{color:#8a93a0;font-size:11px}' +
      'body[data-tpl="cards"] .item-src{color:#8a93a0;font-size:11px}' +
      'body[data-tpl="cards"] .item-src a{color:#8a93a0}' +
      'body[data-tpl="cards"] .item-text{background:transparent;border:0;border-radius:0;padding:0;margin:0;' +
      "font-size:14px;line-height:1.65;color:#1f2937;font-weight:400}" +
      'body[data-tpl="cards"] .item-text-extract{background-color:transparent!important;border-left:2px solid #dfe3e9;' +
      "padding-left:10px}" +
      'body[data-tpl="cards"] .item-answer{color:#4b5563;font-size:12px;line-height:1.7;margin-top:6px}' +
      'body[data-tpl="cards"] .item-answer p{margin:0 0 4px}' +
      'body[data-tpl="cards"] .item-tag{background:rgba(99,102,241,.1);border:0;color:#4f46e5}' +
      'body[data-tpl="cards"] .item-main{background:#f5f6f9;border:0;border-radius:6px;color:#4b5563;' +
      "font-size:12px;line-height:1.7}",
  },
];
let styleTemplate = "glass";

function styleTemplateCss(id) {
  const t = STYLE_TEMPLATES.find((x) => x.id === id);
  return t ? t.css : "";
}

// 导出页整页只有一个记录区，模板的页面底色/字体直接落在 body 上（历史页则只落在 #list，不影响插件自身界面）
function templateExportPageCss(id) {
  if (id === "doc") return "body{background:#f7f8fa}";
  if (id === "quote") return "body{background:#fff}";
  if (id === "compact") return "body{background:#fff}";
  if (id === "paper") return "body{background:#f6f0e2;font-family:Georgia,'Songti SC','SimSun',serif}";
  if (id === "sticky") return "body{background:#eef1f5}";
  if (id === "dark") return "body{background:#0f1115;color:#e5e7eb}";
  if (id === "news") return "body{background:#fbfaf7}";
  if (id === "grid")
    return (
      "body{background:#fdfcf8;" +
      // 用 repeating-linear-gradient 画格：不依赖 background-size 的百分比解析，屏幕与打印都稳定出方格
      "background-image:repeating-linear-gradient(to bottom,rgba(120,170,220,.28) 0 1px,transparent 1px 25px)," +
      "repeating-linear-gradient(to right,rgba(120,170,220,.2) 0 1px,transparent 1px 25px)}"
    );
  if (id === "ruled") return "body{background:#f7f8fa}";
  if (id === "mono") return "body{background:#f4f5f7}";
  if (id === "kraft") return "body{background:#d9c3a1}";
  if (id === "ink") return "body{background:#f8f4ea}";
  if (id === "warmdark") return "body{background:#1c1a17;color:#e8dcc4}";
  if (id === "legal") return "body{background:#fdf6c8}";
  if (id === "seyes") return "body{background:#fff}";
  if (id === "carre") return "body{background:#fbf7ee}";
  if (id === "dots") return "body{background:#f3efe6}";
  if (id === "typer") return "body{background:#f4f1e8}";
  if (id === "book") return "body{background:#efeae0}";
  if (id === "magazine") return "body{background:#f2f2f0}";
  if (id === "terminal") return "body{background:#12161a;color:#c8d1d9}";
  // 卡片墙：导出、预览、打印也排两栏，标题横跨整行
  if (id === "cards")
    return (
      "body{background:#eceef2}" +
      "body[data-tpl=\"cards\"] .wrap{max-width:820px;display:grid;" +
      "grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:12px;align-items:start}" +
      "body[data-tpl=\"cards\"] .wrap>h1,body[data-tpl=\"cards\"] .wrap>.sub{grid-column:1/-1}" +
      "body[data-tpl=\"cards\"] .card{margin-bottom:0}"
    );
  return "";
}

// 明细主文（多行选中原文）：各模板的 .item-main 底色差别很大，通用底色会难看，
// 所以这里给每个模板单独一份「淡版」：底色和左边线变淡，文字颜色沿用模板原色。
// 只在渲染层的独立类上生效，不改动各模板已有的 .item-main 规则。
const MAIN_DIM_CSS = {
  doc: "background:#fbfcfe!important;border-left-color:#ecf0f7!important",
  quote: "background:rgba(0,0,0,.012)!important;border-left-color:#f0f1f3!important",
  compact: "background:transparent!important;border-left-color:#f5f6f8!important",
  paper: "background:rgba(120,100,70,.03)!important;border-left-color:#e8dcc4!important",
  sticky: "background:rgba(245,215,110,.1)!important;border-left-color:#ecd98f!important",
  dark: "background:#1b1f26!important;border-left-color:#2b3140!important",
  news: "background:rgba(0,0,0,.01)!important;border-left-color:#e3e0d9!important",
  grid: "background:rgba(120,170,220,.05)!important;border-left-color:#c9dbee!important",
  ruled: "background:rgba(120,170,220,.05)!important;border-left-color:#c9dbee!important",
  mono: "background:#fcfcfd!important;border-left-color:#e8ebef!important",
  kraft: "background:rgba(106,82,48,.05)!important;border-left-color:#d8c4a8!important",
  ink: "background:rgba(120,110,90,.04)!important;border-left-color:#e0d9cb!important",
  warmdark: "background:#26221c!important;border-left-color:#4b443a!important",
  legal: "background:rgba(90,140,190,.05)!important;border-left-color:#c9dbee!important",
  seyes: "background:rgba(140,170,210,.05)!important;border-left-color:#cfdcf0!important",
  carre: "background:rgba(120,140,160,.04)!important;border-left-color:#dbe2e9!important",
  dots: "background:rgba(90,90,80,.03)!important;border-left-color:#e6e1d6!important",
  typer: "background:#f6f3ea!important;border-left-color:#e2dccd!important",
  book: "background:#fcfaf5!important;border-left-color:#ece7dc!important",
  magazine: "background:#fbfbfa!important;border-left-color:#e4e6e9!important",
  terminal: "background:#161a1f!important;border-left-color:#20272d!important",
  cards: "background:#fafbfc!important;border-left-color:#e9ebef!important",
};

function mainDimCss(id) {
  const body = MAIN_DIM_CSS[id];
  return body ? 'body[data-tpl="' + id + '"] .item-main-dim{' + body + "}" : "";
}

// 把模板样式注入历史页（一次即可，切换靠 body 上的 data-tpl）
function ensureTemplateStyle() {
  if (document.getElementById("tplStyle")) return;
  const style = document.createElement("style");
  style.id = "tplStyle";
  style.textContent =
    STYLE_TEMPLATES.map((t) => t.css).join("\n") +
    "\n" +
    STYLE_TEMPLATES.map((t) => mainDimCss(t.id)).join("\n");
  document.head.appendChild(style);
}

function applyStyleTemplate(id, persist = true) {
  styleTemplate = STYLE_TEMPLATES.some((t) => t.id === id) ? id : "glass";
  ensureTemplateStyle();
  document.body.dataset.tpl = styleTemplate;
  [...document.querySelectorAll(".tpl-btn")].forEach((b) => {
    b.classList.toggle("active", b.dataset.tpl === styleTemplate);
  });
  if (persist) chrome.storage.local.set({ [STYLE_TPL_KEY]: styleTemplate });
  // 把该模板的样式回填到样式设置面板（面板只记录“改动”，模板默认值作为恢复基准）
  syncTemplateStyleState();
}

function renderTplBar() {
  const bar = $("tplBar");
  if (!bar) return;
  bar.innerHTML = "";
  STYLE_TEMPLATES.forEach((t) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "tpl-btn" + (t.id === styleTemplate ? " active" : "");
    b.dataset.tpl = t.id;
    b.textContent = t.name;
    b.title = t.desc;
    b.addEventListener("click", () => applyStyleTemplate(t.id));
    bar.appendChild(b);
  });
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

// 记录时间的展示格式：按「设置 → 时间显示」决定（默认到秒）
function recordTimeMode() {
  const m = displayOpts && displayOpts.timeDisplay;
  return m === "date" || m === "short" ? m : "second";
}

function formatRecordTime(t) {
  const d = new Date(t);
  const mode = recordTimeMode();
  if (mode === "date") {
    return d.getFullYear() + "/" + pad(d.getMonth() + 1) + "/" + pad(d.getDate());
  }
  if (mode === "short") {
    return String(d.getFullYear()).slice(2) + "/" + (d.getMonth() + 1) + "/" + d.getDate();
  }
  return formatTime(t);
}

function safeHost(u) {
  try {
    const url = new URL(u);
    return url.hostname;
  } catch {
    return u;
  }
}

// 来源标题替换：按网址前缀匹配，规则按顺序依次生效（只影响展示与导出，不改记录）
function applyTitleRules(url, title) {
  let out = String(title || "");
  const u = String(url || "");
  for (const r of titleRules) {
    const prefix = String(r && r.prefix ? r.prefix : "").trim();
    if (!prefix || !u.startsWith(prefix)) continue;
    const from = String(r.from || "");
    const to = String(r.to == null ? "" : r.to);
    if (!from) out = to; // 查找留空 = 整条标题替换
    else if (out.includes(from)) out = out.split(from).join(to);
  }
  return out;
}

// 记录在界面上展示的来源标题（原始 pageTitle 经替换规则处理）
function displayTitle(rec) {
  if (!rec) return "";
  return applyTitleRules(rec.pageUrl, rec.pageTitle);
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
  $("optExtractBg").value = displayOpts.extractBg || DEFAULT_DISPLAY.extractBg;
  syncFontScopeControls();
  $("optTimeDisplay").value = recordTimeMode();
  $("optCardRadius").value = displayOpts.cardRadius ?? DEFAULT_DISPLAY.cardRadius;
  $("optQuoteRadius").value = displayOpts.quoteRadius ?? DEFAULT_DISPLAY.quoteRadius;
  $("optExtractRadius").value = displayOpts.extractRadius ?? DEFAULT_DISPLAY.extractRadius;
  syncColorSwatches("bgSwatches", "optPageBg");
  syncColorSwatches("quoteSwatches", "optQuoteBg");
  syncColorSwatches("mainSwatches", "optMainBg");
  syncColorSwatches("extractSwatches", "optExtractBg");
  syncColorSwatches("fontSwatches", "optFontColor");
}

// 字体控件（字体 / 颜色 / 大小 / 行高）按当前作用域回填
function syncFontScopeControls() {
  const sc = FONT_SCOPES[fontScope] || FONT_SCOPES.quote;
  $("optFontColor").value = displayOpts[sc.color] || DEFAULT_DISPLAY[sc.color];
  $("optFontSize").value = displayOpts[sc.size] || DEFAULT_DISPLAY[sc.size];
  $("optLineHeight").value = displayOpts[sc.line] || DEFAULT_DISPLAY[sc.line];
  const storedFont = displayOpts[sc.family] || displayOpts.fontFamily || DEFAULT_DISPLAY.fontFamily;
  const preset = matchFontPreset(storedFont);
  if (preset) {
    $("optFontPreset").value = preset;
    $("optFontFamily").value = "";
  } else {
    $("optFontPreset").value = ""; // 自定义…
    $("optFontFamily").value = storedFont;
  }
  syncFontScopeValues(displayOpts);
  syncColorSwatches("fontSwatches", "optFontColor");
}

// 把字体控件上的值写回当前作用域
function readFontScopeInto(opts) {
  const sc = FONT_SCOPES[fontScope] || FONT_SCOPES.quote;
  opts[sc.family] = currentFontFamily();
  opts[sc.color] = $("optFontColor").value;
  opts[sc.size] = Number($("optFontSize").value);
  opts[sc.line] = Number($("optLineHeight").value);
}

// 切换字体作用域
function setFontScope(scope) {
  if (!FONT_SCOPES[scope]) return;
  fontScope = scope;
  [...document.querySelectorAll("#fontScopeBar .seg-btn")].forEach((b) => {
    b.classList.toggle("active", b.dataset.scope === fontScope);
  });
  syncFontScopeControls();
  refreshFontSwatches();
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
  $("presetSelect").value = String(i);
  saveStyleState();
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
      [READONLY_KEY]: false,
      [AGG_ORDER_KEY]: {},
      [STYLE_TPL_KEY]: "glass",
      [STYLE_PANEL_KEY]: false,
      timeMode: "date",
      config: {},
    },
    (res) => {
      all = Array.isArray(res[HISTORY_KEY]) ? res[HISTORY_KEY] : [];
      titleRules = Array.isArray(res.config && res.config.titleRules) ? res.config.titleRules : [];
      exportOpts = { ...exportOpts, ...(res[EXPORT_OPTS_KEY] || {}) };
      $("optTime").checked = exportOpts.time;
      $("optPageTitle").checked = exportOpts.pageTitle;
      $("optPageUrl").checked = exportOpts.pageUrl;
      $("optCount").checked = exportOpts.count;
      $("optTags").checked = exportOpts.tags !== false;
      $("optSep").checked = exportOpts.sep;
      $("optCompact").checked = exportOpts.compact;
      $("optNoSplit").checked = exportOpts.noSplit;
      $("optPrintBlack").checked = exportOpts.printBlack !== false;
      $("optBackup").checked = exportOpts.backup;

      displayOpts = { ...DEFAULT_DISPLAY, ...(res[DISPLAY_OPTS_KEY] || {}) };
      glassDisplay = { ...displayOpts };
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
      syncReadonly(res[READONLY_KEY] === true);
      aggOrder = (res[AGG_ORDER_KEY] && typeof res[AGG_ORDER_KEY] === "object") ? res[AGG_ORDER_KEY] : {};

      // 列表风格模板：渲染按钮并套用（不再写回存储）
      tplOverrides = (res[TPL_OVERRIDES_KEY] && typeof res[TPL_OVERRIDES_KEY] === "object") ? res[TPL_OVERRIDES_KEY] : {};
      styleTemplate = res[STYLE_TPL_KEY] || "glass";
      renderTplBar();
      applyStyleTemplate(styleTemplate, false);

      // 时间筛选精度（默认按日期）
      $("optTimeMode").value = res.timeMode === "second" ? "second" : "date";
      applyTimeMode($("optTimeMode").value, false, true);

      // 字体/颜色/圆角面板默认收起
      syncStylePanel(res[STYLE_PANEL_KEY] === true);

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
      tags: $("optTags").checked,
      sep: $("optSep").checked,
      compact: $("optCompact").checked,
      noSplit: $("optNoSplit").checked,
      printBlack: $("optPrintBlack").checked,
      backup: $("optBackup").checked,
    };
    chrome.storage.local.set({ [EXPORT_OPTS_KEY]: exportOpts });
  };
  $("optTime").addEventListener("change", persist);
  $("optPageTitle").addEventListener("change", persist);
  $("optPageUrl").addEventListener("change", persist);
  $("optCount").addEventListener("change", persist);
  $("optTags").addEventListener("change", persist);
  $("optSep").addEventListener("change", persist);
  $("optCompact").addEventListener("change", persist);
  $("optNoSplit").addEventListener("change", persist);
  $("optBackup").addEventListener("change", persist);
}

// ---------- 保存 / 恢复 ----------
// 默认模板：改动直接写进 displayOpts（走 CSS 变量）；
// 其它模板：改动记成「覆盖层」，只保存与模板默认值的差异，模板原样式不动。
function saveStyleState() {
  if (styleTemplate === "glass") {
    glassDisplay = { ...displayOpts };
    chrome.storage.local.set({ [DISPLAY_OPTS_KEY]: glassDisplay });
  } else {
    const diff = currentStyleDiff();
    if (Object.keys(diff).length) tplOverrides[styleTemplate] = diff;
    else delete tplOverrides[styleTemplate];
    chrome.storage.local.set({ [TPL_OVERRIDES_KEY]: tplOverrides });
    injectTemplateOverrideStyle();
  }
  updateStyleModifiedHint();
}

// 恢复到当前模板的默认样式
function resetToTemplateStyle() {
  const keepTimeDisplay = displayOpts.timeDisplay;
  if (styleTemplate === "glass") {
    displayOpts = { ...DEFAULT_DISPLAY };
    glassDisplay = { ...displayOpts };
  } else {
    delete tplOverrides[styleTemplate];
    displayOpts = { ...DEFAULT_DISPLAY, ...tplSnapshot };
  }
  displayOpts.timeDisplay = keepTimeDisplay;
  applyDisplay(displayOpts);
  syncDisplayControls();
  $("presetSelect").value = "";
  syncColorSwatches("bgSwatches", "optPageBg");
  syncColorSwatches("quoteSwatches", "optQuoteBg");
  syncColorSwatches("mainSwatches", "optMainBg");
  syncColorSwatches("extractSwatches", "optExtractBg");
  syncColorSwatches("fontSwatches", "optFontColor");
  injectTemplateOverrideStyle();
  if (styleTemplate === "glass") {
    chrome.storage.local.set({ [DISPLAY_OPTS_KEY]: glassDisplay, [TPL_OVERRIDES_KEY]: tplOverrides });
  } else {
    chrome.storage.local.set({ [TPL_OVERRIDES_KEY]: tplOverrides });
  }
  updateStyleModifiedHint();
}

// 显示设置变更时即时生效并保存
function bindDisplay() {
  const persist = () => {
    const next = { ...displayOpts };
    next.pageBg = $("optPageBg").value;
    next.quoteBg = $("optQuoteBg").value;
    next.mainBg = $("optMainBg").value;
    next.extractBg = $("optExtractBg").value;
    next.timeDisplay = $("optTimeDisplay").value;
    next.cardRadius = Number($("optCardRadius").value);
    next.quoteRadius = Number($("optQuoteRadius").value);
    next.extractRadius = Number($("optExtractRadius").value);
    readFontScopeInto(next); // 只改当前 tab（原文/释义/主文）对应的字段
    displayOpts = next;
    applyDisplay(displayOpts);
    $("presetSelect").value = ""; // 手动调整后，样式组下拉不再指向任何已存组
    syncColorSwatches("bgSwatches", "optPageBg");
    syncColorSwatches("quoteSwatches", "optQuoteBg");
    syncColorSwatches("mainSwatches", "optMainBg");
    syncColorSwatches("extractSwatches", "optExtractBg");
    syncColorSwatches("fontSwatches", "optFontColor");
    saveStyleState();
  };
  $("optPageBg").addEventListener("input", persist);
  $("optQuoteBg").addEventListener("input", persist);
  $("optMainBg").addEventListener("input", persist);
  $("optExtractBg").addEventListener("input", persist);
  $("optFontColor").addEventListener("input", persist);
  $("optFontSize").addEventListener("input", persist);
  $("optLineHeight").addEventListener("input", persist);
  // 时间显示格式改了要重渲染列表（时间文字是渲染时生成的）
  $("optTimeDisplay").addEventListener("change", () => {
    persist();
    refreshHistory();
  });
  $("optCardRadius").addEventListener("input", persist);
  $("optQuoteRadius").addEventListener("input", persist);
  $("optExtractRadius").addEventListener("input", persist);
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
  // 恢复当前模板的默认样式（带确认）
  $("resetDisplay").addEventListener("click", () => {
    if (!window.confirm("恢复到当前模板的默认样式吗？你在样式设置里的修改会被清除。")) return;
    resetToTemplateStyle();
  });
}

// ---------- 渲染 ----------
// 时间筛选精度：date（按天）/ second（精确到秒），存本地
function timeMode() {
  return $("optTimeMode") && $("optTimeMode").value === "second" ? "second" : "date";
}

// 解析时间筛选输入框：date 型按天取整天（起始 00:00:00，结束 23:59:59），datetime 型精确到秒
function parseBound(s, isEnd) {
  if (!s) return NaN;
  s = String(s);
  const dm = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dm) {
    return new Date(+dm[1], +dm[2] - 1, +dm[3], isEnd ? 23 : 0, isEnd ? 59 : 0, isEnd ? 59 : 0, isEnd ? 999 : 0).getTime();
  }
  return parseLocal(s);
}

// 切换精度：输入框类型跟着变，清空已有值并从第 1 页重渲染
function applyTimeMode(mode, persist, skipRender) {
  const second = mode === "second";
  $("timeStart").type = second ? "datetime-local" : "date";
  $("timeEnd").type = second ? "datetime-local" : "date";
  $("timeStart").step = second ? "1" : "";
  $("timeEnd").step = second ? "1" : "";
  $("timeStart").value = "";
  $("timeEnd").value = "";
  if (persist) chrome.storage.local.set({ timeMode: mode });
  page = 1;
  if (!skipRender) render();
}

// 把 datetime-local 的本地时间值（YYYY-MM-DDTHH:MM[:SS]）解析为本地时间戳
function parseLocal(s) {
  if (!s) return NaN;
  const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return NaN;
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)).getTime();
}

// 当前是否设置了时间范围筛选
function hasTimeFilter() {
  return !!$("timeStart").value || !!$("timeEnd").value;
}

// 把本地时间戳写入起止输入框：日期模式写 YYYY-MM-DD，秒模式写 YYYY-MM-DDTHH:MM:SS
function setTimeRange(startTs, endTs) {
  const p = (n) => String(n).padStart(2, "0");
  const toDate = (ts) => {
    const d = new Date(ts);
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
  };
  const toLocal = (ts) => {
    const d = new Date(ts);
    return toDate(ts) + "T" + p(d.getHours()) + ":" + p(d.getMinutes()) + ":" + p(d.getSeconds());
  };
  const fmt = timeMode() === "second" ? toLocal : toDate;
  $("timeStart").value = fmt(startTs);
  $("timeEnd").value = fmt(endTs);
  page = 1;
  render();
}

// 按当前搜索框 + 时间范围返回筛选后的记录
function filteredList() {
  const q = ($("search").value || "").trim().toLowerCase();
  const startTs = parseBound($("timeStart").value, false);
  const endTs = parseBound($("timeEnd").value, true);
  const hasStart = Number.isFinite(startTs);
  const hasEnd = Number.isFinite(endTs);
  let list = all;
  if (hasStart || hasEnd) {
    const lo = hasStart ? startTs : -Infinity;
    const hi = hasEnd ? endTs : Infinity;
    list = list.filter((e) => (e.time || 0) >= lo && (e.time || 0) <= hi);
  }
  if (q) {
    list = list.filter(
      (e) =>
        (e.text || "").toLowerCase().includes(q) ||
        (e.answer || "").toLowerCase().includes(q) ||
        (e.pageTitle || "").toLowerCase().includes(q) ||
        // 搜索也认替换后的来源名，看到的文字都能搜到
        displayTitle(e).toLowerCase().includes(q) ||
        (e.pageUrl || "").toLowerCase().includes(q)
    );
  }
  if (tagFilter.length) {
    // or / 默认单选取一个：命中任意一个选中标签即显示；and：选中的标签必须全部具备
    // 「无标签」单独处理：非 and 模式下也把 tags 为空的记录算进来，and 模式下要求为空
    list = list.filter((e) => {
      const tags = Array.isArray(e.tags) ? e.tags.filter((t) => String(t || "").trim()) : [];
      const wantUntagged = tagFilter.includes(UNTAGGED);
      const wantTags = tagFilter.filter((t) => t !== UNTAGGED);
      if (tagMode === "and") {
        if (wantUntagged && tags.length) return false;
        return wantTags.every((t) => tags.includes(t));
      }
      if (wantUntagged && !tags.length) return true;
      return tags.some((t) => wantTags.includes(t));
    });
  }
  return list;
}

// 全部标签（从记录里聚合，按出现次数排序）
function allTags() {
  const count = new Map();
  for (const e of all) {
    for (const t of e.tags || []) {
      const name = String(t || "").trim();
      if (name) count.set(name, (count.get(name) || 0) + 1);
    }
  }
  return [...count.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

// 点标签筛选 chip：没选「或 / 且」时是单选（再点取消）；选了模式后可多选
function toggleTagFilter(name) {
  if (!tagMode) {
    tagFilter = tagFilter.length === 1 && tagFilter[0] === name ? [] : [name];
  } else {
    tagFilter = tagFilter.includes(name)
      ? tagFilter.filter((t) => t !== name)
      : [...tagFilter, name];
  }
  page = 1;
  render();
}

// 顶部标签筛选条：没有标签且也没有无标签记录时整条隐藏
function renderTagBar() {
  const bar = $("tagBar");
  const wrap = $("tagFilters");
  const tags = allTags();
  const untaggedCount = all.filter(
    (e) => !(Array.isArray(e.tags) ? e.tags.filter((t) => String(t || "").trim()) : []).length
  ).length;
  if (!tags.length && !untaggedCount) {
    bar.hidden = true;
    wrap.innerHTML = "";
    return;
  }
  // 筛选里选中的标签可能已被删光，清掉失效项（「无标签」在没有无标签记录时也清掉）
  tagFilter = tagFilter.filter((t) =>
    t === UNTAGGED ? untaggedCount > 0 : tags.some(([name]) => name === t)
  );
  bar.hidden = false;
  wrap.innerHTML = "";
  // 模式按钮与状态保持一致（只有一个 active）
  $("tagModeOr").classList.toggle("active", tagMode === "or");
  $("tagModeAnd").classList.toggle("active", tagMode === "and");
  if (untaggedCount) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "tag-chip tag-chip-untagged" + (tagFilter.includes(UNTAGGED) ? " active" : "");
    chip.textContent = "无标签（" + untaggedCount + "）";
    chip.addEventListener("click", () => toggleTagFilter(UNTAGGED));
    wrap.appendChild(chip);
  }
  tags.forEach(([name, num]) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "tag-chip" + (tagFilter.includes(name) ? " active" : "");
    chip.textContent = name + "（" + num + "）";
    chip.addEventListener("click", () => toggleTagFilter(name));
    wrap.appendChild(chip);
  });
}

// 批量改写标签：changes = [{ id, tags }]，一次写盘、一次发同步消息
function saveTagsBatch(changes) {
  let touched = false;
  const now = Date.now();
  for (const ch of changes) {
    const item = all.find((e) => e.id === ch.id);
    if (!item) continue;
    const clean = (ch.tags || []).map((t) => String(t || "").trim()).filter(Boolean).slice(0, 8);
    if (clean.length) item.tags = clean;
    else delete item.tags;
    item.updatedAt = now;
    touched = true;
  }
  if (!touched) return;
  chrome.storage.local.set({ [HISTORY_KEY]: all }, () => {
    try {
      chrome.runtime.sendMessage({ type: "history-changed" }).catch(() => {});
    } catch (e) {}
    render();
  });
}

// 改写某条记录的标签（只动 updatedAt，不动 time；云端合并按 updatedAt 取新）
function saveRecordTags(id, tags) {
  saveTagsBatch([{ id, tags }]);
}

// 改写来源文本（pageTitle），链接地址 pageUrl 保持不变；一次可改多条（聚合视图按来源整组改）
function saveRecordTitle(ids, title) {
  const clean = String(title || "").trim();
  const now = Date.now();
  let touched = false;
  (ids || []).forEach((id) => {
    const item = all.find((e) => e.id === id);
    if (!item) return;
    if (clean) item.pageTitle = clean;
    else delete item.pageTitle;
    item.updatedAt = now;
    touched = true;
  });
  if (!touched) {
    render();
    return;
  }
  chrome.storage.local.set({ [HISTORY_KEY]: all }, () => {
    try {
      chrome.runtime.sendMessage({ type: "history-changed" }).catch(() => {});
    } catch (e) {}
    render();
  });
}

// 就地编辑来源文本：把来源区域换成输入框，回车/失焦保存，Esc 取消
function startEditSource(srcEl, records) {
  const first = (records || [])[0];
  if (!first || !srcEl) return;
  const input = document.createElement("input");
  input.type = "text";
  input.className = "item-src-input";
  input.maxLength = 100;
  // 输入框里先放「当前看到的」来源名（已过替换规则），保存写回原始 pageTitle
  input.value = displayTitle(first) || (first.pageUrl ? safeHost(first.pageUrl) : "");
  input.title = "改来源文本，链接地址不变；回车保存，Esc 取消";
  srcEl.classList.add("editing");
  srcEl.textContent = "来源：";
  srcEl.appendChild(input);
  input.focus();
  input.select();
  let done = false;
  const finish = (save) => {
    if (done) return;
    done = true;
    if (save) saveRecordTitle(records.map((r) => r.id), input.value);
    else render();
  };
  input.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") {
      ev.preventDefault();
      finish(true);
    } else if (ev.key === "Escape") {
      ev.preventDefault();
      finish(false);
    }
  });
  input.addEventListener("blur", () => finish(true));
}

// 一条记录（或一组同源记录共用）的标签行：点标签移除，＋ 输入框回车/失焦提交
// 传多条时按「来源」打标签：标签取组内并集，增删都作用到这一组的每条记录
function buildTagsRow(targets) {
  const row = document.createElement("div");
  row.className = "item-tags";
  const list = (targets || []).filter(Boolean);
  if (!list.length) return row;

  // 组内标签并集（按出现次数降序，同数按名称）
  const counts = new Map();
  list.forEach((e) => {
    (Array.isArray(e.tags) ? e.tags : []).forEach((t) => {
      const name = String(t || "").trim();
      if (name) counts.set(name, (counts.get(name) || 0) + 1);
    });
  });
  const tags = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([n]) => n);

  tags.forEach((t) => {
    const chip = document.createElement("span");
    chip.className = "item-tag";
    chip.textContent = t;
    // 只读模式不能移除标签，就不给「点击移除」的悬停提示
    if (!readOnly) {
      chip.title = list.length > 1 ? "点击从这 " + list.length + " 条移除这个标签" : "点击移除这个标签";
    }
    chip.addEventListener("click", () => {
      if (readOnly) return; // 只读模式下标签不可移除
      saveTagsBatch(
        list.map((e) => ({
          id: e.id,
          tags: (Array.isArray(e.tags) ? e.tags : []).filter((x) => x !== t),
        }))
      );
    });
    row.appendChild(chip);
  });

  if (readOnly) return row; // 只读模式不显示「＋标签」

  const addBtn = document.createElement("button");
  addBtn.type = "button";
  addBtn.className = "item-tag-add";
  addBtn.textContent = "＋标签";
  addBtn.title = list.length > 1 ? "给这 " + list.length + " 条一起加标签" : "给这条记录加一个标签";
  addBtn.addEventListener("click", () => {
    if (row.querySelector("input")) return;

    const inp = document.createElement("input");
    inp.type = "text";
    inp.className = "item-tag-input";
    inp.placeholder = "选已有标签或输入新标签";
    inp.maxLength = 24;

    // 候选下拉：自己画（datalist 无法用代码自动展开），点 ＋ 后立即弹出
    const menu = document.createElement("div");
    menu.className = "item-tag-menu";
    let done = false;

    // 把标签加到这一组的所有记录上（已有则跳过）
    const applyTag = (v) => {
      if (done) return;
      done = true;
      closeMenu();
      saveTagsBatch(
        list.map((e) => {
          const cur = Array.isArray(e.tags) ? e.tags.filter(Boolean) : [];
          return { id: e.id, tags: cur.includes(v) ? cur : [...cur, v] };
        })
      );
    };

    function closeMenu() {
      menu.remove();
    }

    // 按输入内容过滤候选，并把菜单摆在输入框正下方（超出视口则翻到上方）
    function refreshMenu() {
      const kw = inp.value.trim().toLowerCase();
      const excludes = new Set(
        list.flatMap((e) => (Array.isArray(e.tags) ? e.tags : [])).map((t) => String(t || "").trim())
      );
      const names = allTags()
        .map(([n]) => n)
        .filter((n) => !excludes.has(n))
        .filter((n) => (kw ? n.toLowerCase().includes(kw) : true));
      menu.innerHTML = "";
      if (!names.length) {
        closeMenu();
        return;
      }
      names.forEach((n) => {
        const opt = document.createElement("button");
        opt.type = "button";
        opt.className = "item-tag-menu-item";
        opt.textContent = n;
        // mousedown 拦掉，避免输入框先失焦把菜单收起来
        opt.addEventListener("mousedown", (ev) => ev.preventDefault());
        opt.addEventListener("click", () => applyTag(n));
        menu.appendChild(opt);
      });
      if (!menu.isConnected) document.body.appendChild(menu);
      const r = inp.getBoundingClientRect();
      const h = menu.offsetHeight || 0;
      menu.style.left = Math.max(8, Math.min(r.left, window.innerWidth - 168)) + "px";
      menu.style.top =
        (r.bottom + 4 + h > window.innerHeight ? Math.max(8, r.top - 4 - h) : r.bottom + 4) + "px";
    }

    inp.addEventListener("input", refreshMenu);
    inp.addEventListener("focus", refreshMenu);
    inp.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") {
        ev.preventDefault();
        const v = inp.value.trim();
        if (v) applyTag(v);
      } else if (ev.key === "Escape") {
        done = true;
        closeMenu();
        render();
      }
    });
    inp.addEventListener("blur", () => {
      // 点菜单项时 mousedown 已拦掉默认行为，这里稍等再判断是否真的离开了
      setTimeout(() => {
        if (done) return;
        if (document.activeElement !== inp) closeMenu();
        const v = inp.value.trim();
        if (v) applyTag(v); // 输入了新标签名后点到别处：照旧提交
        else {
          done = true;
          render();
        }
      }, 120);
    });

    row.insertBefore(inp, addBtn);
    inp.focus();
    refreshMenu(); // 点开＋标签立刻看到下拉候选
  });
  row.appendChild(addBtn);
  return row;
}

function render() {
  const q = ($("search").value || "").trim().toLowerCase();
  // 有内容时显示搜索框右侧的清空按钮
  $("searchClear").style.display = q ? "flex" : "none";
  renderTagBar();
  const list = filteredList();

  // 统计信息尽量短：有筛选时显示「命中/总数」，没筛选显示「共 总数」，避免把右侧按钮挤到下一行
  const isFiltered = Boolean(q || hasTimeFilter() || tagFilter.length);
  $("count").textContent =
    (isFiltered ? list.length + "/" + all.length : "共 " + all.length) + " 条" +
    (aggregate ? " / " + new Set(list.map((e) => e.pageUrl || e.pageTitle || e.id)).size + " 组" : "");

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

// 旧版摘录记录残留的占位释义文本；识别摘录记录时一并视为无释义
const EXTRACT_PLACEHOLDER = "（摘录模式，未释义）"

// 判断一条记录是否为摘录（无释义）：有 extract 标记、answer 为空，或旧占位文本
function isExtractRecord(e) {
  if (!e) return false;
  if (e.extract === true) return true;
  const a = (e.answer || "").trim();
  return !a || a === EXTRACT_PLACEHOLDER;
}

// ---------- 多行选中：整段放进主文，原文行不再显示 ----------
// 划词选中多行时（诗词、列表、代码），原文塞在「……」里很难看：
// 卡片里改为只用主文块显示完整文本（保留换行），原文行直接省掉。
function isMultilineSelection(t) {
  return /\n/.test(String(t || ""));
}

// 「主文」按钮图标：双引号（用户提供的 quote.svg），配合 title 提示表示“该来源的一段主文说明”
const MAIN_BTN_ICON =
  '<svg width="12" height="12" viewBox="0 0 1024 1024" fill="currentColor" aria-hidden="true">' +
  '<path d="M408.547 205.584c12.15-7.798 21.15-8.255 30.545 3.948l21.631 28.093c5.588 7.26 3.38 16.83-2.424 21.763-87.482 56.125-187.06 176.64-194.526 220.106-7.466 43.468 35.337 32.139 105.328 64.668 69.991 32.527 127.933 151.522 31.273 245.272-96.66 93.75-287.427-10.591-259.637-223.763 17.85-136.933 107.12-256.962 267.81-360.087z m423.043 0c12.152-7.798 21.152-8.255 30.547 3.948l21.629 28.093c5.59 7.26 3.382 16.83-2.422 21.763-87.483 56.125-187.06 176.64-194.526 220.106-7.468 43.468 35.336 32.139 105.328 64.668 69.991 32.527 127.933 151.522 31.273 245.272-96.66 93.75-287.428-10.591-259.639-223.763 17.852-136.933 107.122-256.962 267.81-360.087z"/></svg>';

// 「改来源文本」按钮图标：铅笔
const EDIT_SRC_ICON =
  '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>';

// 普通卡片（非聚合）：第一行 时间 + 来源按钮 + 来源 + 删除
function buildItemCard(e) {
  const item = document.createElement("div");
  item.className = "card";

  const srcKey = e.pageUrl || e.pageTitle || "";

  const head = document.createElement("div");
  head.className = "item-head";

  const timeEl = document.createElement("span");
  timeEl.className = "item-time";
  timeEl.textContent = formatRecordTime(e.time);

  // 第一行：只在右侧放操作图标组；第二行左侧是时间、来源，右侧是标签
  const actions = document.createElement("div");
  actions.className = "item-actions";

  const meta = document.createElement("div");
  meta.className = "item-meta";
  meta.appendChild(timeEl);

  if (srcKey) {
    const src = document.createElement("span");
    src.className = "item-src";
    if (e.pageUrl) {
      src.innerHTML =
        '来源：<a href="' + esc(e.pageUrl) + '" target="_blank" rel="noopener noreferrer">' +
        esc(displayTitle(e) || safeHost(e.pageUrl)) + "</a>";
    } else {
      src.textContent = "来源：" + displayTitle(e);
    }
    meta.appendChild(src);

    // 来源左侧的搜索图标：点击筛选同来源记录
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
    actions.appendChild(srcBtn);

    // 来源主文按钮：编辑/查看该来源的主文
    const mainBtn = document.createElement("button");
    mainBtn.type = "button";
    mainBtn.className = "item-main-btn";
    mainBtn.title = "来源主文：为这个来源填写一段主文";
    mainBtn.innerHTML = MAIN_BTN_ICON;
    mainBtn.addEventListener("click", () => openMainModal(srcKey));
    actions.appendChild(mainBtn);

    // 改来源文本（只改标题，链接地址不变）
    const editSrcBtn = document.createElement("button");
    editSrcBtn.type = "button";
    editSrcBtn.className = "item-src-edit";
    editSrcBtn.title = "修改来源文本（链接地址不变）";
    editSrcBtn.innerHTML = EDIT_SRC_ICON;
    editSrcBtn.addEventListener("click", () => startEditSource(src, [e]));
    actions.appendChild(editSrcBtn);
  }

  const del = document.createElement("button");
  del.className = "item-del";
  del.title = "删除这条";
  del.textContent = "✕";
  del.addEventListener("click", () => removeOne(e.id));
  actions.appendChild(del);
  head.appendChild(actions);

  const isExtract = isExtractRecord(e);
  // 多行选中：整段原文改放进主文块（带换行显示），有主文就不再渲染原文行
  const multi = isMultilineSelection(e.text);
  const textEl = document.createElement("div");
  textEl.className = "item-text" + (isExtract ? " item-text-extract" : "");
  textEl.textContent = "「" + (e.text || "") + "」";

  const selMain = multi ? document.createElement("div") : null;
  if (selMain) {
    selMain.className = "item-main item-main-dim";
    selMain.textContent = e.text || "";
  }

  const ans = document.createElement("div");
  ans.className = "item-answer";
  if (!isExtract) ans.innerHTML = renderMarkdown(e.answer || "");

  item.appendChild(head);
  // 标签在第二行最右
  meta.appendChild(buildTagsRow([e]));
  item.appendChild(meta);

  // 同源主文：该来源保存过主文时，同源所有卡片都显示（受“显示/隐藏主文”开关控制）
  if (showMainText && sourceTexts[srcKey]) {
    const main = document.createElement("div");
    main.className = "item-main";
    main.textContent = sourceTexts[srcKey];
    item.appendChild(main);
  }

  // 有明细主文（多行原文）时不再显示原文行
  if (!multi) item.appendChild(textEl);
  if (selMain) item.appendChild(selMain);
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
    if (ev.key !== "Escape") return;
    if (!$("mainModal").hidden) closeMainModal();
    if (!$("importModal").hidden) closeImportModal();
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

// 排序按钮的 SVG 图标（统一 24×24 视框、2px 圆头描边，currentColor 随按钮变色）
const MOVE_ICONS = {
  top: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 4h14M12 20V8M7.5 12.5L12 8l4.5 4.5"/></svg>',
  up: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5M6 11l6-6 6 6"/></svg>',
  down: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M6 13l6 6 6-6"/></svg>',
  bottom: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 20h14M12 4v12M7.5 11.5L12 16l4.5-4.5"/></svg>',
};

// 聚合模式下移动某条记录在其来源内的位置，并持久化手工排序
// mode：-1 上移 / 1 下移 / "top" 移到最上 / "bottom" 移到最下
function moveInOrder(srcKey, index, mode, recs) {
  if (index < 0 || index >= recs.length) return;
  if (mode === "top") {
    if (index === 0) return;
    const item = recs.splice(index, 1)[0];
    recs.unshift(item);
  } else if (mode === "bottom") {
    if (index === recs.length - 1) return;
    const item = recs.splice(index, 1)[0];
    recs.push(item);
  } else {
    const target = index + mode;
    if (target < 0 || target >= recs.length) return;
    [recs[index], recs[target]] = [recs[target], recs[index]];
  }
  aggOrder[srcKey] = recs.map((r) => r.id);
  chrome.storage.local.set({ [AGG_ORDER_KEY]: aggOrder });
  render();
}

// 翻页后跳转到列表顶部
function jumpTop() {
  const list = $("list");
  if (list && list.scrollIntoView) list.scrollIntoView({ block: "start" });
}

// 渲染分页条，超过一页时显示「首页 / 上一页 / 第 x / N 页（可输入跳转）/ 下一页 / 尾页」
function renderPager(total) {
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (page > pages) page = pages;
  const pager = $("pager");
  pager.innerHTML = "";
  if (pages <= 1) return;
  const goTo = (p) => {
    const t = Math.min(pages, Math.max(1, p));
    if (t === page) return;
    page = t;
    render();
    jumpTop();
  };
  const first = document.createElement("button");
  first.className = "page-btn";
  first.textContent = "« 首页";
  first.disabled = page <= 1;
  first.addEventListener("click", () => goTo(1));
  pager.appendChild(first);
  const prev = document.createElement("button");
  prev.className = "page-btn";
  prev.textContent = "‹ 上一页";
  prev.disabled = page <= 1;
  prev.addEventListener("click", () => goTo(page - 1));
  pager.appendChild(prev);
  const info = document.createElement("span");
  info.className = "page-info";
  const pageInput = document.createElement("input");
  pageInput.type = "number";
  pageInput.className = "page-input";
  pageInput.min = "1";
  pageInput.max = String(pages);
  pageInput.value = String(page);
  pageInput.title = "输入页码，回车跳转";
  const jump = () => {
    const t = parseInt(pageInput.value, 10);
    if (isNaN(t)) { pageInput.value = String(page); return; }
    goTo(t);
    // 重渲染后分页条已重建，无需回写输入框
  };
  pageInput.addEventListener("change", jump);
  pageInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); pageInput.blur(); jump(); }
  });
  info.appendChild(pageInput);
  info.appendChild(document.createTextNode(" / " + pages + " 页"));
  pager.appendChild(info);
  const next = document.createElement("button");
  next.className = "page-btn";
  next.textContent = "下一页 ›";
  next.disabled = page >= pages;
  next.addEventListener("click", () => goTo(page + 1));
  pager.appendChild(next);
  const last = document.createElement("button");
  last.className = "page-btn";
  last.textContent = "尾页 »";
  last.disabled = page >= pages;
  last.addEventListener("click", () => goTo(pages));
  pager.appendChild(last);
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

    // 第一行：只在右侧放操作图标组；第二行左侧是记录数、来源，右侧是标签
    const head = document.createElement("div");
    head.className = "item-head item-head-agg";

    const actions = document.createElement("div");
    actions.className = "item-actions";

    const meta = document.createElement("div");
    meta.className = "item-meta";

    const countEl = document.createElement("span");
    countEl.className = "item-count";
    countEl.textContent = recs.length + " 条";
    meta.appendChild(countEl);

    if (srcKey) {
      // 来源接在记录数后面
      const src = document.createElement("span");
      src.className = "item-src";
      const first = recs[0];
      if (first.pageUrl) {
        src.innerHTML =
          '来源：<a href="' + esc(first.pageUrl) + '" target="_blank" rel="noopener noreferrer">' +
          esc(displayTitle(first) || safeHost(first.pageUrl)) + "</a>";
      } else {
        src.textContent = "来源：" + displayTitle(first);
      }
      meta.appendChild(src);

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
      actions.appendChild(srcBtn);

      const mainBtn = document.createElement("button");
      mainBtn.type = "button";
      mainBtn.className = "item-main-btn";
      mainBtn.title = "来源主文：为这个来源填写一段主文";
      mainBtn.innerHTML = MAIN_BTN_ICON;
      mainBtn.addEventListener("click", () => openMainModal(srcKey));
      actions.appendChild(mainBtn);

      // 改来源文本：聚合视图下改这一组全部记录的来源标题，链接地址不变
      const editSrcBtn = document.createElement("button");
      editSrcBtn.type = "button";
      editSrcBtn.className = "item-src-edit";
      editSrcBtn.title = "修改来源文本（链接地址不变）";
      editSrcBtn.innerHTML = EDIT_SRC_ICON;
      editSrcBtn.addEventListener("click", () => startEditSource(src, recs));
      actions.appendChild(editSrcBtn);
    }
    head.appendChild(actions);
    item.appendChild(head);
    // 聚合模式按「来源」打标签：一组同源记录共用一行，单独一行靠右
    meta.appendChild(buildTagsRow(recs));
    item.appendChild(meta);

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
      t.textContent = formatRecordTime(e.time);
      giHead.appendChild(t);
      const top = document.createElement("button");
      top.className = "item-move";
      top.title = "移到最上";
      top.innerHTML = MOVE_ICONS.top;
      top.disabled = idx === 0;
      top.addEventListener("click", () => moveInOrder(srcKey, idx, "top", recs));
      giHead.appendChild(top);
      const up = document.createElement("button");
      up.className = "item-move";
      up.title = "上移";
      up.innerHTML = MOVE_ICONS.up;
      up.disabled = idx === 0;
      up.addEventListener("click", () => moveInOrder(srcKey, idx, -1, recs));
      giHead.appendChild(up);
      const down = document.createElement("button");
      down.className = "item-move";
      down.title = "下移";
      down.innerHTML = MOVE_ICONS.down;
      down.disabled = idx === recs.length - 1;
      down.addEventListener("click", () => moveInOrder(srcKey, idx, 1, recs));
      giHead.appendChild(down);
      const bottom = document.createElement("button");
      bottom.className = "item-move";
      bottom.title = "移到最下";
      bottom.innerHTML = MOVE_ICONS.bottom;
      bottom.disabled = idx === recs.length - 1;
      bottom.addEventListener("click", () => moveInOrder(srcKey, idx, "bottom", recs));
      giHead.appendChild(bottom);
      const del = document.createElement("button");
      del.className = "item-del";
      del.title = "删除这条";
      del.textContent = "✕";
      del.addEventListener("click", () => removeOne(e.id));
      giHead.appendChild(del);
      gi.appendChild(giHead);

      const isExtract = isExtractRecord(e);
      const multi = isMultilineSelection(e.text);
      const textEl = document.createElement("div");
      textEl.className = "item-text" + (isExtract ? " item-text-extract" : "");
      textEl.textContent = "「" + (e.text || "") + "」";
      // 有明细主文（多行原文）时不再显示原文行
      if (!multi) gi.appendChild(textEl);
      if (multi) {
        const selMain = document.createElement("div");
        selMain.className = "item-main item-main-dim";
        selMain.textContent = e.text || "";
        gi.appendChild(selMain);
      }

      const ans = document.createElement("div");
      ans.className = "item-answer";
      if (!isExtract) ans.innerHTML = renderMarkdown(e.answer || "");
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
  // 按钮文字固定为「设置」，用按下态表达设置区是否显示
  const btn = $("toggleSettings");
  btn.textContent = "设置";
  btn.classList.toggle("is-on", !settingsHidden);
  btn.setAttribute("aria-pressed", settingsHidden ? "false" : "true");
  btn.title = settingsHidden ? "显示设置区" : "隐藏设置区";
  $("settingsArea").style.display = settingsHidden ? "none" : "";
}

function toggleSettings() {
  settingsHidden = !settingsHidden;
  chrome.storage.local.set({ [SETTINGS_HIDDEN_KEY]: settingsHidden });
  syncSettingsBtn();
}

// 只读模式：卡片里不显示操作图标，标签也不能点掉；默认编辑模式
function syncReadonly(on) {
  readOnly = on;
  document.body.classList.toggle("readonly", on);
  const btn = $("toggleReadonly");
  if (!btn) return;
  btn.classList.toggle("is-on", on);
  btn.setAttribute("aria-pressed", on ? "true" : "false");
  btn.title = on ? "当前只读：点一下切回编辑模式" : "切换只读模式：只读下列表卡片不显示任何操作图标";
}

function toggleReadonly() {
  syncReadonly(!readOnly);
  chrome.storage.local.set({ [READONLY_KEY]: readOnly });
  page = 1;
  render();
}

// 设置区里「字体设置」开始往后的面板：默认收起，点按钮展开/折叠
function syncStylePanel(open) {
  const panel = $("stylePanel");
  const btn = $("styleToggle");
  if (!panel || !btn) return;
  panel.hidden = !open;
  btn.setAttribute("aria-expanded", open ? "true" : "false");
  const state = btn.querySelector(".panel-toggle-state");
  if (state) state.textContent = open ? "折叠" : "打开";
  btn.title = open ? "折叠字体、颜色、圆角与样式管理" : "展开字体、颜色、圆角与样式管理";
}

function toggleStylePanel() {
  const open = $("stylePanel").hidden;
  syncStylePanel(open);
  chrome.storage.local.set({ [STYLE_PANEL_KEY]: open });
}

// 刷新列表：只重新读取记录与来源标题规则后重渲染，搜索词、时间范围、标签筛选都保持原样
function refreshHistory() {
  chrome.storage.local.get({ [HISTORY_KEY]: [], config: {} }, (res) => {
    all = Array.isArray(res[HISTORY_KEY]) ? res[HISTORY_KEY] : [];
    titleRules = Array.isArray(res.config && res.config.titleRules) ? res.config.titleRules : [];
    render();
    setStatus("已刷新，共 " + all.length + " 条记录（筛选条件保持不变）。", true);
  });
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
      lines.push("| " + (i + 1) + ". 「" + text + "」 | " + formatRecordTime(e.time) + " |");
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
      lines.push("## " + (i + 1) + ". 「" + String(e.text || "").replace(/\s*\r?\n\s*/g, " ") + "」");
      lines.push("");
      if (opts.time) lines.push("- **时间**：" + formatRecordTime(e.time));
      if (opts.pageTitle && displayTitle(e)) lines.push("- **来源页面**：" + displayTitle(e));
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
    const title = displayTitle(first) || first.pageUrl || "未命名来源";
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
      lines.push("### " + (j + 1) + ". 「" + String(e.text || "").replace(/\s*\r?\n\s*/g, " ") + "」");
      if (opts.time) lines.push("- **时间**：" + formatRecordTime(e.time));
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
h1{font-size:20px;margin:0 0 12px;display:flex;align-items:baseline;gap:10px;flex-wrap:wrap}
h1 .dot{flex:0 0 auto;width:12px;height:12px;border-radius:50%;background:#6366f1;background-image:linear-gradient(135deg,#6366f1,#a855f7);-webkit-print-color-adjust:exact;print-color-adjust:exact}
@media print{h1 .dot{background-image:none;background:#6366f1}}
h1 .h1-title{flex:0 0 auto}
/* 记录数与导出时间挪到标题右侧，省掉一整行 */
h1 .h1-sub{flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;font-weight:400;color:var(--muted)}
.sub{color:var(--muted);font-size:13px;margin:0 0 20px}
.card{background:rgba(255,255,255,0.88);-webkit-backdrop-filter:blur(14px);backdrop-filter:blur(14px);border:1px solid rgba(255,255,255,0.6);border-radius:16px;padding:16px 18px;margin-bottom:12px;box-shadow:0 8px 30px rgba(0,0,0,0.05)}
.item-head{display:flex;align-items:center;gap:10px;flex-wrap:nowrap;margin-bottom:8px}
.item-head-agg{justify-content:space-between}
.item-count{font-size:12px;color:var(--muted);flex:0 0 auto;white-space:nowrap}
.item-src-group{display:inline-flex;align-items:center;gap:10px;flex:0 1 auto;min-width:0}
.item-time{font-size:12px;color:var(--muted);flex:0 0 auto;white-space:nowrap}
.item-src{font-size:12px;color:var(--muted);flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.item-tags{display:inline-flex;align-items:center;gap:5px;flex:0 0 auto;margin-left:auto}
.item-tag{font-size:11px;line-height:1.4;padding:1px 7px;border-radius:999px;color:#4338ca;background:rgba(99,102,241,0.14);border:1px solid rgba(99,102,241,0.3);white-space:nowrap}
.item-src a{color:var(--muted);text-decoration:none}
.item-src a:hover{color:var(--primary);text-decoration:underline}
.item-text{font-size:13px;font-weight:600;color:#374151;background:var(--primary-soft);border-radius:8px;padding:6px 10px;margin-bottom:8px;word-break:break-word;white-space:pre-wrap}
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
.item-main-dim{background:color-mix(in srgb,var(--main-bg) 40%,transparent);border-left-color:color-mix(in srgb,var(--main-border) 35%,transparent)}
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

// 导出用的隐藏元数据：始终写入 data-* 属性。
// 即使没勾选「时间/来源页面/页面地址」（页面上不显示），或没勾「备份数据」，
// 另一台电脑导入时仍能从这些属性精确还原，不会丢时间、来源与页面地址。
// withSource=false 用于聚合卡片里的条目：同一卡片内所有记录来源相同，
// 地址与标题只写在卡片头上，导入时由条目继承，避免逐条重复。
function metaAttrs(e, isExtract, withSource) {
  return (
    ' data-id="' + esc(e.id || "") + '"' +
    ' data-time="' + esc(String(e.time || 0)) + '"' +
    (withSource === false
      ? ""
      : ' data-page-url="' + esc(e.pageUrl || "") + '"' +
        ' data-page-title="' + esc(e.pageTitle || "") + '"') +
    (isExtract ? ' data-extract="1"' : "")
  );
}

// 普通单条卡片的 HTML（与页面非聚合卡片一致：时间 + 来源）
function cardHtml(e) {
  const opts = exportOpts;
  const head = [];
  if (opts.time) head.push('<span class="item-time">' + esc(formatRecordTime(e.time)) + "</span>");
  // 来源：勾选「来源页面」才显示；「页面地址」决定是否带超链接
  if (opts.pageTitle && displayTitle(e)) {
    if (opts.pageUrl && e.pageUrl) {
      head.push(
        '<span class="item-src"><a href="' + esc(e.pageUrl) + '" target="_blank" rel="noopener noreferrer">' +
          esc(displayTitle(e)) + "</a></span>"
      );
    } else {
      head.push('<span class="item-src">' + esc(displayTitle(e)) + "</span>");
    }
  }
  const srcKey = e.pageUrl || e.pageTitle || "";
  const isExtract = isExtractRecord(e);
  const tags = opts.tags !== false && Array.isArray(e.tags) ? e.tags.filter((t) => String(t || "").trim()) : [];
  if (tags.length) {
    head.push('<span class="item-tags">' + tags.map((t) => '<span class="item-tag">' + esc(t) + "</span>").join("") + "</span>");
  }
  const main =
    showMainText && sourceTexts[srcKey]
      ? '<div class="item-main">' + esc(sourceTexts[srcKey]) + "</div>"
      : "";
  const meta = metaAttrs(e, isExtract);
  const multi = isMultilineSelection(e.text);
  const quoteHtml = multi
    ? ""
    : '<div class="item-text' + (isExtract ? " item-text-extract" : "") + '">「' + esc(e.text || "") + "」</div>";
  const selMain = multi ? '<div class="item-main item-main-dim">' + esc(e.text || "") + "</div>" : "";
  return (
    '<div class="card"' + meta + ">" +
    '<div class="item-head">' + head.join("") + "</div>" +
    main +
    quoteHtml +
    selMain +
    (isExtract ? "" : '<div class="item-answer">' + renderMarkdown(e.answer || "") + "</div>") +
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
      // 卡片头显示这组明细里最后一条的时间（勾选「时间」才显示）；明细行不再重复时间与标签
      if (opts.time) {
        const lastTime = Math.max(...recs.map((e) => Number(e.time) || 0));
        if (lastTime) head.push('<span class="item-time">' + esc(formatRecordTime(lastTime)) + "</span>");
      }
      // 来源：勾选「来源页面」才显示；「页面地址」决定是否带超链接
      if (opts.pageTitle && displayTitle(first)) {
        if (opts.pageUrl && first.pageUrl) {
          head.push(
            '<span class="item-src-group"><span class="item-src"><a href="' + esc(first.pageUrl) + '" target="_blank" rel="noopener noreferrer">' +
              esc(displayTitle(first)) + "</a></span></span>"
          );
        } else {
          head.push('<span class="item-src-group"><span class="item-src">' + esc(displayTitle(first)) + "</span></span>");
        }
      }
      // 聚合卡也在头部右侧显示这一组记录的全部标签（去重）
      const grpTags = opts.tags === false ? [] : [...new Set(recs.flatMap((e) => (Array.isArray(e.tags) ? e.tags : [])).filter((t) => String(t || "").trim()))];
      if (grpTags.length) {
        head.push('<span class="item-tags">' + grpTags.map((t) => '<span class="item-tag">' + esc(t) + "</span>").join("") + "</span>");
      }
      const main =
        showMainText && sourceTexts[srcKey]
          ? '<div class="item-main">' + esc(sourceTexts[srcKey]) + "</div>"
          : "";
      const items = recs
        .map((e) => {
          const isExtract = isExtractRecord(e);
          const meta = metaAttrs(e, isExtract, false);
          const multi = isMultilineSelection(e.text);
          return (
            '<div class="agg-item"' + meta + ">" +
            (multi
              ? ""
              : '<div class="item-text' + (isExtract ? " item-text-extract" : "") + '">「' + esc(e.text || "") + "」</div>") +
            (multi ? '<div class="item-main item-main-dim">' + esc(e.text || "") + "</div>" : "") +
            (isExtract ? "" : '<div class="item-answer">' + renderMarkdown(e.answer || "") + "</div>") +
            "</div>"
          );
        })
        .join("\n");
      return (
        gap +
        '<div class="card card-agg"' +
        ' data-page-url="' + esc(first.pageUrl || "") + '"' +
        ' data-page-title="' + esc(first.pageTitle || "") + '">' +
        '<div class="item-head item-head-agg">' + head.join("") + "</div>" +
        main +
        '<div class="agg-items' + (opts.sep ? "" : " no-sep") + '">' + items + "</div>" +
        "</div>"
      );
    })
    .join("\n");
}

// 导出 HTML 右上角的打印按钮：仅用于屏幕，打印时隐藏
const HEAD_BTN_CSS =
  "\n.h1-btn{margin-left:auto;flex:0 0 auto;border:none;cursor:pointer;font-size:13px;font-weight:400;font-family:inherit;padding:9px 16px;border-radius:9px;transition:0.15s;white-space:nowrap;background:var(--primary-soft);color:var(--primary)}" +
  "\n.h1-btn:hover{background:rgba(99,102,241,0.2)}" +
  "\n@media print{.h1-btn{display:none}}";

// 生成导出页 HTML（导出文件与「打印」预览共用，保证两者一致）
// withPrintScript：导出文件里内联一段脚本给「打印」按钮绑事件；
// 打印预览窗口继承扩展页 CSP，内联脚本会被拦，那边由父页直接绑事件。
function buildExportHtml(list, withPrintScript, titleWithTime, previewBlack) {
  // 预览 / 打印页把时间（到秒）写进 <title>：浏览器「另存为 PDF」默认用标题做文件名
  // 命名格式与导出的 HTML 文件一致：_YYYYMMDD_HHMMSS
  const now = new Date();
  const stamp =
    now.getFullYear() + pad(now.getMonth() + 1) + pad(now.getDate()) + "_" +
    pad(now.getHours()) + pad(now.getMinutes()) + pad(now.getSeconds());
  const docTitle = titleWithTime ? "划词释义历史_" + stamp : "划词AI释义 · 历史记录";
  // 勾选「卡片不跨页拆分」时，额外追加打印规则（不改动现有卡片样式）：
  // 卡片不跨页截断；每张卡片前的透明占位 div 提供 16px 顶部空隙
  // （与左右留白一致、露出页面背景色），并用 break-after:avoid 使其
  // 与下一张卡片同页，从而在被推到下一页顶部的卡片上方留出空白
  const noSplitCss = exportOpts.noSplit
    ? "\n@media print{.card{break-inside:avoid;page-break-inside:avoid}.card-gap{height:16px;break-after:avoid;page-break-after:avoid}}"
    : "";
  // 将显示设置（页面背景/原文背景/字体颜色/字号/字体）写入导出样式
  const displayCss = buildDisplayCss(displayOpts);
  // 风格模板：导出页与历史页共用同一份样式，靠 body 上的 data-tpl 生效；
  // 导出页再追加整页底色（历史页的页面底色只作用于 #list）
  const tplOverridesCss =
    styleTemplate !== "glass" && tplOverrides[styleTemplate]
      ? tplOverrideCss(styleTemplate, tplOverrides[styleTemplate], true)
      : "";
  const tplCss =
    styleTemplateCss(styleTemplate) + mainDimCss(styleTemplate) + templateExportPageCss(styleTemplate) + tplOverridesCss;
  // 打印用黑色字：纸上用颜料墨更清楚、也防水；只影响打印，屏幕与导出的 HTML 仍按模板配色
  const blackRules =
    ".item-text,.item-text-extract,.item-answer,.item-answer p,.item-answer li,.item-main,.item-main-dim{" +
    "color:#000!important}" +
    "h1,.h1-sub,.card .item-text,.card .item-answer,.card .item-main{text-shadow:none!important}";
  const printBlackCss = exportOpts.printBlack === false
    ? ""
    : "\n@media print{" + blackRules + "}" +
      // 预览 / 打印窗口另开一份“所见即打印”的规则，屏幕上就能看出打印出来的纯黑效果
      (previewBlack ? "\n" + blackRules : "");
  const html =
    "<!DOCTYPE html>\n" +
    '<html lang="zh-CN">\n<head>\n' +
    '<meta charset="UTF-8" />\n' +
    '<meta name="viewport" content="width=device-width, initial-scale=1.0" />\n' +
    "<title>" + docTitle + "</title>\n" +
    "<style>\n" + CARD_CSS + noSplitCss + displayCss + HEAD_BTN_CSS + tplCss + printBlackCss + "\n</style>\n" +
    "</head>\n" + '<body data-tpl="' + esc(styleTemplate) + '">\n' +
    '<div class="wrap">\n' +
    '<h1><span class="dot"></span><span class="h1-title">划词AI释义 · 历史记录</span>' +
    '<span class="h1-sub">共 ' + list.length + " 条 · 导出时间：" + formatTime(Date.now()) + "</span>" +
    '<button type="button" class="h1-btn" id="aie-h1-print">打印</button></h1>\n' +
    (aggregate ? buildCardsHtmlAggregated(list) : buildCardsHtml(list)) +
    // 内嵌完整备份数据（JSON 数据区，仅勾选「备份数据」时输出）：
    // 页面可视卡片仅按导出选项渲染，数据区始终包含全部字段，
    // 供「导入」功能在另一台电脑上精确还原。
    // 用 \u003c 转义 "<"，避免 JSON 中出现 </script> 截断脚本。
    (exportOpts.backup
      ? "\n" +
        '<script type="application/json" id="aie-history-data">' +
        JSON.stringify({ version: 1, exportedAt: Date.now(), records: list }).replace(/</g, "\\u003c") +
        "</script>"
      : "") +
    (withPrintScript
      ? "\n<script>\n(function(){\n  var b = document.getElementById(\"aie-h1-print\");\n  if (b) b.addEventListener(\"click\", function(){ window.print(); });\n})();\n</" + "script>"
      : "") +
    "\n</div>\n</body>\n</html>";
  return html;
}

// 导出为 HTML 文件（下载）
function exportHtml() {
  const statusEl = $("exportStatus");
  const exportStatus = (text, ok) => {
    statusEl.textContent = text;
    statusEl.className = "export-status" + (ok ? " ok" : " err");
  };
  const list = filteredList();
  if (!list.length) {
    exportStatus("暂无记录可导出。", false);
    return;
  }
  const html = buildExportHtml(list, true);
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

// 打印：打开与导出 HTML 完全相同的页面（不下载文件），并自动唤起浏览器打印窗口
// 预览：与打印同一份页面，但不自动弹出打印窗口
function previewHistory() {
  const statusEl = $("exportStatus");
  const list = filteredList();
  if (!list.length) {
    statusEl.textContent = "暂无记录可预览。";
    statusEl.className = "export-status err";
    return;
  }
  const html = buildExportHtml(list, false, true, exportOpts.printBlack !== false);
  const win = window.open("about:blank", "_blank");
  if (!win) {
    statusEl.textContent = "浏览器拦截了新窗口，请允许扩展打开新标签页后重试。";
    statusEl.className = "export-status err";
    return;
  }
  win.document.open();
  win.document.write(html);
  win.document.close();
  setTimeout(() => {
    try {
      const btn = win.document.getElementById("aie-h1-print");
      if (btn) btn.addEventListener("click", () => win.print());
    } catch (e) {
      /* 拿不到就不绑定，页面仍可阅读 */
    }
  }, 500);
}

function printHistory() {
  const statusEl = $("exportStatus");
  const list = filteredList();
  if (!list.length) {
    statusEl.textContent = "暂无记录可打印。";
    statusEl.className = "export-status err";
    return;
  }
  const html = buildExportHtml(list, false, true, exportOpts.printBlack !== false);
  // 用 about:blank 新窗口写入同一份文档，再由本页调它的 window.print()
  // （不靠文档内联脚本：新窗口继承扩展页的 CSP，内联 script 与 onclick 都会被拦掉）
  const win = window.open("about:blank", "_blank");
  if (!win) {
    statusEl.textContent = "浏览器拦截了新窗口，请允许扩展打开新标签页后重试。";
    statusEl.className = "export-status err";
    return;
  }
  win.document.open();
  win.document.write(html);
  win.document.close();
  // 等样式与字体就绪再触发打印，避免预览还没排好版
  setTimeout(() => {
    try {
      const btn = win.document.getElementById("aie-h1-print");
      if (btn) btn.addEventListener("click", () => win.print());
      win.focus();
      win.print();
    } catch (e) {
      statusEl.textContent = "已打开打印页，但自动打印被浏览器阻止，请在页面里点右上角「打印」。";
      statusEl.className = "export-status err";
      return;
    }
  }, 500);
}

// 只导出备份数据（JSON 文件），供另一台电脑「导入」精确还原；
// 备份始终包含全部历史，不受搜索与时间范围筛选影响
function exportBackup() {
  const statusEl = $("exportStatus");
  const exportStatus = (text, ok) => {
    statusEl.textContent = text;
    statusEl.className = "export-status" + (ok ? " ok" : " err");
  };
  if (!all.length) {
    exportStatus("暂无记录可导出。", false);
    return;
  }
  const text = JSON.stringify({ version: 1, exportedAt: Date.now(), records: all }, null, 2);
  const blob = new Blob([text], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  const name =
    "划词释义备份_" +
    d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) +
    "_" + p(d.getHours()) + p(d.getMinutes()) + ".json";
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  exportStatus("已导出 " + all.length + " 条记录的备份数据：" + name, true);
}

// ---------- 导入历史记录（跨电脑同步） ----------
const IMPORT_SCRIPT_RE = /<script[^>]*id=["']aie-history-data["'][^>]*>([\s\S]*?)<\/script>/i;
const IMPORT_ANY_JSON_RE = /<script[^>]*type=["']application\/json["'][^>]*>([\s\S]*?)<\/script>/i;
let importRecords = []; // 待导入的临时记录（导入弹窗打开期间）

function normalizeTime(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

// 规整一条导入记录：字段转字符串、time 归一、缺失 id 时补一个新 id（保证去重与删除可用）
function sanitizeRecord(r) {
  const rec = {
    id: String(r && r.id ? r.id : ""),
    text: String(r && r.text ? r.text : ""),
    answer: String(r && r.answer ? r.answer : ""),
    context: String(r && r.context ? r.context : ""),
    pageUrl: String(r && r.pageUrl ? r.pageUrl : ""),
    pageTitle: String(r && r.pageTitle ? r.pageTitle : ""),
    time: normalizeTime(r && r.time),
  };
  if (!rec.id) rec.id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  if (r && r.extract) rec.extract = true; // 保留摘录标记，导入后仍按摘录记录渲染
  // 标签与版本时间：JSON 备份里带了就原样还原，避免导入后丢标签
  if (Array.isArray(r && r.tags)) {
    const tags = r.tags.map((t) => String(t || "").trim()).filter(Boolean).slice(0, 8);
    if (tags.length) rec.tags = tags;
  }
  const upd = Number(r && r.updatedAt);
  rec.updatedAt = Number.isFinite(upd) && upd > 0 ? upd : rec.time;
  return rec;
}

// 解析导出的 HTML：优先读取内嵌的 aie-history-data JSON（完整保真）；
// 数据区缺失或损坏时退化为从卡片 DOM 解析基本字段（answer 为纯文本，排版会丢失）
function parseImportFile(text) {
  // 纯 JSON 备份文件（工具栏「导出」按钮生成）
  const raw = String(text).replace(/^\uFEFF/, "").trim();
  if (raw.charAt(0) === "{") {
    try {
      const data = JSON.parse(raw);
      if (data && Array.isArray(data.records) && data.records.length) {
        return { records: data.records.map(sanitizeRecord), degraded: false };
      }
    } catch (e) {
      /* 不是有效 JSON，继续按 HTML 解析 */
    }
  }
  const m = text.match(IMPORT_SCRIPT_RE) || text.match(IMPORT_ANY_JSON_RE);
  if (m) {
    try {
      const data = JSON.parse(m[1].replace(/\\u003c/g, "<"));
      if (data && Array.isArray(data.records) && data.records.length) {
        return { records: data.records.map(sanitizeRecord), degraded: false };
      }
    } catch (e) {
      /* 数据区损坏则继续尝试 DOM 解析 */
    }
  }
  const records = parseFromDom(text);
  return records.length
    ? { records, degraded: true }
    : { records: [], degraded: false };
}

// 去掉 .item-text 文本两端的「」
function stripQuote(node) {
  if (!node) return "";
  return node.textContent.replace(/^「|」$/g, "").trim();
}

// "YYYY-MM-DD HH:mm:ss" → 时间戳
function parseTimeText(s) {
  const m = String(s).match(/(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})/);
  if (!m) return 0;
  const d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
  return d.getTime() || 0;
}

// 从导出 HTML 的卡片 DOM 提取字段。
// 优先读导出时写入的 data-* 隐藏元数据（时间/来源/地址/上下文/摘录标记/id），
// 即使页面上没显示这些内容也能完整还原；旧版本导出文件没有 data-* 时，
// 回退为从可见文本解析（时间取自 .item-time，来源取自 .item-src）。
function parseFromDom(text) {
  const doc = new DOMParser().parseFromString(text, "text/html");
  const cards = doc.querySelectorAll(".card");
  const records = [];
  const dataOf = (el, name) => (el && el.getAttribute ? el.getAttribute("data-" + name) || "" : "");
  cards.forEach((card) => {
    const srcEl = card.querySelector(".item-src");
    let pageTitle = dataOf(card, "page-title");
    let pageUrl = dataOf(card, "page-url");
    if ((!pageTitle || !pageUrl) && srcEl) {
      const a = srcEl.querySelector("a");
      if (!pageTitle) pageTitle = srcEl.textContent.replace(/^来源：/, "").trim();
      if (!pageUrl && a) pageUrl = a.getAttribute("href") || "";
    }
    const readTime = (el) => {
      const dv = dataOf(el, "time");
      if (dv !== "") return Number(dv) || 0;
      const t = el.querySelector(".item-time");
      return t ? parseTimeText(t.textContent) : 0;
    };
    const readAnswer = (el) =>
      el.querySelector(".item-answer") ? el.querySelector(".item-answer").textContent.trim() : "";
    const items = card.querySelectorAll(".agg-item");
    if (items.length) {
      items.forEach((it) => {
        records.push(
          sanitizeRecord({
            id: dataOf(it, "id"),
            text: stripQuote(it.querySelector(".item-text")),
            answer: readAnswer(it),
            pageUrl: dataOf(it, "page-url") || pageUrl,
            pageTitle: dataOf(it, "page-title") || pageTitle,
            time: readTime(it),
            extract: dataOf(it, "extract") === "1",
          })
        );
      });
    } else {
      records.push(
        sanitizeRecord({
          id: dataOf(card, "id"),
          text: stripQuote(card.querySelector(".item-text")),
          answer: readAnswer(card),
          pageUrl: pageUrl,
          pageTitle: pageTitle,
          time: readTime(card),
          extract: dataOf(card, "extract") === "1",
        })
      );
    }
  });
  return records;
}

// 读历史上限（来自 config.historyMax，默认 1000，上限 100 万）
function getHistoryMax(config) {
  const max = Number(config && config.historyMax);
  if (!Number.isFinite(max) || max < 1) return 1000;
  return Math.min(Math.floor(max), 1000000);
}

function handleImportFile(ev) {
  const file = ev.target.files && ev.target.files[0];
  ev.target.value = ""; // 允许再次选择同一文件
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const { records, degraded } = parseImportFile(String(reader.result));
      if (!records.length) {
        setStatus("未在文件中找到可导入的历史记录。", false);
        return;
      }
      importRecords = records;
      $("importModalInfo").innerHTML =
        "检测到 <b>" + records.length + "</b> 条历史记录可导入。" +
        (degraded
          ? '<div class="dim">该文件为早期导出版本，缺少完整备份数据，仅能恢复原文、来源与纯文本释义，排版可能丢失。</div>'
          : "") +
        '<div class="dim">合并导入：保留本机现有记录并按 id 去重；覆盖导入：先清空本机现有记录再导入。</div>';
      $("importModal").hidden = false;
    } catch (e) {
      setStatus("导入失败：" + (e && e.message ? e.message : e), false);
    }
  };
  reader.onerror = () => setStatus("读取文件失败。", false);
  reader.readAsText(file);
}

function closeImportModal() {
  $("importModal").hidden = true;
  importRecords = [];
}

// 执行导入：mode = "merge"（合并，按 id 去重）| "replace"（覆盖，先清空本机）
function doImport(mode) {
  const records = importRecords;
  if (!records.length) {
    closeImportModal();
    return;
  }
  // 文件内部按 id 去重（重复 id 保留首条）
  const seen = new Set();
  const dedup = records.filter((r) => {
    if (seen.has(r.id)) return false;
    seen.add(r.id);
    return true;
  });
  if (!dedup.length) {
    setStatus("文件中没有可导入的有效记录。", false);
    closeImportModal();
    return;
  }

  chrome.storage.local.get({ [HISTORY_KEY]: [], config: {} }, (res) => {
    const local = Array.isArray(res[HISTORY_KEY]) ? res[HISTORY_KEY] : [];
    let next;
    let added = 0;
    if (mode === "replace") {
      next = dedup.slice();
    } else {
      const byId = new Map(local.map((e) => [e.id, e]));
      next = local.slice();
      for (const r of dedup) {
        if (byId.has(r.id)) continue;
        next.push(r);
        byId.set(r.id, true);
        added++;
      }
    }
    // 统一按时间新→旧排序（无有效时间的排最后）
    next.sort((a, b) => (b.time || 0) - (a.time || 0));
    // 按历史上限裁剪（保留最新）
    const max = getHistoryMax(res.config);
    if (next.length > max) next.length = max;

    chrome.storage.local.set({ [HISTORY_KEY]: next }, () => {
      all = next;
      page = 1;
      render();
      closeImportModal();
      // 导入是直接改存储，通知后台排一次云端同步（开了同步才会有动作）
      try {
        chrome.runtime.sendMessage({ type: "history-changed" }).catch(() => {});
      } catch (e) {}
      if (mode === "replace") {
        setStatus("已覆盖导入 " + next.length + " 条记录。", true);
      } else if (added) {
        setStatus("已合并导入，新增 " + added + " 条记录（现有 " + next.length + " 条）。", true);
      } else {
        setStatus("已合并导入，本机已包含全部记录（共 " + next.length + " 条，无新增）。", true);
      }
    });
  });
}

function setStatus(text, ok) {
  const el = $("status");
  el.textContent = text;
  el.className = ok ? "ok" : "err";
}

// 事件
$("search").addEventListener("input", () => { page = 1; render(); });
$("tagClear").addEventListener("click", () => {
  tagFilter = [];
  page = 1;
  render();
});
// 「或 / 且」互斥，且都可以再点一次取消（取消后回到单选默认态）
["tagModeOr", "tagModeAnd"].forEach((id) => {
  $(id).addEventListener("click", () => {
    const mode = id === "tagModeAnd" ? "and" : "or";
    if (tagMode === mode) {
      tagMode = "";
      // 回到默认态时标签只保留一个，符合「单选」
      tagFilter = tagFilter.slice(0, 1);
    } else {
      tagMode = mode;
    }
    page = 1;
    render();
  });
});
$("timeStart").addEventListener("change", () => { page = 1; render(); });
$("timeEnd").addEventListener("change", () => { page = 1; render(); });
$("optTimeMode").addEventListener("change", () => applyTimeMode(timeMode(), true));
$("timeClear").addEventListener("click", () => {
  $("timeStart").value = "";
  $("timeEnd").value = "";
  page = 1;
  render();
});
document.querySelectorAll(".quick-link[data-range]").forEach((b) => {
  b.addEventListener("click", () => {
    const now = Date.now();
    const DAY = 24 * 60 * 60 * 1000;
    let start = now;
    const r = b.dataset.range;
    if (r === "today") {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      start = d.getTime();
    } else if (r === "1d") start = now - DAY;
    else if (r === "1w") start = now - 7 * DAY;
    else if (r === "1m") start = now - 30 * DAY;
    setTimeRange(start, now);
  });
});
$("searchClear").addEventListener("click", () => {
  $("search").value = "";
  page = 1;
  render();
});
$("export").addEventListener("click", exportMd);
$("exportHtml").addEventListener("click", exportHtml);
$("printPage").addEventListener("click", printHistory);
$("exportBackup").addEventListener("click", exportBackup);
$("import").addEventListener("click", () => $("importFile").click());
$("importFile").addEventListener("change", handleImportFile);
$("importMerge").addEventListener("click", () => doImport("merge"));
$("importReplace").addEventListener("click", () => doImport("replace"));
$("importCancel").addEventListener("click", closeImportModal);
$("importModalClose").addEventListener("click", closeImportModal);
$("importModal").addEventListener("click", (ev) => {
  if (ev.target === $("importModal")) closeImportModal();
});
$("clear").addEventListener("click", clearAll);
$("refresh").addEventListener("click", refreshHistory);
initFontSelect();
initColorSwatches("bgSwatches", "optPageBg", BG_PALETTE);
initColorSwatches("quoteSwatches", "optQuoteBg", BG_PALETTE);
initColorSwatches("mainSwatches", "optMainBg", BG_PALETTE);
initColorSwatches("extractSwatches", "optExtractBg", BG_PALETTE);
initColorSwatches("fontSwatches", "optFontColor", FONT_RECOMMEND);
bindExportOpts();
bindDisplay();
// 字体作用域切换：原文 | 释义 | 主文
[...document.querySelectorAll("#fontScopeBar .seg-btn")].forEach((b) => {
  b.addEventListener("click", () => setFontScope(b.dataset.scope));
});
$("saveDisplay").addEventListener("click", saveDisplay);
$("presetSelect").addEventListener("change", applyPreset);
$("deletePreset").addEventListener("click", deletePreset);
$("toggleMain").addEventListener("click", toggleMain);
$("toggleAgg").addEventListener("click", toggleAgg);
$("toggleSettings").addEventListener("click", toggleSettings);
$("toggleReadonly").addEventListener("click", toggleReadonly);
$("styleToggle").addEventListener("click", toggleStylePanel);
$("previewPage").addEventListener("click", previewHistory);
bindMainModal();

// ---------- 悬浮按钮组：跳到页首/页脚 ----------
(function initFab() {
  const group = $("fabGroup");
  const top = $("fabTop");
  const bottom = $("fabBottom");
  if (!group || !top || !bottom) return;
  top.addEventListener("click", () => window.scrollTo({ top: 0, behavior: "smooth" }));
  bottom.addEventListener("click", () => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "smooth" }));
  // 滚动超过一屏的一半才显示，避免短页面常驻遮挡
  const update = () => {
    const scrolled = window.scrollY || document.documentElement.scrollTop || 0;
    const threshold = Math.min(window.innerHeight * 0.5, 300);
    group.classList.toggle("show", scrolled > threshold);
  };
  window.addEventListener("scroll", update, { passive: true });
  window.addEventListener("resize", update, { passive: true });
  update();
})();

document.addEventListener("DOMContentLoaded", load);

// 后台云端同步会直接改写 history，页面跟着刷新（否则要手动重开才看得到）
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.config) {
    const cfg = changes.config.newValue || {};
    titleRules = Array.isArray(cfg.titleRules) ? cfg.titleRules : [];
    render();
    return;
  }
  if (!changes[HISTORY_KEY]) return;
  const next = changes[HISTORY_KEY].newValue;
  if (!Array.isArray(next)) return;
  all = next;
  render();
});
