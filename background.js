// background.js —— 划词AI释义（MV3 Service Worker）
// 负责所有对外 API 请求（content script 无页面跨域问题，由 SW 代为转发并流式回传）。

// 云端同步（WebDAV，默认按坚果云填好地址）
const DEFAULT_SYNC = {
  enabled: false,
  url: "https://dav.jianguoyun.com/dav/",
  user: "", // 坚果云账号（邮箱）
  pass: "", // 坚果云「应用密码」，不是登录密码
  file: "AI_explain/history.json",
  auto: true, // 历史变动后自动同步
};

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
  currentTag: "", // 当前标签：划词/摘录入库时自动打上，空表示不打标签
  // 来源标题替换规则：[{ prefix, from, to }]，按网址前缀匹配，命中后把来源名里的 from 替换成 to
  // 只影响展示/导出，不改记录本身，也不改链接地址
  titleRules: [],
  sync: DEFAULT_SYNC,
  systemPrompt:
    "你是一位博学的中文释义助手。用户选中了网页上的一段文本，请用简体中文对其中可能不理解的生词、术语、难句或概念进行清晰、准确、易懂的解释。\n" +
    "请根据文本类型灵活处理：若是外文，先给出准确翻译再简要解释；若是文言文或单个汉字，请考证其本字、造字原意与字形演变；若是专业术语或缩写，用通俗语言讲解。\n" +
    "回答简洁，条理清楚，可适当使用要点。\n" +
    "释义时，每个字词释义组和其他字词释义组之间要换行，字和其释义之间不换行，保持在一行。字用粗体。\n" +
    "如果有整句意思、整体含义等部分，放在逐字解释的后面另起段落。非常用字加注拼音。\n" +
    "如果选中的是单个汉字，则列出其在先秦古籍中的上下文，即书证。书证中的非常用字也要加拼音。\n" +
    "只解释【所选文本】；【所在页面上下文】仅用于理解语境，不要逐句翻译或解释上下文中的其他内容（除非所选本身已是整段）。",
};

// 多份提示词：默认内置这三份，用户可在设置页增删改，在浮层里随时切换
// 存法：config.prompts = [{ id, name, prompt }]，config.activePromptId 指向当前使用的那份，
// config.systemPrompt 始终同步为当前提示词正文，请求时照旧读 systemPrompt。
const BUILTIN_PROMPTS = [
  { id: "default", name: "默认释义", prompt: DEFAULT_CONFIG.systemPrompt },
  {
    id: "brief",
    name: "简洁速览",
    prompt:
      "你是一位中文阅读助手。用户选中了网页上的一段文本，请用简体中文、不超过三句话说明它的意思：\n" +
      "① 先用一句话概括这段文本在说什么；\n" +
      "② 再点出其中最容易误解的一个词或说法，简短解释；\n" +
      "③ 若是外文或文言，先给出通顺的现代汉语译文。\n" +
      "不要列小标题、不要逐字考证、不要复述页面上下文。",
  },
  {
    id: "translate",
    name: "翻译优先",
    prompt:
      "你是一位翻译。用户选中了网页上的一段文本。\n" +
      "若为外文或文言：先给出整段通顺、准确的中文译文；译文之后另起一段，用要点列出不超过 3 个难点词或术语的简短注释（词用粗体，注释同行）。\n" +
      "若为现代中文：先用一句话概括意思，再解释其中难懂的词。\n" +
      "不做字形考证，不加评价，不解释页面上下文。",
  },
];

// 统一整理 config 里的提示词：缺字段/旧版只有 systemPrompt 时自动迁移，并保证 systemPrompt 与选中项一致
function normalizePromptConfig(cfg) {
  let prompts = Array.isArray(cfg.prompts) ? cfg.prompts : [];
  prompts = prompts
    .filter((p) => p && typeof p.prompt === "string" && p.prompt.trim())
    .map((p, i) => ({
      id: String(p.id || "p" + i),
      name: String(p.name || "").trim() || "提示词 " + (i + 1),
      prompt: String(p.prompt),
    }));
  if (!prompts.length) {
    // 旧配置：只有一份 systemPrompt。用户改过就保留成「我的提示词」，但内置三份也一并铺上
    // （此前只留自定义那份，设置里就看不到内置提示词）
    const saved = String(cfg.systemPrompt || "").trim();
    prompts =
      saved && saved !== DEFAULT_CONFIG.systemPrompt
        ? [{ id: "custom", name: "我的提示词", prompt: saved }, ...BUILTIN_PROMPTS.map((p) => ({ ...p }))]
        : BUILTIN_PROMPTS.map((p) => ({ ...p }));
  }
  // 老版本迁移只留下了「我的提示词」的情况：把缺失的内置提示词补回来（一次性，记 promptsBuiltinSeeded）
  if (!cfg.promptsBuiltinSeeded) {
    const ids = new Set(prompts.map((p) => p.id));
    const missing = BUILTIN_PROMPTS.filter((b) => !ids.has(b.id));
    if (missing.length) prompts = [...prompts, ...missing.map((p) => ({ ...p }))];
  }
  let activeId = cfg.activePromptId;
  if (!prompts.some((p) => p.id === activeId)) activeId = prompts[0].id;
  const active = prompts.find((p) => p.id === activeId);
  return { prompts, activePromptId: activeId, systemPrompt: active.prompt, promptsBuiltinSeeded: true };
}

let configCache = null;

async function getConfig() {
  if (configCache) return configCache;
  const res = await chrome.storage.local.get("config");
  const saved = res.config || {};
  configCache = { ...DEFAULT_CONFIG, ...saved };
  configCache = { ...configCache, ...normalizePromptConfig(configCache) };
  // 旧配置迁移：把整理后的提示词结构写回一次，content 脚本与设置页就不用各自兜底
  if (
    !Array.isArray(saved.prompts) ||
    !saved.activePromptId ||
    !saved.promptsBuiltinSeeded ||
    saved.systemPrompt !== configCache.systemPrompt
  ) {
    chrome.storage.local.set({ config: configCache }).catch(() => {});
  }
  return configCache;
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "sync") {
    const payload = {};
    for (const k of SETTINGS_SYNC_FIELDS) {
      if (changes[k]) payload[k] = changes[k].newValue;
    }
    if (!Object.keys(payload).length) return;
    getSettingsSyncEnabled().then((on) => {
      if (on) applyRemoteSettings(payload);
    });
    return;
  }
  if (area !== "local") return;
  if (changes.config) {
    configCache = null;
    pushSettingsToSync();
  }
  if (changes.paused) setActionState();
  if (changes.extractMode) { updateExtractMenu(); setActionState(); pushSettingsToSync(); }
  if (changes.highlightMode) { updateHighlightMenu(); pushSettingsToSync(); }
  if (changes[SETTINGS_SYNC_KEY] && changes[SETTINGS_SYNC_KEY].newValue !== false) {
    pushSettingsToSync(); // 重新打开设置同步时补推一次
  }
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
// 摘录模式图标：左上角带粉点（基于正常图标生成）
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
async function saveHistory({ text, answer, context, pageUrl, pageTitle, extract, tags }) {
  if (!text || !String(text).trim()) return null;
  const hasAnswer = !!answer && !!String(answer).trim();
  if (!hasAnswer && !extract) return null;
  const list = await getHistory();
  const cfg = await getConfig();
  // 调用方没显式给标签时，用设置里的「当前标签」，划词与摘录都会带上
  const explicit = Array.isArray(tags) ? tags.map((t) => String(t).trim()).filter(Boolean) : null;
  const curTag = String(cfg.currentTag || "").trim();
  const entryTags = explicit && explicit.length ? explicit : curTag ? [curTag] : [];
  const now = Date.now();
  const entry = {
    id: now.toString(36) + Math.random().toString(36).slice(2, 8),
    text: String(text),
    answer: hasAnswer ? String(answer) : "",
    context: context ? String(context) : "",
    pageUrl: pageUrl ? String(pageUrl) : "",
    pageTitle: pageTitle ? String(pageTitle) : "",
    time: now,
    updatedAt: now, // 合并用：改标签等编辑只动它，不动 time（time 决定排序）
  };
  if (entryTags.length) entry.tags = entryTags;
  if (extract) entry.extract = true;
  list.unshift(entry);
  const max = await getHistoryMax();
  if (list.length > max) list.length = max;
  await chrome.storage.local.set({ [HISTORY_KEY]: list });
  scheduleSync();
  return entry;
}

async function deleteHistory(id) {
  const list = await getHistory();
  const next = list.filter((e) => e.id !== id);
  await chrome.storage.local.set({ [HISTORY_KEY]: next });
  if (id) await addTombstones([id]);
  scheduleSync();
  return next.length;
}

async function clearHistory() {
  const list = await getHistory();
  if (list.length) await addTombstones(list.map((e) => e.id));
  await chrome.storage.local.set({ [HISTORY_KEY]: [] });
  scheduleSync();
}

// ---------- 设置同步（chrome.storage.sync，跟浏览器账号走） ----------
// 只同步「设置项」：config（含提示词、接口参数、WebDAV 账号）+ 摘录/高亮两个开关。
// 暂停状态属于单机行为，不同步，否则一端暂停会把另一端也停掉。
const SETTINGS_SYNC_KEY = "settingsSync";
const SETTINGS_SYNC_FIELDS = ["config", "highlightMode", "extractMode"];
const SETTINGS_SYNC_DEBOUNCE = 1500;

let settingsSyncTimer = null;
let applyingRemoteSettings = false;

async function getSettingsSyncEnabled() {
  const res = await chrome.storage.local.get({ [SETTINGS_SYNC_KEY]: true });
  return res[SETTINGS_SYNC_KEY] !== false;
}

async function pushSettingsToSync() {
  if (applyingRemoteSettings) return; // 刚从远端拉下来的改动，不再回推
  if (settingsSyncTimer) clearTimeout(settingsSyncTimer);
  settingsSyncTimer = setTimeout(async () => {
    settingsSyncTimer = null;
    if (applyingRemoteSettings) return;
    if (!(await getSettingsSyncEnabled())) return;
    const res = await chrome.storage.local.get(SETTINGS_SYNC_FIELDS);
    const payload = {};
    for (const k of SETTINGS_SYNC_FIELDS) {
      if (res[k] !== undefined) payload[k] = res[k];
    }
    try {
      await chrome.storage.sync.set(payload);
    } catch (e) {
      // 超出配额等失败不阻塞本地使用
    }
  }, SETTINGS_SYNC_DEBOUNCE);
}

// 把远端设置并到本地（config 按字段浅合并，保留本地独有的字段）
async function applyRemoteSettings(payload) {
  if (!payload) return;
  const patch = {};
  if (payload.config && typeof payload.config === "object") {
    const res = await chrome.storage.local.get({ config: null });
    patch.config = { ...(res.config || {}), ...payload.config };
  }
  if (payload.highlightMode !== undefined) patch.highlightMode = !!payload.highlightMode;
  if (payload.extractMode !== undefined) patch.extractMode = !!payload.extractMode;
  if (!Object.keys(patch).length) return;
  applyingRemoteSettings = true;
  try {
    await chrome.storage.local.set(patch);
  } finally {
    setTimeout(() => {
      applyingRemoteSettings = false;
    }, 600);
  }
}

async function pullSettingsFromSync() {
  if (!(await getSettingsSyncEnabled())) return;
  try {
    const all = await chrome.storage.sync.get(SETTINGS_SYNC_FIELDS);
    await applyRemoteSettings(all);
  } catch (e) {
    // 未登录浏览器账号等情况直接跳过
  }
}

// ---------- 云端同步（WebDAV） ----------
// 文件里的结构：{ version, updatedAt, records, tombstones }
// 合并规则：按 id 求并集，同一 id 取 time 更大的；tombstones 里的 id 一律不复活。
const SYNC_TOMBSTONE_KEY = "syncTombstones";
const SYNC_STATE_KEY = "syncState";
const TOMBSTONE_TTL = 90 * 24 * 3600 * 1000; // 墓碑保留 90 天
const TOMBSTONE_MAX = 2000;
const SYNC_DEBOUNCE = 4000;

async function getSyncConfig() {
  const cfg = await getConfig();
  return { ...DEFAULT_SYNC, ...(cfg.sync || {}) };
}

async function getTombstones() {
  const res = await chrome.storage.local.get({ [SYNC_TOMBSTONE_KEY]: [] });
  const list = Array.isArray(res[SYNC_TOMBSTONE_KEY]) ? res[SYNC_TOMBSTONE_KEY] : [];
  return list.filter((t) => t && t.id);
}

async function addTombstones(ids) {
  if (!ids || !ids.length) return;
  const list = await getTombstones();
  const map = new Map(list.map((t) => [t.id, t]));
  const now = Date.now();
  ids.forEach((id) => {
    if (!id) return;
    map.set(String(id), { id: String(id), time: now });
  });
  const next = pruneTombstones([...map.values()]);
  await chrome.storage.local.set({ [SYNC_TOMBSTONE_KEY]: next });
}

function pruneTombstones(list) {
  const cutoff = Date.now() - TOMBSTONE_TTL;
  const arr = Array.isArray(list) ? list : Array.from(list || []);
  return arr
    .filter((t) => t && t.id && Number(t.time) >= cutoff)
    .sort((a, b) => Number(b.time) - Number(a.time))
    .slice(0, TOMBSTONE_MAX);
}

// UTF-8 安全的 Base64（Basic 认证用）
function b64utf8(str) {
  const bytes = new TextEncoder().encode(String(str));
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

// 把 base 与文件路径拼成完整 URL，路径逐段编码
function davUrl(cfg) {
  const base = String(cfg.url || "").replace(/\/+$/, "");
  const segs = String(cfg.file || "AI_explain/history.json")
    .replace(/^\/+/, "")
    .split("/")
    .filter(Boolean)
    .map((s) => encodeURIComponent(s));
  return base + "/" + segs.join("/");
}

function davDirUrl(url) {
  return url.replace(/\/[^/]+$/, "");
}

async function davFetch(cfg, method, url, body) {
  const headers = { Authorization: "Basic " + b64utf8(cfg.user + ":" + cfg.pass) };
  if (body !== undefined) headers["Content-Type"] = "application/json; charset=utf-8";
  return fetch(url, { method, headers, body });
}

// 逐级创建目录：坚果云不会替我们建中间目录，405 表示已存在
async function ensureDavDir(cfg, fileUrl) {
  const base = String(cfg.url || "").replace(/\/+$/, "");
  const dir = davDirUrl(fileUrl);
  if (!dir || dir === base) return;
  const rel = dir.slice(base.length + 1);
  const segs = rel ? rel.split("/") : [];
  let cur = base;
  for (const seg of segs) {
    cur += "/" + seg;
    const resp = await davFetch(cfg, "MKCOL", cur).catch(() => null);
    if (resp && !resp.ok && resp.status !== 405 && resp.status !== 301) {
      // 目录创建失败通常意味着账号/密码或路径有问题，直接抛出让上层提示
      const text = await resp.text().catch(() => "");
      throw new Error("创建目录失败 HTTP " + resp.status + (text ? "：" + text.slice(0, 120) : ""));
    }
  }
}

function normalizeRemote(raw) {
  const data = raw && typeof raw === "object" ? raw : {};
  const records = Array.isArray(data.records) ? data.records.filter((e) => e && e.id) : [];
  const tombstones = Array.isArray(data.tombstones) ? data.tombstones.filter((t) => t && t.id) : [];
  return { records, tombstones };
}

async function readRemote(cfg) {
  const url = davUrl(cfg);
  await ensureDavDir(cfg, url);
  const resp = await davFetch(cfg, "GET", url);
  if (resp.status === 404) return { records: [], tombstones: [], missing: true };
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error("读取失败 HTTP " + resp.status + (text ? "：" + text.slice(0, 120) : ""));
  }
  const text = await resp.text();
  if (!text.trim()) return { records: [], tombstones: [], missing: true };
  try {
    return { ...normalizeRemote(JSON.parse(text)), missing: false };
  } catch (e) {
    throw new Error("远端文件不是合法 JSON");
  }
}

async function writeRemote(cfg, payload) {
  const url = davUrl(cfg);
  await ensureDavDir(cfg, url);
  const resp = await davFetch(cfg, "PUT", url, JSON.stringify(payload));
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error("上传失败 HTTP " + resp.status + (text ? "：" + text.slice(0, 120) : ""));
  }
}

// 合并两端记录：id 并集，同 id 取 updatedAt（没有则 time）更大者；并集后再剔除墓碑
function mergeRecords(local, remote, tombstones) {
  const map = new Map();
  const version = (e) => Number(e && (e.updatedAt || e.time)) || 0;
  const add = (e) => {
    if (!e || !e.id) return;
    const cur = map.get(e.id);
    if (!cur || version(e) > version(cur)) map.set(e.id, e);
  };
  (local || []).forEach(add);
  (remote || []).forEach(add);
  const dead = new Set((tombstones || []).map((t) => t.id));
  return [...map.values()]
    .filter((e) => !dead.has(e.id))
    .sort((a, b) => (Number(b.time) || 0) - (Number(a.time) || 0));
}

let syncing = null; // 同一时间只跑一次，避免两端互相打架
let syncTimer = null;

async function setSyncState(patch) {
  const res = await chrome.storage.local.get({ [SYNC_STATE_KEY]: null });
  const state = { ...(res[SYNC_STATE_KEY] || {}), ...patch };
  await chrome.storage.local.set({ [SYNC_STATE_KEY]: state });
}

async function runSync({ manual = false } = {}) {
  const cfg = await getSyncConfig();
  if (!cfg.enabled || !cfg.url || !cfg.user || !cfg.pass) {
    if (manual) return { ok: false, message: "未启用同步或缺少 WebDAV 账号/应用密码" };
    return { ok: false, skipped: true };
  }
  if (syncing) return syncing;
  syncing = (async () => {
    try {
      const [local, localTomb] = await Promise.all([getHistory(), getTombstones()]);
      const remote = await readRemote(cfg);
      const tombstones = pruneTombstones(
        // 两端墓碑取并集
        [...localTomb, ...remote.tombstones].reduce((acc, t) => {
          const prev = acc.get(t.id);
          if (!prev || Number(t.time) > Number(prev.time)) acc.set(t.id, t);
          return acc;
        }, new Map()).values()
      );
      let merged = mergeRecords(local, remote.records, tombstones);
      const max = await getHistoryMax();
      if (merged.length > max) merged.length = max;

      await chrome.storage.local.set({
        [HISTORY_KEY]: merged,
        [SYNC_TOMBSTONE_KEY]: tombstones,
      });
      await writeRemote(cfg, {
        version: 1,
        updatedAt: Date.now(),
        source: "ai-explain",
        records: merged,
        tombstones,
      });
      const added = merged.filter((e) => !local.some((l) => l.id === e.id)).length;
      await setSyncState({ lastAt: Date.now(), ok: true, message: "同步成功", added, count: merged.length });
      return { ok: true, count: merged.length, added };
    } catch (err) {
      const message = String(err && err.message ? err.message : err);
      await setSyncState({ lastAt: Date.now(), ok: false, message });
      return { ok: false, message };
    } finally {
      syncing = null;
    }
  })();
  return syncing;
}

// 历史变动后延迟合并一次，避免连续删除/保存触发多次上传
function scheduleSync() {
  getSyncConfig()
    .then((cfg) => {
      if (!cfg.enabled || !cfg.auto) return null;
      if (syncTimer) clearTimeout(syncTimer);
      syncTimer = setTimeout(() => {
        syncTimer = null;
        runSync().catch(() => {});
      }, SYNC_DEBOUNCE);
      return true;
    })
    .catch(() => {});
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
  if (msg && msg.type === "history-changed") {
    scheduleSync(); // 历史页导入等直接改存储的入口，通知后台排一次同步
    return;
  }
  // 历史里已用过的标签（按出现次数排序），供浮层/设置页选择
  if (msg && msg.type === "tag-list") {
    getHistory()
      .then((list) => {
        const count = new Map();
        for (const e of list) {
          for (const t of e.tags || []) {
            const name = String(t || "").trim();
            if (name) count.set(name, (count.get(name) || 0) + 1);
          }
        }
        const tags = [...count.entries()].sort((a, b) => b[1] - a[1]).map(([name]) => name);
        sendResponse({ ok: true, tags });
      })
      .catch((err) => sendResponse({ ok: false, error: String(err && err.message || err) }));
    return true;
  }
  if (msg && msg.type === "settings-pull") {
    (async () => {
      await pullSettingsFromSync();
      const res = await chrome.storage.local.get({ config: null, highlightMode: false, extractMode: false });
      return { ok: true, ...res };
    })().then((res) => sendResponse(res));
    return true;
  }
  if (msg && msg.type === "sync-now") {
    runSync({ manual: true })
      .then((res) => sendResponse(res))
      .catch((err) => sendResponse({ ok: false, message: String(err && err.message || err) }));
    return true;
  }
  // 测试连接：只读远端文件头，不上传、不改本地
  if (msg && msg.type === "sync-test") {
    (async () => {
      const cfg = await getSyncConfig();
      if (!cfg.url || !cfg.user || !cfg.pass) {
        return { ok: false, message: "请先填写服务器地址、账号与应用密码" };
      }
      try {
        const remote = await readRemote(cfg);
        return {
          ok: true,
          missing: !!remote.missing,
          count: remote.records.length,
          message: remote.missing
            ? "连接成功，远端还没有文件（首次同步会创建）"
            : "连接成功，远端已有 " + remote.records.length + " 条记录",
        };
      } catch (err) {
        return { ok: false, message: String(err && err.message ? err.message : err) };
      }
    })().then((res) => sendResponse(res));
    return true;
  }
});

// 浏览器启动时先补一次同步（开了自动同步的话）
chrome.runtime.onStartup.addListener(() => {
  setTimeout(() => pullSettingsFromSync(), 800); // 先把别的电脑改过的设置拉下来
  setTimeout(() => runSync().catch(() => {}), 1500);
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
  pullSettingsFromSync(); // 新装/更新后把账号里已有的设置拉下来
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

// Service Worker 每次被唤醒都补拉一次设置：storage.onChanged 不会唤醒休眠的 worker，
// 只靠它会导致另一台电脑一直拿不到这里刚改的配置（含 WebDAV 账号）。
pullSettingsFromSync();
