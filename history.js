// history.js —— 划词AI释义 历史记录页逻辑
// 读取 chrome.storage.local["history"]，支持搜索、单条删除、清空、导出为 Markdown 文件。

const HISTORY_KEY = "history";
const EXPORT_OPTS_KEY = "exportOpts"; // 导出选项：是否包含 时间/来源页面/页面地址
const DISPLAY_OPTS_KEY = "displayOpts"; // 显示设置：页面背景色/原文背景色/字体颜色/字体大小/字体
const TPL_OVERRIDES_KEY = "tplStyleOverrides"; // 各模板下用户改过的样式字段（空表示没改，用模板原样式）
const DISPLAY_PRESETS_KEY = "displayPresets"; // 已保存的显示样式组列表
const SOURCE_TEXTS_KEY = "sourceTexts"; // 来源主文：{ srcKey: 文本 }
const SHOW_MAIN_KEY = "showMainText"; // 是否显示来源主文
const SHOW_QUOTE_KEY = "showQuoteText"; // 是否显示原文（划词的那段文本）
const AGG_KEY = "aggregate"; // 是否按来源聚合
const SETTINGS_HIDDEN_KEY = "settingsHidden"; // 是否隐藏所有设置
const READONLY_KEY = "readOnly"; // 只读模式（默认 false＝编辑模式）
const AGG_ORDER_KEY = "aggOrder"; // 聚合模式下每来源记录的手工排序（{ srcKey: [记录id] }）
const STYLE_TPL_KEY = "styleTemplate"; // 列表风格模板（见 STYLE_TEMPLATES）
const STYLE_PANEL_KEY = "stylePanelOpen"; // 独立的样式设置块是否显示（默认收起，与设置区互斥）
const STYLE_PIN_KEY = "stylePinned"; // 样式设置区是否钉住（滚动时贴页面顶部）
const LOCAL_FONTS_KEY = "localFontList"; // 读到的本机中文字体（Local Font Access API）
const TIME_DISPLAY_KEY = "timeDisplay"; // 时间显示格式（与模板无关，单独存一份，切模板/刷新都不丢）
const QUOTE_MERGE_KEY = "quoteMerge"; // 原文与释义合段（原文当大字头，占两行）——排版开关，与模板样式无关，单独存一份
const QUOTE_MERGE_MAX_KEY = "quoteMergeMax"; // 合段时原文最多几个字才做成大字头（默认 5）

const $ = (id) => document.getElementById(id);

let all = []; // 当前全部记录（新→旧）
let exportOpts = { time: true, pageTitle: true, pageUrl: true, count: true, tags: true, sep: true, compact: false, noSplit: false, printBlack: true, backup: false }; // 导出选项
let displayPresets = []; // [{ name, opts }] 已保存的样式组
let sourceTexts = {}; // { srcKey: 主文 } 按来源保存的主文
let mainModalKey = ""; // 当前正在编辑主文的 srcKey
let showMainText = true; // 列表是否显示来源主文
let showQuoteText = true; // 是否显示原文（列表与导出/预览/打印同样生效）
let aggregate = false; // 是否按来源聚合
let settingsHidden = false; // 是否隐藏所有设置
let readOnly = false; // 只读模式：卡片里不显示任何操作图标
let quoteMerge = false; // 原文与释义合段：原文当大字头，占两行，释义绕排
let quoteMergeMax = 5; // 原文最多几个字才做大字头（超出就走普通的 2 行截断）
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
  ansSpacing: 6, // 释义段后间距（px）
  mainFontColor: "#1f2937",
  mainFontSize: 13,
  mainLineHeight: 1.7,
  // 字重（三作用域）：400 常规 / 500 中等 / 600 半粗 / 700 粗
  fontWeight: 600,
  ansFontWeight: 400,
  mainFontWeight: 400,
  // 卡片本体
  cardBg: "#fbfcff",
  cardBorder: "#ffffff",
  cardBorderW: 1,
  cardBar: "#ffffff", // 卡片左侧色条颜色
  cardBarW: 0,
  cardShadow: "soft", // 跟随模板 / none / soft / medium / strong
  cardGap: 12,
  cardPad: 16,
  // 卡片头部的信息
  timeColor: "#6b7280",
  srcColor: "#6b7280",
  tagBg: "#e9e8ff",
  tagColor: "#4338ca",
  tagRadius: 20, // 20 表示胶囊（999px）
  // 原文 / 主文的左侧竖线（颜色留空表示沿用模板或由底色推出）
  quoteBorder: "#dbe1ee",
  quoteBorderW: 0,
  mainBorder: "",
  mainBorderW: 3,
  // 聚合卡片里明细之间的分隔线（颜色留空 = 沿用模板）
  aggSep: "",
  aggSepStyle: "", // 空 = 沿用模板（虚线）/ dashed / solid / none
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
  quote: { family: "fontFamily", color: "fontColor", size: "fontSize", line: "lineHeight", weight: "fontWeight", label: "原文" },
  answer: { family: "ansFontFamily", color: "ansFontColor", size: "ansFontSize", line: "ansLineHeight", spacing: "ansSpacing", weight: "ansFontWeight", label: "释义" },
  main: { family: "mainFontFamily", color: "mainFontColor", size: "mainFontSize", line: "mainLineHeight", weight: "mainFontWeight", label: "主文" },
};

// 卡片阴影档位
const SHADOW_PRESETS = {
  none: "none",
  soft: "0 8px 30px rgba(0, 0, 0, 0.05)",
  medium: "0 10px 30px rgba(0, 0, 0, 0.12)",
  strong: "0 18px 44px rgba(0, 0, 0, 0.2)",
};
function shadowCss(key) {
  return SHADOW_PRESETS[key] || SHADOW_PRESETS.soft;
}
// 阴影反推档位：按模糊半径分档，模板里读回来的值也能落到下拉里
function shadowLevelOf(css) {
  const s = String(css || "").trim();
  if (s === "none" || !s) return "none";
  const nums = s.match(/-?[\d.]+px/g);
  const blur = nums && nums[2] ? parseFloat(nums[2]) : 0;
  if (blur < 18) return "soft";
  if (blur < 38) return "medium";
  return "strong";
}
let fontScope = "main";
let displayOpts = { ...DEFAULT_DISPLAY };
// 历史页里手动选中的卡片 id 集合：有选中时只显示/导出这些记录
let pickedIds = new Set();

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
// 本机读到的字体也当成下拉里的一个选项，切换作用域时不会被踢回输入框
function matchFontPreset(font) {
  const f = (font || "").trim();
  const hit = FONT_OPTIONS.find((o) => o.value && o.value.trim() === f);
  if (hit) return hit.value;
  const local = localFontList.find((name) => name === f);
  return local || "";
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

// 页面底色是不是纯白：只有白底页面顶部那圈留白才显得空，需要打印时收紧。
// 判断就用「等于白色」，不按亮度猜——浅灰、浅蓝这类有底色的页面照样要留边距。
function isLightPageBg(css) {
  const s = String(css || "").trim().toLowerCase().replace(/\s+/g, "");
  if (!s) return false;
  if (s === "#fff" || s === "#ffffff" || s === "#ffffffff" || s === "white") return true;
  const m = s.match(/^rgba?\(([^)]+)\)$/);
  if (!m) return false;
  const p = m[1].split(",").map((x) => parseFloat(x));
  if (p.length < 3) return false;
  if (p.length > 3 && (p[3] === 0 || !isFinite(p[3]))) return false;
  return p[0] === 255 && p[1] === 255 && p[2] === 255;
}

function applyDisplay(d) {
  const s = document.documentElement.style;
  // 每次刷新样式顺便把「原文与释义合段」的开关重新落一次，避免类名被别处清掉
  applyQuoteMerge();
  s.setProperty("--page-bg", d.pageBg);
  s.setProperty("--quote-bg", d.quoteBg);
  s.setProperty("--extract-bg", d.extractBg);
  s.setProperty("--extract-border", deepBorder(d.extractBg));
  s.setProperty("--main-bg", d.mainBg);
  s.setProperty("--main-border", d.mainBorder || darken(d.mainBg, 0.12));
  s.setProperty("--card-bg", d.cardBg || DEFAULT_DISPLAY.cardBg);
  s.setProperty("--card-border", d.cardBorder || DEFAULT_DISPLAY.cardBorder);
  s.setProperty("--card-border-w", (d.cardBorderW === undefined ? DEFAULT_DISPLAY.cardBorderW : Number(d.cardBorderW) || 0) + "px");
  s.setProperty("--card-bar", d.cardBar || d.cardBorder || DEFAULT_DISPLAY.cardBorder);
  s.setProperty("--card-bar-w", (d.cardBarW === undefined ? DEFAULT_DISPLAY.cardBarW : Number(d.cardBarW) || 0) + "px");
  s.setProperty("--card-shadow", shadowCss(d.cardShadow || DEFAULT_DISPLAY.cardShadow));
  s.setProperty("--card-gap", (d.cardGap === undefined ? DEFAULT_DISPLAY.cardGap : Number(d.cardGap) || 0) + "px");
  s.setProperty("--card-pad", (d.cardPad === undefined ? DEFAULT_DISPLAY.cardPad : Number(d.cardPad) || 0) + "px");
  s.setProperty("--time-color", d.timeColor || DEFAULT_DISPLAY.timeColor);
  s.setProperty("--src-color", d.srcColor || DEFAULT_DISPLAY.srcColor);
  s.setProperty("--tag-bg", d.tagBg || DEFAULT_DISPLAY.tagBg);
  s.setProperty("--tag-color", d.tagColor || DEFAULT_DISPLAY.tagColor);
  const tagR = Number(d.tagRadius === undefined ? DEFAULT_DISPLAY.tagRadius : d.tagRadius) || 0;
  s.setProperty("--tag-radius", tagR >= 20 ? "999px" : tagR + "px");
  s.setProperty("--quote-border", d.quoteBorder || DEFAULT_DISPLAY.quoteBorder);
  s.setProperty("--quote-border-w", (d.quoteBorderW === undefined ? DEFAULT_DISPLAY.quoteBorderW : Number(d.quoteBorderW) || 0) + "px");
  s.setProperty("--main-border-w", (d.mainBorderW === undefined ? DEFAULT_DISPLAY.mainBorderW : Number(d.mainBorderW) || 0) + "px");
  // 聚合明细分隔线：留空表示沿用模板自带的线色/线型
  if (d.aggSep) s.setProperty("--agg-sep", d.aggSep);
  else s.removeProperty("--agg-sep");
  if (d.aggSepStyle) s.setProperty("--agg-sep-style", d.aggSepStyle);
  else s.removeProperty("--agg-sep-style");
  s.setProperty("--font-weight", d.fontWeight || DEFAULT_DISPLAY.fontWeight);
  s.setProperty("--ans-font-weight", d.ansFontWeight || DEFAULT_DISPLAY.ansFontWeight);
  s.setProperty("--main-font-weight", d.mainFontWeight || DEFAULT_DISPLAY.mainFontWeight);
  s.setProperty("--font-color", d.fontColor);
  s.setProperty("--font-size", d.fontSize + "px");
  s.setProperty("--font-family", toFontFamilyCss(d.fontFamily));
  s.setProperty("--line-height", d.lineHeight);
  s.setProperty("--ans-font-color", d.ansFontColor || DEFAULT_DISPLAY.ansFontColor);
  s.setProperty("--ans-font-size", (d.ansFontSize || DEFAULT_DISPLAY.ansFontSize) + "px");
  s.setProperty("--ans-font-family", toFontFamilyCss(d.ansFontFamily || d.fontFamily));
  s.setProperty("--ans-line-height", d.ansLineHeight || DEFAULT_DISPLAY.ansLineHeight);
  s.setProperty("--ans-spacing", (d.ansSpacing === 0 ? 0 : d.ansSpacing || DEFAULT_DISPLAY.ansSpacing) + "px");
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
  // 行高/字号/模板一变，大字头的高度要按新的释义行高重算
  if (typeof applyDropQuoteSize === "function") applyDropQuoteSize();
  // 字号行高变了卡片高度也变，瀑布流要重新分配
  if (typeof applyMasonry === "function") applyMasonry();
}

// 原文与释义合段：只在 body 上切一个类，具体排版交给 CSS（与风格模板无关，切模板也保持）
// 合段模式下，释义开头常自带「原文：」；原文已单独作大字头，这段就是重复的
// 规则：原文后紧跟冒号 → 连冒号一起去掉；原文和冒号之间还夹着别的字（拼音、括号等）→ 只去掉原文
function stripQuotePrefixInAnswer(answer, quoteText) {
  if (!quoteMerge) return answer;
  const q = String(quoteText || "").trim();
  const raw = String(answer || "");
  if (!q || !raw) return answer;
  const t = raw.replace(/^\s+/, "");
  // 前缀分两段：列表符号（- * + 1.）保留，其余装饰（书名号、引号、markdown 强调）跟着原文一起去掉
  const lm = (t.match(/^\s*(?:[-*+]|\d+[.)])\s+/) || [""])[0];
  const leadRaw = t.slice(lm.length);
  const deco = (leadRaw.match(/^[^\p{L}\p{N}]{0,6}/u) || [""])[0];
  const core = leadRaw.slice(deco.length);
  if (!core.startsWith(q)) return answer;
  const rest = core.slice(q.length);
  const tailTrim = (s) => s.replace(/^\s+/, "");
  const emph = /(?:\*\*|\*|__|_|~~)+/;
  // A. 原文之后（只隔着空格、收尾括号、强调符号等装饰）直接是冒号：连冒号一起去掉
  const m = rest.match(/^[^\p{L}\p{N}]{0,6}[:：]/u);
  if (m && !/[。！？；]/.test(m[0])) {
    return lm + tailTrim(rest.slice(m[0].length));
  }
  // B. 原文与冒号之间还有实际文字（拼音、括号说明等）：只去掉原文，中间那段保留
  const colon = rest.search(/[:：]/);
  const pre = colon > 0 ? rest.slice(0, colon) : "";
  // 括号里夹拼音时这段会很长（如「**（xiāo xiāo）」），只要它看起来像注音/括号，就别用长度卡它
  const isAnnotation = /^[\s()（）\[\]【】<>《》"'’‘*_~·.\-a-zA-Zāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜüńňǹç]*$/u.test(pre);
  if (colon > 0 && !/[。！？；\n]/.test(pre) && (colon <= 12 || isAnnotation)) {
    // 只在「原文到第一个冒号」这一段里收拾装饰，后面的正文（可能有 **书证** 之类）一律别碰
    let mid = pre.replace(/^[」』》）】”’]+/, ""); // 原文外侧的收尾引号/括号
    mid = mid.replace(new RegExp(emph.source + "$"), ""); // 冒号前紧邻的强调符号
    mid = mid.replace(new RegExp("^" + emph.source), ""); // 原文后面紧跟的强调符号
    return lm + tailTrim(mid + rest.slice(colon));
  }
  return answer;
}

// 释义统一从这里渲染，合段模式的「原文：」前缀只在渲染前处理
function answerMarkdownForRender(e) {
  return renderMarkdown(stripQuotePrefixInAnswer(e && e.answer, e && e.text));
}

function applyQuoteMerge() {
  // body 与 html 都挂一份：任何一处刷新/重建都不会把开关丢掉
  document.body.classList.toggle("merge-quote", !!quoteMerge);
  document.documentElement.classList.toggle("merge-quote", !!quoteMerge);
  if ($("optMergeQuote")) $("optMergeQuote").checked = !!quoteMerge;
}

// 合段模式下，原文短到能当「大字头」时给它一个 class：去掉书名号、字号放大、占两行
function isDropQuote(e) {
  if (!quoteMerge || !e) return false;
  if (isExtractRecord(e) || isMultilineSelection(e.text)) return false;
  const t = String(e.text || "").trim();
  return !!t && t.length <= quoteMergeMax;
}

// 释义用多列容器（column-count）的模板：它自成块级上下文，
// 外层浮动只会把两栏整体挤窄、第 3 行也回不到开头；
// 所以这些模板把大字头挪到释义第一段的开头，浮动只作用于第一栏，
// 第一栏绕排两行后自然接到第二栏。其余模板仍沿用原来的兄弟节点方式。
const MULTICOL_TEMPLATES = ["magazine", "news"];

function dropQuoteInsideAnswer() {
  return MULTICOL_TEMPLATES.includes(styleTemplate);
}

function injectDropIntoAnswerHtml(ansHtml, dropInner) {
  const m = ansHtml.match(/<p([^>]*)>/);
  if (m) return ansHtml.replace(/<p([^>]*)>/, "<p$1>" + dropInner);
  return dropInner + ansHtml;
}

function injectDropIntoAnswerEl(ansEl, dropEl) {
  const first = ansEl.firstElementChild;
  if (first && first.tagName === "P") first.insertBefore(dropEl, first.firstChild);
  else ansEl.insertBefore(dropEl, ansEl.firstChild);
}

// 字符串渲染时用 span：<p> 里塞 <div> 会被浏览器当作段落结束，浮动的原文反而又跑到段落外面
function dropSpanHtml(e) {
  return '<span class="item-text item-text-drop">' + esc(String(e.text || "").trim()) + "</span>";
}

// 字体作用域里的两个数值标签（跟着当前 tab 走）
function syncFontScopeValues(d) {
  const sc = FONT_SCOPES[fontScope] || FONT_SCOPES.quote;
  const size = d[sc.size] || DEFAULT_DISPLAY[sc.size];
  const line = d[sc.line] || DEFAULT_DISPLAY[sc.line];
  if ($("optFontSizeVal")) $("optFontSizeVal").textContent = size;
  if ($("optLineHeightVal")) $("optLineHeightVal").textContent = line;
  // 段后间距：只有释义有段落，其它页签隐藏这一行
  const spacingRow = $("optSpacingRow");
  if (spacingRow) spacingRow.hidden = !sc.spacing;
  if (sc.spacing && $("optParaSpacing")) {
    const sp = d[sc.spacing] === 0 ? 0 : d[sc.spacing] || DEFAULT_DISPLAY[sc.spacing];
    $("optParaSpacing").value = sp;
    if ($("optParaSpacingVal")) $("optParaSpacingVal").textContent = sp;
  }
}

// ---------- 模板样式 ↔ 样式设置 ----------
// 选中某个风格模板后，把该模板实际的底色/字号/行高等读进样式设置面板；
// 用户在面板上的改动只作为「覆盖层」记录（tplOverrides[模板]），生成一条更高优先级的 CSS，
// 不改动模板本身的 CSS。没改过的字段不生成覆盖，模板原样式原封不动。

let tplOverrides = {}; // { 模板 id: { 字段: 值 } }
let tplSnapshot = { ...DEFAULT_DISPLAY }; // 当前模板的原始样式快照（面板的「模板默认值」）
let glassDisplay = { ...DEFAULT_DISPLAY }; // 默认模板自己的显示设置（其它模板下 displayOpts 会换成模板值）
let localFontList = []; // 本机读到的字体族名（只读一次，存 local）
const LOCAL_FONT_FALLBACK = "sans-serif";

// 面板里可调、且能映射到模板样式的字段
const SNAP_KEYS = [
  "pageBg", "quoteBg", "extractBg", "mainBg",
  // 原文
  "fontFamily", "fontColor", "fontSize", "lineHeight", "fontWeight",
  // 释义
  "ansFontFamily", "ansFontColor", "ansFontSize", "ansLineHeight", "ansSpacing", "ansFontWeight",
  // 主文
  "mainFontFamily", "mainFontColor", "mainFontSize", "mainLineHeight", "mainFontWeight",
  // 圆角
  "cardRadius", "quoteRadius", "extractRadius",
  // 卡片本体
  "cardBg", "cardBorder", "cardBorderW", "cardBar", "cardBarW", "cardShadow", "cardGap", "cardPad",
  // 卡片头部信息与标签
  "timeColor", "srcColor", "tagBg", "tagColor", "tagRadius",
  // 原文 / 主文左侧竖线
  "quoteBorder", "quoteBorderW", "mainBorder", "mainBorderW",
  // 聚合明细分隔线
  "aggSep", "aggSepStyle",
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
    '<div class="item-time">探针</div>' +
    '<div class="item-src">探针</div>' +
    '<div class="item-tag">探针</div>' +
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
  const cardRule = cs(card);
  const qRule = cs(q);
  const tagEl = probe.querySelector(".item-tag");
  const timeEl = probe.querySelector(".item-time");
  const srcEl = probe.querySelector(".item-src");
  const tagR = cssPx(cs(tagEl).borderTopLeftRadius);
  return {
    palette: [
      { c: textColor, name: "模板原文色" },
      { c: answerColor, name: "模板释义色" },
      { c: mainColor, name: "模板主文色" },
    ],
    pageBg: colorToHex(page),
    // 卡片底色单独存一份，给「卡片底色」用；原文/摘录/主文仍按混合到卡片后的实际色
    cardBg: colorToHex(cardBg),
    quoteBg: colorToHex(quoteBg),
    extractBg: colorToHex(extractBg),
    mainBg: colorToHex(mainBg),
    cardBorder: colorToHex(parseCssColor(cardRule.borderTopColor) || white),
    cardBorderW: cssPx(cardRule.borderTopWidth),
    cardBar: colorToHex(parseCssColor(cardRule.borderLeftColor) || white),
    cardBarW: cssPx(cardRule.borderLeftWidth),
    cardShadow: shadowLevelOf(cardRule.boxShadow),
    cardGap: cssPx(cardRule.marginBottom),
    cardPad: cssPx(cardRule.paddingTop),
    timeColor: colorToHex(parseCssColor(cs(timeEl).color) || { r: 107, g: 114, b: 128, a: 1 }),
    srcColor: colorToHex(parseCssColor(cs(srcEl).color) || { r: 107, g: 114, b: 128, a: 1 }),
    tagBg: colorToHex(blendColor(parseCssColor(cs(tagEl).backgroundColor), cardBg)),
    tagColor: colorToHex(parseCssColor(cs(tagEl).color) || { r: 67, g: 56, b: 202, a: 1 }),
    tagRadius: tagR >= 20 ? 20 : tagR,
    quoteBorder: colorToHex(parseCssColor(qRule.borderLeftColor) || { r: 219, g: 225, b: 238, a: 1 }),
    quoteBorderW: cssPx(qRule.borderLeftWidth),
    mainBorder: colorToHex(parseCssColor(cs(mn).borderLeftColor) || { r: 99, g: 102, b: 241, a: 1 }),
    mainBorderW: cssPx(cs(mn).borderLeftWidth),
    // 原文
    fontColor: textColor,
    fontSize: Math.round(fs),
    lineHeight,
    fontFamily: cs(q).fontFamily,
    fontWeight: Number(cs(q).fontWeight) || 400,
    // 释义
    ansFontColor: answerColor,
    ansFontSize: Math.round(afs),
    ansLineHeight: alh === "normal" ? 1.5 : round2(parseFloat(alh) / afs),
    ansSpacing: cssPx(cs(an.querySelector("p")).marginBottom),
    ansFontFamily: cs(an).fontFamily,
    ansFontWeight: Number(cs(an).fontWeight) || 400,
    // 主文
    mainFontColor: mainColor,
    mainFontSize: Math.round(mfs),
    mainLineHeight,
    mainFontFamily: cs(mn).fontFamily,
    mainFontWeight: Number(cs(mn).fontWeight) || 400,
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
  if (ov.ansSpacing !== undefined)
    parts.push(sel + ".card .item-answer p{margin:0 0 " + (Number(ov.ansSpacing) || 0) + "px}");
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
  // 卡片本体：底色、四边边框、左侧色条、阴影、间距、内边距
  if (ov.cardBg) parts.push(sel + ".card{background:" + ov.cardBg + "}");
  if (ov.cardBorder) parts.push(sel + ".card{border-color:" + ov.cardBorder + "}");
  if (ov.cardBorderW !== undefined)
    parts.push(sel + ".card{border-width:" + (Number(ov.cardBorderW) || 0) + "px;border-style:solid}");
  if (ov.cardBar) parts.push(sel + ".card{border-left-color:" + ov.cardBar + "}");
  if (ov.cardBarW !== undefined)
    parts.push(sel + ".card{border-left-width:" + (Number(ov.cardBarW) || 0) + "px;border-left-style:solid}");
  if (ov.cardShadow) parts.push(sel + ".card{box-shadow:" + shadowCss(ov.cardShadow) + "}");
  if (ov.cardGap !== undefined) parts.push(sel + ".card{margin-bottom:" + (Number(ov.cardGap) || 0) + "px}");
  if (ov.cardPad !== undefined)
    parts.push(sel + ".card{padding:" + (Number(ov.cardPad) || 0) + "px 18px}");
  // 时间 / 来源 / 标签
  if (ov.timeColor) parts.push(sel + ".item-time{color:" + ov.timeColor + "}");
  if (ov.srcColor) parts.push(sel + ".item-src," + sel + ".item-src a{color:" + ov.srcColor + "}");
  if (ov.tagBg) parts.push(sel + ".item-tag{background:" + ov.tagBg + "}");
  if (ov.tagColor)
    parts.push(sel + ".item-tag{color:" + ov.tagColor +
      ";border-color:color-mix(in srgb," + ov.tagColor + " 30%,transparent)}");
  if (ov.tagRadius !== undefined)
    parts.push(sel + ".item-tag{border-radius:" + (Number(ov.tagRadius) >= 20 ? "999px" : (Number(ov.tagRadius) || 0) + "px") + "}");
  // 原文 / 主文的左侧竖线
  if (ov.quoteBorder) parts.push(sel + ".card .item-text{border-left-color:" + ov.quoteBorder + "}");
  if (ov.quoteBorderW !== undefined)
    parts.push(sel + ".card .item-text{border-left-width:" + (Number(ov.quoteBorderW) || 0) + "px;border-left-style:solid}");
  if (ov.mainBorder) parts.push(sel + ".card .item-main{border-left-color:" + ov.mainBorder + "}");
  if (ov.mainBorderW !== undefined)
    parts.push(sel + ".card .item-main{border-left-width:" + (Number(ov.mainBorderW) || 0) + "px;border-left-style:solid}");
  // 字重
  if (ov.fontWeight) parts.push(sel + ".card .item-text{font-weight:" + ov.fontWeight + "}");
  if (ov.ansFontWeight) parts.push(sel + ".card .item-answer{font-weight:" + ov.ansFontWeight + "}");
  if (ov.mainFontWeight) parts.push(sel + ".card .item-main{font-weight:" + ov.mainFontWeight + "}");
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
    // 行高是相对值，差 0.1 肉眼就能看出来，容差必须很小；
    // 像素/圆角类字段才用 0.6 容忍滑块与计算的小数误差
    const tol =
      key === "lineHeight" || key === "ansLineHeight" || key === "mainLineHeight" ? 0.02 : 0.6;
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
  // 提示放在风格模板行的最后：当前模板的样式被改过时显示
  const hint = $("tplModified");
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
// withTemplate=true（当前是风格模板）时，卡片底色/边框/阴影/标签/竖线/字重这些交给模板 CSS 与
// tplOverrideCss 负责，这里不再重复输出，避免读回来的近似值把模板原样式盖偏。
function buildDisplayCss(d, withTemplate) {
  const ff = toFontFamilyCss(d.fontFamily);
  const aff = toFontFamilyCss(d.ansFontFamily || d.fontFamily);
  const mff = toFontFamilyCss(d.mainFontFamily || d.fontFamily);
  const cardR = Number(d.cardRadius) || 0;
  const quoteR = Number(d.quoteRadius) || 0;
  const extractR = Number(d.extractRadius) || 0;
  const cardBorderW = d.cardBorderW === undefined ? DEFAULT_DISPLAY.cardBorderW : Number(d.cardBorderW) || 0;
  const cardBarW = d.cardBarW === undefined ? DEFAULT_DISPLAY.cardBarW : Number(d.cardBarW) || 0;
  const cardGap = d.cardGap === undefined ? DEFAULT_DISPLAY.cardGap : Number(d.cardGap) || 0;
  const cardPad = d.cardPad === undefined ? DEFAULT_DISPLAY.cardPad : Number(d.cardPad) || 0;
  const tagR = Number(d.tagRadius === undefined ? DEFAULT_DISPLAY.tagRadius : d.tagRadius) || 0;
  const quoteBW = d.quoteBorderW === undefined ? DEFAULT_DISPLAY.quoteBorderW : Number(d.quoteBorderW) || 0;
  const mainBW = d.mainBorderW === undefined ? DEFAULT_DISPLAY.mainBorderW : Number(d.mainBorderW) || 0;
  const mainBorderColor = d.mainBorder || darken(d.mainBg, 0.12);
  // 带模板时这些交给模板 CSS / tplOverrideCss，避免近似值盖偏模板
  const extras = !withTemplate;
  const cardExtraCss = extras
    ? ";background:" + (d.cardBg || DEFAULT_DISPLAY.cardBg) +
      ";border:" + cardBorderW + "px solid " + (d.cardBorder || DEFAULT_DISPLAY.cardBorder) +
      ";border-left:" + cardBarW + "px solid " + (d.cardBar || d.cardBorder || DEFAULT_DISPLAY.cardBorder) +
      ";box-shadow:" + shadowCss(d.cardShadow || DEFAULT_DISPLAY.cardShadow) +
      ";margin-bottom:" + cardGap + "px;padding:" + cardPad + "px 18px"
    : "";
  const metaExtraCss = extras
    ? ".item-time{color:" + (d.timeColor || DEFAULT_DISPLAY.timeColor) + "}" +
      ".item-src,.item-src a{color:" + (d.srcColor || DEFAULT_DISPLAY.srcColor) + "}" +
      ".item-tag{background:" + (d.tagBg || DEFAULT_DISPLAY.tagBg) +
        ";color:" + (d.tagColor || DEFAULT_DISPLAY.tagColor) +
        ";border-color:color-mix(in srgb," + (d.tagColor || DEFAULT_DISPLAY.tagColor) + " 30%,transparent)" +
        ";border-radius:" + (tagR >= 20 ? "999px" : tagR + "px") + "}"
    : "";
  const quoteExtraCss = extras
    ? ";font-weight:" + (d.fontWeight || DEFAULT_DISPLAY.fontWeight) +
      ";border-left:" + quoteBW + "px solid " + (d.quoteBorder || DEFAULT_DISPLAY.quoteBorder)
    : "";
  const ansExtraCss = extras ? ";font-weight:" + (d.ansFontWeight || DEFAULT_DISPLAY.ansFontWeight) : "";
  const mainExtraCss = extras
    ? ";border-left:" + mainBW + "px solid " + mainBorderColor +
      ";font-weight:" + (d.mainFontWeight || DEFAULT_DISPLAY.mainFontWeight)
    : "";
  return (
    // 页面底色同时落一份变量：模板里要「咬」页面底色的地方（小票的撕口等）要用到
    ":root{--page-bg:" + d.pageBg + "}" +
    "body{background:" + d.pageBg + ";color:" + d.fontColor +
      ";font-family:" + ff + ";font-size:" + d.fontSize + "px}" +
    // 白底/透明底时打印：顶部不留白、标题下边距收到 18px（屏幕预览保持原样）
    (isLightPageBg(d.pageBg)
      ? "@media print{body{padding-top:0}h1{margin-bottom:18px}}"
      : "") +
    ".card{border-radius:" + cardR + "px" + cardExtraCss + "}" +
    metaExtraCss +
    ".item-text{background:" + d.quoteBg + ";color:" + d.fontColor +
      ";font-size:" + d.fontSize + "px;line-height:" + d.lineHeight +
      ";font-family:" + ff + ";border-radius:" + quoteR + "px" + quoteExtraCss + "}" +
    // 释义：独立作用域的字体/颜色/大小/行高
    ".item-answer{color:" + (d.ansFontColor || d.fontColor) +
      ";font-size:" + (d.ansFontSize || d.fontSize) + "px" +
      ";line-height:" + (d.ansLineHeight || d.lineHeight) +
      ansExtraCss +
      ";font-family:" + aff + "}" +
    // 释义段后间距
    ".item-answer p{margin:0 0 " + (d.ansSpacing === 0 ? 0 : d.ansSpacing || DEFAULT_DISPLAY.ansSpacing) + "px}" +
    // 主文：独立作用域的字体/颜色/大小/行高
    ".item-main{background:" + d.mainBg + ";color:" + (d.mainFontColor || d.fontColor) +
      mainExtraCss +
      ";font-size:" + (d.mainFontSize || DEFAULT_DISPLAY.mainFontSize) + "px" +
      ";line-height:" + (d.mainLineHeight || DEFAULT_DISPLAY.mainLineHeight) +
      ";font-family:" + mff + "}" +
    // 明细主文：同一底色淡出（默认模板按用户设置的主文底色算）
    ".item-main-dim{background:color-mix(in srgb," + d.mainBg + " 40%,transparent)" +
      ";border-left-color:color-mix(in srgb," + mainBorderColor + " 35%,transparent)}" +
    // 摘录记录：左侧深色竖线的引文样式，底色与主文不同，置于最后确保覆盖上面的原文底色
    ".item-text-extract{background:" + d.extractBg +
      ";border-left:3px solid " + deepBorder(d.extractBg) +
      ";border-radius:" + extractR + "px;padding-left:12px;font-weight:normal}" +
    // 聚合明细之间的分隔线：写进变量，模板规则用 var 兜自己的默认色
    (d.aggSep || d.aggSepStyle
      ? ":root{--agg-sep:" + (d.aggSep || "rgba(99,102,241,.28)") +
        ";--agg-sep-style:" + (d.aggSepStyle || "dashed") + "}"
      : "")
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
      // 用线性渐变 + 固定 background-size 平铺：repeating-linear-gradient 在 125% 缩放/非整数像素比下
      // 会周期性丢掉重复里的某一条线（表现为每隔几条缺一条），改成整块平铺就不会
      "background-image:" +
      "linear-gradient(to bottom,rgba(120,170,220,.28) 0 1px,transparent 1px 25px)," +
      "linear-gradient(to right,rgba(120,170,220,.2) 0 1px,transparent 1px 25px);" +
      "background-size:100% 25px,25px 100%;background-repeat:repeat,repeat;" +
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
      // 首段首字下沉（开了「合并原文释义」时原文已是大字头，首字下沉要失效）
      'body[data-tpl="book"] .item-answer p:first-of-type::first-letter{float:left;font-size:30px;line-height:26px;' +
      "padding-right:4px;font-weight:600;color:#6b4a2f}" +
      "body[data-tpl=\"book\"].merge-quote .item-answer p:first-of-type::first-letter{float:none;font-size:inherit;" +
      "line-height:inherit;padding-right:0;font-weight:inherit;color:inherit}" +
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
      "margin:0 0 8px;font-family:Georgia,'华文细黑','Songti SC','SimSun',serif;font-size:17px;line-height:1.45;" +
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
      // 打印用的透明占位块会占掉栅格一格，两栏模板里隐藏掉
      'body[data-tpl="cards"] .card-gap{display:none!important}' +
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
  {
    id: "receipt",
    name: "小票",
    desc: "整页两栏，白色票据纸、撕口下边、底部条码",
    css:
      // 页面级两栏：打印/导出用多列流（grid 整块不可分页，会把卡片全推到第二页），
      // 屏幕上改用瀑布流（见 applyMasonry：每张卡放进当前较矮的那一栏），两栏都从顶部起、
      // 底边尽量齐平，卡片完整不拆。
      'body[data-tpl="receipt"] #list{background:transparent;column-count:2;column-gap:16px}' +
      '@media (max-width:560px){body[data-tpl="receipt"] #list{column-count:1}}' +
      '@media screen{body[data-tpl="receipt"] #list{column-count:auto;display:flex;gap:16px;align-items:flex-start}}' +
      '@media screen{body[data-tpl="receipt"] .rcpt-col{display:flex;flex-direction:column;gap:16px;' +
      "flex:1 1 0;min-width:0}}" +
      '@media screen{body[data-tpl="receipt"] .rcpt-col>.card{margin:0}}' +
      // 只有一张卡（或还没排瀑布流）时占满整行，避免 flex 把它压成内容宽度
      '@media screen{body[data-tpl="receipt"] #list>.card{flex:1 1 100%;width:100%}}' +
      // 「卡片不跨页」用的透明占位块会占掉一栏的位置，这里直接不显示
      'body[data-tpl="receipt"] .card-gap{display:none!important}' +
      // 票据纸本体：白纸、直角、底部留出撕口与条码的位置
      'body[data-tpl="receipt"] .card{position:relative;background:#fff;border:0;border-radius:2px;' +
      "box-shadow:0 8px 20px rgba(17,24,39,.14);padding:14px 18px 46px;margin:0 0 16px;min-width:0;" +
      "break-inside:avoid;page-break-inside:avoid;-webkit-backdrop-filter:none;backdrop-filter:none}" +
      // 标题上方的操作图标行与时间/来源行收紧，别把原文顶得太靠下
      'body[data-tpl="receipt"] .item-head{margin-bottom:2px}' +
      'body[data-tpl="receipt"] .item-meta{margin-top:0}' +
      'body[data-tpl="receipt"] .item-text{margin-top:2px}' +
      // 打印时允许卡片跨栏/跨页拆开：纸上不留栏尾空白，内容接着往下排
      '@media print{body[data-tpl="receipt"] .card{break-inside:auto;page-break-inside:auto}}' +
      // 底部撕口：纸色半圆齿露在卡片下方，看起来像撕下来的小票边
      'body[data-tpl="receipt"] .card::after{content:"";position:absolute;left:0;right:0;bottom:-9px;height:10px;' +
      "background-image:radial-gradient(circle at 5px 0,#fff 5px,transparent 5.5px);" +
      "background-size:10px 10px;background-repeat:repeat-x}" +
      // 底部右下角的条码
      'body[data-tpl="receipt"] .card::before{content:"";position:absolute;right:16px;bottom:14px;width:56px;height:12px;' +
      "background:repeating-linear-gradient(90deg,#111 0 2px,transparent 2px 4px,#111 4px 5px,transparent 5px 8px);" +
      "opacity:.5}" +
      // 页眉/页脚都做成票据上的等宽小字
      'body[data-tpl="receipt"] .item-time,body[data-tpl="receipt"] .item-src,body[data-tpl="receipt"] .item-src a{' +
      "font-family:ui-monospace,'Cascadia Mono',Consolas,monospace;font-size:11px;letter-spacing:.1em;" +
      "text-transform:uppercase;color:#8a8a8a}" +
      'body[data-tpl="receipt"] .item-text{background:transparent;border:0;border-radius:0;padding:0;margin:2px 0 10px;' +
      "font-size:15px;line-height:1.6;color:#111;font-weight:700}" +
      'body[data-tpl="receipt"] .item-text-extract{background-color:transparent!important;border-left:0;padding-left:0}' +
      // 释义上方一排行点，像撕纸的虚线
      'body[data-tpl="receipt"] .item-answer{font-size:12.5px;line-height:1.8;color:#33343a}' +
      'body[data-tpl="receipt"] .item-answer::after{content:"";display:block;height:9px;margin:12px 0 0;' +
      "background-image:radial-gradient(circle at 4px 4px,#cccccc 1.4px,transparent 1.6px);" +
      "background-size:9px 9px;background-repeat:repeat-x}" +
      'body[data-tpl="receipt"] .item-answer p{margin:0 0 6px}' +
      // 那排圆点是「正文与底部条码之间的撕线」，聚合卡里只留最后一条明细画，中间的明细靠分隔线分段
      'body[data-tpl="receipt"] .agg-items .item-answer::after{content:none}' +
      'body[data-tpl="receipt"] .agg-items>.agg-item:last-child .item-answer::after{content:""}' +
      'body[data-tpl="receipt"] .item-tag{background:transparent;border:1px dashed #cfcfcf;border-radius:2px;' +
      "color:#6f7078;font-family:ui-monospace,'Cascadia Mono',Consolas,monospace}" +
      'body[data-tpl="receipt"] .item-main{background:#f6f6f4;border:0;border-left:2px solid #dddddd;border-radius:0;' +
      "color:#4a4b52;font-size:12px;line-height:1.8}" +
      // 聚合：明细之间仍是一条虚线，头部时间也是等宽小字
      'body[data-tpl="receipt"] .agg-items{gap:0}' +
      'body[data-tpl="receipt"] .agg-item-head{font-family:ui-monospace,\'Cascadia Mono\',Consolas,monospace;' +
      "font-size:11px;color:#8a8a8a}" +
      // 打印时纸面吃掉一档对比度：等宽小字、标签框、票面轮廓都加深，屏幕上保持原样
      '@media print{body[data-tpl="receipt"] .item-time,body[data-tpl="receipt"] .item-src,' +
      'body[data-tpl="receipt"] .item-src a,body[data-tpl="receipt"] .agg-item-head{color:#3f3f3f}' +
      'body[data-tpl="receipt"] .item-tag{color:#3f3f3f;border-color:#909090}' +
      // 卡片阴影打印不出来，改用一条浅边框勾出票面轮廓
      'body[data-tpl="receipt"] .card{border:1px solid #dcdcdc}' +
      'body[data-tpl="receipt"] .card::before{opacity:.8}}',
  },
];
let styleTemplate = "glass";
let stylePinned = false; // 样式设置区是否钉住（滚动时贴住页面顶部）

// ---------- 全局布局：单栏 / 两栏 ----------
// 两栏本身与外观无关：页面排成两栏（屏幕走瀑布流，打印走 CSS 多列流）。
// 报纸、杂志的自定义卡片内部已经是双栏，再套一层页面两栏会碎，所以这两个模板下不生效。
const LAYOUT_KEY = "layoutMode";
const LAYOUT_NO_TWOCOL = ["news", "magazine", "cards"];
let layoutMode = "single";
const LAYOUT_CSS =
  'body[data-layout="twocol"] #list{column-count:2;column-gap:16px}' +
  '@media (max-width:560px){body[data-layout="twocol"] #list{column-count:1}}' +
  '@media screen{body[data-layout="twocol"] #list{column-count:auto;display:flex;gap:16px;align-items:flex-start}}' +
  '@media screen{body[data-layout="twocol"] .rcpt-col{display:flex;flex-direction:column;gap:16px;' +
  "flex:1 1 0;min-width:0}}" +
  '@media screen{body[data-layout="twocol"] .rcpt-col>.card{margin:0}}' +
  '@media screen{body[data-layout="twocol"] #list>.card{flex:1 1 100%;width:100%}}' +
  'body[data-layout="twocol"] .card-gap{display:none!important}' +
  '@media print{body[data-layout="twocol"] .card{break-inside:auto;page-break-inside:auto}}';

// 当前是否真的按两栏排：选了「两栏」且模板不是报纸/杂志；小票模板自带两栏，也走这里
function layoutActive() {
  return layoutMode === "twocol" && !LAYOUT_NO_TWOCOL.includes(styleTemplate);
}

// 导出/预览页没有 #list，卡片直接挂在 .wrap 上，两栏要落在 .wrap；
// 历史页也有 .wrap（工具栏+设置区+列表都在里面），所以这条只在导出页拼进去，不能进 LAYOUT_CSS
const LAYOUT_EXPORT_CSS =
  'body[data-layout="twocol"] .wrap{max-width:820px;column-count:2;column-gap:16px}' +
  // 标题与导出时间（含副标题）横跨整行，不参与分栏
  'body[data-layout="twocol"] .wrap>h1,body[data-layout="twocol"] .wrap>.sub{column-span:all}' +
  '@media (max-width:560px){body[data-layout="twocol"] .wrap{column-count:1}}';

// 把当前布局落到 body 上，并同步面板按钮
function syncLayout() {
  const on = layoutActive() || styleTemplate === "receipt";
  document.body.dataset.layout = on ? "twocol" : "";
  [...document.querySelectorAll("#layoutBar .seg-btn")].forEach((b) => {
    b.classList.toggle("active", b.dataset.layout === layoutMode);
  });
  const bar = $("layoutBar");
  if (bar) {
    bar.title = LAYOUT_NO_TWOCOL.includes(styleTemplate)
      ? "该模板的卡片内部已是双栏，页面两栏对它不生效"
      : "两栏：屏幕上左右两栏瀑布流，打印时首尾相接、卡片可跨栏拆开";
  }
}

function setLayout(mode, persist = true) {
  layoutMode = mode === "twocol" ? "twocol" : "single";
  if ($("layoutBar")) syncLayout();
  if (persist) chrome.storage.local.set({ [LAYOUT_KEY]: layoutMode });
  if (typeof applyMasonry === "function") applyMasonry();
}


function styleTemplateCss(id) {
  const t = STYLE_TEMPLATES.find((x) => x.id === id);
  return (t ? t.css : "") + (t ? "\n" + aggSepCss(id) : "");
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
      "body[data-tpl=\"cards\"] .card{margin-bottom:0}" +
      "body[data-tpl=\"cards\"] .card-gap{display:none!important}"
    );
  // 小票：导出、预览、打印同样是整页两栏（多列流，可跨页续排），标题与副标题横跨整行
  if (id === "receipt")
    return (
      "body[data-tpl=\"receipt\"] .wrap{max-width:820px;column-count:2;column-gap:16px}" +
      "body[data-tpl=\"receipt\"] .wrap>h1,body[data-tpl=\"receipt\"] .wrap>.sub{column-span:all}" +
      "body[data-tpl=\"receipt\"] .card{margin:0 0 16px}" +
      "body[data-tpl=\"receipt\"] .card-gap{display:none!important}" +
      "@media (max-width:560px){body[data-tpl=\"receipt\"] .wrap{column-count:1}}"
    );
  return "";
}

// 导出/打印页标题前的圆点：跟着各模板自己的主色走（默认模板保留原来的紫蓝渐变）
const DOT_COLORS = {
  doc: "#6366f1",
  quote: "#64748b",
  compact: "#94a3b8",
  paper: "#b08a5a",
  sticky: "#e0b23c",
  dark: "#8b9cf9",
  news: "#44403c",
  grid: "#7ea6cf",
  ruled: "#7ea6cf",
  mono: "#6b7280",
  kraft: "#a97c4c",
  ink: "#8a7f6a",
  warmdark: "#c8a878",
  legal: "#4a6fa5",
  seyes: "#5b8fc9",
  carre: "#7f97ad",
  dots: "#8a8574",
  typer: "#a8724a",
  book: "#8a5a33",
  magazine: "#9aa0a8",
  terminal: "#4f9f7f",
  cards: "#6366f1",
};

function templateDotCss(id) {
  const c = DOT_COLORS[id];
  if (!c) return "";
  return "h1 .dot{background:" + c + ";background-image:none}" +
    "@media print{h1 .dot{background:" + c + ";background-image:none}}";
}

// 深色模板打印时改成白底黑字（否则黑字压在深底上看不见）
const DARK_TEMPLATES = ["dark", "warmdark", "terminal"];
// 打印用的浅底色：给三个深色模板一点各自的色偏，纸上还看得出是哪个模板
const DARK_PRINT_BG = { dark: "#f8f9fb", warmdark: "#fbf8f2", terminal: "#f6f9f8" };

function darkPrintCss(id) {
  if (DARK_TEMPLATES.indexOf(id) < 0) return "";
  const s = 'body[data-tpl="' + id + '"]';
  const pageBg = DARK_PRINT_BG[id] || "#fff";
  return (
    s + "{background:" + pageBg + "!important;color:#111!important}" +
    s + " .card{background:" + pageBg + "!important;border-color:#e5e7eb!important;box-shadow:none!important" +
    ";-webkit-backdrop-filter:none!important;backdrop-filter:none!important}" +
    // 原文 / 摘录 / 主文块在白底上收回到浅底细线
    s + " .item-text," + s + " .item-text-extract," + s + " .item-main," + s + " .item-main-dim{" +
    "background:" + pageBg + "!important;border-color:#dde1e7!important}" +
    // 所有文字（含时间、来源、标签、标题）一律纯黑，标签改成浅底
    s + " .item-text," + s + " .item-text-extract," + s + " .item-answer," + s + " .item-answer p," +
    s + " .item-answer li," + s + " .item-answer blockquote," + s + " .item-main," + s + " .item-main-dim," +
    s + " h1," + s + " .h1-sub," + s + " .item-time," + s + " .item-src," + s + " .item-src a," +
    s + " .item-count," + s + " .item-tag{color:#000!important}" +
    s + " .item-tag{background:#f2f3f5!important;border-color:#dfe2e6!important}" +
    s + " .item-answer code," + s + " .item-answer pre{background:#f5f6f8!important;color:#000!important}"
  );
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

// 聚合明细之间的分隔线默认色：按模板底色给一条协调的线，留空（跟随模板）时用
const AGG_SEP_BY_TPL = {
  glass: "rgba(99,102,241,.28)",
  doc: "rgba(99,102,241,.22)",
  quote: "rgba(140,150,165,.3)",
  compact: "rgba(99,102,241,.22)",
  paper: "rgba(150,120,70,.28)",
  sticky: "rgba(180,150,60,.3)",
  dark: "rgba(255,255,255,.14)",
  news: "rgba(120,110,95,.28)",
  grid: "rgba(99,102,241,.22)",
  ruled: "rgba(99,102,241,.2)",
  dot: "rgba(99,102,241,.2)",
  mono: "rgba(60,60,60,.2)",
  kraft: "rgba(120,90,55,.3)",
  ink: "rgba(40,40,40,.22)",
  warmdark: "rgba(255,255,255,.14)",
  legal: "rgba(99,102,241,.2)",
  seyes: "rgba(99,102,241,.2)",
  carre: "rgba(99,102,241,.2)",
  dots: "rgba(99,102,241,.2)",
  typer: "rgba(70,60,45,.25)",
  book: "rgba(150,125,85,.3)",
  magazine: "rgba(150,155,165,.28)",
  cards: "rgba(99,102,241,.22)",
  // 小票：明细之间用细直线分段，末条之后再画那排圆点收尾
  receipt: "rgba(0,0,0,.16)",
  terminal: "rgba(90,160,140,.28)",
};

function aggSepCss(id) {
  const c = AGG_SEP_BY_TPL[id];
  if (!c) return "";
  // 用 var 兜模板默认值：用户在面板里改过线色/线型时，变量会盖掉模板默认
  // 只作用于非首条明细，否则会盖掉基础的「首条无上边框」
  return (
    'body[data-tpl="' + id + '"] .agg-item:not(:first-child){border-top-color:var(--agg-sep,' + c + ");" +
    "border-top-style:var(--agg-sep-style,dashed)}"
  );
}

// 把模板样式注入历史页（一次即可，切换靠 body 上的 data-tpl）
function ensureTemplateStyle() {
  if (document.getElementById("tplStyle")) return;
  const style = document.createElement("style");
  style.id = "tplStyle";
  style.textContent =
    STYLE_TEMPLATES.map((t) => t.css).join("\n") +
    "\n" +
    STYLE_TEMPLATES.map((t) => mainDimCss(t.id)).join("\n") +
    "\n" +
    STYLE_TEMPLATES.map((t) => aggSepCss(t.id)).join("\n") +
    "\n" +
    LAYOUT_CSS;
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
  // 切模板可能让「两栏」生效或失效（报纸/杂志不吃页面两栏）
  syncLayout();
  // 把该模板的样式回填到样式设置面板（面板只记录“改动”，模板默认值作为恢复基准）
  syncTemplateStyleState();
  // 切进/切出小票模板时，瀑布流的分栏容器要建起来或拆掉
  if (typeof applyMasonry === "function") applyMasonry();
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
  // 「样式有修改」跟着模板胶囊一起排，固定落在最后一个模板后面
  const hint = $("tplModified");
  if (hint) bar.appendChild(hint);
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

// 农历 1900-2100 年月大小 / 闰月信息表（每年一个十六进制数：低 4 位是闰月月份，16 位是闰月大小，中间 12 位是各月大小）
const LUNAR_INFO = [
  0x04bd8, 0x04ae0, 0x0a570, 0x054d5, 0x0d260, 0x0d950, 0x16554, 0x056a0, 0x09ad0, 0x055d2,
  0x04ae0, 0x0a5b6, 0x0a4d0, 0x0d250, 0x1d255, 0x0b540, 0x0d6a0, 0x0ada2, 0x095b0, 0x14977,
  0x04970, 0x0a4b0, 0x0b4b5, 0x06a50, 0x06d40, 0x1ab54, 0x02b60, 0x09570, 0x052f2, 0x04970,
  0x06566, 0x0d4a0, 0x0ea50, 0x16a95, 0x05ad0, 0x02b60, 0x186e3, 0x092e0, 0x1c8d7, 0x0c950,
  0x0d4a0, 0x1d8a6, 0x0b550, 0x056a0, 0x1a5b4, 0x025d0, 0x092d0, 0x0d2b2, 0x0a950, 0x0b557,
  0x06ca0, 0x0b550, 0x15355, 0x04da0, 0x0a5b0, 0x14573, 0x052b0, 0x0a9a8, 0x0e950, 0x06aa0,
  0x0aea6, 0x0ab50, 0x04b60, 0x0aae4, 0x0a570, 0x05260, 0x0f263, 0x0d950, 0x05b57, 0x056a0,
  0x096d0, 0x04dd5, 0x04ad0, 0x0a4d0, 0x0d4d4, 0x0d250, 0x0d558, 0x0b540, 0x0b6a0, 0x195a6,
  0x095b0, 0x049b0, 0x0a974, 0x0a4b0, 0x0b27a, 0x06a50, 0x06d40, 0x0af46, 0x0ab60, 0x09570,
  0x04af5, 0x04970, 0x064b0, 0x074a3, 0x0ea50, 0x06b58, 0x05ac0, 0x0ab60, 0x096d5, 0x092e0,
  0x0c960, 0x0d954, 0x0d4a0, 0x0da50, 0x07552, 0x056a0, 0x0abb7, 0x025d0, 0x092d0, 0x0cab5,
  0x0a950, 0x0b4a0, 0x0baa4, 0x0ad50, 0x055d9, 0x04ba0, 0x0a5b0, 0x15176, 0x052b0, 0x0a930,
  0x07954, 0x06aa0, 0x0ad50, 0x05b52, 0x04b60, 0x0a6e6, 0x0a4e0, 0x0d260, 0x0ea65, 0x0d530,
  0x05aa0, 0x076a3, 0x096d0, 0x04afb, 0x04ad0, 0x0a4d0, 0x1d0b6, 0x0d250, 0x0d520, 0x0dd45,
  0x0b5a0, 0x056d0, 0x055b2, 0x049b0, 0x0a577, 0x0a4b0, 0x0aa50, 0x1b255, 0x06d20, 0x0ada0,
  0x14b63, 0x09370, 0x049f8, 0x04970, 0x064b0, 0x168a6, 0x0ea50, 0x06b20, 0x1a6c4, 0x0aae0,
  0x0a2e0, 0x0d2e3, 0x0c960, 0x0d557, 0x0d4a0, 0x0da50, 0x05d55, 0x056a0, 0x0a6d0, 0x055d4,
  0x052d0, 0x0a9b8, 0x0a950, 0x0b4a0, 0x0b6a6, 0x0ad50, 0x055a0, 0x0aba4, 0x0a5b0, 0x052b0,
  0x0b273, 0x06930, 0x07337, 0x06aa0, 0x0ad50, 0x14b55, 0x04b60, 0x0a570, 0x054e4, 0x0d160,
  0x0e968, 0x0d520, 0x0daa0, 0x16aa6, 0x056d0, 0x04ae0, 0x0a9d4, 0x0a2d0, 0x0d150, 0x0f252,
  0x0d520,
];
const LUNAR_MONTH_NAMES = ["正", "二", "三", "四", "五", "六", "七", "八", "九", "十", "冬", "腊"];
const LUNAR_DAY_NAMES = [
  "初一", "初二", "初三", "初四", "初五", "初六", "初七", "初八", "初九", "初十",
  "十一", "十二", "十三", "十四", "十五", "十六", "十七", "十八", "十九", "二十",
  "廿一", "廿二", "廿三", "廿四", "廿五", "廿六", "廿七", "廿八", "廿九", "三十",
];

function lunarLeapMonth(y) {
  return LUNAR_INFO[y - 1900] & 0xf;
}

function lunarLeapDays(y) {
  if (!lunarLeapMonth(y)) return 0;
  return LUNAR_INFO[y - 1900] & 0x10000 ? 30 : 29;
}

function lunarMonthDays(y, m) {
  return LUNAR_INFO[y - 1900] & (0x10000 >> m) ? 30 : 29;
}

function lunarYearDays(y) {
  let sum = 348; // 12 个月各 29 天
  for (let i = 0x8000; i > 0x8; i >>= 1) sum += LUNAR_INFO[y - 1900] & i ? 1 : 0;
  return sum + lunarLeapDays(y);
}

// 公历 → 农历（返回 { year, month, day, isLeap }；只换算 2026-2100 这段，别的年份返回 null 走原格式）
function solarToLunar(sy, sm, sd) {
  if (sy < 2026 || sy > 2100) return null;
  if (sy === 1900 && (sm === 1 && sd < 31)) return null;
  // 1900-01-31 是农历 1900 年正月初一
  let daySpan = Math.floor((Date.UTC(sy, sm - 1, sd) - Date.UTC(1900, 0, 31)) / 86400000) + 1;
  if (daySpan < 1) return null;
  let ly = 1900;
  while (ly < 2100 && daySpan > lunarYearDays(ly)) {
    daySpan -= lunarYearDays(ly);
    ly++;
  }
  // 该年的月份序列（闰月插在对应月份之后）
  const leap = lunarLeapMonth(ly);
  const months = [];
  for (let m = 1; m <= 12; m++) {
    months.push({ m, isLeap: false, days: lunarMonthDays(ly, m) });
    if (leap === m) months.push({ m, isLeap: true, days: lunarLeapDays(ly) });
  }
  let i = 0;
  while (i < months.length - 1 && daySpan > months[i].days) {
    daySpan -= months[i].days;
    i++;
  }
  return { year: ly, month: months[i].m, day: daySpan, isLeap: months[i].isLeap };
}

// 农历日期文案：丙午年冬月初八（闰月写「闰X月」）
function formatLunarDate(sy, sm, sd) {
  const l = solarToLunar(sy, sm, sd);
  if (!l) return "";
  const leapMark = l.isLeap ? "闰" : "";
  const dayName = LUNAR_DAY_NAMES[l.day - 1] || String(l.day);
  return ganzhiYear(l.year) + leapMark + LUNAR_MONTH_NAMES[l.month - 1] + "月" + dayName;
}

// 记录时间的展示格式：按「设置 → 时间显示」决定（默认到秒）
function recordTimeMode() {
  const m = displayOpts && displayOpts.timeDisplay;
  return m === "date" || m === "short" || m === "ganzhi" ? m : "second";
}

// 干支纪年：(公历年 - 1984) 取模 60，1984 年为甲子年
function ganzhiYear(y) {
  const gan = ["甲", "乙", "丙", "丁", "戊", "己", "庚", "辛", "壬", "癸"];
  const zhi = ["子", "丑", "寅", "卯", "辰", "巳", "午", "未", "申", "酉", "戌", "亥"];
  const n = (((y - 1984) % 60) + 60) % 60;
  return gan[n % 10] + zhi[n % 12] + "年";
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
  // 干支纪年：年月日用农历，不带时分秒
  if (mode === "ganzhi") {
    const lunar = formatLunarDate(d.getFullYear(), d.getMonth() + 1, d.getDate());
    if (lunar) return lunar;
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
  renderLocalFontOptions();
}

// 把读到的本机字体挂到下拉里（放在末尾分组，值就是字体族名）
function renderLocalFontOptions() {
  const sel = $("optFontPreset");
  if (!sel) return;
  sel.querySelectorAll("#localFontGroup").forEach((g) => g.remove());
  if (localFontList.length) sel.appendChild(buildFontGroup("localFontGroup", "本机字体", localFontList));
}

function buildFontGroup(id, label, names) {
  const grp = document.createElement("optgroup");
  grp.id = id;
  grp.label = label;
  names.forEach((name) => {
    const o = document.createElement("option");
    o.value = name;
    o.textContent = name;
    grp.appendChild(o);
  });
  return grp;
}

// 字体名模糊匹配打分：连续命中分最高（越靠前越高），允许隔字顺序命中
function fontMatchScore(name, q) {
  if (!q) return 0;
  const n = String(name).toLowerCase();
  const s = String(q).toLowerCase();
  const idx = n.indexOf(s);
  if (idx >= 0) return 100 - idx;
  let i = 0;
  let gaps = 0;
  let started = false;
  for (let k = 0; k < n.length && i < s.length; k++) {
    if (n[k] === s[i]) {
      i++;
      started = true;
    } else if (started) gaps++;
  }
  return i === s.length ? Math.max(1, 50 - gaps) : -1;
}

// 候选来源：内置预设（显示中文名）+ 本机读到的字体
function fontCandidates() {
  const out = [];
  FONT_OPTIONS.forEach((o) => {
    if (o.value) out.push({ name: o.label, value: o.value });
  });
  localFontList.forEach((name) => out.push({ name, value: name }));
  return out;
}

// 自定义字体输入框：边输入边给模糊匹配的候选，点/回车即填入
function bindFontSuggest() {
  const input = $("optFontFamily");
  const box = $("fontSuggest");
  const clearBtn = $("fontClear");
  if (!input || !box) return;
  let active = -1;

  // 输入框里有内容时显示右侧清空图标（与搜索框一致）
  const syncClear = () => {
    if (clearBtn) clearBtn.hidden = !input.value.trim();
  };
  input.addEventListener("input", syncClear);
  input.addEventListener("focus", syncClear);
  if (clearBtn) {
    clearBtn.addEventListener("click", () => {
      input.value = "";
      syncClear();
      hide();
      input.focus();
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }
  syncClear();

  const hide = () => {
    box.hidden = true;
    box.innerHTML = "";
    active = -1;
  };

  const paint = () => {
    Array.from(box.children).forEach((el, i) => el.classList.toggle("active", i === active));
  };

  const pick = (i) => {
    const el = box.children[i];
    if (!el) return;
    input.value = el.dataset.value;
    hide();
    input.dispatchEvent(new Event("input", { bubbles: true }));
  };

  const render = () => {
    const q = input.value.trim();
    if (!q) {
      hide();
      return;
    }
    const items = fontCandidates()
      .map((c) => ({ c, score: fontMatchScore(c.name, q) }))
      .filter((x) => x.score >= 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 8)
      .map((x) => x.c);
    if (!items.length) {
      hide();
      return;
    }
    box.innerHTML = "";
    items.forEach((c, i) => {
      const el = document.createElement("div");
      el.className = "font-suggest-item";
      el.textContent = c.name;
      el.dataset.value = c.value;
      el.addEventListener("mousedown", (e) => {
        e.preventDefault();
        pick(i);
      });
      box.appendChild(el);
    });
    box.hidden = false;
    active = -1;
  };

  input.addEventListener("input", render);
  input.addEventListener("focus", render);
  input.addEventListener("blur", () => setTimeout(hide, 120));
  input.addEventListener("keydown", (e) => {
    if (box.hidden) return;
    const n = box.children.length;
    if (!n) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      active = (active + 1) % n;
      paint();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      active = (active - 1 + n) % n;
      paint();
    } else if (e.key === "Enter" && active >= 0) {
      e.preventDefault();
      pick(active);
    } else if (e.key === "Escape") {
      hide();
    }
  });
}

// 中文（以及常见 CJK 字体）的族名特征，用来从本机字体里挑出要显示的
const CJK_FONT_RE =
  /(宋|黑|楷|仿|雅黑|等线|明朝|隶|圆体|標楷|新細明|微软|方正|思源|华文|汉仪|汉|文鼎|苹方|冬青|兰亭|Sim|Kai|Fang|YaHei|DengXian|MingLiU|PMingLiU|Source Han|Noto (Sans|Serif) (SC|TC|CJK)|Hiragino Sans GB|PingFang|STSong|STKaiti|STHeiti|STFangsong|Yu Gothic|Meiryo|Malgun|PMing|Batang)/i;

// 名字里没有中文特征的字体（如方正金陵的英文族名 FZJinLing）用画字宽的方式判一下有没有中文字形：
// 没有中文字形时会回退到系统中文兜底字体，宽度和 monospace 基准一致；有的话宽度会不同
function fontSupportsCJK(family) {
  try {
    if (!fontSupportsCJK.ctx) {
      fontSupportsCJK.cv = document.createElement("canvas");
      fontSupportsCJK.ctx = fontSupportsCJK.cv.getContext("2d");
    }
    const ctx = fontSupportsCJK.ctx;
    const sample = "汉字";
    ctx.font = '64px monospace';
    const w0 = ctx.measureText(sample).width;
    ctx.font = '64px "' + String(family).replace(/"/g, '\\"') + '", monospace';
    const w1 = ctx.measureText(sample).width;
    return Math.abs(w1 - w0) > 0.5;
  } catch (e) {
    return false;
  }
}

// 读取本机字体：Local Font Access API，首次需要用户授权；不支持或拒绝时静默回退
async function scanLocalFonts() {
  const btn = $("fontScan");
  if (!window.queryLocalFonts) {
    if (btn) btn.title = "当前浏览器不支持读取本机字体（需 Chrome/Edge 103+）";
    return;
  }
  if (btn) {
    btn.disabled = true;
    btn.textContent = "读取中…";
  }
  try {
    const fonts = await window.queryLocalFonts();
    const all = new Set();
    fonts.forEach((f) => {
      const fam = String(f.family || "").trim();
      if (fam) all.add(fam);
    });
    // 一个「本机字体」组放全部读到的字体：中文在前，其它按名称排在后面
    localFontList = [...all].sort((a, b) => {
      const ca = CJK_FONT_RE.test(a), cb = CJK_FONT_RE.test(b);
      if (ca !== cb) return ca ? -1 : 1;
      return a.localeCompare(b, "zh");
    });
    chrome.storage.local.set({ [LOCAL_FONTS_KEY]: localFontList });
    renderLocalFontOptions();
    if (btn) btn.title = "已读取 " + localFontList.length + " 个字体，可再次读取";
  } catch (e) {
    if (btn) btn.title = "没有取得字体列表（授权被拒绝或浏览器不支持）";
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = "读取本机字体";
    }
  }
}

// 按当前 displayOpts 同步各显示控件
function syncDisplayControls() {
  $("optPageBg").value = displayOpts.pageBg;
  $("optQuoteBg").value = displayOpts.quoteBg;
  $("optMainBg").value = displayOpts.mainBg;
  $("optExtractBg").value = displayOpts.extractBg || DEFAULT_DISPLAY.extractBg;
  syncFontScopeControls();
  $("optTimeDisplay").value = recordTimeMode();
  $("optMergeQuote").checked = quoteMerge;
  $("optMergeMax").value = quoteMergeMax;
  $("optCardRadius").value = displayOpts.cardRadius ?? DEFAULT_DISPLAY.cardRadius;
  $("optQuoteRadius").value = displayOpts.quoteRadius ?? DEFAULT_DISPLAY.quoteRadius;
  $("optExtractRadius").value = displayOpts.extractRadius ?? DEFAULT_DISPLAY.extractRadius;
  // 卡片本体
  const d = displayOpts;
  $("optCardBg").value = d.cardBg || DEFAULT_DISPLAY.cardBg;
  $("optCardBorder").value = d.cardBorder || DEFAULT_DISPLAY.cardBorder;
  $("optCardBorderW").value = d.cardBorderW === undefined ? DEFAULT_DISPLAY.cardBorderW : Number(d.cardBorderW) || 0;
  $("optCardBar").value = d.cardBar || d.cardBorder || DEFAULT_DISPLAY.cardBar;
  $("optCardBarW").value = d.cardBarW === undefined ? DEFAULT_DISPLAY.cardBarW : Number(d.cardBarW) || 0;
  $("optCardShadow").value = d.cardShadow || DEFAULT_DISPLAY.cardShadow;
  $("optCardGap").value = d.cardGap === undefined ? DEFAULT_DISPLAY.cardGap : Number(d.cardGap) || 0;
  $("optCardPad").value = d.cardPad === undefined ? DEFAULT_DISPLAY.cardPad : Number(d.cardPad) || 0;
  // 时间 / 来源 / 标签
  $("optTimeColor").value = d.timeColor || DEFAULT_DISPLAY.timeColor;
  $("optSrcColor").value = d.srcColor || DEFAULT_DISPLAY.srcColor;
  $("optTagBg").value = d.tagBg || DEFAULT_DISPLAY.tagBg;
  $("optTagColor").value = d.tagColor || DEFAULT_DISPLAY.tagColor;
  $("optTagRadius").value = d.tagRadius === undefined ? DEFAULT_DISPLAY.tagRadius : Number(d.tagRadius) || 0;
  // 竖线
  $("optQuoteBorder").value = d.quoteBorder || DEFAULT_DISPLAY.quoteBorder;
  $("optQuoteBorderW").value = d.quoteBorderW === undefined ? DEFAULT_DISPLAY.quoteBorderW : Number(d.quoteBorderW) || 0;
  $("optMainBorder").value = d.mainBorder || darken(d.mainBg || DEFAULT_DISPLAY.mainBg, 0.12);
  $("optMainBorderW").value = d.mainBorderW === undefined ? DEFAULT_DISPLAY.mainBorderW : Number(d.mainBorderW) || 0;
  // 聚合明细分隔线：颜色留空表示跟随模板
  $("optAggSep").value = d.aggSep || "#6366f1";
  $("optAggSep").disabled = !d.aggSep;
  $("optAggSepStyle").value = d.aggSepStyle || "";
  $("optCardBorderWVal").textContent = $("optCardBorderW").value;
  $("optCardBarWVal").textContent = $("optCardBarW").value;
  $("optCardGapVal").textContent = $("optCardGap").value;
  $("optCardPadVal").textContent = $("optCardPad").value;
  $("optTagRadiusVal").textContent = Number($("optTagRadius").value) >= 20 ? "胶囊" : $("optTagRadius").value + "px";
  $("optQuoteBorderWVal").textContent = $("optQuoteBorderW").value;
  $("optMainBorderWVal").textContent = $("optMainBorderW").value;
  syncColorSwatches("bgSwatches", "optPageBg");
  syncColorSwatches("quoteSwatches", "optQuoteBg");
  syncColorSwatches("mainSwatches", "optMainBg");
  syncColorSwatches("extractSwatches", "optExtractBg");
  syncColorSwatches("cardSwatches", "optCardBg");
  syncColorSwatches("fontSwatches", "optFontColor");
}

// 字体控件（字体 / 颜色 / 大小 / 行高）按当前作用域回填
function syncFontScopeControls() {
  const sc = FONT_SCOPES[fontScope] || FONT_SCOPES.quote;
  $("optFontColor").value = displayOpts[sc.color] || DEFAULT_DISPLAY[sc.color];
  $("optFontSize").value = displayOpts[sc.size] || DEFAULT_DISPLAY[sc.size];
  $("optLineHeight").value = displayOpts[sc.line] || DEFAULT_DISPLAY[sc.line];
  if (sc.weight) $("optFontWeight").value = String(displayOpts[sc.weight] || DEFAULT_DISPLAY[sc.weight]);
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
  if (sc.weight) opts[sc.weight] = Number($("optFontWeight").value) || 400;
  if (sc.spacing) opts[sc.spacing] = Number($("optParaSpacing").value);
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
      [TPL_OVERRIDES_KEY]: {},
      [SOURCE_TEXTS_KEY]: {},
      [SHOW_MAIN_KEY]: true,
      [SHOW_QUOTE_KEY]: true,
      [AGG_KEY]: false,
      [SETTINGS_HIDDEN_KEY]: false,
      [READONLY_KEY]: false,
      [AGG_ORDER_KEY]: {},
      [STYLE_TPL_KEY]: "glass",
      [LAYOUT_KEY]: "single",
      [STYLE_PANEL_KEY]: false,
      [STYLE_PIN_KEY]: false,
      [LOCAL_FONTS_KEY]: [],
      [TIME_DISPLAY_KEY]: "second",
      [QUOTE_MERGE_KEY]: false,
      [QUOTE_MERGE_MAX_KEY]: 5,
      timeMode: "date",
      [QUICK_RANGE_KEY]: "",
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
      // 时间显示格式单独存一份：换模板、刷新都不丢（不跟着模板样式回填走）
      if (res[TIME_DISPLAY_KEY]) displayOpts.timeDisplay = res[TIME_DISPLAY_KEY];
      quoteMerge = !!res[QUOTE_MERGE_KEY];
      quoteMergeMax = Number(res[QUOTE_MERGE_MAX_KEY]) || 5;
      applyQuoteMerge();
      glassDisplay = { ...displayOpts };
      glassDisplay.timeDisplay = displayOpts.timeDisplay;
      syncDisplayControls();
      applyDisplay(displayOpts);

      displayPresets = Array.isArray(res[DISPLAY_PRESETS_KEY]) ? res[DISPLAY_PRESETS_KEY] : [];
      refreshPresetSelect();

      // 上次读到的本机字体：直接挂回字体下拉（兼容之前分组存过的 cjk/other 形式）
      const savedFonts = res[LOCAL_FONTS_KEY];
      if (Array.isArray(savedFonts)) {
        localFontList = savedFonts;
      } else if (savedFonts && typeof savedFonts === "object") {
        const cjk = Array.isArray(savedFonts.cjk) ? savedFonts.cjk : [];
        const other = Array.isArray(savedFonts.other) ? savedFonts.other : [];
        localFontList = [...cjk, ...other];
      }
      renderLocalFontOptions();
      syncFontScopeControls();

      sourceTexts = (res[SOURCE_TEXTS_KEY] && typeof res[SOURCE_TEXTS_KEY] === "object") ? res[SOURCE_TEXTS_KEY] : {};
      showMainText = res[SHOW_MAIN_KEY] !== false;
      showQuoteText = res[SHOW_QUOTE_KEY] !== false;
      syncMainBtn();
      syncQuoteBtn();
      aggregate = res[AGG_KEY] === true;
      syncAggBtn();
      settingsHidden = res[SETTINGS_HIDDEN_KEY] === true;
      syncSettingsBtn();
      syncReadonly(res[READONLY_KEY] === true);
      aggOrder = (res[AGG_ORDER_KEY] && typeof res[AGG_ORDER_KEY] === "object") ? res[AGG_ORDER_KEY] : {};

      // 列表风格模板：渲染按钮并套用（不再写回存储）
      tplOverrides = (res[TPL_OVERRIDES_KEY] && typeof res[TPL_OVERRIDES_KEY] === "object") ? res[TPL_OVERRIDES_KEY] : {};
      styleTemplate = res[STYLE_TPL_KEY] || "glass";
      // 全局布局：单栏 / 两栏（老数据没有这个键时按单栏）
      layoutMode = res[LAYOUT_KEY] === "twocol" ? "twocol" : "single";
      renderTplBar();
      applyStyleTemplate(styleTemplate, false);

      // 时间筛选精度（默认按日期）
      $("optTimeMode").value = res.timeMode === "second" ? "second" : "date";
      applyTimeMode($("optTimeMode").value, false, true);
      // 上次用的快捷时间范围：按存的「哪一种」重新算区间（不落死时间戳）
      const savedRange = res[QUICK_RANGE_KEY];
      if (savedRange && quickRangeBounds(savedRange)) {
        const [qs, qe] = quickRangeBounds(savedRange);
        setQuickActive(savedRange, false);
        setTimeRange(qs, qe, true);
      }

      // 样式设置独立成块，默认不显示
      syncStylePanel(res[STYLE_PANEL_KEY] === true);
      stylePinned = res[STYLE_PIN_KEY] === true;
      syncStylePin();

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
    chrome.storage.local.set({ [TIME_DISPLAY_KEY]: next.timeDisplay });
    next.cardRadius = Number($("optCardRadius").value);
    next.quoteRadius = Number($("optQuoteRadius").value);
    next.extractRadius = Number($("optExtractRadius").value);
    // 卡片本体
    next.cardBg = $("optCardBg").value;
    next.cardBorder = $("optCardBorder").value;
    next.cardBorderW = Number($("optCardBorderW").value);
    next.cardBar = $("optCardBar").value.toLowerCase() === $("optCardBorder").value.toLowerCase()
      ? "" : $("optCardBar").value;
    next.cardBarW = Number($("optCardBarW").value);
    next.cardShadow = $("optCardShadow").value;
    next.cardGap = Number($("optCardGap").value);
    next.cardPad = Number($("optCardPad").value);
    // 时间 / 来源 / 标签
    next.timeColor = $("optTimeColor").value;
    next.srcColor = $("optSrcColor").value;
    next.tagBg = $("optTagBg").value;
    next.tagColor = $("optTagColor").value;
    next.tagRadius = Number($("optTagRadius").value);
    // 竖线
    next.quoteBorder = $("optQuoteBorder").value;
    next.quoteBorderW = Number($("optQuoteBorderW").value);
    // 主文竖线颜色等于「由主文底色推出来的默认色」时，记为「跟随底色」，改底色时竖线跟着变
    next.mainBorder = $("optMainBorder").value.toLowerCase() === darken(next.mainBg, 0.12).toLowerCase()
      ? "" : $("optMainBorder").value;
    next.mainBorderW = Number($("optMainBorderW").value);
    // 聚合明细分隔线：只记录用户实际改过的部分，留空表示跟随模板
    next.aggSepStyle = $("optAggSepStyle").value;
    next.aggSep = next.aggSepStyle ? $("optAggSep").value : "";
    readFontScopeInto(next); // 只改当前 tab（原文/释义/主文）对应的字段
    displayOpts = next;
    applyDisplay(displayOpts);
    $("presetSelect").value = ""; // 手动调整后，样式组下拉不再指向任何已存组
    syncColorSwatches("bgSwatches", "optPageBg");
    syncColorSwatches("quoteSwatches", "optQuoteBg");
    syncColorSwatches("mainSwatches", "optMainBg");
    syncColorSwatches("extractSwatches", "optExtractBg");
    syncColorSwatches("cardSwatches", "optCardBg");
    syncColorSwatches("fontSwatches", "optFontColor");
    $("optCardBorderWVal").textContent = $("optCardBorderW").value;
    $("optCardBarWVal").textContent = $("optCardBarW").value;
    $("optCardGapVal").textContent = $("optCardGap").value;
    $("optCardPadVal").textContent = $("optCardPad").value;
    $("optQuoteBorderWVal").textContent = $("optQuoteBorderW").value;
    $("optMainBorderWVal").textContent = $("optMainBorderW").value;
    $("optTagRadiusVal").textContent = Number($("optTagRadius").value) >= 20 ? "胶囊" : $("optTagRadius").value + "px";
    saveStyleState();
  };
  $("optPageBg").addEventListener("input", persist);
  $("optQuoteBg").addEventListener("input", persist);
  $("optMainBg").addEventListener("input", persist);
  $("optExtractBg").addEventListener("input", persist);
  $("optCardBg").addEventListener("input", persist);
  $("optCardBorder").addEventListener("input", persist);
  $("optCardBorderW").addEventListener("input", persist);
  $("optCardBar").addEventListener("input", persist);
  $("optCardBarW").addEventListener("input", persist);
  $("optCardShadow").addEventListener("change", persist);
  $("optCardGap").addEventListener("input", persist);
  $("optCardPad").addEventListener("input", persist);
  $("optTimeColor").addEventListener("input", persist);
  $("optSrcColor").addEventListener("input", persist);
  $("optTagBg").addEventListener("input", persist);
  $("optTagColor").addEventListener("input", persist);
  $("optTagRadius").addEventListener("input", persist);
  $("optQuoteBorder").addEventListener("input", persist);
  $("optQuoteBorderW").addEventListener("input", persist);
  $("optMainBorder").addEventListener("input", persist);
  $("optMainBorderW").addEventListener("input", persist);
  // 明细分隔线：选颜色即视为自定义（线型没选就给虚线）；线型选「跟随模板」则颜色也交回模板
  $("optAggSep").addEventListener("input", () => {
    displayOpts.aggSep = $("optAggSep").value;
    if (!displayOpts.aggSepStyle) displayOpts.aggSepStyle = "dashed";
    $("optAggSepStyle").value = displayOpts.aggSepStyle;
    $("optAggSep").disabled = false;
    applyDisplay(displayOpts);
    saveStyleState();
  });
  $("optAggSepStyle").addEventListener("change", () => {
    displayOpts.aggSepStyle = $("optAggSepStyle").value;
    if (!displayOpts.aggSepStyle) displayOpts.aggSep = "";
    $("optAggSep").disabled = !displayOpts.aggSep;
    applyDisplay(displayOpts);
    saveStyleState();
  });
  $("optFontWeight").addEventListener("change", persist);
  $("optFontColor").addEventListener("input", persist);
  $("optFontSize").addEventListener("input", persist);
  $("optLineHeight").addEventListener("input", persist);
  $("optParaSpacing").addEventListener("input", persist);
  // 时间显示格式改了要重渲染列表（时间文字是渲染时生成的）
  $("optTimeDisplay").addEventListener("change", () => {
    persist();
    refreshHistory();
  });
  // 原文与释义合段：纯排版开关，单独存一份（不跟模板样式走，恢复模板默认也不会关掉）
  // 原文是否去掉书名号、是否当大字头都由渲染时决定，所以改了要重出卡片。
  // 报纸/杂志这类卡片内双栏的模板更特殊：大字头是渲染时塞进释义第一段里的（不是只换个 class），
  // 必须整卡重建才会出现，所以这里统一走「重建 + 下一帧按实测行高重量」两步。
  // 用事件委托绑定：面板元素被重建时回调也不会丢。
  document.addEventListener("change", (ev) => {
    const t = ev.target;
    if (!t || !t.id) return;
    if (t.id === "optMergeQuote") {
      quoteMerge = t.checked;
      applyQuoteMerge();
      chrome.storage.local.set({ [QUOTE_MERGE_KEY]: quoteMerge });
      render();
      requestAnimationFrame(() => applyDropQuoteSize($("list")));
    } else if (t.id === "optMergeMax") {
      quoteMergeMax = Math.max(1, Math.min(20, Number(t.value) || 5));
      t.value = quoteMergeMax;
      chrome.storage.local.set({ [QUOTE_MERGE_MAX_KEY]: quoteMergeMax });
      if (quoteMerge) {
        render();
        requestAnimationFrame(() => applyDropQuoteSize($("list")));
      }
    }
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
  bindFontSuggest();
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
  // 提示语只在「日期」精度下出现
  const hint = $("timeModeHint");
  if (hint) hint.hidden = second;
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

// 快捷时间（当天/1天/1周/1月）对应的区间；导航到历史页时按存储的选择重新算一遍，
// 存的只是「哪一种快捷范围」，不存死时间戳，所以「当天」第二天依然从当天零点算起
const QUICK_RANGE_KEY = "quickRange";
let quickRange = "";
function quickRangeBounds(r, now = Date.now()) {
  const DAY = 24 * 60 * 60 * 1000;
  let start = now;
  if (r === "today") {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    start = d.getTime();
  } else if (r === "1d") start = now - DAY;
  else if (r === "1w") start = now - 7 * DAY;
  else if (r === "1m") start = now - 30 * DAY;
  else return null;
  return [start, now];
}

// 把本地时间戳写入起止输入框：日期模式写 YYYY-MM-DD，秒模式写 YYYY-MM-DDTHH:MM:SS
function setTimeRange(startTs, endTs, skipRender = false) {
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
  if (!skipRender) render();
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

// 导出 / 预览 / 打印用的列表：有手动选中的卡片时，只出选中的记录；
// 页面上的列表始终按筛选条件显示，方便一边浏览一边勾选。
function outputList() {
  if (!pickedIds.size) return filteredList();
  return all.filter((e) => pickedIds.has(e.id));
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
  // 选中的记录被删掉后，把失效的 id 剔掉
  if (pickedIds.size) {
    const ids = new Set(all.map((e) => e.id));
    Array.from(pickedIds).forEach((id) => {
      if (!ids.has(id)) pickedIds.delete(id);
    });
  }
  const list = filteredList();
  const pickBtn = $("pickClear");
  if (pickBtn) pickBtn.hidden = !pickedIds.size;

  // 统计信息尽量短：有筛选时显示「命中/总数」，没筛选显示「共 总数」，避免把右侧按钮挤到下一行
  const isFiltered = Boolean(q || hasTimeFilter() || tagFilter.length);
  const groupCount = new Set(list.map((e) => e.pageUrl || e.pageTitle || e.id)).size;
  let countText;
  if (aggregate) {
    // 聚合模式按「组」统计；有选中时显示选中的组数
    countText = "共 " + groupCount + " 组";
    if (pickedIds.size) {
      const pickedGroups = groupRecords(all.filter((e) => pickedIds.has(e.id))).length;
      countText += " · 已选 " + pickedGroups + " 组";
    }
  } else {
    countText = (isFiltered ? list.length + "/" + all.length : "共 " + all.length) + " 条";
    if (pickedIds.size) countText += " · 已选 " + pickedIds.size + " 条";
  }
  $("count").textContent = countText;

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
  applyDropQuoteSize($("list"));
  applyMasonry();
}

// 小票模板的瀑布流：屏幕上把卡片分进两栏容器，每张放进当前较矮的那一栏，
// 两栏顶端对齐、底边尽量齐平，卡片整张不拆（打印走 CSS 多列流，模板里没给 .rcpt-col）
function flattenMasonry(box) {
  const cols = box.querySelectorAll(".rcpt-col");
  if (!cols.length) return;
  const cards = [];
  cols.forEach((c) => Array.prototype.push.apply(cards, c.querySelectorAll(".card")));
  // 按排布前的原始阅读顺序放回 #list
  cards
    .sort((a, b) => (Number(a.dataset.mi) || 0) - (Number(b.dataset.mi) || 0))
    .forEach((c) => {
      delete c.dataset.mi;
      box.appendChild(c);
    });
  cols.forEach((c) => c.remove());
}

function applyMasonry() {
  const box = $("list");
  if (!box) return;
  if (styleTemplate !== "receipt" && !layoutActive()) {
    flattenMasonry(box);
    return;
  }
  // 打印时交给 CSS 多列流，卡片必须是 #list 的直接子元素
  if (window.matchMedia && window.matchMedia("print").matches) {
    flattenMasonry(box);
    return;
  }
  flattenMasonry(box);
  const cards = Array.from(box.querySelectorAll(".card"));
  if (cards.length < 2) return;
  cards.forEach((c, i) => (c.dataset.mi = String(i)));
  const n = window.innerWidth <= 560 ? 1 : 2;
  const cols = [];
  for (let i = 0; i < n; i++) {
    const d = document.createElement("div");
    d.className = "rcpt-col";
    box.appendChild(d);
    cols.push(d);
  }
  // 先全部丢进第一栏量出各自的真实高度（宽度已经是半栏，量得才准），再按「谁矮放谁」分配
  cards.forEach((c) => cols[0].appendChild(c));
  const cardH = cards.map((c) => c.getBoundingClientRect().height);
  const heights = new Array(n).fill(0);
  cards.forEach((c, i) => {
    let k = 0;
    for (let j = 1; j < n; j++) if (heights[j] < heights[k]) k = j;
    cols[k].appendChild(c);
    heights[k] += cardH[i] + 16; // 加上栏间距
  });
}

window.addEventListener("beforeprint", () => {
  const box = $("list");
  if (box) flattenMasonry(box);
});
window.addEventListener("afterprint", () => applyMasonry());
let masonryResizeTimer = 0;
window.addEventListener("resize", () => {
  clearTimeout(masonryResizeTimer);
  masonryResizeTimer = setTimeout(applyMasonry, 150);
});

// 大字头（合并原文释义）的高度按「该卡释义的实际行高」算：
// 模板常常把释义行高写死，CSS 里的 --ans-line-height 未必等于实际值，
// 所以在卡片上按实测行高写内联高度，保证右边释义正好绕两行。
function applyDropQuoteSize(root) {
  const scope = root || document;
  scope.querySelectorAll(".item-text-drop").forEach((el) => {
    const ans = el.closest(".card") && el.closest(".card").querySelector(".item-answer");
    if (!ans) return;
    const lh = parseFloat(getComputedStyle(ans).lineHeight);
    if (!lh || !isFinite(lh)) return;
    // 再减 1px：让浮动的下边缘严格落在第 2 行内，否则第三行会被压出一小段缩进
    const boxH = Math.max(1, Math.round(lh * 2) - 1);
    el.style.height = boxH + "px";
    el.style.lineHeight = boxH + "px";
    // 字号取盒高的固定比例（0.72），让各模板的上下空隙比例一致，宋体这类墨迹偏下的字体才不会有的模板偏、有的不偏
    el.style.fontSize = Math.round(boxH * 0.72) + "px";
    // 不同字体的上行/下行度量差别很大（宋体最明显、Noto Serif 次之，雅黑/楷体几乎为 0），
    // 同一行高的盒子在不同字体里字会偏上或偏下；这里量出字本身的高度，让它在这两行里垂直居中
    el.style.top = "0px";
    try {
      const range = document.createRange();
      range.selectNodeContents(el);
      const textBox = range.getBoundingClientRect();
      const box = el.getBoundingClientRect();
      if (textBox.height && box.height) {
        const shift = Math.round((box.height - textBox.height) / 2 - (textBox.top - box.top));
        if (isFinite(shift)) el.style.top = shift + "px";
      }
    } catch (err) {
      /* 量不到就保持不偏移 */
    }
  });
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

// 选中 / 取消选中某张卡片；清空全部选中
function togglePick(id) {
  if (pickedIds.has(id)) pickedIds.delete(id);
  else pickedIds.add(id);
  render();
}

function clearPicked() {
  if (!pickedIds.size) return;
  pickedIds = new Set();
  render();
}

// 普通卡片（非聚合）：第一行 时间 + 来源按钮 + 来源 + 删除
function buildItemCard(e) {
  const item = document.createElement("div");
  item.className = "card";

  // 右上角角标：点一下选中/取消这张卡片，选中后这条记录就算进「自由筛选」
  const pick = document.createElement("button");
  pick.type = "button";
  pick.className = "card-pick";
  const picked = pickedIds.has(e.id);
  if (picked) item.classList.add("selected");
  pick.title = picked ? "取消选中" : "选中这条：选中后只显示、导出选中的记录";
  pick.addEventListener("click", (ev) => {
    ev.stopPropagation();
    togglePick(e.id);
  });
  item.appendChild(pick);

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
  const drop = isDropQuote(e);
  const textEl = document.createElement("div");
  textEl.className = "item-text" + (isExtract ? " item-text-extract" : "") + (drop ? " item-text-drop" : "");
  textEl.textContent = drop ? String(e.text || "").trim() : "「" + (e.text || "") + "」";

  const selMain = multi ? document.createElement("div") : null;
  if (selMain) {
    selMain.className = "item-main item-main-dim";
    selMain.textContent = e.text || "";
  }

  const ans = document.createElement("div");
  ans.className = "item-answer";
  if (!isExtract) ans.innerHTML = answerMarkdownForRender(e);

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

  // 原文行受「隐藏原文」控制（摘录记录的原文就是内容，照旧显示）；
  // 多行选中的明细主文属于主文，受「隐藏主文」控制
  if (multi) {
    if (showMainText) item.appendChild(selMain);
  } else if (showQuoteText || isExtract) {
    if (drop && !isExtract && dropQuoteInsideAnswer()) injectDropIntoAnswerEl(ans, textEl);
    else item.appendChild(textEl);
  }
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

function syncQuoteBtn() {
  $("toggleQuote").textContent = showQuoteText ? "隐藏原文" : "显示原文";
}

// 隐藏原文：列表卡片与导出 / 预览 / 打印都不再输出划词那段原文
function toggleQuote() {
  showQuoteText = !showQuoteText;
  chrome.storage.local.set({ [SHOW_QUOTE_KEY]: showQuoteText });
  syncQuoteBtn();
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

    // 右上角角标：聚合卡片按「整组」选中（选中后把这组全部记录算进自由筛选）
    const pick = document.createElement("button");
    pick.type = "button";
    pick.className = "card-pick";
    const allPicked = recs.every((r) => pickedIds.has(r.id));
    if (allPicked) item.classList.add("selected");
    pick.title = allPicked ? "取消选中这一组" : "选中这一组：选中后只显示、导出选中的记录";
    pick.addEventListener("click", (ev) => {
      ev.stopPropagation();
      if (allPicked) recs.forEach((r) => pickedIds.delete(r.id));
      else recs.forEach((r) => pickedIds.add(r.id));
      render();
    });
    item.appendChild(pick);

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
      const drop = isDropQuote(e);
      const textEl = document.createElement("div");
      textEl.className = "item-text" + (isExtract ? " item-text-extract" : "") + (drop ? " item-text-drop" : "");
      textEl.textContent = drop ? String(e.text || "").trim() : "「" + (e.text || "") + "」";
      // 原文行受「隐藏原文」控制（摘录记录照旧显示）；多行选中的明细主文受「隐藏主文」控制
      if (multi) {
        if (showMainText) {
          const selMain = document.createElement("div");
          selMain.className = "item-main item-main-dim";
          selMain.textContent = e.text || "";
          gi.appendChild(selMain);
        }
      } else if (showQuoteText || isExtract) {
        if (!(drop && !isExtract && dropQuoteInsideAnswer())) gi.appendChild(textEl);
      }

      const ans = document.createElement("div");
      ans.className = "item-answer";
      if (!isExtract) ans.innerHTML = answerMarkdownForRender(e);
      if (drop && !isExtract && showQuoteText && dropQuoteInsideAnswer()) {
        injectDropIntoAnswerEl(ans, textEl);
      }
      gi.appendChild(ans);

      items.appendChild(gi);
    }
    item.appendChild(items);
    box.appendChild(item);
  }
  renderPager(entries.length);
  applyDropQuoteSize(box);
  applyMasonry();
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
  // 与「样式」互斥：打开设置就收起样式区
  if (!settingsHidden) {
    const area = $("styleArea");
    if (area && !area.hidden) {
      area.hidden = true;
      chrome.storage.local.set({ [STYLE_PANEL_KEY]: false });
      syncStylePanel(false);
    }
  }
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

// 样式设置区：独立成块，由工具栏「样式」按钮显示/隐藏，与「设置」互斥
function syncStylePanel(open) {
  const area = $("styleArea");
  const btn = $("toggleStyle");
  if (!area) return;
  area.hidden = !open;
  if (btn) {
    btn.classList.toggle("is-on", open);
    btn.setAttribute("aria-pressed", open ? "true" : "false");
  }
  if (open) {
    // 与设置区互斥：显示样式就把设置收起来
    if (!settingsHidden) {
      settingsHidden = true;
      chrome.storage.local.set({ [SETTINGS_HIDDEN_KEY]: true });
      syncSettingsBtn();
    }
  }
  syncStylePin();
}

function toggleStylePanel() {
  const open = $("styleArea").hidden;
  syncStylePanel(open);
  chrome.storage.local.set({ [STYLE_PANEL_KEY]: open });
}

// 钉住：样式区本身 sticky（下面还有列表，有足够粘住区间），只切一个 class
function syncStylePin() {
  const btn = $("pinStyle");
  if (btn) {
    btn.setAttribute("aria-pressed", stylePinned ? "true" : "false");
    btn.title = stylePinned ? "取消钉住：随页面滚动" : "钉住：向下滚动页面时，样式设置固定在页面上方";
  }
  const area = $("styleArea");
  document.body.classList.toggle("pin-style", stylePinned && area && !area.hidden);
}

function toggleStylePin() {
  stylePinned = !stylePinned;
  chrome.storage.local.set({ [STYLE_PIN_KEY]: stylePinned });
  syncStylePin();
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
  if (!outputList().length) {
    exportStatus("暂无记录可导出。", false);
    return;
  }
  const list = outputList();
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
/* 打印时底部内边距清零，避免末尾那 60px 溢出多打一页空白 */
@media print{body{padding-bottom:0}}
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
.item-answer ul,.item-answer ol{margin:0;padding-left:20px}
.item-answer li{margin:0}
.item-answer code{font-family:ui-monospace,SFMono-Regular,Consolas,"Courier New",monospace;font-size:12px;background:rgba(99,102,241,0.08);color:#4f46e5;padding:1px 4px;border-radius:4px}
.item-answer pre{background:rgba(31,41,55,0.06);padding:8px;border-radius:8px;overflow-x:auto;margin:6px 0}
.item-answer pre code{background:transparent;color:inherit;padding:0}
.item-answer blockquote{margin:6px 0;padding:2px 10px;border-left:3px solid #6366f1;color:#4b5563}
.item-answer a{color:#4f46e5;text-decoration:none}
.item-answer a:hover{text-decoration:underline}
.item-main{font-size:13px;color:#1f2937;background:rgba(99,102,241,0.07);border-left:3px solid #6366f1;border-radius:6px;padding:6px 10px;margin-bottom:8px;white-space:pre-wrap;word-break:break-word}
.item-main-dim{background:color-mix(in srgb,var(--main-bg) 40%,transparent);border-left-color:color-mix(in srgb,var(--main-border) 35%,transparent)}
.item-main-label{font-size:11px;color:var(--muted);margin-bottom:2px}.agg-items.no-sep .agg-item{border-top:none!important;padding-top:0}
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
  const drop = isDropQuote(e);
  // 原文行受「隐藏原文」控制（摘录记录的原文就是内容，照旧显示）；明细主文受「隐藏主文」控制
  const quoteHtml =
    !multi && (showQuoteText || isExtract)
      ? '<div class="item-text' + (isExtract ? " item-text-extract" : "") + (drop ? " item-text-drop" : "") + '">' +
        (drop ? esc(String(e.text || "").trim()) : "「" + esc(e.text || "") + "」") + "</div>"
      : "";
  const selMain = multi && showMainText ? '<div class="item-main item-main-dim">' + esc(e.text || "") + "</div>" : "";
  // 杂志双栏：大字头放进释义第一段，浮动只作用于第一栏
  let quoteOut = quoteHtml;
  let ansHtml = isExtract ? "" : '<div class="item-answer">' + answerMarkdownForRender(e) + "</div>";
  if (drop && !isExtract && showQuoteText && dropQuoteInsideAnswer()) {
    quoteOut = "";
    ansHtml = '<div class="item-answer">' + injectDropIntoAnswerHtml(answerMarkdownForRender(e), dropSpanHtml(e)) + "</div>";
  }
  return (
    '<div class="card"' + meta + ">" +
    '<div class="item-head">' + head.join("") + "</div>" +
    main +
    quoteOut +
    selMain +
    ansHtml +
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
          const drop = isDropQuote(e);
          const quoteInner =
            '<div class="item-text' + (isExtract ? " item-text-extract" : "") + (drop ? " item-text-drop" : "") + '">' +
            (drop ? esc(String(e.text || "").trim()) : "「" + esc(e.text || "") + "」") + "</div>";
          // 杂志双栏：大字头放进释义第一段，避免多列容器把两栏整体挤窄
          const dropInside = drop && !isExtract && showQuoteText && dropQuoteInsideAnswer();
          const ansInner = isExtract ? "" : answerMarkdownForRender(e);
          return (
            '<div class="agg-item"' + meta + ">" +
            (showQuoteText || isExtract
              ? multi || dropInside
                ? ""
                : quoteInner
              : "") +
            (multi && showMainText ? '<div class="item-main item-main-dim">' + esc(e.text || "") + "</div>" : "") +
            (isExtract
              ? ""
              : '<div class="item-answer">' + (dropInside ? injectDropIntoAnswerHtml(ansInner, dropSpanHtml(e)) : ansInner) + "</div>") +
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

// 「原文与释义合段」：导出/预览/打印与历史页共用的排版规则
// 短原文当大字头（占两行、释义绕排），长原文退回 2 行截断
const MERGE_QUOTE_CSS =
  "\nbody.merge-quote .card .item-text:not(.item-text-extract):not(.item-text-drop){" +
  "display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden;" +
  "background:transparent!important;border-left:0!important;border-radius:0!important;" +
  "padding:0!important;margin:0 0 2px!important}" +
  "body.merge-quote .card .item-text:not(.item-text-extract).item-text-drop{" +
  "float:left;display:block;overflow:hidden;width:auto;" +
  // 高度＝释义两行，字号跟着行高走（上限 39px），避免右侧释义多绕一行
  "height:calc(var(--ans-line-height,1.2) * var(--ans-font-size,13px) * 2);" +
  "line-height:calc(var(--ans-line-height,1.2) * var(--ans-font-size,13px) * 2);" +
  "font-size:calc(var(--ans-line-height,1.2) * var(--ans-font-size,13px) * 1.44);" +
  "font-weight:600;margin:0 10px 0 0!important;position:relative;" +
  "padding:0!important;background:transparent!important;border-left:0!important;border-radius:0!important;" +
  "white-space:nowrap;word-break:keep-all}" +
  "body.merge-quote .card::after{content:\"\";display:block;clear:both}";

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
  const displayCss = buildDisplayCss(displayOpts, styleTemplate !== "glass");
  // 风格模板：导出页与历史页共用同一份样式，靠 body 上的 data-tpl 生效；
  // 导出页再追加整页底色（历史页的页面底色只作用于 #list）
  const tplOverridesCss =
    styleTemplate !== "glass" && tplOverrides[styleTemplate]
      ? tplOverrideCss(styleTemplate, tplOverrides[styleTemplate], true)
      : "";
  const tplCss =
    styleTemplateCss(styleTemplate) + mainDimCss(styleTemplate) + templateExportPageCss(styleTemplate) + tplOverridesCss +
    // 标题前的圆点跟着模板主色走，默认模板仍保留原来的紫蓝渐变
    templateDotCss(styleTemplate);
  // 打印用黑色字：纸上用颜料墨更清楚、也防水；只影响打印，屏幕与导出的 HTML 仍按模板配色
  const blackRules =
    ".item-text,.item-text-extract,.item-answer,.item-answer p,.item-answer li,.item-main,.item-main-dim{" +
    "color:#000!important}" +
    "h1,.h1-sub,.card .item-text,.card .item-answer,.card .item-main{text-shadow:none!important}";
  // 深色模板（夜间/暖夜/终端暗色）底是深的，纯黑字在纸上等于看不见：
  // 打印时把这几个模板整页改成白底，文字用纯黑
  const darkPrintRules = darkPrintCss(styleTemplate);
  const printBlackCss = exportOpts.printBlack === false
    ? ""
    : "\n@media print{" + blackRules + darkPrintRules + "}" +
      // 预览 / 打印窗口另开一份“所见即打印”的规则，屏幕上就能看出打印出来的纯黑效果
      (previewBlack ? "\n" + blackRules + darkPrintRules : "");
  const html =
    "<!DOCTYPE html>\n" +
    '<html lang="zh-CN">\n<head>\n' +
    '<meta charset="UTF-8" />\n' +
    '<meta name="viewport" content="width=device-width, initial-scale=1.0" />\n' +
    "<title>" + docTitle + "</title>\n" +
    "<style>\n" + CARD_CSS + MERGE_QUOTE_CSS + noSplitCss + displayCss + HEAD_BTN_CSS + tplCss +
    (layoutActive() ? LAYOUT_CSS + LAYOUT_EXPORT_CSS : "") + printBlackCss + "\n</style>\n" +
    "</head>\n" + '<body data-tpl="' + esc(styleTemplate) + '"' +
    (layoutActive() ? ' data-layout="twocol"' : "") +
    (quoteMerge ? ' class="merge-quote"' : "") + ">\n" +
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
  const list = outputList();
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
  const list = outputList();
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
  const list = outputList();
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
$("pickClear").addEventListener("click", clearPicked);
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
// 快捷时间（当天/1天/1周/1月）的选中态：只有点过快捷项、且区间没被手动改过时才高亮
function setQuickActive(range, persist = true) {
  quickRange = range || "";
  document.querySelectorAll(".quick-link[data-range]").forEach((b) => {
    b.classList.toggle("active", !!range && b.dataset.range === range);
  });
  if (persist) chrome.storage.local.set({ [QUICK_RANGE_KEY]: quickRange });
}

$("timeStart").addEventListener("change", () => { setQuickActive(""); page = 1; render(); });
$("timeEnd").addEventListener("change", () => { setQuickActive(""); page = 1; render(); });
$("optTimeMode").addEventListener("change", () => applyTimeMode(timeMode(), true));
$("timeClear").addEventListener("click", () => {
  $("timeStart").value = "";
  $("timeEnd").value = "";
  setQuickActive("");
  page = 1;
  render();
});
document.querySelectorAll(".quick-link[data-range]").forEach((b) => {
  b.addEventListener("click", () => {
    const bounds = quickRangeBounds(b.dataset.range);
    if (!bounds) return;
    setQuickActive(b.dataset.range);
    setTimeRange(bounds[0], bounds[1]);
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
initFontSelect();
initColorSwatches("bgSwatches", "optPageBg", BG_PALETTE);
initColorSwatches("quoteSwatches", "optQuoteBg", BG_PALETTE);
initColorSwatches("mainSwatches", "optMainBg", BG_PALETTE);
initColorSwatches("extractSwatches", "optExtractBg", BG_PALETTE);
initColorSwatches("cardSwatches", "optCardBg", BG_PALETTE);
initColorSwatches("fontSwatches", "optFontColor", FONT_RECOMMEND);
bindExportOpts();
bindDisplay();
$("fontScan").addEventListener("click", scanLocalFonts);
// 字体作用域切换：原文 | 释义 | 主文
[...document.querySelectorAll("#fontScopeBar .seg-btn")].forEach((b) => {
  b.addEventListener("click", () => setFontScope(b.dataset.scope));
});
// 全局布局：单栏 / 两栏
[...document.querySelectorAll("#layoutBar .seg-btn")].forEach((b) => {
  b.addEventListener("click", () => setLayout(b.dataset.layout));
});
$("saveDisplay").addEventListener("click", saveDisplay);
$("presetSelect").addEventListener("change", applyPreset);
$("deletePreset").addEventListener("click", deletePreset);
$("toggleMain").addEventListener("click", toggleMain);
$("toggleQuote").addEventListener("click", toggleQuote);
$("toggleAgg").addEventListener("click", toggleAgg);
$("toggleSettings").addEventListener("click", toggleSettings);
$("toggleReadonly").addEventListener("click", toggleReadonly);
$("toggleStyle").addEventListener("click", toggleStylePanel);
$("pinStyle").addEventListener("click", toggleStylePin);

// 行高那一行末尾的「更多 / 折叠」：展开下面的背景色、圆角与样式管理，默认折叠
$("styleMoreBtn").addEventListener("click", () => {
  const box = $("styleMore");
  const btn = $("styleMoreBtn");
  const open = box.hidden;
  box.hidden = !open;
  btn.textContent = open ? "折叠" : "更多";
  btn.setAttribute("aria-expanded", open ? "true" : "false");
});
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
