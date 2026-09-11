# BeeWeb Current Protocol Notes

当前前端已经切换为 JSON 发送，不再使用纯文本发送。

## 已实现

- 每个用户问题生成独立 `messageId`。
- 前端统一发送 `type: "chat"` JSON，纯文本、图片和文本文件都放在 OpenAI-style `content` 数组中。
- 前端每条发送到 WS 的 JSON 字符串末尾都会追加一个换行符 `\n`。
- 后端返回 `content/status/think/tool_calls/tool_result/image/error/end` 时可以带同一个 `messageId`。
- `image` 用于返回图片，`data.url` 是图片 base64，`data.prompt` 是提示词，会显示为图片下方的说明文字；图片会按容器宽度和高度上限自适应缩放，不会撑破布局。
- `think` 会显示为类似 Codex 的思考块，超过约 3 行时默认折叠。
- `tool_calls.data` 支持函数调用数组格式，`tool_result.data.result` 支持 JSON 字符串，前端会格式化后显示在同一个 assistant 对话里的独立折叠块中。
- 后端返回 `close` 时，前端会移除对应 `messageId` 的 assistant 显示，不删除用户消息。
- 流式输出时，如果用户已经滚动到历史记录位置，前端不会强制滚动到底部。
- 输入框使用 Enter 发送，Ctrl+Enter 或 Cmd+Enter 换行。
- 前端按 `messageId` 分流多个并发回答。
- 如果后端暂时没有返回 `messageId`，前端会落到最近一个 loading 回答里。
- WS 获取聊天历史暂不启用，聊天记录保存在浏览器 `localStorage`。
- 浏览器存储不足时，前端会裁剪旧记录并优先保留较新的会话内容。
- assistant 回复支持轻量 Markdown 渲染。
- 后端返回 `file`、`html` 或 `document` 事件时，前端会按文件类型显示桌面预览侧栏；文本、Markdown、HTML、图片和 PDF 分别采用对应预览方式。
- 文件事件可提供 `content`、`url` 或 `path`。工作区内路径可通过配置中的 `workspace_url` 映射为浏览器可访问的 HTTP(S) 地址；无法映射的后端本地路径只显示路径提示，不会假装浏览器能够读取它。

文件事件示例：

```json
{
  "type": "file",
  "messageId": "question-message-id",
  "data": {
    "filename": "report.html",
    "mimeType": "text/html",
    "content": "<html><body><h1>Hello</h1></body></html>",
    "encoding": "text"
  }
}
```

仅返回工作区路径时：

```json
{
  "type": "file",
  "messageId": "question-message-id",
  "data": {
    "filename": "reports/demo.html",
    "mimeType": "text/html",
    "path": "D:/AgentBee/workspace/reports/demo.html"
  }
}
```

`workspace_url` 必须实际提供对应文件，例如 `https://example.test/workspace/`；它只是路径映射配置。`file://` 地址指向打开浏览器的电脑，普通网页不能读取后端电脑的本地文件。

## 从返回内容推断可预览产物（前端实现）

后端暂时不发 `file` / `html` / `document` 事件，前端会从已有信号里推断产物并在右侧侧边栏预览：

- 正文里的**完整 HTML 文档**（`<html>…</html>`，可带 doctype）
- 正文里的 **```html 围栏块**（嵌在说明文字里也能识别；无语言围栏但内容是完整 HTML 也识别）
- 正文里的 **```md 围栏块**，以及 ≥400 字且含 2 个以上标题的**长 Markdown 回复**
- 正文里出现的**文件路径**（相对路径 / 绝对路径 / Windows 盘符；带协议头的 URL 会被跳过）
- `tool_result` 里的 `saved_files` / `file_path` / `path` 等字段

实现位置：`src/utils/artifacts.ts`（识别与排序）、`src/utils/fileUrl.ts`（路径 → URL 解析）。
服务端记忆里的历史回复不派生预览入口，避免整屏按钮。

### 侧边栏自动打开

- 只针对**最新一轮** assistant 回复，每个 `messageId` 只自动打开一次（用户关掉后不会重复弹出）。
- 优先级：HTML 文档 > Markdown 文档 > PDF / 其它；图片已在气泡内联展示，不抢占侧栏。
- 只有「能真正渲染」的产物才自动打开：内联内容，或能解析出 `http(s)` / `data` / `blob` 的地址。
  落到 `file://` 的纯路径（浏览器读不到后端本地文件）只保留手动预览按钮。
- 子 agent 面板占用右侧时，自动打开会挂起，等它关闭再弹出，两者不抢位置。

### 仍然存在的限制

`file://` 无法在浏览器里加载（开发态页面是 http 源，生产态是 file:// 源，Chrome 都拦），
`workspace_url` 目前也没有对应的 HTTP 文件服务。因此**纯路径产物只能看到路径提示**，
要真正预览后端文件，仍需后端提供 HTTP 文件服务，或改为通过 WS 回传文件字节。


## 关键字段

```json
{
  "type": "chat",
  "sessionId": "session-xxx",
  "messageId": "msg-xxx",
  "content": [
    { "type": "text", "text": "用户问题" }
  ],
  "createdAt": "2026-05-11T10:00:00.000Z"
}
```

带附件时：

```json
{
  "type": "chat",
  "sessionId": "session-xxx",
  "messageId": "msg-xxx",
  "content": [
    { "type": "text", "text": "用户问题" },
    { "type": "file", "file": { "filename": "notes.md", "mimeType": "text/markdown", "content": "IyBOb3Rlcy4uLg==" } },
    { "type": "file", "file": { "filename": "R.png", "mimeType": "image/png", "content": "iVBORw0KGgo..." } }
  ],
  "createdAt": "2026-05-11T10:00:00.000Z"
}
```

后端所有该问题的流式事件都应带回同一个 `messageId`。

完整协议参考 `WS_BACKEND_TEMPLATE.md`。
