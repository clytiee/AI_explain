// background.js —— 划词AI释义（MV3 Service Worker）
// 负责所有对外 API 请求（content script 无页面跨域问题，由 SW 代为转发并流式回传）。

const DEFAULT_CONFIG = {
  apiBaseUrl: "https://api.deepseek.com",
  apiKey: "",
  model: "deepseek-chat",
  temperature: 0.3,
  stream: true,
  autoExplain: true,
  maxLength: 500,
  systemPrompt:
    "你是一位博学的中文释义助手。用户选中了网页上的一段文本，请用简体中文进行解释。\n" +
    "【输出格式要求，务必严格遵守】\n" +
    "1. 分板块输出，每个板块标题独占一行（如“逐词解释：”“整句翻译：”“语境说明：”），标题前后各留一个空行。\n" +
    "2. “逐词解释”用无序列表，每项一行，格式为“字：解释”。\n" +
    "3. 不同板块内容严禁合并到同一行；严禁把小节标题或整句翻译追加到“逐词解释”的某个列表项后面；整句翻译必须完整写在一个独立段落里，不要拆成多行。\n" +
    "4. 不要用 ``` 代码块把全文包起来。\n" +
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
  if (area === "local" && changes.config) configCache = null;
});

function buildUrl(base) {
  return base.replace(/\/+$/, "") + "/chat/completions";
}

function buildBody(cfg, text, context) {
  const messages = [];
  if (cfg.systemPrompt) messages.push({ role: "system", content: cfg.systemPrompt });

  let userContent = text;
  if (context && context.trim()) {
    userContent = "【所选文本】\n" + text + "\n\n【所在页面上下文】\n" + context.trim();
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

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === "open-options") {
    chrome.runtime.openOptionsPage();
  }
});

// 右键菜单：把选中文本快速复制为「问句」发送（备用入口）
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: "ai-explain-copy",
      title: "复制选中文本到划词AI释义",
      contexts: ["selection"],
    });
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== "ai-explain-copy" || !tab?.id) return;
  await chrome.tabs.sendMessage(tab.id, { type: "explain-selection" }).catch(() => {});
});
