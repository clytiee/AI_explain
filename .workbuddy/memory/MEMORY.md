# 项目长期记忆 · AI_explain（划词AI释义 浏览器扩展）

## 提交约定（重要）
- 仓库历史风格：**标题一句话概述，正文逐条列出改动点**，不要只写一行标题。
- 正文两种写法都可以（参考 `fc2ec81`、`a704a3b`、`e45b1a3`）：
  - 按文件分行：`- content.js：底部按钮按用途分发点击，no_key 时改为打开设置页`、`- history.js：…`、`- history.html：…`
  - 或按要点分行：`- 新增行高设置（滑块 1.0-2.4），导出同步`、`- 修复：选择字体预设不生效`
- 用 `git commit -m "标题" -m "- 文件A：…\n- 文件B：…"` 分两段写，标题行保持精炼，细节放正文。
- 不要用 `git rebase -i`／`--amend` 改写已推送的历史，除非用户明确要求。

## 项目结构
- `manifest.json` MV3；content script（content.js + content.css）跑在所有页面。
- `background.js`：service worker，负责 AI 调用（port `ai-explain`）、历史记录读写、右键菜单（摘录模式/高亮划词开关）、按页面筛选历史原文供高亮恢复。
- `options.html/js`：设置页（API 配置、提示词、高亮划词卡片：开关 + 8 个常用荧光笔色 + 调色盘）。
- `history.html/js`：历史页（搜索、聚合模式、显示设置含颜色/字号/行高/圆角、导出 MD/HTML、分页、排序、悬浮按钮组）。

## 关键技术决策
- 高亮划线：CSS 渐变画在文字盒下半部（`--aie-hl` 变量），`box-decoration-break: clone` 保证跨行；划线按页面 URL（origin+path+search）持久化到 `chrome.storage.local.highlights`，刷新后按原文 TreeWalker 检索重包。
- 悬停划线读历史释义不调 AI（`highlight-lookup` 消息）；`showHoverPopup` 有守卫：普通释义浮层显示中不劫持（否则会吞掉 AI 流、历史漏记）。
- 图标风格：统一内联 SVG（24×24、2px 圆头描边、currentColor），避免字符字体回退导致粗细/大小不一致。

## 数据与导出（重要）
- 扩展「移除」会连同 `Profile 1\Local Extension Settings\dddanpchabebjgecfbkeloocnhjbdjga` 整个目录一起删除（11-05 实测，勾不勾选项都一样），历史随之丢失；测功能只用扩展卡片上的「刷新」重载，不要移除。唯一旧快照 `C:\Users\dingy\Downloads\划词释义备份_20261105_2151.json`（58 条、time 全 0，地址与上下文无法回填）。
- 导出 HTML 的卡片始终写隐藏元数据 `data-id / data-time / data-page-url / data-page-title / data-extract`，即使不勾「时间/来源页面/页面地址」、也不勾「备份数据」都不丢；聚合卡片只在卡片头写来源，条目继承。`parseFromDom` 优先读属性、缺失才回退文本解析。不写 `data-context`。
- 导入文件选择器接受 `.json`；历史页「导出」按钮只导全量 `{version, exportedAt, records}`，不受搜索与时间筛选影响，可直接用「导入」还原。
- 默认提示词在 `background.js` 的 `DEFAULT_CONFIG.systemPrompt` 与 `options.js` 的 `DEFAULT_PROMPT` 各存一份，改动必须两处同步（当前 356 字符、7 行）；用户存过自定义提示词时新默认不生效，需在设置页「恢复默认」。
- 导出 HTML 右上角只有一个「打印」按钮（ghost 风格、打印时隐藏）。`window.print()` 无法指定「另存为 PDF」，只能靠 Chrome 记住上次选择的打印目标。
