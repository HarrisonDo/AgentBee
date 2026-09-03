# Backend Reference Demo

This is a reference flow for backend developers. It is not a required server implementation.

## On WebSocket Open

The frontend will send:

```json
{
  "type": "memory",
  "content": {
    "act": "read",
    "length": 50,
    "create_id": 0
  }
}
```

Backend may respond with:

```json
{
  "type": "memory",
  "act": "read",
  "status": "success",
  "data": [],
  "total": 0
}
```

## On User Message

Frontend sends:

```json
{
  "type": "text",
  "sessionId": "session-id-from-browser",
  "messageId": "msg-001",
  "message": "请用 Markdown 介绍 BeeWeb",
  "createdAt": "2026-05-11T10:00:00.000Z"
}
```

The actual WebSocket frame payload ends with `\n`.

Backend should stream:

```json
{
  "type": "status",
  "sessionId": "session-id-from-browser",
  "messageId": "msg-001",
  "data": "Agent is thinking..."
}
```

```json
{
  "type": "content",
  "sessionId": "session-id-from-browser",
  "messageId": "msg-001",
  "data": "## BeeWeb\n\n"
}
```

```json
{
  "type": "content",
  "sessionId": "session-id-from-browser",
  "messageId": "msg-001",
  "data": "- WebSocket 前端\n- 支持聊天记录\n- 支持 Markdown 渲染\n"
}
```

```json
{
  "type": "tool_calls",
  "sessionId": "session-id-from-browser",
  "messageId": "msg-001",
  "data": [
    {
      "id": "tool-001",
      "type": "function",
      "function": {
        "name": "read_file",
        "arguments": "{\"path\":\"README.md\"}"
      }
    }
  ]
}
```

```json
{
  "type": "tool_result",
  "sessionId": "session-id-from-browser",
  "messageId": "msg-001",
  "data": {
    "tool_call_id": "tool-001",
    "function_name": "read_file",
    "result": "README.md content..."
  }
}
```

```json
{
  "type": "end",
  "sessionId": "session-id-from-browser",
  "messageId": "msg-001"
}
```

## Pseudo Code

```js
function onMessage(raw, ws) {
  const msg = JSON.parse(raw);

  if (msg.type === "memory" && msg.content?.act === "read") {
    ws.send(JSON.stringify({
      type: "memory",
      act: "read",
      status: "success",
      data: readMemory(msg.content.length, msg.content.create_id),
      total: countMemory()
    }));
    return;
  }

  if (msg.type === "text") {
    const base = {
      sessionId: msg.sessionId,
      messageId: msg.messageId
    };

    ws.send(JSON.stringify({
      ...base,
      type: "status",
      data: "Agent is thinking..."
    }));

    for (const chunk of modelStream(msg.message)) {
      ws.send(JSON.stringify({
        ...base,
        type: "content",
        data: chunk
      }));
    }

    ws.send(JSON.stringify({
      ...base,
      type: "end"
    }));
  }
}
```

## Concurrent Replies

If two user messages are running together, keep their streams separate by `messageId`.

```json
{"type":"content","sessionId":"s1","messageId":"msg-A","data":"A chunk"}
```

```json
{"type":"content","sessionId":"s1","messageId":"msg-B","data":"B chunk"}
```

## Close Assistant Display

To remove an assistant loading/reply bubble without deleting the user message:

```json
{"type":"close","sessionId":"s1","messageId":"msg-A"}
```
