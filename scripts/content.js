// content.js —— 划词AI释义
// 监听文本选择 → 自动弹出浮层 → 通过 background 调用 AI API → 流式渲染释义。

(() => {
  if (window.__aiExplainLoaded) return;
  window.__aiExplainLoaded = true;

  const POPUP_ID = "ai-explain-popup";
  const TAG_MENU_ID = "ai-explain-tagmenu";
  let config = { autoExplain: true, autoSaveHistory: true, maxLength: 500, stream: true };
  let paused = false;             // 是否暂停划词（点击插件图标切换）
  let extractMode = false;        // 摘录模式：划词仅存为历史摘录，不释义（图标右键切换）
  let highlightMode = false;      // 高亮划词：划词/摘录用荧光笔在文字下半部分划线（图标右键切换）
  let currentRange = null;        // 当前选中 Range，用于滚动后重定位
  let currentSignature = "";      // 去重标记
  let port = null;
  let rawAnswer = "";             // 累积的原文（markdown）
  let popupInteraction = false;   // 本次点击是否发生在浮层内部
  let selectionWasInPopup = false; // 点击发生前，浮层内是否选中了一段文本（用于保护浮层内选词）
  let userW = null;               // 用户手动拉宽后的宽度（跨重建保留）
  let userH = null;               // 用户手动拉高后的高度
  let userMoved = false;          // 用户手动拖走浮层后为 true（滚动/重选不再弹回）
  let lastSelectedText = "";      // 最近一次选中的文本（供复制/重试/汉典链接使用）
  let lastContext = "";           // 最近一次选中处的上下文（高亮包裹会使 range 失效，需提前取出）
  let hoverPopup = false;         // 当前浮层是否为「悬停划线读历史」弹出的
  let hoverShowTimer = null;      // 悬停显示延迟计时器
  let hoverHideTimer = null;      // 悬停离开后延迟关闭计时器
  let mouseDown = false;          // 是否正在按下鼠标（选择文字过程中不触发悬停浮层）
  let pinned = false;             // 浮层是否被钉住（钉住后不自动消失）
  let statusEl, bodyEl, resultEl, selEl, closeBtn, copyBtn, historyBtn, warnEl, settingsBtn, retryBtn, header;
  let pinBtn;
  let promptSelect, selTextEl, histTag;  // 提示词下拉（原文行最右）+ 原文文字节点 + 「历史释义」标签
  let curTagBtn, tagMenu; // 标题栏的「当前标签」chip 与它的下拉
  let hoverEntry = null; // 悬停看历史释义时取到的那条记录（改标签要改它，而不是全局当前标签）
  let savedThisExplain = false; // 本次释义是否已写入历史（防止 result+done 重复保存）

  chrome.storage.local.get({ config: null, paused: false, extractMode: false, highlightMode: false }, (res) => {
    if (res.config) config = { ...config, ...res.config };
    paused = !!res.paused;
    extractMode = !!res.extractMode;
    highlightMode = !!res.highlightMode;
    if (highlightMode) restoreHighlights(); // 页面加载时恢复本页持久化的荧光笔划线
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes.config?.newValue) {
      config = { ...config, ...changes.config.newValue };
      syncHighlightColors(); // 荧光笔颜色变化时，同步已划线的颜色
      syncPromptBar(); // 设置页改了提示词/切换了提示词时，刷新浮层下拉
      updateCurTagChip(); // 别处（设置页或另一台电脑）改了当前标签，chip 跟着变
    }
    if (changes.paused !== undefined) {
      paused = !!changes.paused.newValue;
      if (paused) hidePopup(); // 暂停时收起当前浮层
    }
    if (changes.extractMode !== undefined) {
      extractMode = !!changes.extractMode.newValue;
      // 摘录模式状态变化时，若浮层在等待释义（loading），关闭重开以应用新模式
      if (statusEl && statusEl.textContent === "正在解析…") hidePopup();
    }
    if (changes.highlightMode !== undefined) {
      highlightMode = !!changes.highlightMode.newValue;
      if (!highlightMode) {
        clearHighlights(); // 关闭时清除本页所有荧光笔划线
        clearPageHighlightRecords(); // 并删除本页的持久化记录，刷新后不再显示
        if (hoverPopup) hidePopup(); // 关闭时收起悬停浮层
      } else {
        highlightExistingSelection(); // 开启时立即补划页面上已有的选区
        restoreHighlights(); // 并恢复本页持久化的划线
      }
    }
  });

  // ---------- 选择检测 ----------
  // 浏览器自带的 Selection.toString() 会把块级换行压成空格，
  // 多行选中（诗词、列表、代码块）贴到浮层/历史里就串成一行了。
  // 这里遍历克隆出来的 DOM，块级元素与 <br> 都还原成换行。
  const BLOCK_TAGS =
    /^(P|DIV|LI|UL|OL|DL|DT|DD|H1|H2|H3|H4|H5|H6|SECTION|ARTICLE|BLOCKQUOTE|PRE|FIGURE|TABLE|TR|HEADER|FOOTER|ASIDE|NAV|MAIN|FORM|FIELDSET|CAPTION)$/;
  function nodeTextWithBreaks(node, preformatted) {
    if (!node) return "";
    if (node.nodeType === 3) {
      const s = node.nodeValue || "";
      // 普通文本里的连续空白按浏览器习惯压成一个空格；<pre> 里原样保留
      return preformatted ? s : s.replace(/[ \t\r\n\f]+/g, " ");
    }
    if (node.nodeType !== 1) return "";
    const tag = (node.tagName || "").toUpperCase();
    if (tag === "BR") return "\n";
    const inner = Array.from(node.childNodes)
      .map((c) => nodeTextWithBreaks(c, preformatted || tag === "PRE"))
      .join("");
    if (tag === "TD" || tag === "TH") return " " + inner;
    if (BLOCK_TAGS.test(tag)) return "\n" + inner + "\n";
    return inner;
  }

  function cleanSelectedText(raw) {
    return String(raw || "")
      .replace(/\u00a0/g, " ")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n[ \t]+/g, "\n")
      .replace(/[ \t]{2,}/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .replace(/\s+$/, "")
      .replace(/^\s+/, "");
  }

  function selectionText(sel) {
    if (!sel || sel.rangeCount === 0) return "";
    try {
      const frag = sel.getRangeAt(0).cloneContents();
      const box = document.createElement("div");
      box.appendChild(frag);
      const raw = nodeTextWithBreaks(box, false);
      const cleaned = cleanSelectedText(raw);
      // 万一遍历出来是空的（少数特殊节点），退回浏览器实现
      return cleaned || sel.toString().trim();
    } catch {
      return sel.toString().trim();
    }
  }

  function getSelectionInfo() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;
    const text = selectionText(sel);
    if (!text) return null;
    const range = sel.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return null;
    return { text, range };
  }

  function isInsidePopup(node) {
    if (!node || !node.closest) return false;
    // 标签下拉挂在 <html> 下，但视作浮层的一部分，否则点它会把浮层关掉
    return !!node.closest("#" + POPUP_ID) || !!node.closest("#" + TAG_MENU_ID);
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
      // 普通点击页面：关闭旧浮层（钉住时保留），并可能为新选择重新弹出
      if (!pinned) hidePopup();
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
      closeTagMenu(); // 菜单按视口坐标定位，页面一滚就收起，避免飘走
      if (isVisible() && currentRange && !userMoved) {
        reposition(currentRange.getBoundingClientRect());
      }
    },
    { capture: true, passive: true }
  );

  // ---------- 悬停划线：直接显示历史释义（不调用 AI） ----------
  document.addEventListener("mousedown", () => { mouseDown = true; }, true);
  document.addEventListener("mouseup", () => { mouseDown = false; }, true);

  document.addEventListener("mouseover", (e) => {
    if (!highlightMode) return;
    const t = e.target;
    if (!t || !t.closest) return;
    if (isInsidePopup(t)) {
      clearTimeout(hoverHideTimer); // 移入浮层：不关闭，方便阅读/复制
      return;
    }
    const hl = t.closest(".aie-hl");
    if (hl) {
      if (mouseDown) return; // 正在拖选文字时不弹
      clearTimeout(hoverHideTimer);
      clearTimeout(hoverShowTimer);
      hoverShowTimer = setTimeout(() => showHoverPopup(hl), 150); // 轻微防抖
    } else if (hoverPopup && !pinned) {
      // 移出划线且不在浮层内：延迟关闭，给移动到浮层留时间（钉住时不自动关）
      clearTimeout(hoverShowTimer);
      clearTimeout(hoverHideTimer);
      hoverHideTimer = setTimeout(() => {
        // 标签菜单开着（可能在给这条记录改标签）就别关浮层
        if (tagMenu && !tagMenu.hidden) return;
        if (hoverPopup && !pinned && isVisible()) hidePopup();
      }, 250);
    }
  });

  // 悬停弹出的浮层：直接读取历史记录里这条划词的释义，不调 AI
  function showHoverPopup(hlSpan) {
    // 普通划词释义浮层正在显示时不劫持：划词后 applyHighlight 包裹选区会让浏览器
    // 对新出现的 .aie-hl 触发一次 mouseover，若不拦截会把刚打开的释义浮层抢走，
    // 导致 savedThisExplain 被置 true（历史不写入）、AI 流被覆盖/掐断
    if (!hoverPopup && isVisible()) return;
    const text = (hlSpan.textContent || "").trim();
    if (!text) return;
    hoverPopup = true;
    setPinned(false); // 新悬停弹出的浮层默认不钉住
    ensurePopup();
    abortPort(); // 停掉可能仍在进行的 AI 流，避免旧结果写进悬停浮层
    syncPromptBar(); // 悬停模式下会隐藏提示词切换条
    setHistoryTag(false); // 每次悬停先收起标签，查到释义后再显示
    hoverEntry = null; // 查到记录后填上，chip 显示的是这条记录自己的标签
    updateCurTagChip();
    closeTagMenu();
    userMoved = false;
    savedThisExplain = true; // 悬停不产生新释义，禁止写入历史
    lastSelectedText = text;
    // 标题里只放一行摘要：多行选中把换行压成空格再截断
    const flat = String(text).replace(/\s*\n+\s*/g, " ");
    selTextEl.textContent = flat.length > 40 ? "「" + flat.slice(0, 40) + "…」" : "「" + flat + "」";
    selTextEl.title = text;
    resultEl.innerHTML = "";
    rawAnswer = "";
    resultEl.hidden = true;
    retryBtn.hidden = true;
    bodyEl.style.display = "";
    setStatus("loading", "正在查找历史释义…");
    reposition(hlSpan.getBoundingClientRect());

    try {
      chrome.runtime.sendMessage(
        { type: "highlight-lookup", pageUrl: location.href, text },
        (resp) => {
          if (!hoverPopup || !isVisible()) return; // 浮层已被关闭/替换
          if (resp && resp.ok && resp.entry) {
            hoverEntry = resp.entry; // 记住这条记录，chip 显示/修改它的标签
            updateCurTagChip();
            if (resp.entry.answer && String(resp.entry.answer).trim()) {
              rawAnswer = resp.entry.answer;
              render();
              // 「历史释义」作为标签挂在原文行最右，不再单独占标题行
              setStatus("idle", "");
              statusEl.hidden = true;
              setHistoryTag(true);
            } else {
              setStatus("idle", "摘录 · 该划词未释义");
            }
          } else {
            setStatus("idle", "未在历史中找到这条划词的释义");
          }
        }
      );
    } catch (e) {
      setStatus("error", "查找历史释义失败");
    }
  }

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
    openPopup(info.text, rect, info.range);
  }

  // 转义 HTML 特殊字符，防止所选文本注入破坏浮层
  function escHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    })[c]);
  }

  function openPopup(text, rect, range) {
    ensurePopup();
    hoverPopup = false; // 普通划词流程接管浮层
    setPinned(false); // 新划词弹出的浮层默认不钉住
    clearTimeout(hoverShowTimer);
    clearTimeout(hoverHideTimer);
    userMoved = false; // 换选新文本时重新锚定到选中处
    savedThisExplain = false; // 新一轮释义可重新写入历史
    lastSelectedText = text;
    lastContext = range ? buildContext(range) : "";
    // 单个汉字时，在字右侧附带汉典链接
    if (text.length === 1) {
      selTextEl.innerHTML =
        "「" + escHtml(text) + "」" +
        '<a class="aie-zdic" href="https://zdic.net/hans/' +
        encodeURIComponent(text) +
        '" target="_blank" rel="noopener" title="汉典：' + escHtml(text) + '">汉典</a>';
    } else {
      selTextEl.textContent = "「" + text + "」";
    }
    selTextEl.title = text;
    resultEl.innerHTML = "";
    rawAnswer = "";
    setStatus("loading", "正在解析…");
    resultEl.hidden = true;
    retryBtn.hidden = true;
    bodyEl.style.display = "";
    syncPromptBar(); // 显示提示词切换条（普通划词流程）
    setHistoryTag(false);
    hoverEntry = null; // 普通划词：chip 回到“当前标签”语义
    if (curTagBtn) curTagBtn.hidden = false;
    updateCurTagChip(); // 标题栏显示当前的打标签状态
    closeTagMenu();
    reposition(rect);

    // 高亮划词：用荧光笔在选区文字下半部分划线（划词与摘录均生效）
    if (highlightMode && range) applyHighlight(range);

    if (extractMode) {
      // 摘录模式：只把选中文本存为历史摘录，不调用 AI 释义
      saveExtract(text);
      setStatus("idle", "摘录模式：已摘录，未释义");
      retryBtn.hidden = true;
    } else if (config.autoExplain) {
      startExplain(text);
    } else {
      setStatus("idle", "已选中，点击「解释」发起释义");
      retryBtn.hidden = false;
      retryBtn.textContent = "解释";
      retryBtn.dataset.action = "retry";
    }
    checkHistoryWarn(); // 历史将满时，在标题提示去导出备份
  }

  // 摘录模式：把选中文本保存为一条历史摘录记录（不释义）
  function saveExtract(text) {
    if (savedThisExplain) return;
    if (!text || !String(text).trim()) return;
    savedThisExplain = true;
    chrome.runtime
      .sendMessage({
        type: "history-save",
        text,
        answer: "",
        context: "",
        pageUrl: location.href,
        pageTitle: document.title,
        extract: true,
      })
      .catch(() => {});
  }

  // ---------- 荧光笔高亮（高亮划词模式） ----------
  // 把选区内容包裹进 <span class="aie-hl">，CSS 用渐变在文字下半部分画出荧光笔线
  function applyHighlight(range) {
    try {
      const popup = document.getElementById(POPUP_ID);
      if (popup && range.intersectsNode(popup)) return; // 不高亮浮层内部
      const startEl = range.startContainer.parentElement;
      if (startEl && startEl.closest && startEl.closest(".aie-hl")) return; // 已划过线的不重复包
      const span = makeHlSpan(config.highlightColor);
      span.appendChild(range.extractContents());
      range.insertNode(span);
      // 原节点被替换后 range 失效（rect 变为 0），停止滚动跟随，避免浮层跳位
      currentRange = null;
      // 持久化划线内容，刷新页面后自动恢复
      saveHighlightRecord(span.textContent);
    } catch (e) {
      // 跨节点等异常选区：跳过高亮，不影响释义流程
    }
  }

  function makeHlSpan(color) {
    const span = document.createElement("span");
    span.className = "aie-hl";
    span.style.setProperty("--aie-hl", color || config.highlightColor || "#fef08a");
    return span;
  }

  // ---------- 荧光笔持久化（按页面 URL 存储划线文本，刷新后检索原文重新包裹） ----------
  function pageKey() {
    return location.origin + location.pathname + location.search;
  }

  const HL_PAGES_MAX = 200; // 最多保留最近 200 个页面的划线
  const HL_ITEMS_MAX = 500; // 每页最多 500 条划线

  function saveHighlightRecord(text) {
    if (!text || !text.trim()) return;
    try {
      chrome.storage.local.get({ highlights: {} }, (res) => {
        const all = res.highlights;
        const key = pageKey();
        const page = all[key] && Array.isArray(all[key].items) ? all[key] : { t: 0, items: [] };
        if (page.items.some((it) => it && it.text === text)) return; // 去重
        page.items.push({ text });
        page.items = page.items.slice(-HL_ITEMS_MAX);
        page.t = Date.now();
        all[key] = page;
        // 超出页面数上限时，删掉最久未更新的页面
        const keys = Object.keys(all);
        if (keys.length > HL_PAGES_MAX) {
          keys
            .sort((a, b) => (all[a] && all[a].t ? all[a].t : 0) - (all[b] && all[b].t ? all[b].t : 0))
            .slice(0, keys.length - HL_PAGES_MAX)
            .forEach((k) => delete all[k]);
        }
        chrome.storage.local.set({ highlights: all });
      });
    } catch (e) {
      /* 存储失败不影响划线显示 */
    }
  }

  // 删除本页的持久化划线记录（关闭高亮划词时一并清除）
  function clearPageHighlightRecords() {
    try {
      chrome.storage.local.get({ highlights: {} }, (res) => {
        const all = res.highlights;
        if (all[pageKey()]) {
          delete all[pageKey()];
          chrome.storage.local.set({ highlights: all });
        }
      });
    } catch (e) {}
  }

  // 页面加载（或重新开启）时，恢复荧光笔划线：
  // ① 本功能保存的划线记录；② 历史记录里本页的划词与摘录原文（以前的记录同样生效）
  function restoreHighlights() {
    const color = config.highlightColor || "#fef08a";
    try {
      chrome.storage.local.get({ highlights: {} }, (res) => {
        const page = res.highlights[pageKey()];
        const items = page && Array.isArray(page.items) ? page.items : [];
        for (const it of items) {
          if (it && it.text) wrapFirstMatch(it.text, color);
        }
        // 历史记录（划词释义 + 摘录）里本页的原文本，同样补上荧光笔
        try {
          chrome.runtime.sendMessage({ type: "highlight-history", pageUrl: location.href }, (resp) => {
            if (resp && resp.ok && Array.isArray(resp.texts)) {
              for (const t of resp.texts) wrapFirstMatch(t, color);
            }
          });
        } catch (e) {}
      });
    } catch (e) {}
  }

  // 收集正文文本节点（跳过脚本/样式/浮层/已划线部分）
  function collectTextNodes() {
    const root = document.body || document.documentElement;
    if (!root) return [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(n) {
        if (!n.nodeValue || !n.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
        const el = n.parentElement;
        if (!el) return NodeFilter.FILTER_REJECT;
        if (el.closest("script,style,noscript,textarea,.aie-hl,#" + POPUP_ID)) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    return nodes;
  }

  // 在页面文本中找到 text 的第一处出现，把对应文字重新用荧光笔包住
  function wrapFirstMatch(text, color) {
    try {
      const nodes = collectTextNodes();
      if (!nodes.length) return false;
      let acc = ""; // 已累积的文本
      const meta = []; // { node, start } 每个节点在 acc 中的起始偏移
      for (const node of nodes) {
        const full = acc + node.nodeValue;
        const idx = full.indexOf(text);
        if (idx >= 0) {
          // 匹配必须结束于当前节点（更早的匹配在之前迭代已处理过）
          const end = idx + text.length;
          if (end <= full.length) {
            // 收集与 [idx, end) 重叠的节点片段（meta 为文档序，倒序收集后连同当前节点）
            const portions = [];
            for (let i = meta.length - 1; i >= 0; i--) {
              const m = meta[i];
              const nodeEnd = m.start + m.node.nodeValue.length;
              if (nodeEnd <= idx) break;
              portions.push({
                node: m.node,
                s: Math.max(idx, m.start) - m.start,
                e: Math.min(end, nodeEnd) - m.start,
              });
            }
            portions.push({
              node,
              s: Math.max(idx, acc.length) - acc.length,
              e: Math.min(end, acc.length + node.nodeValue.length) - acc.length,
            });
            // 从文档末尾往前包裹，避免拆分节点影响前面的引用
            for (let i = portions.length - 1; i >= 0; i--) wrapNodePortion(portions[i], color);
            return true;
          }
        }
        meta.push({ node, start: acc.length });
        acc = full;
      }
    } catch (e) {}
    return false;
  }

  // 把单个文本节点的一段文字包进高亮 span
  function wrapNodePortion(p, color) {
    try {
      const node = p.node;
      if (!node.parentNode || !node.nodeValue) return;
      if (node.parentElement && node.parentElement.closest(".aie-hl")) return;
      if (p.s === 0 && p.e === node.nodeValue.length) {
        // 整个节点都在选区内，直接包裹
        const span = makeHlSpan(color);
        node.parentNode.insertBefore(span, node);
        span.appendChild(node);
        return;
      }
      const range = document.createRange();
      range.setStart(node, p.s);
      range.setEnd(node, p.e);
      const span = makeHlSpan(color);
      span.appendChild(range.extractContents());
      range.insertNode(span);
    } catch (e) {}
  }

  // 开启高亮划词时，立即高亮页面上当前已有的选区（右键菜单/选项页切换后补划）
  function highlightExistingSelection() {
    if (paused) return;
    try {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) return;
      if (!sel.toString().trim()) return;
      const popup = document.getElementById(POPUP_ID);
      const range = sel.getRangeAt(0);
      if (popup && (isInsidePopup(range.startContainer) || range.intersectsNode(popup))) return;
      applyHighlight(range);
    } catch (e) {
      /* 异常选区静默跳过 */
    }
  }

  // 清除本页所有荧光笔划线（关闭高亮划词时调用）
  function clearHighlights() {
    document.querySelectorAll("span.aie-hl").forEach((span) => {
      const parent = span.parentNode;
      if (!parent) return;
      while (span.firstChild) parent.insertBefore(span.firstChild, span);
      span.remove();
      parent.normalize(); // 合并被拆开的相邻文本节点，尽量还原 DOM
    });
  }

  // 荧光笔颜色变化时，同步已划线文字的颜色
  function syncHighlightColors() {
    const color = config.highlightColor || "#fef08a";
    document.querySelectorAll("span.aie-hl").forEach((span) => {
      span.style.setProperty("--aie-hl", color);
    });
  }

  // 历史条数接近上限（剩余 ≤200）时，在浮层标题显示提示，点击可去历史页导出备份
  function checkHistoryWarn() {
    if (!warnEl) return;
    try {
      chrome.runtime.sendMessage({ type: "history-count" }, (res) => {
        if (!res || !res.ok || typeof res.count !== "number") {
          warnEl.hidden = true;
          return;
        }
        const remaining = res.max - res.count;
        if (remaining <= 200) {
          warnEl.textContent = "历史将满（剩 " + remaining + " 条）· 导出备份";
          warnEl.hidden = false;
        } else {
          warnEl.hidden = true;
        }
      });
    } catch (e) {
      warnEl.hidden = true;
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
      '<button class="aie-curtag" type="button" title="点击选择标签，之后的划词与摘录都会自动打上">＋标签</button>' +
      '<span class="aie-warn" title="历史记录将满，点击去导出备份" hidden></span>' +
      '<div class="aie-actions">' +
      '<button class="aie-btn aie-copy" title="复制释义">复制</button>' +
      '<button class="aie-btn aie-history" title="查看历史记录并导出MD">历史</button>' +
      '<button class="aie-btn aie-settings" title="设置">设置</button>' +
      '<button class="aie-btn aie-pin" title="钉住浮层（不自动消失）">' +
      '<svg viewBox="0 0 1024 1024" width="13" height="13" aria-hidden="true"><path fill="currentColor" d="M648.728381 130.779429a73.142857 73.142857 0 0 1 22.674286 15.433142l191.561143 191.756191a73.142857 73.142857 0 0 1-22.137905 118.564571l-67.876572 30.061715-127.341714 127.488-10.093714 140.239238a73.142857 73.142857 0 0 1-124.684191 46.445714l-123.66019-123.782095-210.724572 211.699809-51.833904-51.614476 210.846476-211.821714-127.926857-128.024381a73.142857 73.142857 0 0 1 46.299428-124.635429l144.237715-10.776381 125.074285-125.220571 29.379048-67.779048a73.142857 73.142857 0 0 1 96.207238-38.034285z m-29.086476 67.120761l-34.913524 80.530286-154.087619 154.331429-171.398095 12.751238 303.323428 303.542857 12.044191-167.399619 156.233143-156.428191 80.384-35.59619-191.585524-191.73181z"/></svg>' +
      "</button>" +
      '<button class="aie-btn aie-close" title="关闭">×</button>' +
      "</div>" +
      "</div>" +
      '<div class="aie-seltext">' +
      '<span class="aie-seltext-text"></span>' +
      '<span class="aie-tag" hidden>历史释义</span>' +
      '<select class="aie-prompt-select" title="切换AI提示词" hidden></select>' +
      "</div>" +
      '<div class="aie-body">' +
      '<div class="aie-status"></div>' +
      '<div class="aie-result"></div>' +
      '<div class="aie-retry-row"><button class="aie-btn aie-retry">重新解释</button></div>' +
      "</div>" +
      '<div class="aie-grip aie-grip-w" title="单独拉宽"></div>' +
      '<div class="aie-grip aie-grip-h" title="单独拉高"></div>' +
      '<div class="aie-grip aie-grip-corner" title="同时拉宽拉高"></div>';

    document.documentElement.appendChild(root);

    closeBtn = root.querySelector(".aie-close");
    pinBtn = root.querySelector(".aie-pin");
    copyBtn = root.querySelector(".aie-copy");
    historyBtn = root.querySelector(".aie-history");
    warnEl = root.querySelector(".aie-warn");
    settingsBtn = root.querySelector(".aie-settings");
    retryBtn = root.querySelector(".aie-retry");
    promptSelect = root.querySelector(".aie-prompt-select");
    selEl = root.querySelector(".aie-seltext");
    selTextEl = root.querySelector(".aie-seltext-text");
    histTag = root.querySelector(".aie-tag");
    curTagBtn = root.querySelector(".aie-curtag");
    // 标签下拉挂在 <html> 下而不是浮层里：浮层有 backdrop-filter（会成为 fixed 后代的
    // 包含块）且 overflow:hidden，菜单放在里面会被裁掉/定位错乱，看起来像“点了没反应”
    tagMenu = document.getElementById(TAG_MENU_ID);
    if (!tagMenu) {
      tagMenu = document.createElement("div");
      tagMenu.id = TAG_MENU_ID;
      tagMenu.className = "aie-tagmenu";
      tagMenu.hidden = true;
    }
    // 每次都挪到 html 末尾：浮层被重建时会重新 append，若菜单留在它前面，同层级下会被浮层盖住
    document.documentElement.appendChild(tagMenu);
    statusEl = root.querySelector(".aie-status");
    bodyEl = root.querySelector(".aie-body");
    resultEl = root.querySelector(".aie-result");
    header = root.querySelector(".aie-header");

    // 标题栏「当前标签」chip：点开选择/新建，之后的划词与摘录都自动带上
    curTagBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      openTagMenu();
    });
    document.addEventListener(
      "pointerdown",
      (e) => {
        if (!tagMenu || tagMenu.hidden) return;
        if (e.target.closest(".aie-tagmenu") || e.target.closest(".aie-curtag")) return;
        closeTagMenu();
      },
      true
    );

    // 拖动标题栏移动浮层位置（按钮区域除外）
    header.addEventListener("pointerdown", (e) => {
      if (e.target.closest(".aie-btn, .aie-curtag")) return;
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
    // 钉住/取消钉住：钉住后点击页面、悬停移开都不自动关闭
    pinBtn.addEventListener("click", () => setPinned(!pinned));
    copyBtn.addEventListener("click", copyAnswer);
    historyBtn.addEventListener("click", openHistory);
    warnEl.addEventListener("click", openHistory); // 历史将满提示：点击去导出备份
    settingsBtn.addEventListener("click", openSettings);
    promptSelect.addEventListener("change", onPromptChange);
    retryBtn.addEventListener("click", () => {
      // 「去设置 API Key」不是重试：直接打开设置页
      if (retryBtn.dataset.action === "settings") {
        openSettings();
        return;
      }
      const sel = lastSelectedText || selTextEl.textContent.replace(/^「|」$/g, "").trim();
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
    root.querySelector(".aie-grip-w").addEventListener("pointerdown", (e) => startResize(e, { w: true }));    root.querySelector(".aie-grip-h").addEventListener("pointerdown", (e) => startResize(e, { h: true }));
    root.querySelector(".aie-grip-corner").addEventListener("pointerdown", (e) => startResize(e, { w: true, h: true }));

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

  // 设置钉住状态并同步按钮外观
  function setPinned(v) {
    pinned = !!v;
    if (pinBtn) {
      pinBtn.classList.toggle("active", pinned);
      pinBtn.title = pinned ? "已钉住，点击取消" : "钉住浮层（不自动消失）";
    }
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
    closeTagMenu();
    hoverPopup = false;
    setPinned(false);
    clearTimeout(hoverShowTimer);
    clearTimeout(hoverHideTimer);
    if (port) {
      try {
        port.disconnect();
      } catch {}
      port = null;
    }
    currentRange = null;
    currentSignature = "";
    rawAnswer = "";
    lastContext = "";
  }

  // ---------- AI 调用 ----------
  function buildContext(range) {
    if (!range) return "";
    try {
      const selTxt = range.toString();
      let text = range.startContainer.parentElement?.textContent || "";
      const idx = text.indexOf(selTxt);
      if (idx < 0) return "";
      // 上下文窗口随所选文本长度自适应：短词只取邻近一小段，避免把整段/整首诗都塞进上下文
      const span = Math.max(60, selTxt.length * 6); // 上下文总长上限
      const rest = Math.max(0, span - selTxt.length);
      const before = Math.min(40, Math.floor(rest / 2));
      const after = Math.min(40, Math.ceil(rest / 2));
      const start = Math.max(0, idx - before);
      const end = Math.min(text.length, idx + selTxt.length + after);
      return text.slice(start, end).replace(/\s+/g, " ").trim();
    } catch {
      return "";
    }
  }

  // ---------- 提示词切换（浮层内） ----------
  function promptList() {
    return Array.isArray(config.prompts) ? config.prompts : [];
  }

  function activePrompt() {
    const list = promptList();
    return list.find((p) => p.id === config.activePromptId) || list[0] || null;
  }

  // 用设置里保存的提示词列表渲染原文行最右的下拉；悬停读历史释义或没有提示词时隐藏
  function syncPromptBar() {
    if (!promptSelect) return;
    const list = promptList();
    promptSelect.innerHTML = "";
    if (!list.length || hoverPopup) {
      promptSelect.hidden = true;
      return;
    }
    list.forEach((p) => {
      const opt = document.createElement("option");
      opt.value = p.id;
      opt.textContent = String(p.name || "提示词");
      promptSelect.appendChild(opt);
    });
    const cur = activePrompt();
    promptSelect.value = cur ? cur.id : "";
    promptSelect.hidden = false;
    promptSelect.title = "切换AI提示词";
  }

  // ---------- 当前标签：划词与摘录入库时自动带上，切换后一直生效 ----------
  // 悬停看历史释义时，chip 改为显示/编辑“这条记录自己的标签”
  function hoverRecordTags() {
    return hoverEntry && Array.isArray(hoverEntry.tags) ? hoverEntry.tags.filter((t) => String(t || "").trim()) : [];
  }

  function updateCurTagChip() {
    if (!curTagBtn) return;
    curTagBtn.hidden = false; // 普通划词与悬停看历史释义的浮层都显示
    if (hoverEntry) {
      const tags = hoverRecordTags();
      curTagBtn.textContent = tags.length ? tags.join(" · ") : "＋标签";
      curTagBtn.classList.toggle("has-tag", !!tags.length);
      curTagBtn.title = tags.length
        ? "这条记录的标签：" + tags.join("、") + "（点击修改）"
        : "这条记录还没有标签，点击添加";
      return;
    }
    const tag = String((config && config.currentTag) || "").trim();
    curTagBtn.textContent = tag || "＋标签";
    curTagBtn.classList.toggle("has-tag", !!tag);
    curTagBtn.title = tag
      ? "当前标签：" + tag + "（点击切换，之后的划词与摘录都会打上它）"
      : "点击选择标签，之后的划词与摘录都会自动打上";
  }

  // 改写悬停那条记录的标签（只动 updatedAt，不动 time；发 history-changed 触发云端同步）
  function setHoverRecordTags(tags) {
    if (!hoverEntry || !hoverEntry.id) return;
    const clean = tags.map((t) => String(t || "").trim()).filter(Boolean).slice(0, 8);
    hoverEntry.tags = clean;
    updateCurTagChip();
    chrome.storage.local.get({ history: [] }, (res) => {
      const list = Array.isArray(res.history) ? res.history : [];
      const item = list.find((e) => e.id === hoverEntry.id);
      if (!item) return;
      if (clean.length) item.tags = clean;
      else delete item.tags;
      item.updatedAt = Date.now();
      chrome.storage.local.set({ history: list }, () => {
        try {
          chrome.runtime.sendMessage({ type: "history-changed" });
        } catch (e) {}
      });
    });
  }

  function closeTagMenu() {
    if (tagMenu) tagMenu.hidden = true;
  }

  function positionTagMenu() {
    if (!tagMenu || !curTagBtn || tagMenu.hidden) return;
    const r = curTagBtn.getBoundingClientRect();
    const width = 220;
    // 右侧放不下就往左挪，整体夹在视口内
    const left = Math.min(Math.max(8, r.left), Math.max(8, window.innerWidth - width - 8));
    tagMenu.style.left = left + "px";
    tagMenu.style.top = r.bottom + 6 + "px";
    tagMenu.style.width = width + "px";
  }

  function setCurrentTag(tag) {
    const name = String(tag || "").trim();
    config = { ...config, currentTag: name };
    // 写回时以存储里的最新配置为底，避免把别处刚改的字段覆盖成旧值
    chrome.storage.local.get({ config: null }, (res) => {
      chrome.storage.local.set({ config: { ...(res.config || {}), currentTag: name }, configUpdatedAt: Date.now() });
    });
    updateCurTagChip();
    setStatus("idle", "之后的划词与摘录将打上标签：" + (name || "无"));
  }

  function openTagMenu() {
    if (!tagMenu) return;
    if (!tagMenu.hidden) {
      closeTagMenu();
      return;
    }
    const cur = String((config && config.currentTag) || "").trim();
    const recordMode = !!hoverEntry; // 悬停看历史释义：改的是这条记录的标签
    let recordTags = hoverRecordTags();
    tagMenu.innerHTML = "";

    const addItem = (label, onClick, active) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "aie-tagmenu-item" + (active ? " active" : "");
      btn.textContent = label;
      btn.addEventListener("click", onClick);
      tagMenu.appendChild(btn);
    };
    if (!recordMode) addItem("不打标签", () => { setCurrentTag(""); closeTagMenu(); }, !cur);

    tagMenu.hidden = false;
    positionTagMenu();

    // 已有标签从历史记录里聚合，不单独维护标签库（删记录不会留下空标签）
    chrome.runtime.sendMessage({ type: "tag-list" }, (resp) => {
      if (!tagMenu || tagMenu.hidden) return;
      const tags = resp && resp.ok && Array.isArray(resp.tags) ? resp.tags : [];
      if (recordMode) {
        // 记录模式：点一下加/减，菜单不关，方便连续挑多个标签
        tags.forEach((t) => {
          const on = recordTags.includes(t);
          addItem((on ? "✓ " : "") + t, () => {
            recordTags = on ? recordTags.filter((x) => x !== t) : [...recordTags, t];
            setHoverRecordTags(recordTags);
            // 立刻重画菜单，反映勾选状态
            closeTagMenu();
            openTagMenu();
          }, on);
        });
        if (recordTags.length) {
          addItem("清除标签", () => {
            setHoverRecordTags([]);
            closeTagMenu();
          }, false);
        }
      } else {
        tags.forEach((t) => addItem(t, () => { setCurrentTag(t); closeTagMenu(); }, t === cur));
      }

      const row = document.createElement("div");
      row.className = "aie-tagmenu-new";
      const input = document.createElement("input");
      input.type = "text";
      input.placeholder = recordMode ? "新标签名" : "新标签名";
      input.maxLength = 24;
      const okBtn = document.createElement("button");
      okBtn.type = "button";
      okBtn.textContent = "确定";
      const submit = () => {
        const name = input.value.trim();
        if (!name) return;
        if (recordMode) {
          if (!recordTags.includes(name)) setHoverRecordTags([...recordTags, name]);
        } else {
          setCurrentTag(name);
        }
        closeTagMenu();
      };
      okBtn.addEventListener("click", submit);
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          submit();
        }
      });
      row.appendChild(input);
      row.appendChild(okBtn);
      tagMenu.appendChild(row);
      positionTagMenu();
    });
  }

  // 悬停读历史释义时，在原文行最右显示「历史释义」小标签
  function setHistoryTag(on) {
    if (histTag) histTag.hidden = !on;
  }

  function onPromptChange() {
    const target = promptList().find((p) => p.id === promptSelect.value);
    if (!target) return;
    const next = { ...config, activePromptId: target.id, systemPrompt: target.prompt };
    config = next;
    // 写回时以存储里的最新配置为底，避免把别处刚改的字段覆盖成旧值
    chrome.storage.local.get({ config: null }, (res) => {
      const base = { ...(res.config || {}), activePromptId: target.id, systemPrompt: target.prompt };
      chrome.storage.local.set({ config: base, configUpdatedAt: Date.now() });
    });
    // 已经有释义结果时，直接用新提示词重新解释当前这段文字
    if (rawAnswer && rawAnswer.trim()) {
      const sel = lastSelectedText || (selTextEl ? selTextEl.textContent.replace(/^「|」$/g, "").trim() : "");
      if (sel) startExplain(sel);
    }
  }

  function startExplain(text) {
    abortPort();
    savedThisExplain = false;
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
      context: lastContext || buildContext(currentRange),
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
        retryBtn.dataset.action = "settings";
      } else {
        retryBtn.hidden = false;
        retryBtn.textContent = "重试";
        retryBtn.dataset.action = "retry";
      }
    }
  }

  function finish() {
    setStatus("idle", "");
    statusEl.hidden = true;
    if (rawAnswer.trim()) {
      resultEl.hidden = false;
      render(); // 释义完成时用最终原文重绘一次，确保显示与复制内容一致
      saveToHistory(); // 释义成功后写入历史记录
    }
    // 内容确定后按实际高度重新定位一次，避免浮层因加载时高度偏小、
    // 而在滚动时才按新高度突然跳位（上方放不下切到下方）
    if (currentRange && !userMoved) reposition(currentRange.getBoundingClientRect());
  }

  // 释义完成后自动写入历史记录（可在设置里关闭）
  function saveToHistory() {
    if (savedThisExplain) return;
    if (config.autoSaveHistory === false) return;
    const text =
      lastSelectedText ||
      (selTextEl ? selTextEl.textContent.replace(/^「|」$/g, "").trim() : "");
    if (!text || !rawAnswer.trim()) return;
    savedThisExplain = true;
    chrome.runtime
      .sendMessage({
        type: "history-save",
        text,
        answer: rawAnswer,
        context: lastContext || buildContext(currentRange) || "",
        pageUrl: location.href,
        pageTitle: document.title,
      })
      .catch(() => {});
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
    const text = rawAnswer || lastSelectedText || selTextEl.textContent.replace(/^「|」$/g, "");
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

  // 打开历史记录页：同样交由后台用 chrome.tabs.create 打开扩展页，规避拦截
  function openHistory() {
    try {
      chrome.runtime.sendMessage({ type: "open-history" });
    } catch (e) {
      chrome.tabs.create({ url: chrome.runtime.getURL("pages/history.html") });
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
