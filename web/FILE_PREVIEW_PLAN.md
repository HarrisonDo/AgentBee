# 文件预览支持方案（file / html / md + workspace_url / file 模式）

> 目标：WS 返回 `content` 里出现 HTML / Markdown / 各类文件（或文件路径）时，前端能在当前页面右侧侧边栏正确预览。
> 范围：仅桌面端；移动端不处理。

---

## 一、现状盘点

### 1.1 前端已具备的能力（BeeWeb）

| 模块 | 已有能力 |
| --- | --- |
| `src/components/FilePreviewPanel.vue` | 侧边栏预览面板，已按 mime/扩展名区分 HTML / Markdown / 图片 / PDF / 纯文本；支持源码切换、复制、下载、新窗口打开；`resolveFileUrl()` 已实现 `workspace_url` 拼接与 `file://` 生成 |
| `src/components/ChatMessage.vue` | 文件卡片（带"预览"按钮，`emit('previewFile')`）；正文若是**完整 HTML 文档**，显示"预览 HTML 页面"入口 |
| `src/protocol/normalizers.ts` | `normalizeFileEvent()` 已能解析 `file` / `html` / `document` 事件的 `content` / `url` / `path` / `encoding` |
| `src/App.vue` | `previewFile` 状态、可拖拽调宽的右侧面板、`workspace_path` / `workspace_url` 从 agent 配置注入 |
| `src/composables/useWebSocketAgent.ts` | 已路由 `file` / `html` / `document` 事件 → `appendAssistantFile()` |
| `useI18n.ts` | 预览相关文案（filePreview / localFileUnavailable / previewHtml …）齐全 |

**结论：前端的"展示层"基本齐了，缺的是"取数层"。**

### 1.2 断点（真正的 4 个问题）

**P1 — 后端根本不发 `file`/`html`/`document` 事件。**
全仓搜索 `'type' => 'file'` 无任何命中。后端目前只会发 `content` / `think` / `status` / `tool_calls` / `tool_result` / `image` / `error` / `close` / `end`。前端那条预览链路**从没被真实数据喂过**，所以文件卡片、侧边栏实际不可达。agent 现在只能把路径写进正文文本里。

**P2 — `file://` 模式在浏览器里本质不可行。**
- 开发态页面源是 `http://127.0.0.1:5173`，浏览器**禁止 http 页面加载 `file://` 子资源**（Chrome/Safari/Edge 全禁）。
- 生产态启动器 `AgentBee-Launcher` 是直接 `open BeeWeb-standalone.html`，页面源变成 `file://`；此时 Chrome 默认仍拦截本地文件间的 iframe/子资源加载。
- 前端已经"认命"了：`FilePreviewPanel` 里 `isLocalFile` 分支只显示 `localFileUnavailable` 提示，是个死胡同。

**P3 — `workspace_url` 背后没有 HTTP 文件服务。**
系统提示（`utils.php` → `## 文件链接`）会按配置教 LLM：
- `workspace_url` 以 `http` 开头 → 用 `域名 + 相对路径` 拼链接；
- 以 `file` 开头 → 用 `file:// + 绝对路径`；
- 都没有 → 只告知绝对路径。
但仓库里**没有任何进程在服务 `workspace/` 目录**，`config/AgentBee.json` 的 `workspace_url` 默认为 `""`。所以"域名拼接"这条路径目前是空配置 + 空后端。

**P4 — 正文内联 HTML/Markdown 的识别过严。**
`fullHtmlDocument` 要求整条消息**恰好**是一个 `<html>…</html>` 文档（正则全匹配）。一旦 HTML 被包在 ```html 代码块里、或前后夹了说明文字，预览入口就不出现。Markdown 同理：只有走 `file` 事件才有 md 预览，正文里的长 md 没有"侧边栏打开"入口。

---

## 二、方案设计

核心思路：**把"一个文件从哪来"抽象成一条统一的解析链，前端只认三种取数通道，后端补齐缺失的两条。**

### 2.1 三种取数通道（优先级从高到低）

```
① inline  —— 后端直接把字节/文本塞在事件里（content/encoding）
              → 前端直接渲染（HTML 用 srcdoc，图片/PDF 用 Blob，文本/MD 直接渲染）
② http    —— 后端或第三方 HTTP 文件服务（workspace_url）
              → 前端直接用 URL（iframe / img / a[download]）
③ ws-read —— 后端不发字节、只给路径（含 file:// 模式）
              → 前端发 WS 请求，后端按路径读文件回传 base64
              → 前端生成 blob: URL 渲染（绕开浏览器对 file:// 的全部限制）
```

**关键点：把 `file://` 从"浏览器直接访问"改成"WS 回传字节 + Blob"**，`file` 模式就能在 dev / prod 两种页面源下都成立，且不需要开新端口、复用现有 ws_token 鉴权与 workspace 沙箱。

### 2.2 决策树

```
事件到达（file / html / document / 正文内联文档）
  ├─ 有 content 或 data / base64 字节？ → ① inline
  ├─ 有 url 且是 http(s) / blob / data？ → ② http
  ├─ 有 path
  │    ├─ workspace_url 是 http(s) 且路径在 workspace_path 下 → ② http（拼相对路径）
  │    └─ 其它（workspace_url 为空或为 file://） → ③ ws-read（读字节 → Blob）
  └─ 都没有 → 空态提示
```

渲染分派（保持现有逻辑，面板内按 mime/扩展名）：
- HTML → `iframe`（`srcdoc` 或 blob URL），保持 `sandbox="allow-scripts"`（不给 `allow-same-origin`）
- Markdown → `renderMarkdown()`
- 图片 / PDF → `img` / `iframe`（blob 或 http）
- 其它文本 / JSON / 代码 → `<pre>`，超长截断
- 其它二进制 → 只给"下载"，不给内联

---

## 三、改造清单

### 3.1 后端（AgentBee / PHP）

| 文件 | 改动 |
| --- | --- |
| `modules/agent_core/core.php` | 新增 `sendFileMessage(string $socket_id, array $message, array $file): void`，仿 `sendImageMessage()`，`type = 'file'`，`data = { filename, mimeType, content, encoding, url, path, size }` |
| `modules/agent_core/lib/utils.php` | ① 新增 `resolveFileEvent(string $abs_path): array`，按扩展名推断 mime、判断文本/二进制、超阈值不走内联；② 重写 `## 文件链接` 提示：把"只贴路径"改为"用 `file`/`html` 事件返回文件，路径用工作区相对路径"；③ 复用已有 `securePath()` 做越权校验 |
| `modules/agent_core/lib/message.php` | 新增 `process_file()`，处理前端 `{type:"file", content:{act:"read", path, requestId}}`：校验路径在 workspace 内 → 读文件 → 大小上限（建议 20–32MB）→ 回 `{type:"file", act:"read", status, requestId, data:{filename,mimeType,content,encoding,size}}` |
| `modules/agent_core/lib/config.php` + `config/AgentBee.json` | 新增 `workspace_serve` 段：`{ enabled, host, port }`（默认 `127.0.0.1:8687`）；保留 `workspace_url` 作为可覆盖项 |
| 新增 `modules/file_server/`（静态文件服务） | 极小 HTTP 服务，仅暴露 `workspace_path`，加目录穿越防护、`Content-Type` 推断、`Range` 支持（PDF 需要）、可选只监听 127.0.0.1。启动时把默认 `workspace_url` 指向它 |
| Skills / 工具集（可选，P2） | 提供 `System-attachFile(path)` 工具，让 LLM 明确"把文件推给前端"，比依赖提示词更稳 |

### 3.2 前端（BeeWeb）

| 文件 | 改动 |
| --- | --- |
| 新增 `src/utils/fileResolve.ts` | 抽出并强化 `resolveFileTarget(file, { workspacePath, workspaceUrl })`，返回 `{ kind: 'inline' \| 'http' \| 'ws-read' \| 'none', url?, path? }`；把 `FilePreviewPanel` 里的 `resolveFileUrl/toFileUrl` 迁过来，修正 Windows 盘符/UNC 处理 |
| `src/protocol/types.ts` | 新增客户端 `ClientFileReadRequest`；`ChatFile` 增加运行期字段 `displayUrl?` / `resolveKind?` |
| `src/composables/useWebSocketAgent.ts` | ① 新增 `readWorkspaceFile(path): Promise<FileBytes>`，用 `requestId` 关联请求/响应；② 入站识别 `type==='file' && act==='read'` 的分支，回填 pending；③ 超时与错误处理；④ `appendAssistantFile` 后触发"自动打开"策略 |
| `src/components/FilePreviewPanel.vue` | 改为消费 `resolveFileTarget`；新增 `loading / error / too-large` 状态；`ws-read` 成功后创建 `blob:` URL 并在卸载时 `revokeObjectURL`；下载统一走 Blob；`openInNewWindow` 仅 http 可用（ws-read 模式改为"打开临时 blob 页"或禁用） |
| `src/components/ChatMessage.vue` | 放宽内联文档识别：① 完整 HTML 文档；② ` ```html ` 围栏块；③ 完整 `<html>` 无围栏。共用一个"侧边栏打开"入口，`emit('previewFile')` |
| `src/App.vue` | 新增自动打开策略开关（见待确认项）；`file` 事件到达且是"主要产物"时自动开侧栏；把 `agent.readWorkspaceFile` 透传给面板 |
| `src/composables/useI18n.ts` | 补文案：`loadingPreview` / `previewTooLarge` / `sourceModeInline` / `sourceModeHttp` / `sourceModeLocal` 等 |
| `WS_BACKEND_TEMPLATE.md` / `docs.md` | 同步 `file` 事件与 `file/act=read` 请求的最新契约 |

### 3.3 协议扩展（建议最终形态）

服务端 → 客户端（已有，需后端真正开始发）：
```json
{ "type": "file", "messageId": "msg-1",
  "data": { "filename": "report.html", "mimeType": "text/html",
            "path": "reports/report.html", "encoding": "text",
            "content": "<html>…</html>", "size": 1234 } }
```
- 纯路径（让前端走 http 或 ws-read）：`data` 只给 `filename` / `mimeType` / `path`。

客户端 → 服务端（新增）：
```json
{ "type": "file", "sessionId": "s1", "messageId": "msg-1",
  "content": { "act": "read", "requestId": "req-1", "path": "reports/report.html" } }
```
服务端回：
```json
{ "type": "file", "act": "read", "status": "success", "requestId": "req-1",
  "data": { "filename": "report.html", "mimeType": "text/html",
            "encoding": "base64", "content": "PGh0bWw+…", "size": 1234 } }
```

---

## 四、安全与边界

- **路径沙箱**：`ws-read` 必须复用 `securePath()`，仅允许 `workspace_path` 内的相对路径；拒绝 `..`、绝对盘符、UNC、符号链接逃逸。
- **大小上限**：内联建议 ≤ 2MB；`ws-read` ≤ 20–32MB；超限只给路径 + 下载提示，不传输。
- **类型白名单**：HTML / MD / 文本 / 图片 / PDF 走内联预览；`.exe/.sh/.dll` 等只下载不预览。
- **iframe 沙箱**：保持 `sandbox="allow-scripts"`，不叠加 `allow-same-origin`，避免预览 HTML 拿到父页面权限。
- **协议限制**：`file://` 语义在前端**彻底不再直接加载**，统一降级为 ws-read，避免出现"看起来能开其实被浏览器拦"的假象。
- **HTTPS 场景**：若页面将来跑在 https 上，`http://127.0.0.1` 与 `ws://` 会被拦，需内置 HTTPS/WSS 或改为纯 ws-read 通道（ws-read 在 wss 下同样成立，这也是它的优势）。

---

## 五、分期实施

**P0（打通主链路，最小可用）**
1. 后端 `sendFileMessage()` + `process_file()`（ws-read）；
2. 前端 `fileResolve.ts` + `FilePreviewPanel` 接 ws-read，去掉 `file://` 死胡同提示；
3. 后端开始对"生成的 HTML/MD/图片文件"发 `file` 事件（先接 `OfficeSuite` / `ImageMaker` / `System` 的落地产物）。

**P1（体验补齐）**
4. `workspace_serve` 静态 HTTP 服务 + 默认 `workspace_url`，打通 http 通道；
5. 正文内联 HTML/MD 放宽识别 + 自动打开侧栏；
6. 大文件、错误态、下载、新窗口。

**P2（增强）**
7. `System-attachFile` 工具，让 agent 主动推文件而非依赖提示词；
8. 图片/PDF 的 Range/流式、预览缓存、多文件卡片分组。

---

## 六、待确认决策

1. **本地文件取数主通道**：A. 后端静态 HTTP 服务（`workspace_url` 真正落地）；B. 纯 WS 回传字节→Blob；C. 两者都要，http 优先、ws-read 兜底（本方案推荐 C）。
2. **自动打开侧栏的触发条件**：仅当该轮回复的"主要产物"是文件时自动开？还是永远只给按钮、用户点开？
3. **`file://` 配置的定位**：确认只作为"后端读取路径的语义"，前端不再直接加载（推荐）；还是仍希望保留浏览器直开 `file://` 的尝试。
