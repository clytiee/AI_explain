// options.js —— 划词AI释义 设置页逻辑

const PRESETS = {
  deepseek: { base: "https://api.deepseek.com", model: "deepseek-chat" },
  doubao: { base: "https://ark.cn-beijing.volces.com/api/v3", model: "" },
  openai: { base: "https://api.openai.com", model: "gpt-4o-mini" },
  moonshot: { base: "https://api.moonshot.cn", model: "moonshot-v1-8k" },
  custom: { base: "", model: "" },
};

const DEFAULT_PROMPT =
  "你是一位博学的中文释义助手。用户选中了网页上的一段文本，请用简体中文进行解释。\n" +
  "【输出格式要求，务必严格遵守】\n" +
  "1. 分板块输出，每个板块标题独占一行（如“逐词解释：”“整句翻译：”“语境说明：”），标题前后各留一个空行。\n" +
  "2. “逐词解释”用无序列表，每项一行，格式为“字：解释”。\n" +
  "3. 不同板块内容严禁合并到同一行；严禁把小节标题或整句翻译追加到“逐词解释”的某个列表项后面；整句翻译必须完整写在一个独立段落里，不要拆成多行。\n" +
  "4. 不要用 ``` 代码块把全文包起来。\n" +
  "【解释原则】若是外文，先给准确翻译再简要解释；若是文言文或单个汉字，考证其本字、造字原意与字形演变；若是专业术语或缩写，用通俗语言讲解。回答简洁，条理清楚。";

const $ = (id) => document.getElementById(id);

let currentConfig = {
  apiBaseUrl: "https://api.deepseek.com",
  apiKey: "",
  model: "deepseek-chat",
  temperature: 0.3,
  stream: true,
  autoExplain: true,
  maxLength: 500,
  systemPrompt: DEFAULT_PROMPT,
};

function load() {
  chrome.storage.local.get({ config: null }, (res) => {
    if (res.config) currentConfig = { ...currentConfig, ...res.config };
    $("apiBaseUrl").value = currentConfig.apiBaseUrl || "";
    $("model").value = currentConfig.model || "";
    $("apiKey").value = currentConfig.apiKey || "";
    $("temperature").value = currentConfig.temperature ?? 0.3;
    $("maxLength").value = currentConfig.maxLength ?? 500;
    $("autoExplain").checked = !!currentConfig.autoExplain;
    $("stream").checked = !!currentConfig.stream;
    $("systemPrompt").value = currentConfig.systemPrompt || DEFAULT_PROMPT;

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
    systemPrompt: $("systemPrompt").value,
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

$("test").addEventListener("click", async () => {
  const cfg = readForm();
  if (!cfg.apiKey) {
    setStatus("请先填写 API Key。", false);
    return;
  }
  const box = $("testBox");
  box.textContent = "请求中…";
  box.classList.add("show");
  setStatus("", true);

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
      setStatus("连接失败", false);
      return;
    }
    const data = await resp.json();
    const reply = data?.choices?.[0]?.message?.content || "(空响应)";
    box.textContent = reply;
    setStatus("连接成功 ✓ 已能调用该模型。", true);
  } catch (err) {
    box.textContent = "请求出错：" + String(err && err.message ? err.message : err);
    setStatus("连接失败", false);
  }
});

document.addEventListener("DOMContentLoaded", load);
