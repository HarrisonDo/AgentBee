# 子Agent功能 - 快速参考

## 🎯 核心概念

- **主Agent消息**: 显示在主聊天区（左侧）
- **子Agent消息**: 显示在右侧独立面板
- **区分标识**: `isSubTalk: 1` 字段
- **分组依据**: `workerName` 字段

## 📋 后端协议

### 发送子Agent消息

```json
{
  "type": "content",
  "data": "消息内容",
  "workerName": "worker_name",
  "workerRole": "显示名称",
  "isSubTalk": 1,
  "sessionId": "session-id",
  "messageId": "message-id"
}
```

### 发送主Agent消息

```json
{
  "type": "content",
  "data": "消息内容",
  "workerName": "AgentBee",
  "workerRole": "Assistant",
  "isSubTalk": 0,
  "sessionId": "session-id",
  "messageId": "message-id"
}
```

## 🔑 关键字段

| 字段 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `isSubTalk` | `number` | 是 | `1`=子Agent，`0`=主Agent |
| `workerName` | `string` | 是 | 用于识别和分组子Agent |
| `workerRole` | `string` | 否 | 显示名称 |

## 💻 代码示例

### Python
```python
import json

# 子Agent
ws.send(json.dumps({
    "type": "content",
    "data": "搜索中...",
    "workerName": "search_worker",
    "workerRole": "搜索助手",
    "isSubTalk": 1,
    "sessionId": session_id,
    "messageId": message_id
}))

# 主Agent
ws.send(json.dumps({
    "type": "content",
    "data": "处理完成",
    "workerName": "AgentBee",
    "workerRole": "Assistant",
    "isSubTalk": 0,
    "sessionId": session_id,
    "messageId": message_id
}))
```

### Node.js
```javascript
// 子Agent
ws.send(JSON.stringify({
    type: 'content',
    data: '搜索中...',
    workerName: 'search_worker',
    workerRole: '搜索助手',
    isSubTalk: 1,
    sessionId: sessionId,
    messageId: messageId
}));

// 主Agent
ws.send(JSON.stringify({
    type: 'content',
    data: '处理完成',
    workerName: 'AgentBee',
    workerRole: 'Assistant',
    isSubTalk: 0,
    sessionId: sessionId,
    messageId: messageId
}));
```

## 📱 前端展示

```
┌─────────────────────────────────┬──────┐
│                                 │ 🔍 3 │
│   主聊天区                      │ 📊 2 │
│   (isSubTalk=0的消息)          │      │
│                                 └──────┘
│   用户: 帮我查询天气                    
│   AgentBee: 正在处理...               
│                                        
└────────────────────────────────────────┘

点击右侧Tab后:
┌─────────────────┬──────────────┬──────┐
│                 │              │ 🔍 3 │
│   主聊天区      │ 搜索助手     │ 📊 2 │
│                 │ ──────────── │      │
│                 │ 搜索中...    │      │
│                 │ 连接API...   │      │
│                 │ 查询成功     │      │
└─────────────────┴──────────────┴──────┘
```

## 📚 文档

- **完整功能**: `SUB_AGENT_FEATURE.md`
- **实现说明**: `IMPLEMENTATION.md`
- **协议模板**: `WS_BACKEND_TEMPLATE.md`
- **项目说明**: `README.md`

## ✅ 已验证

- [x] TypeScript 类型检查
- [x] Vite 构建成功
- [x] 组件正确集成
- [x] 国际化支持
- [x] 本地存储持久化
- [x] 向后兼容

## 🚀 快速开始

1. 后端发送带有 `isSubTalk: 1` 的消息
2. 前端自动显示在右侧面板
3. 用户点击Tab查看子Agent对话

就这么简单！
