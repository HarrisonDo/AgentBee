# BeeWeb Current Protocol Notes

当前前端已经切换为 JSON 发送，不再使用纯文本发送。

## 已实现

- 每个用户问题生成独立 `messageId`。
- 前端统一发送 `type: "chat"` JSON，纯文本、图片和文本文件都放在 OpenAI-style `content` 数组中。
- 前端每条发送到 WS 的 JSON 字符串末尾都会追加一个换行符 `\n`。
- 后端返回 `content/status/think/tool_calls/tool_result/error/end` 时可以带同一个 `messageId`。
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
