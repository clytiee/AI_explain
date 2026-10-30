// content.js —— 划词AI释义
// 监听文本选择 → 自动弹出浮层 → 通过 background 调用 AI API → 流式渲染释义。

(() => {
  if (window.__aiExplainLoaded) return;
  window.__aiExplainLoaded = true;

  const POPUP_ID = "ai-explain-popup";
  let config = { autoExplain: true, maxLength: 500, stream: true };
  let paused = false;             // 是否暂停划词（点击插件图标切换）
  let currentRange = null;        // 当前选中 Range，用于滚动后重定位
  let currentSignature = "";      // 去重标记
  let port = null;
  let rawAnswer = "";             // 累积的原文（markdown）
  let popupInteraction = false;   // 本次点击是否发生在浮层内部
  let selectionWasInPopup = false; // 点击发生前，浮层内是否选中了一段文本（用于保护浮层内选词）
  let userW = null;               // 用户手动拉宽后的宽度（跨重建保留）
  let userH = null;               // 用户手动拉高后的高度
  let userMoved = false;          // 用户手动拖走浮层后为 true（滚动/重选不再弹回）
  let statusEl, bodyEl, resultEl, selEl, closeBtn, copyBtn, settingsBtn, retryBtn, header;

  chrome.storage.local.get({ config: null, paused: false }, (res) => {
    if (res.config) config = { ...config, ...res.config };
    paused = !!res.paused;
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes.config?.newValue) config = { ...config, ...changes.config.newValue };
    if (changes.paused !== undefined) {
      paused = !!changes.paused.newValue;
      if (paused) hidePopup(); // 暂停时收起当前浮层
    }
  });

  // ---------- 选择检测 ----------
  function getSelectionInfo() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;
    const text = sel.toString().trim();
    if (!text) return null;
    const range = sel.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return null;
    return { text, range };
  }

  function isInsidePopup(node) {
    if (!node || !node.closest) return false;
    return !!node.closest("#" + POPUP_ID);
  }

  // 是否在浮层内实际选中了一段文本（塌陷的选择不算）
  function selectionInPopup() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return false;
    return isInsidePopup(sel.anchorNode) || isInsidePopup(sel.focusNode);
  }

  document.addEventListener(
    "mousedown",
    (e) => {
      popupInteraction = isInsidePopup(e.target);
      // 记录点击发生前，浮层内是否有选中的文本
      selectionWasInPopup = selectionInPopup();
    },
    true
  );

  // 浮层的关闭统一由 mouseup 决定，避免 selectionchange 的事件时序造成误关
  document.addEventListener(
    "mouseup",
    (e) => {
      if (isInsidePopup(e.target)) return; // 浮层内点击：不关闭
      if (selectionWasInPopup) {
        // 点击前浮层内正选中文本：本次点击不关闭、不重开（保护选词/复制）
        selectionWasInPopup = false;
        return;
      }
      // 普通点击页面：关闭旧浮层，并可能为新选择重新弹出
      hidePopup();
      setTimeout(handleSelection, 0);
    },
    true
  );

  document.addEventListener("keyup", (e) => {
    if (e.key === "Escape") hidePopup();
    if (isInsidePopup(e.target)) return;
    if (window.getSelection && !window.getSelection().isCollapsed) {
      setTimeout(handleSelection, 0);
    }
  });

  // 滚动时跟随选中区域重新定位
  document.addEventListener(
    "scroll",
    () => {
      if (isVisible() && currentRange && !userMoved) {
        reposition(currentRange.getBoundingClientRect());
      }
    },
    { capture: true, passive: true }
  );

  // ---------- 主流程 ----------
  function handleSelection() {
    if (paused) return; // 暂停时不再触发划词
    const info = getSelectionInfo();
    if (!info) return;

    if (info.text.length > (config.maxLength || 500)) {
      // 过长时仍弹出，但截断发送，避免无谓消耗
      info.text = info.text.slice(0, config.maxLength);
    }

    const sig = info.text.slice(0, 80);
    const rect = info.range.getBoundingClientRect();

    if (sig === currentSignature && isVisible()) {
      if (!userMoved) reposition(rect); // 手动拖走过就不再弹回选中处
      return;
    }
    currentSignature = sig;
    currentRange = info.range;
    openPopup(info.text, rect);
  }

  function openPopup(text, rect) {
    ensurePopup();
    userMoved = false; // 换选新文本时重新锚定到选中处
    selEl.textContent = "「" + text + "」";
    selEl.title = text;
    resultEl.innerHTML = "";
    rawAnswer = "";
    setStatus("loading", "正在解析…");
    resultEl.hidden = true;
    retryBtn.hidden = true;
    bodyEl.style.display = "";
    reposition(rect);

    if (config.autoExplain) {
      startExplain(text);
    } else {
      setStatus("idle", "已选中，点击「解释」发起释义");
      retryBtn.hidden = false;
      retryBtn.textContent = "解释";
    }
  }

  function ensurePopup() {
    if (document.getElementById(POPUP_ID)) return;

    const root = document.createElement("div");
    root.id = POPUP_ID;
    root.className = "aie-popup";
    root.innerHTML =
      '<div class="aie-header">' +
      '<span class="aie-label">划词释义</span>' +
      '<div class="aie-actions">' +
      '<button class="aie-btn aie-copy" title="复制释义">复制</button>' +
      '<button class="aie-btn aie-settings" title="设置">设置</button>' +
      '<button class="aie-btn aie-close" title="关闭">×</button>' +
      "</div>" +
      "</div>" +
      '<div class="aie-seltext"></div>' +
      '<div class="aie-body">' +
      '<div class="aie-status"></div>' +
      '<div class="aie-result"></div>' +
      '<div class="aie-retry-row"><button class="aie-btn aie-retry">重新解释</button></div>' +
      "</div>" +
      '<div class="aie-grip aie-grip-w" title="单独拉宽"></div>' +
      '<div class="aie-grip aie-grip-h" title="单独拉高"></div>' +
      '<div class="aie-grip" title="同时拉宽拉高"></div>';

    document.documentElement.appendChild(root);

    closeBtn = root.querySelector(".aie-close");
    copyBtn = root.querySelector(".aie-copy");
    settingsBtn = root.querySelector(".aie-settings");
    retryBtn = root.querySelector(".aie-retry");
    selEl = root.querySelector(".aie-seltext");
    statusEl = root.querySelector(".aie-status");
    bodyEl = root.querySelector(".aie-body");
    resultEl = root.querySelector(".aie-result");
    header = root.querySelector(".aie-header");

    // 拖动标题栏移动浮层位置（按钮区域除外）
    header.addEventListener("pointerdown", (e) => {
      if (e.target.closest(".aie-btn")) return;
      e.preventDefault();
      e.stopPropagation();
      const startX = e.clientX;
      const startY = e.clientY;
      const r = root.getBoundingClientRect();
      const startL = r.left;
      const startT = r.top;

      const onMove = (ev) => {
        let left = startL + (ev.clientX - startX);
        let top = startT + (ev.clientY - startY);
        left = Math.min(Math.max(left, 4), window.innerWidth - root.offsetWidth - 4);
        top = Math.min(Math.max(top, 4), window.innerHeight - 4);
        root.style.left = left + "px";
        root.style.top = top + "px";
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        userMoved = true;
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    });

    closeBtn.addEventListener("click", hidePopup);
    copyBtn.addEventListener("click", copyAnswer);
    settingsBtn.addEventListener("click", openSettings);
    retryBtn.addEventListener("click", () => {
      const sel = selEl.textContent.replace(/^「|」$/g, "").trim();
      if (sel) startExplain(sel);
    });

    // 拖拽调整大小：axes 指定允许变化的轴（w=宽, h=高）
    const startResize = (e, axes) => {
      e.preventDefault();
      e.stopPropagation();
      const startX = e.clientX;
      const startY = e.clientY;
      const startW = root.offsetWidth;
      const startH = root.offsetHeight;
      const rect = root.getBoundingClientRect();
      const maxW = Math.max(240, window.innerWidth - rect.left - 8);
      const maxH = Math.max(160, window.innerHeight - rect.top - 8);

      const onMove = (ev) => {
        if (axes.w) {
          let w = startW + (ev.clientX - startX);
          w = Math.min(Math.max(w, 240), maxW);
          root.style.width = w + "px";
        }
        if (axes.h) {
          let h = startH + (ev.clientY - startY);
          h = Math.min(Math.max(h, 160), maxH);
          root.style.height = h + "px";
          if (bodyEl) bodyEl.style.maxHeight = "none"; // 拉高后允许内容区伸展
        }
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        userW = root.offsetWidth;
        userH = root.offsetHeight;
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    };

    // 右边缘手柄：单独拉宽；底边手柄：单独拉高；右下角手柄：同时拉宽拉高
    root.querySelector(".aie-grip-w").addEventListener("pointerdown", (e) => startResize(e, { w: true }));
    root.querySelector(".aie-grip-h").addEventListener("pointerdown", (e) => startResize(e, { h: true }));
    root.querySelector(".aie-grip").addEventListener("pointerdown", (e) => startResize(e, { w: true, h: true }));

    // 单独的拉宽/拉高手柄：鼠标靠近右边缘显示拉宽、靠近下边缘显示拉高
    const gripW = root.querySelector(".aie-grip-w");
    const gripH = root.querySelector(".aie-grip-h");
    const edgeZone = 24; // 边缘判定阈值（px）
    root.addEventListener("pointermove", (e) => {
      const r = root.getBoundingClientRect();
      gripW.style.opacity = r.right - e.clientX <= edgeZone ? "1" : "0";
      gripH.style.opacity = r.bottom - e.clientY <= edgeZone ? "1" : "0";
    });
    root.addEventListener("pointerleave", () => {
      gripW.style.opacity = "0";
      gripH.style.opacity = "0";
    });

    // 阻止 popup 内的选择冒泡触发展开/关闭
    root.addEventListener("mouseup", (e) => e.stopPropagation());
    root.addEventListener("mousedown", (e) => e.stopPropagation());
  }

  function reposition(rect) {
    if (!rect) return;
    const root = document.getElementById(POPUP_ID);
    if (!root) return;

    // 尺寸：优先沿用用户手动拉过的宽/高，否则用默认
    if (userW) {
      root.style.width = userW + "px";
    } else {
      root.style.width = Math.min(380, window.innerWidth - 16) + "px";
    }
    if (userH) {
      root.style.height = userH + "px";
      if (bodyEl) bodyEl.style.maxHeight = "none";
    } else {
      root.style.height = "";
      if (bodyEl) bodyEl.style.maxHeight = "";
    }

    const popupW = userW || Math.min(380, window.innerWidth - 16);
    // 用浮层实际高度定位，避免拉高后下沿盖住所划文字
    const estH = root.offsetHeight || 220;

    // 水平：优先错开到所划文字右侧，右侧放不下则放左侧，
    // 两侧都放不下才回退到左上对齐，避免浮层盖住文字
    const vw = window.innerWidth;
    let left;
    if (rect.right + popupW + 8 <= vw - 8) {
      left = rect.right + 8;
    } else if (rect.left - popupW - 8 >= 8) {
      left = rect.left - popupW - 8;
    } else {
      left = rect.left;
      if (left + popupW > vw - 8) left = vw - popupW - 8;
      if (left < 8) left = 8;
    }

    // 垂直：让浮层中“所选文本”区域的虚线分隔对齐所选文字的上边缘；
    // 上方放不下时才移到文字下方
    const selBottom = selEl ? selEl.offsetTop + selEl.offsetHeight : 40;
    let top = rect.top - selBottom;
    if (top < 8) top = rect.bottom + 10; // 上方放不下，改到文字下方
    if (top + estH > window.innerHeight - 8) top = Math.max(8, window.innerHeight - estH - 8);

    root.style.left = left + "px";
    root.style.top = top + "px";
  }

  function isVisible() {
    const root = document.getElementById(POPUP_ID);
    return !!root && root.style.display !== "none" && document.contains(root);
  }

  function hidePopup() {
    const root = document.getElementById(POPUP_ID);
    if (root) root.remove();
    if (port) {
      try {
        port.disconnect();
      } catch {}
      port = null;
    }
    currentRange = null;
    currentSignature = "";
    rawAnswer = "";
  }

  // ---------- AI 调用 ----------
  function buildContext(range) {
    if (!range) return "";
    try {
      const before = 180, after = 120;
      let text = range.startContainer.parentElement?.textContent || "";
      const selTxt = range.toString();
      const idx = text.indexOf(selTxt);
      if (idx < 0) return "";
      const start = Math.max(0, idx - before);
      const end = Math.min(text.length, idx + selTxt.length + after);
      return text.slice(start, end).replace(/\s+/g, " ").trim();
    } catch {
      return "";
    }
  }

  function startExplain(text) {
    abortPort();
    rawAnswer = "";
    resultEl.innerHTML = "";
    resultEl.hidden = true;
    retryBtn.hidden = true;
    setStatus("loading", "正在解析…");

    port = chrome.runtime.connect({ name: "ai-explain" });
    port.onMessage.addListener(onPortMessage);
    port.postMessage({
      type: "explain",
      text,
      context: buildContext(currentRange),
    });
  }

  function onPortMessage(msg) {
    if (!msg) return;
    if (msg.type === "chunk") {
      rawAnswer += msg.text;
      render();
    } else if (msg.type === "result") {
      rawAnswer = msg.text;
      render();
      finish();
    } else if (msg.type === "done") {
      finish();
    } else if (msg.type === "error") {
      statusEl.hidden = false;
      setStatus("error", msg.message || "出错了");
      if (msg.code === "no_key") {
        retryBtn.hidden = false;
        retryBtn.textContent = "去设置 API Key";
      } else {
        retryBtn.hidden = false;
        retryBtn.textContent = "重试";
      }
    }
  }

  function finish() {
    setStatus("idle", "");
    statusEl.hidden = true;
    if (rawAnswer.trim()) resultEl.hidden = false;
    // 内容确定后按实际高度重新定位一次，避免浮层因加载时高度偏小、
    // 而在滚动时才按新高度突然跳位（上方放不下切到下方）
    if (currentRange && !userMoved) reposition(currentRange.getBoundingClientRect());
  }

  function render() {
    resultEl.hidden = false;
    statusEl.hidden = true;
    resultEl.innerHTML = renderMarkdown(rawAnswer);
  }

  function setStatus(kind, text) {
    statusEl.className = "aie-status aie-status-" + kind;
    statusEl.textContent = text;
  }

  function copyAnswer() {
    const text = rawAnswer || selEl.textContent.replace(/^「|」$/g, "");
    const flash = () => {
      copyBtn.textContent = "已复制";
      setTimeout(() => (copyBtn.textContent = "复制"), 1200);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(flash).catch(() => legacyCopy(text) && flash());
    } else {
      legacyCopy(text) && flash();
    }
  }

  function legacyCopy(text) {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }

  function abortPort() {
    if (port) {
      try {
        port.disconnect();
      } catch {}
      port = null;
    }
  }

  // 打开设置页：content script 无权直接调用 chrome.runtime.openOptionsPage，
  // 且 window.open 打开扩展页会被 Edge 拦截（ERR_BLOCKED_BY_CLIENT）。
  // 正确做法是发消息给后台（有权限）调用 openOptionsPage()。
  function openSettings() {
    try {
      chrome.runtime.sendMessage({ type: "open-options" });
    } catch (e) {
      // 后台不可达时的兜底
      chrome.runtime.openOptionsPage();
    }
  }

  // 右键菜单触达：把选中文本重新弹出
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg && msg.type === "explain-selection") handleSelection();
  });

  // ---------- 极简 markdown → HTML ----------
  function esc(s) {
    return s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function inline(s) {
    s = s.replace(/`([^`]+)`/g, (_, c) => "<code>" + c + "</code>");
    s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    s = s.replace(/\*([^*]+)\*/g, "<em>$1</em>");
    s = s.replace(
      /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g,
      '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>'
    );
    return s;
  }

  function renderMarkdown(md) {
    const lines = md.split(/\r?\n/);
    const html = [];
    let inCode = false;
    let codeBuf = [];
    let list = null; // 'ul' | 'ol' | null

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
})();
