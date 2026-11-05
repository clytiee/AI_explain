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
];
const HL_DEFAULT_COLOR = "#fef08a";

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
};

// 渲染常用荧光笔色一排
function renderHlColors() {
  const wrap = $("hlColors");
  wrap.innerHTML = "";
  HL_PRESET_COLORS.forEach((color) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "hl-swatch";
    btn.style.background = color;
    btn.title = color;
    btn.dataset.color = color;
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

function load() {
  chrome.storage.local.get({ config: null, paused: false, highlightMode: false }, (res) => {
    if (res.config) currentConfig = { ...currentConfig, ...res.config };
    $("pausedSwitch").checked = !!res.paused;
    $("highlightSwitch").checked = !!res.highlightMode;
    $("apiBaseUrl").value = currentConfig.apiBaseUrl || "";
    $("model").value = currentConfig.model || "";
    $("apiKey").value = currentConfig.apiKey || "";
    $("temperature").value = currentConfig.temperature ?? 0.3;
    $("maxLength").value = currentConfig.maxLength ?? 500;
    $("autoExplain").checked = !!currentConfig.autoExplain;
    $("stream").checked = !!currentConfig.stream;
    $("autoSaveHistory").checked = currentConfig.autoSaveHistory !== false;
    $("historyMax").value = currentConfig.historyMax ?? 1000;
    $("systemPrompt").value = currentConfig.systemPrompt || DEFAULT_PROMPT;
    const hlColor = currentConfig.highlightColor || HL_DEFAULT_COLOR;
    $("highlightColor").value = hlColor;
    markActiveSwatch(hlColor);

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
    systemPrompt: $("systemPrompt").value,
    highlightColor: $("highlightColor").value,
  };
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
  chrome.storage.local.set({ config: cfg }, () => {
    currentConfig = cfg;
    setStatus("已保存 ✓ 现在去网页上选中文字试试吧。", true);
  });
});

$("resetPrompt").addEventListener("click", () => {
  $("systemPrompt").value = DEFAULT_PROMPT;
  setStatus("已恢复默认提示词，记得点「保存设置」生效。", true);
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

document.addEventListener("DOMContentLoaded", () => {
  renderHlColors();
  load();
});
