// background.js —— 划词AI释义（MV3 Service Worker）
// 负责所有对外 API 请求（content script 无页面跨域问题，由 SW 代为转发并流式回传）。

const DEFAULT_CONFIG = {
  apiBaseUrl: "https://api.deepseek.com",
  apiKey: "",
  model: "deepseek-chat",
  temperature: 0.3,
  stream: true,
  autoExplain: true,
  autoSaveHistory: true,
  maxLength: 500,
  historyMax: 1000,
  systemPrompt:
    "你是一位博学的中文释义助手。用户选中了网页上的一段文本，请用简体中文进行解释。\n" +
    "【输出格式要求，务必严格遵守】\n" +
    "1. 分板块输出，每个板块标题独占一行（如“逐词解释：”“整句翻译：”“语境说明：”），标题前后各留一个空行。\n" +
    "2. “逐词解释”用无序列表，每项一行，格式为“字：解释”。\n" +
    "3. 不同板块内容严禁合并到同一行；严禁把小节标题或整句翻译追加到“逐词解释”的某个列表项后面；整句翻译必须完整写在一个独立段落里，不要拆成多行。\n" +
    "4. 不要用 ``` 代码块把全文包起来。\n" +
    "【范围约束】只解释【所选文本】；【所在页面上下文】仅用于理解语境，不要逐句翻译或解释上下文中的其他内容（除非所选本身已是整段）。\n" +
    "【解释原则】若是外文，先给准确翻译再简要解释；若是文言文或单个汉字，考证其本字、造字原意与字形演变；若是专业术语或缩写，用通俗语言讲解。回答简洁，条理清楚。",
};

let configCache = null;

async function getConfig() {
  if (configCache) return configCache;
  const res = await chrome.storage.local.get("config");
  configCache = { ...DEFAULT_CONFIG, ...(res.config || {}) };
  return configCache;
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.config) configCache = null;
  if (changes.paused) setActionState();
  if (changes.extractMode) { updateExtractMenu(); setActionState(); }
  if (changes.highlightMode) updateHighlightMenu();
});

// ---------- 摘录模式（图标右键菜单切换） ----------
const EXTRACT_MODE_KEY = "extractMode";

async function getExtractMode() {
  const res = await chrome.storage.local.get({ [EXTRACT_MODE_KEY]: false });
  return !!res[EXTRACT_MODE_KEY];
}

// 同步图标右键菜单标题，显示当前摘录模式开关状态
async function updateExtractMenu() {
  const on = await getExtractMode();
  chrome.contextMenus
    .update("ai-explain-extract", { title: on ? "摘录模式（开）" : "摘录模式（关）" })
    .catch(() => {});
}

// ---------- 高亮划词（图标右键菜单切换） ----------
const HIGHLIGHT_KEY = "highlightMode";

async function getHighlightMode() {
  const res = await chrome.storage.local.get({ [HIGHLIGHT_KEY]: false });
  return !!res[HIGHLIGHT_KEY];
}

// 同步图标右键菜单标题，显示当前高亮划词开关状态
async function updateHighlightMenu() {
  const on = await getHighlightMode();
  chrome.contextMenus
    .update("ai-explain-highlight", { title: on ? "高亮划词（开）" : "高亮划词（关）" })
    .catch(() => {});
}

// ---------- 暂停/恢复（点击插件图标切换） ----------
const NORMAL_ICON = {
  16: "icon16.png",
  32: "icon32.png",
  48: "icon48.png",
  128: "icon128.png",
};
const PAUSED_ICON = {
  16: "icon-paused-16.png",
  32: "icon-paused-32.png",
  48: "icon-paused-48.png",
  128: "icon-paused-128.png",
};
// 摘录模式图标：左上角带绿点（基于正常图标生成）
const EXTRACT_ICON = {
  16: "icon-extract-16.png",
  32: "icon-extract-32.png",
  48: "icon-extract-48.png",
  128: "icon-extract-128.png",
};

async function getPaused() {
  const res = await chrome.storage.local.get({ paused: false });
  return !!res.paused;
}

async function setActionState() {
  const paused = await getPaused();
  const extract = await getExtractMode();
  let path = NORMAL_ICON;
  let title = "划词AI释义（点击暂停）";
  if (paused) {
    path = PAUSED_ICON;
    title = "划词AI释义（已暂停，点击恢复）";
  } else if (extract) {
    path = EXTRACT_ICON;
    title = "划词AI释义（摘录模式，点击暂停）";
  }
  await chrome.action.setIcon({ path }).catch(() => {});
  await chrome.action
    .setTitle({ title })
    .catch(() => {});
}

chrome.action.onClicked.addListener(async () => {
  const paused = await getPaused();
  await chrome.storage.local.set({ paused: !paused });
});

function buildUrl(base) {
  return base.replace(/\/+$/, "") + "/chat/completions";
}

function buildBody(cfg, text, context) {
  const messages = [];
  if (cfg.systemPrompt) messages.push({ role: "system", content: cfg.systemPrompt });

  let userContent = text;
  if (context && context.trim()) {
    userContent =
      "【所选文本】\n" + text +
      "\n\n【所在页面上下文（仅用于理解语境，不要解释或翻译这里的内容）】\n" +
      context.trim();
  }
  messages.push({ role: "user", content: userContent });

  return {
    model: cfg.model,
    messages,
    temperature: Number(cfg.temperature) || 0.3,
    stream: !!cfg.stream,
  };
}

// 从非流式响应里提取纯文本
function extractContent(data) {
  try {
    return data?.choices?.[0]?.message?.content ?? "";
  } catch {
    return "";
  }
}

async function streamResponse(response, port) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finished = false;

  while (!finished) {
    const { value, done } = await reader.read();
    finished = done;
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });

    // 按行切分 SSE 帧
    const lines = buffer.split("\n");
    buffer = lines.pop(); // 保留可能不完整的一行

    for (const raw of lines) {
      const line = raw.trim();
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (payload === "[DONE]") {
        finished = true;
        break;
      }
      try {
        const json = JSON.parse(payload);
        const delta = json?.choices?.[0]?.delta?.content;
        if (delta) port.postMessage({ type: "chunk", text: delta });
      } catch {
        /* 忽略不完整/非 JSON 帧 */
      }
    }
  }
  port.postMessage({ type: "done" });
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "ai-explain") return;

  port.onMessage.addListener(async (msg) => {
    if (!msg || msg.type !== "explain") return;
    const { text, context } = msg;

    try {
      const cfg = await getConfig();
      if (!cfg.apiKey) {
        port.postMessage({
          type: "error",
          code: "no_key",
          message: "尚未配置 API Key，请点击浮层右上角「设置」填写。",
        });
        return;
      }

      const response = await fetch(buildUrl(cfg.apiBaseUrl), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + cfg.apiKey,
        },
        body: JSON.stringify(buildBody(cfg, text, context)),
      });

      if (!response.ok) {
        const errText = await response.text().catch(() => "");
        port.postMessage({
          type: "error",
          code: "http",
          status: response.status,
          message: "API 返回 " + response.status + (errText ? "：" + errText.slice(0, 500) : ""),
        });
        return;
      }

      if (cfg.stream) {
        await streamResponse(response, port);
      } else {
        const data = await response.json();
        const content = extractContent(data);
        port.postMessage({ type: "result", text: content });
      }
    } catch (err) {
      port.postMessage({
        type: "error",
        code: "network",
        message: "请求失败：" + String(err && err.message ? err.message : err),
      });
    }
  });
});

// ---------- 历史记录存储 ----------
const HISTORY_KEY = "history";
const HISTORY_DEFAULT_MAX = 1000; // 默认最多保留条数

async function getHistoryMax() {
  const cfg = await getConfig();
  const max = Number(cfg.historyMax);
  if (!Number.isFinite(max) || max < 1) return HISTORY_DEFAULT_MAX;
  return Math.min(Math.floor(max), 1000000); // 上限 100 万条，防止误填过大
}

async function getHistory() {
  const res = await chrome.storage.local.get({ [HISTORY_KEY]: [] });
  return Array.isArray(res[HISTORY_KEY]) ? res[HISTORY_KEY] : [];
}

// 追加一条释义记录（新的在最前），并做条数上限裁剪（超出覆盖最早）
// extract=true 表示摘录记录：没有释义，允许 answer 为空
async function saveHistory({ text, answer, context, pageUrl, pageTitle, extract }) {
  if (!text || !String(text).trim()) return null;
  const hasAnswer = !!answer && !!String(answer).trim();
  if (!hasAnswer && !extract) return null;
  const list = await getHistory();
  const entry = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
    text: String(text),
    answer: hasAnswer ? String(answer) : "",
    context: context ? String(context) : "",
    pageUrl: pageUrl ? String(pageUrl) : "",
    pageTitle: pageTitle ? String(pageTitle) : "",
    time: Date.now(),
  };
  if (extract) entry.extract = true;
  list.unshift(entry);
  const max = await getHistoryMax();
  if (list.length > max) list.length = max;
  await chrome.storage.local.set({ [HISTORY_KEY]: list });
  return entry;
}

async function deleteHistory(id) {
  const list = await getHistory();
  const next = list.filter((e) => e.id !== id);
  await chrome.storage.local.set({ [HISTORY_KEY]: next });
  return next.length;
}

async function clearHistory() {
  await chrome.storage.local.set({ [HISTORY_KEY]: [] });
}

// ---------- 高亮划词：取本页历史记录（划词+摘录）原文，供 content 恢复荧光笔 ----------
const HIGHLIGHT_HISTORY_MAX = 200; // 每页最多恢复的历史划线数

function urlKeyOf(urlStr) {
  try {
    const u = new URL(urlStr);
    return u.origin + u.pathname + u.search;
  } catch {
    return "";
  }
}

async function getHighlightHistoryTexts(pageUrl) {
  const key = urlKeyOf(pageUrl);
  if (!key) return [];
  const list = await getHistory();
  const seen = new Set();
  const texts = [];
  for (const e of list) {
    if (urlKeyOf(e.pageUrl) !== key) continue;
    const t = String(e.text || "").trim();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    texts.push(t);
    if (texts.length >= HIGHLIGHT_HISTORY_MAX) break;
  }
  return texts;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === "highlight-history") {
    getHighlightHistoryTexts(msg.pageUrl)
      .then((texts) => sendResponse({ ok: true, texts }))
      .catch((err) => sendResponse({ ok: false, error: String(err && err.message || err) }));
    return true;
  }
  // 悬停划线时查这条划词的历史释义（取同页面、同原文的最新一条）
  if (msg && msg.type === "highlight-lookup") {
    const key = urlKeyOf(msg.pageUrl);
    const text = String(msg.text || "").trim();
    getHistory()
      .then((list) => {
        const entry = list.find(
          (e) => key && urlKeyOf(e.pageUrl) === key && String(e.text || "").trim() === text
        );
        sendResponse({ ok: true, entry: entry || null });
      })
      .catch((err) => sendResponse({ ok: false, error: String(err && err.message || err) }));
    return true;
  }
  if (msg && msg.type === "open-options") {
    chrome.runtime.openOptionsPage();
    return;
  }
  if (msg && msg.type === "open-history") {
    chrome.tabs.create({ url: chrome.runtime.getURL("history.html") });
    return;
  }
  if (msg && msg.type === "history-save") {
    saveHistory(msg)
      .then((entry) => sendResponse({ ok: true, entry }))
      .catch((err) => sendResponse({ ok: false, error: String(err && err.message || err) }));
    return true; // 异步响应
  }
  if (msg && msg.type === "history-list") {
    getHistory()
      .then((list) => sendResponse({ ok: true, list }))
      .catch((err) => sendResponse({ ok: false, error: String(err && err.message || err) }));
    return true;
  }
  if (msg && msg.type === "history-delete") {
    deleteHistory(msg.id)
      .then((count) => sendResponse({ ok: true, count }))
      .catch((err) => sendResponse({ ok: false, error: String(err && err.message || err) }));
    return true;
  }
  if (msg && msg.type === "history-clear") {
    clearHistory()
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: String(err && err.message || err) }));
    return true;
  }
  if (msg && msg.type === "history-count") {
    Promise.all([getHistory(), getHistoryMax()])
      .then(([list, max]) => sendResponse({ ok: true, count: list.length, max }))
      .catch((err) => sendResponse({ ok: false, error: String(err && err.message || err) }));
    return true;
  }
});

// 右键菜单：复制选中文本 / 打开历史记录
chrome.runtime.onInstalled.addListener((details) => {
  // 全新安装时默认开启「高亮划词」（已有的用户配置不覆盖）
  if (details && details.reason === "install") {
    chrome.storage.local.get({ [HIGHLIGHT_KEY]: null }, (res) => {
      if (res[HIGHLIGHT_KEY] === null) chrome.storage.local.set({ [HIGHLIGHT_KEY]: true });
    });
  }
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: "ai-explain-copy",
      title: "复制选中文本到划词AI释义",
      contexts: ["selection"],
    });
    chrome.contextMenus.create({
      id: "ai-explain-history",
      title: "打开划词AI释义 · 历史记录",
      contexts: ["page", "selection"],
    });
    chrome.contextMenus.create({
      id: "ai-explain-extract",
      title: "摘录模式（关）",
      contexts: ["action"],
    });
    chrome.contextMenus.create({
      id: "ai-explain-highlight",
      title: "高亮划词（关）",
      contexts: ["action"],
    });
  });
  setActionState(); // 初始化图标状态（暂停/正常）
  updateExtractMenu(); // 初始化摘录模式菜单标题
  updateHighlightMenu(); // 初始化高亮划词菜单标题
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "ai-explain-history") {
    chrome.tabs.create({ url: chrome.runtime.getURL("history.html") });
    return;
  }
  if (info.menuItemId === "ai-explain-extract") {
    (async () => {
      const next = !(await getExtractMode());
      await chrome.storage.local.set({ [EXTRACT_MODE_KEY]: next });
      updateExtractMenu();
    })();
    return;
  }
  if (info.menuItemId === "ai-explain-highlight") {
    (async () => {
      const next = !(await getHighlightMode());
      await chrome.storage.local.set({ [HIGHLIGHT_KEY]: next });
      updateHighlightMenu();
    })();
    return;
  }
  if (info.menuItemId === "ai-explain-copy" && tab?.id) {
    chrome.tabs.sendMessage(tab.id, { type: "explain-selection" }).catch(() => {});
  }
});
