# AgentBee WebSocket Backend Template

This document describes the JSON protocol expected by the current Vue frontend.

Current backend URL:

```text
ws://192.168.254.10:8686
```

## Key Rule

Every user question has a unique `messageId`.

The backend should include the same `messageId` in all streamed events for that question. This lets the frontend render multiple concurrent questions without mixing replies.

## Client To Server

### Load History After Connection

Backend history loading is currently disabled in the Vue frontend. Chat history is stored in browser `localStorage` for now.

The following request shape is kept only for future protocol reference:

```json
{
  "type": "history_request",
  "sessionId": "browser-local-session-id"
}
```

### User Message

The frontend now sends JSON only. All user messages use `type: "chat"` with a `content` array:

```json
{
  "type": "chat",
  "sessionId": "browser-local-session-id",
  "messageId": "question-message-id",
  "content": [
    {
      "type": "text",
      "text": "用户输入的原始文本"
    }
  ],
  "createdAt": "2026-05-11T10:00:00.000Z"
}
```

When attachments are uploaded, the frontend reads every attachment as raw Base64 and appends file parts to the same `content` array:

- Text parts use `{ "type": "text", "text": "..." }`.
- All attachment parts use `{ "type": "file", "file": { "filename": "...", "mimeType": "...", "content": "<base64>" } }`.

```json
{
  "type": "chat",
  "sessionId": "browser-local-session-id",
  "messageId": "question-message-id",
  "content": [
    {
      "type": "text",
      "text": "Please read these files."
    },
    {
      "type": "file",
      "file": {
        "filename": "notes.md",
        "mimeType": "text/markdown",
        "content": "IyBOb3Rlcy4uLg=="
      }
    },
    {
      "type": "file",
      "file": {
        "filename": "R.png",
        "mimeType": "image/png",
        "content": "iVBORw0KGgo..."
      }
    }
  ],
  "createdAt": "2026-05-11T10:00:00.000Z"
}
```

### Stop Request

```json
{
  "type": "stop",
  "sessionId": "browser-local-session-id",
  "messageId": "question-message-id"
}
```

## Server To Client

The frontend sends JSON strings ending with one newline character (`\n`).

All server messages should be JSON strings.

### Sub-Agent Support

Messages can be marked as sub-agent messages by adding the `isSubTalk` field. Sub-agent messages are displayed in a separate panel on the right side instead of the main chat area.

```json
{
  "type": "content",
  "sessionId": "session-id",
  "messageId": "message-id",
  "data": "Sub-agent message content",
  "workerName": "my_worker",
  "workerRole": "My Worker",
  "isSubTalk": 1
}
```

- `isSubTalk`: Set to `1` to mark as sub-agent message, `0` or omit for main agent messages
- `workerName`: Used to identify and group sub-agent messages (required for sub-agents)
- `workerRole`: Display name for the sub-agent (optional)

See `SUB_AGENT_FEATURE.md` for detailed documentation.

### History Response

```json
{
  "type": "history",
  "sessionId": "browser-local-session-id",
  "messages": [
    {
      "role": "user",
      "messageId": "question-message-id",
      "content": "介绍一下这个项目"
    },
    {
      "role": "assistant",
      "messageId": "question-message-id",
      "content": "这是一个 WebSocket 前端聊天台。"
    }
  ]
}
```

### Assistant Content

```json
{
  "type": "content",
  "sessionId": "browser-local-session-id",
  "messageId": "question-message-id",
  "data": "流式正文片段"
}
```

Alternative content fields supported by the frontend:

```json
{
  "type": "content",
  "messageId": "question-message-id",
  "text": "流式正文片段"
}
```

```json
{
  "type": "content",
  "messageId": "question-message-id",
  "content": "流式正文片段"
}
```

### Thinking Or Status

`think` is rendered as a collapsible thinking block. Long thinking text is collapsed to about three lines by default.

```json
{
  "type": "status",
  "sessionId": "browser-local-session-id",
  "messageId": "question-message-id",
  "data": "Agent is thinking..."
}
```

Also supported:

```json
{
  "type": "think",
  "messageId": "question-message-id",
  "data": "模型思考或中间状态"
}
```

### Tool Calls

`tool_calls` is rendered inside the related assistant message as a collapsible tool-call block. The frontend reads the display content from `data`.

```json
{
  "type": "tool_calls",
  "sessionId": "browser-local-session-id",
  "messageId": "question-message-id",
  "data": [
    {
      "id": "155385943",
      "type": "function",
      "function": {
        "name": "tool_fileio/listDirectory",
        "arguments": "{\"path\":\"D:/Programs\"}"
      }
    }
  ]
}
```

### Tool Result

`tool_result` is rendered inside the related assistant message as a collapsible tool-result block. The frontend reads the display content from `data`.

```json
{
  "type": "tool_result",
  "sessionId": "browser-local-session-id",
  "messageId": "question-message-id",
  "data": {
    "tool_call_id": "155385943",
    "function_name": "tool_fileio/listDirectory",
    "result": "{\"success\":true,\"path\":\"D:/Programs\",\"contents\":[]}"
  }
}
```

### Error

```json
{
  "type": "error",
  "sessionId": "browser-local-session-id",
  "messageId": "question-message-id",
  "message": "错误原因"
}
```

### Close Assistant Display

Use `close` when the frontend should remove the assistant display for a message. This does not remove the user message.

```json
{
  "type": "close",
  "sessionId": "browser-local-session-id",
  "messageId": "question-message-id"
}
```

### End

```json
{
  "type": "end",
  "sessionId": "browser-local-session-id",
  "messageId": "question-message-id"
}
```

Also supported:

```json
{
  "type": "done",
  "messageId": "question-message-id"
}
```

```json
{
  "type": "finish",
  "messageId": "question-message-id"
}
```

## Recommended Minimal Stream

Client sends:

```json
{
  "type": "chat",
  "sessionId": "session-1",
  "messageId": "msg-1",
  "content": [
    {
      "type": "text",
      "text": "用 Markdown 回复一个列表"
    }
  ],
  "createdAt": "2026-05-11T10:00:00.000Z"
}
```

Server streams:

```json
{"type":"status","sessionId":"session-1","messageId":"msg-1","data":"Agent is thinking..."}
```

```json
{"type":"content","sessionId":"session-1","messageId":"msg-1","data":"## 示例回复\n\n"}
```

```json
{"type":"content","sessionId":"session-1","messageId":"msg-1","data":"- 第一项\n- 第二项\n\n```js\nconsole.log('hello')\n```"}
```

```json
{"type":"end","sessionId":"session-1","messageId":"msg-1"}
```

## Concurrent Message Demo

When two questions are running at the same time, return each stream with its own `messageId`.

```json
{"type":"content","sessionId":"session-1","messageId":"msg-A","data":"A 的第一段"}
```

```json
{"type":"content","sessionId":"session-1","messageId":"msg-B","data":"B 的第一段"}
```

```json
{"type":"end","sessionId":"session-1","messageId":"msg-B"}
```

```json
{"type":"end","sessionId":"session-1","messageId":"msg-A"}
```

The frontend will render A and B into different assistant bubbles.
