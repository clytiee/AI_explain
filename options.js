// options.js —— 划词AI释义 设置页逻辑

const PRESETS = {
  deepseek: { base: "https://api.deepseek.com", model: "deepseek-chat" },
  doubao: { base: "https://ark.cn-beijing.volces.com/api/v3", model: "" },
  openai: { base: "https://api.openai.com", model: "gpt-4o-mini" },
  moonshot: { base: "https://api.moonshot.cn", model: "moonshot-v1-8k" },
  custom: { base: "", model: "" },
};

const DEFAULT_PROMPT =
  "你是一位博学的中文释义助手。用户选中了网页上的一段文本，请用简体中文对其中可能不理解的生词、术语、难句或概念进行清晰、准确、易懂的解释。\n" +
  "请根据文本类型灵活处理：若是外文，先给出准确翻译再简要解释；若是文言文或单个汉字，请考证其本字、造字原意与字形演变；若是专业术语或缩写，用通俗语言讲解。\n" +
  "回答简洁，条理清楚，可适当使用要点。\n" +
  "释义时，每个字词释义组和其他字词释义组之间要换行，字和其释义之间不换行，保持在一行。字用粗体。\n" +
  "如果有整句意思、整体含义等部分，放在逐字解释的后面另起段落。非常用字加注拼音。\n" +
  "如果选中的是单个汉字，则列出其在先秦古籍中的上下文，即书证。书证中的非常用字也要加拼音。\n" +
  "只解释【所选文本】；【所在页面上下文】仅用于理解语境，不要逐句翻译或解释上下文中的其他内容（除非所选本身已是整段）。";

// 常用荧光笔色（黄/绿/蓝/粉/橙/紫/红/青）
const HL_PRESET_COLORS = [
  "#fef08a", "#bbf7d0", "#bae6fd", "#fbcfe8",
  "#fed7aa", "#ddd6fe", "#fecaca", "#99f6e4",
  "#d9f99d", "#ccfbf1", "#e5e7eb", "#93c5fd",
];
// 常用色的中文名称（与 HL_PRESET_COLORS 一一对应，悬停时显示）
const HL_COLOR_NAMES = {
  "#fef08a": "浅黄",
  "#bbf7d0": "浅绿",
  "#bae6fd": "浅蓝",
  "#fbcfe8": "浅粉",
  "#fed7aa": "浅橙",
  "#ddd6fe": "浅紫",
  "#fecaca": "浅红",
  "#99f6e4": "浅青",
  "#d9f99d": "青柠",
  "#ccfbf1": "青瓷",
  "#e5e7eb": "中性灰",
  "#93c5fd": "链接蓝",
};
const HL_DEFAULT_COLOR = "#fef08a";

// 内置提示词（与 background.js 的 BUILTIN_PROMPTS 一一对应，改动需两处同步）
const BUILTIN_PROMPTS = [
  { id: "default", name: "默认释义", prompt: DEFAULT_PROMPT },
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

// 当前编辑中的提示词集合与选中项（保存时整体写回 config）
let prompts = [];
let activePromptId = "";
let promptUid = 0;
const newPromptId = () =>
  "p" + Date.now().toString(36) + (promptUid++).toString(36) + Math.random().toString(36).slice(2, 5);

// 与 background.js 的 normalizePromptConfig 同义：旧配置迁移 + 保证选中项合法
function normalizePrompts(cfg) {
  let list = Array.isArray(cfg.prompts) ? cfg.prompts : [];
  list = list
    .filter((p) => p && typeof p.prompt === "string" && p.prompt.trim())
    .map((p, i) => ({
      id: String(p.id || "p" + i),
      name: String(p.name || "").trim() || "提示词 " + (i + 1),
      prompt: String(p.prompt),
    }));
  if (!list.length) {
    const saved = String(cfg.systemPrompt || "").trim();
    list =
      saved && saved !== DEFAULT_PROMPT
        ? [{ id: "custom", name: "我的提示词", prompt: saved }, ...BUILTIN_PROMPTS.map((p) => ({ ...p }))]
        : BUILTIN_PROMPTS.map((p) => ({ ...p }));
  }
  // 与后台一致：老版本只留下自定义提示词时，补回缺失的内置提示词
  if (!cfg.promptsBuiltinSeeded) {
    const ids = new Set(list.map((p) => p.id));
    const missing = BUILTIN_PROMPTS.filter((b) => !ids.has(b.id));
    if (missing.length) list = [...list, ...missing.map((p) => ({ ...p }))];
  }
  let id = cfg.activePromptId;
  if (!list.some((p) => p.id === id)) id = list[0].id;
  return { list, id, seeded: true };
}

const DEFAULT_SYNC = {
  enabled: false,
  url: "https://dav.jianguoyun.com/dav/",
  user: "",
  pass: "",
  file: "AI_explain/history.json",
  auto: true,
};

const $ = (id) => document.getElementById(id);

let currentConfig = {
  apiBaseUrl: "https://api.deepseek.com",
  apiKey: "",
  model: "deepseek-chat",
  temperature: 0.3,
  stream: true,
  autoExplain: true,
  autoSaveHistory: true,
  maxLength: 500,
  historyMax: 1000,
  systemPrompt: DEFAULT_PROMPT,
  highlightColor: HL_DEFAULT_COLOR,
  titleRules: [],
  sync: { ...DEFAULT_SYNC },
};

// 色块上的示例文字：按《诗经·蒹葭》全诗逐句依次排（不循环，色块多了就空着）
const HL_SAMPLE_LINES = [
  "蒹葭苍苍", "白露为霜", "所谓伊人", "在水一方",
  "溯洄从之", "道阻且长", "溯游从之", "宛在水中央",
  "蒹葭萋萋", "白露未晞", "所谓伊人", "在水之湄",
  "溯洄从之", "道阻且跻", "溯游从之", "宛在水中坻",
  "蒹葭采采", "白露未已", "所谓伊人", "在水之涘",
  "溯洄从之", "道阻且右", "溯游从之", "宛在水中沚",
];

// 渲染常用荧光笔色：每块用示例文字配下半部分色带，所见即所得
function renderHlColors() {
  const wrap = $("hlColors");
  wrap.innerHTML = "";
  HL_PRESET_COLORS.forEach((color, i) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "hl-swatch";
    btn.style.setProperty("--sw", color);
    // 悬停显示中文色名，后面附色值便于对照
    btn.title = (HL_COLOR_NAMES[color] || "自定义色") + " · " + color;
    btn.dataset.color = color;
    const textEl = document.createElement("span");
    textEl.className = "hl-swatch-text";
    textEl.textContent = HL_SAMPLE_LINES[i] || "";
    btn.appendChild(textEl);
    btn.addEventListener("click", () => {
      $("highlightColor").value = color;
      markActiveSwatch(color);
    });
    wrap.appendChild(btn);
  });
}

function markActiveSwatch(color) {
  $("hlCurrent").textContent = color;
  document.querySelectorAll(".hl-swatch").forEach((el) => {
    el.classList.toggle("active", el.dataset.color.toLowerCase() === String(color).toLowerCase());
  });
}

// ---------- 来源标题替换规则 ----------
let titleRules = [];

// 渲染规则列表：一行 = 网址前缀 + 查找 + 替换为 + 删除
function renderTitleRules() {
  const wrap = $("titleRules");
  wrap.innerHTML = "";
  if (!titleRules.length) {
    const empty = document.createElement("div");
    empty.className = "rules-empty";
    empty.textContent = "还没有规则。点下面「添加规则」新增一条。";
    wrap.appendChild(empty);
    return;
  }
  titleRules.forEach((rule, idx) => {
    const row = document.createElement("div");
    row.className = "title-rule";

    const mkInput = (cls, placeholder, value, key) => {
      const input = document.createElement("input");
      input.type = "text";
      input.className = cls;
      input.placeholder = placeholder;
      input.value = value;
      input.addEventListener("input", () => {
        titleRules[idx][key] = input.value;
      });
      return input;
    };

    row.appendChild(mkInput("rule-prefix", "网址前缀，如 https://www.zhihu.com/", rule.prefix, "prefix"));
    row.appendChild(mkInput("rule-from", "查找（留空=整条替换）", rule.from, "from"));

    const arrow = document.createElement("span");
    arrow.className = "rule-arrow";
    arrow.textContent = "→";
    row.appendChild(arrow);

    row.appendChild(mkInput("rule-to", "替换为", rule.to, "to"));

    const del = document.createElement("button");
    del.type = "button";
    del.className = "rule-del";
    del.textContent = "删除";
    del.title = "删除这条规则";
    del.addEventListener("click", () => {
      titleRules.splice(idx, 1);
      renderTitleRules();
    });
    row.appendChild(del);

    wrap.appendChild(row);
  });
}

// 当前标签的候选胶囊：高亮与输入框内容一致的那一个
function renderCurTagChips() {
  const val = $("curTag").value.trim();
  [...$("curTagChips").querySelectorAll(".curtag-chip")].forEach((chip) => {
    chip.classList.toggle("active", chip.textContent === val);
  });
}

function load() {  chrome.storage.local.get({ config: null, paused: false, highlightMode: false, settingsSync: true }, (res) => {
    if (res.config) currentConfig = { ...currentConfig, ...res.config };
    $("pausedSwitch").checked = !!res.paused;
    $("highlightSwitch").checked = !!res.highlightMode;
    $("settingsSync").checked = res.settingsSync !== false;
    // 当前标签的候选：从历史里聚合已经用过的标签，做成可点的胶囊
    // （不用 datalist：输入框已有值时，datalist 会被过滤成只剩完全匹配的那一项）
    try {
      chrome.runtime.sendMessage({ type: "tag-list" }, (resp) => {
        const list = resp && resp.ok && Array.isArray(resp.tags) ? resp.tags : [];
        const wrap = $("curTagChips");
        wrap.innerHTML = "";
        if (!list.length) {
          wrap.textContent = "还没有用过的标签，直接在上面输入即可。";
          wrap.classList.add("empty");
          return;
        }
        wrap.classList.remove("empty");
        list.forEach((t) => {
          const chip = document.createElement("button");
          chip.type = "button";
          chip.className = "curtag-chip";
          chip.textContent = t;
          chip.title = "设为当前标签";
          chip.addEventListener("click", () => {
            $("curTag").value = t;
            renderCurTagChips();
          });
          wrap.appendChild(chip);
        });
        renderCurTagChips();
      });
    } catch (e) {}
    $("apiBaseUrl").value = currentConfig.apiBaseUrl || "";
    $("model").value = currentConfig.model || "";
    $("apiKey").value = currentConfig.apiKey || "";
    $("temperature").value = currentConfig.temperature ?? 0.3;
    $("maxLength").value = currentConfig.maxLength ?? 500;
    $("autoExplain").checked = !!currentConfig.autoExplain;
    $("stream").checked = !!currentConfig.stream;
    $("autoSaveHistory").checked = currentConfig.autoSaveHistory !== false;
    $("historyMax").value = currentConfig.historyMax ?? 1000;
    $("curTag").value = currentConfig.currentTag || "";
    const np = normalizePrompts(currentConfig);
    prompts = np.list;
    activePromptId = np.id;
    renderPromptSelect();
    fillPromptForm();
    const hlColor = currentConfig.highlightColor || HL_DEFAULT_COLOR;
    $("highlightColor").value = hlColor;
    markActiveSwatch(hlColor);

    titleRules = Array.isArray(currentConfig.titleRules)
      ? currentConfig.titleRules.map((r) => ({
          prefix: String(r && r.prefix ? r.prefix : ""),
          from: String(r && r.from ? r.from : ""),
          to: String(r && r.to ? r.to : ""),
        }))
      : [];
    renderTitleRules();

    const sync = { ...DEFAULT_SYNC, ...(currentConfig.sync || {}) };
    $("syncEnabled").checked = !!sync.enabled;
    $("syncUrl").value = sync.url || "";
    $("syncUser").value = sync.user || "";
    $("syncPass").value = sync.pass || "";
    $("syncFile").value = sync.file || "";
    $("syncAuto").checked = sync.auto !== false;
    showSyncState();

    // 按 base url 反推服务商
    const base = (currentConfig.apiBaseUrl || "").replace(/\/+$/, "");
    let provider = "custom";
    for (const [k, v] of Object.entries(PRESETS)) {
      if (k === "custom") continue;
      if (v.base.replace(/\/+$/, "") === base) provider = k;
    }
    $("provider").value = provider;
  });
}

function readForm() {
  // 先把表单当前内容写回编辑中的那份提示词，再整体序列化
  const cur = currentEntry();
  if (cur) {
    cur.name = $("promptName").value.trim() || cur.name;
    cur.prompt = $("systemPrompt").value;
  }
  const list = prompts.map((p, i) => ({
    id: p.id,
    name: String(p.name || "").trim() || "提示词 " + (i + 1),
    prompt: String(p.prompt || ""),
  }));
  const active = list.find((p) => p.id === activePromptId) || list[0];
  return {
    apiBaseUrl: $("apiBaseUrl").value.trim(),
    apiKey: $("apiKey").value.trim(),
    model: $("model").value.trim(),
    temperature: Number($("temperature").value) || 0.3,
    maxLength: Number($("maxLength").value) || 500,
    autoExplain: $("autoExplain").checked,
    stream: $("stream").checked,
    autoSaveHistory: $("autoSaveHistory").checked,
    historyMax: Number($("historyMax").value) || 1000,
    currentTag: $("curTag").value.trim(),
    systemPrompt: active ? active.prompt : "",
    prompts: list,
    activePromptId: active ? active.id : "",
    promptsBuiltinSeeded: true, // 记住已经补过内置提示词，之后删掉不会被自动加回来
    titleRules: titleRules
      .map((r) => ({
        prefix: String(r.prefix || "").trim(),
        from: String(r.from || ""),
        to: String(r.to || ""),
      }))
      .filter((r) => r.prefix),
    highlightColor: $("highlightColor").value,
    sync: {
      enabled: $("syncEnabled").checked,
      url: $("syncUrl").value.trim(),
      user: $("syncUser").value.trim(),
      pass: $("syncPass").value,
      file: $("syncFile").value.trim() || DEFAULT_SYNC.file,
      auto: $("syncAuto").checked,
    },
  };
}

// ---------- 多提示词：下拉切换 + 增删改 ----------
function currentEntry() {
  return prompts.find((p) => p.id === activePromptId) || prompts[0] || null;
}

// 内置提示词的 id（下拉里给它们标「内置」）
const BUILTIN_IDS = BUILTIN_PROMPTS.map((p) => p.id);

function renderPromptSelect() {
  const sel = $("promptSelect");
  sel.innerHTML = "";
  prompts.forEach((p) => {
    const opt = document.createElement("option");
    opt.value = p.id;
    // 内置的三份在名称右侧标一下，方便区分自己新建的
    opt.textContent = BUILTIN_IDS.includes(p.id) ? p.name + "　·　内置" : p.name;
    sel.appendChild(opt);
  });
  sel.value = activePromptId;
}

function fillPromptForm() {
  const cur = currentEntry();
  if (!cur) return;
  $("promptName").value = cur.name;
  $("systemPrompt").value = cur.prompt;
}

// 切换编辑/使用目标：先把当前表单内容存回原来那份，再载入新的一份
function selectPrompt(id) {
  const cur = currentEntry();
  if (cur) {
    cur.name = $("promptName").value.trim() || cur.name;
    cur.prompt = $("systemPrompt").value;
  }
  if (!prompts.some((p) => p.id === id)) return;
  activePromptId = id;
  renderPromptSelect();
  fillPromptForm();
}

function setStatus(text, ok) {
  const el = $("status");
  el.textContent = text;
  el.className = ok ? "ok" : "err";
}

function applyPreset(provider) {
  const p = PRESETS[provider];
  if (!p) return;
  if (provider !== "custom") {
    $("apiBaseUrl").value = p.base;
    if (p.model) $("model").value = p.model;
  }
}

$("provider").addEventListener("change", (e) => {
  const provider = e.target.value;
  if (provider === "custom") {
    setStatus("自定义模式：请自行填写 Base URL、模型与 Key。", true);
    return;
  }
  applyPreset(provider);
  setStatus("已填入该服务商常用地址与模型。豆包需在下方填写你的「推理接入点」模型名。", true);
});

$("pausedSwitch").addEventListener("change", (e) => {
  chrome.storage.local.set({ paused: e.target.checked }, () => {
    setStatus(e.target.checked ? "已暂停划词（图标变为带红斜杠）" : "已恢复划词", true);
  });
});

// 高亮划词开关：立即生效（与图标右键菜单同一开关）
$("highlightSwitch").addEventListener("change", (e) => {
  chrome.storage.local.set({ highlightMode: e.target.checked }, () => {
    setStatus(e.target.checked ? "已开启高亮划词，去网页选中文字试试。" : "已关闭高亮划词，本页已划的线会自动清除。", true);
  });
});

// 设置同步开关：立即写入，后台会据它决定是否推送/拉取
$("settingsSync").addEventListener("change", (e) => {
  const on = e.target.checked;
  chrome.storage.local.set({ settingsSync: on }, () => {
    setStatus(on ? "已开启设置同步（约 1.5 秒后推送）" : "已关闭设置同步（其他电脑不再自动拉取）", true);
  });
});

// 调色盘选色时同步高亮当前常用色块
$("highlightColor").addEventListener("input", (e) => {
  markActiveSwatch(e.target.value);
});

$("save").addEventListener("click", () => {
  const cfg = readForm();
  if (!cfg.apiBaseUrl) {
    setStatus("请填写 API 地址。", false);
    return;
  }
  if (!cfg.model) {
    setStatus("请填写模型名称。", false);
    return;
  }
  if (!String(cfg.systemPrompt || "").trim()) {
    setStatus("当前选中的提示词正文为空，请填写后再保存。", false);
    return;
  }
  chrome.storage.local.set({ config: cfg }, () => {
    currentConfig = cfg;
    setStatus("已保存 ✓ 现在去网页上选中文字试试吧。", true);
  });
});

$("resetPrompt").addEventListener("click", () => {
  $("systemPrompt").value = DEFAULT_PROMPT;
  const cur = currentEntry();
  if (cur) cur.prompt = DEFAULT_PROMPT;
  setStatus("已把这份提示词恢复为默认正文，记得点「保存设置」生效。", true);
});

// 恢复内置提示词：缺的补回，已有的按内置正文重置（自定义的其它提示词不动）
$("restoreBuiltins").addEventListener("click", () => {
  if (!confirm("将把「默认释义 / 简洁速览 / 翻译优先」三份内置提示词补回或重置为内置正文，其它提示词不受影响。继续？")) return;
  const cur = currentEntry();
  if (cur) {
    cur.name = $("promptName").value.trim() || cur.name;
    cur.prompt = $("systemPrompt").value;
  }
  BUILTIN_PROMPTS.forEach((b) => {
    const exist = prompts.find((p) => p.id === b.id);
    if (exist) {
      exist.name = b.name;
      exist.prompt = b.prompt;
    } else {
      prompts.push({ ...b });
    }
  });
  renderPromptSelect();
  fillPromptForm();
  setStatus("已恢复内置提示词，点「保存设置」写入。", true);
});

// 下拉切换提示词
$("promptSelect").addEventListener("change", (e) => {
  selectPrompt(e.target.value);
});

// 改名：即时同步到下拉选项，避免切换后还要重选
$("promptName").addEventListener("input", () => {
  const cur = currentEntry();
  if (!cur) return;
  const name = $("promptName").value.trim();
  if (!name) return;
  cur.name = name;
  renderPromptSelect();
});

$("systemPrompt").addEventListener("input", () => {
  const cur = currentEntry();
  if (cur) cur.prompt = $("systemPrompt").value;
});

// 新增一份空白提示词
$("promptAdd").addEventListener("click", () => {
  const cur = currentEntry();
  if (cur) {
    cur.name = $("promptName").value.trim() || cur.name;
    cur.prompt = $("systemPrompt").value;
  }
  const id = newPromptId();
  prompts.push({ id, name: "新提示词 " + (prompts.length + 1), prompt: "" });
  activePromptId = id;
  renderPromptSelect();
  fillPromptForm();
  $("systemPrompt").focus();
  setStatus("已新增一份提示词，填好正文与名称后点「保存设置」。", true);
});

// 以当前这份为模板复制一份
$("promptDup").addEventListener("click", () => {
  const cur = currentEntry();
  if (!cur) return;
  cur.name = $("promptName").value.trim() || cur.name;
  cur.prompt = $("systemPrompt").value;
  const id = newPromptId();
  const baseName = cur.name.replace(/（副本(\d*)）/g, "");
  const dupCount = prompts.filter((p) => p.name.startsWith(baseName)).length;
  prompts.push({
    id,
    name: baseName + "（副本" + (dupCount > 1 ? dupCount : "") + "）",
    prompt: cur.prompt,
  });
  activePromptId = id;
  renderPromptSelect();
  fillPromptForm();
  setStatus("已复制一份提示词，可改个名字区分后保存。", true);
});

// 删除当前这份（至少保留一份）
$("promptDel").addEventListener("click", () => {
  if (prompts.length <= 1) {
    setStatus("至少保留一份提示词，不能删除。", false);
    return;
  }
  const cur = currentEntry();
  if (!cur) return;
  if (!confirm("确定删除提示词「" + cur.name + "」？此操作在保存设置后生效。")) return;
  prompts = prompts.filter((p) => p.id !== cur.id);
  activePromptId = prompts[0].id;
  renderPromptSelect();
  fillPromptForm();
  setStatus("已删除「" + cur.name + "」，点「保存设置」写入。", true);
});

$("openHistory").addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("history.html") });
});

$("test").addEventListener("click", async () => {
  const cfg = readForm();
  // 测试反馈显示在「测试连接」按钮正下方
  const statusEl = $("testStatus");
  const testStatus = (text, ok) => {
    statusEl.textContent = text;
    statusEl.className = ok ? "ok" : "err";
  };
  if (!cfg.apiKey) {
    testStatus("请先填写 API Key。", false);
    return;
  }
  const box = $("testBox");
  box.textContent = "请求中…";
  box.classList.add("show");
  testStatus("", true);

  try {
    const base = cfg.apiBaseUrl.replace(/\/+$/, "");
    const resp = await fetch(base + "/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + cfg.apiKey,
      },
      body: JSON.stringify({
        model: cfg.model,
        messages: [
          { role: "system", content: "只回复两个字：连接成功。" },
          { role: "user", content: "测试" },
        ],
        temperature: 0,
        stream: false,
      }),
    });
    if (!resp.ok) {
      const t = await resp.text().catch(() => "");
      box.textContent = "HTTP " + resp.status + "\n" + t.slice(0, 400);
      testStatus("连接失败", false);
      return;
    }
    const data = await resp.json();
    const reply = data?.choices?.[0]?.message?.content || "(空响应)";
    box.textContent = reply;
    testStatus("连接成功 ✓ 已能调用该模型。", true);
  } catch (err) {
    box.textContent = "请求出错：" + String(err && err.message ? err.message : err);
    testStatus("连接失败", false);
  }
});

// 手动改当前标签时同步胶囊高亮
$("curTag").addEventListener("input", renderCurTagChips);

// 新增一条来源标题替换规则
$("titleRuleAdd").addEventListener("click", () => {
  titleRules.push({ prefix: "", from: "", to: "" });
  renderTitleRules();
  const wrap = $("titleRules");
  const last = wrap.querySelector(".title-rule:last-child .rule-prefix");
  if (last) last.focus();
});

// ---------- 云端同步（WebDAV） ----------
function setSyncStatus(text, ok) {
  const el = $("syncStatus");
  el.textContent = text;
  el.className = "hint " + (ok ? "ok" : "err");
}

function showSyncState() {
  chrome.storage.local.get({ syncState: null }, (res) => {
    const st = res.syncState;
    if (!st || !st.lastAt) {
      setSyncStatus("尚未同步。", true);
      return;
    }
    const when = new Date(st.lastAt).toLocaleString("zh-CN", { hour12: false });
    setSyncStatus((st.ok ? "上次同步成功 " : "上次同步失败 ") + when + "：" + (st.message || ""), !!st.ok);
  });
}

$("syncTest").addEventListener("click", () => {
  const cfg = readForm();
  if (!cfg.sync.url || !cfg.sync.user || !cfg.sync.pass) {
    setSyncStatus("请先填写 WebDAV 地址、账号与应用密码。", false);
    return;
  }
  chrome.storage.local.set({ config: cfg }, () => {
    currentConfig = cfg;
    setSyncStatus("正在连接…", true);
    chrome.runtime.sendMessage({ type: "sync-test" }, (res) => {
      if (!res) {
        setSyncStatus("后台没有响应，请刷新扩展后重试。", false);
        return;
      }
      setSyncStatus((res.ok ? "✓ " : "") + (res.message || (res.ok ? "连接成功" : "连接失败")), !!res.ok);
    });
  });
});

$("syncNow").addEventListener("click", () => {
  const cfg = readForm();
  if (!cfg.sync.enabled) {
    setSyncStatus("请先勾选「启用云端同步」。", false);
    return;
  }
  if (!cfg.sync.url || !cfg.sync.user || !cfg.sync.pass) {
    setSyncStatus("请先填写 WebDAV 地址、账号与应用密码。", false);
    return;
  }
  chrome.storage.local.set({ config: cfg }, () => {
    currentConfig = cfg;
    setSyncStatus("正在同步…", true);
    chrome.runtime.sendMessage({ type: "sync-now" }, (res) => {
      if (!res) {
        setSyncStatus("后台没有响应，请刷新扩展后重试。", false);
        return;
      }
      if (res.ok) {
        setSyncStatus("✓ 同步完成，本地共 " + res.count + " 条（新增 " + res.added + "）。", true);
      } else {
        setSyncStatus("同步失败：" + (res.message || "未知错误"), false);
      }
    });
  });
});

// ---------- 右侧悬浮导航 ----------
// 按设置页里的卡片自动生成条目（①～⑥ + 保存设置），点击平滑滚到对应块，滚动时高亮当前块
function buildSideNav() {
  const nav = $("sideNav");
  if (!nav) return;
  const cards = [...document.querySelectorAll(".wrap .card")];
  const items = cards.map((card, i) => {
    if (!card.id) card.id = "card-" + (i + 1);
    const h2 = card.querySelector("h2");
    return { id: card.id, label: h2 ? h2.textContent.trim() : "第 " + (i + 1) + " 块" };
  });
  if ($("saveBar")) items.push({ id: "saveBar", label: "保存设置" });

  // 让菜单顶部与第一张卡片的上边缘对齐（卡片位置随窗口宽度变化，resize 时重算）
  const alignNav = () => {
    const first = cards[0];
    if (!first) return;
    const top = Math.round(first.getBoundingClientRect().top + window.scrollY);
    nav.style.top = Math.max(8, top) + "px";
  };
  alignNav();

  nav.innerHTML = "";
  items.forEach((it) => {
    // 「保存设置」上面加一条分隔线，与菜单项分开
    if (it.id === "saveBar") {
      const sep = document.createElement("div");
      sep.className = "nav-sep";
      nav.appendChild(sep);
    }
    const a = document.createElement("a");
    a.href = "#" + it.id;
    a.textContent = it.label;
    a.title = it.label;
    a.dataset.target = it.id;
    if (it.id === "saveBar") a.classList.add("is-save");
    a.addEventListener("click", (ev) => {
      ev.preventDefault();
      const el = document.getElementById(it.id);
      if (!el) return;
      const top = el.getBoundingClientRect().top + window.scrollY - 16;
      window.scrollTo({ top, behavior: "smooth" });
      history.replaceState(null, "", "#" + it.id);
    });
    nav.appendChild(a);
  });

  const setActive = () => {
    const line = window.scrollY + window.innerHeight * 0.3;
    let cur = items[0] ? items[0].id : "";
    items.forEach((it) => {
      const el = document.getElementById(it.id);
      if (!el) return;
      const top = el.getBoundingClientRect().top + window.scrollY;
      if (top <= line) cur = it.id;
    });
    // 已经滚到底的极端情况，高亮最后一项
    if (window.innerHeight + window.scrollY >= document.body.scrollHeight - 24) {
      cur = items.length ? items[items.length - 1].id : cur;
    }
    nav.querySelectorAll("a").forEach((a) => {
      a.classList.toggle("active", a.dataset.target === cur);
    });
  };
  window.addEventListener("scroll", setActive, { passive: true });
  window.addEventListener("resize", () => {
    alignNav();
    setActive();
  });
  setActive();
}

document.addEventListener("DOMContentLoaded", () => {
  renderHlColors();
  buildSideNav();
  // 打开设置页先让后台把账号里的设置拉一次，再回填表单，避免显示的是旧值
  let loaded = false;
  const doLoad = () => {
    if (loaded) return;
    loaded = true;
    load();
  };
  try {
    chrome.runtime.sendMessage({ type: "settings-pull" }, () => doLoad());
  } catch (e) {
    doLoad();
  }
  setTimeout(doLoad, 2000); // 后台没响应时的兜底
});
