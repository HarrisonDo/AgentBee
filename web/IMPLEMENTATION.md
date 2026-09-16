# 子Agent功能实现说明

## 概述

本次更新为BeeWeb添加了子Agent对话独立显示功能。当后端消息包含 `isSubTalk: 1` 时，消息将显示在右侧独立面板而非主聊天区。

## 核心实现

### 1. 类型定义扩展 (`src/protocol/types.ts`)

为 `ChatMessage` 和 `ServerMessage` 接口添加 `isSubTalk` 字段：

```typescript
export interface ChatMessage {
  // ... 其他字段
  isSubTalk?: number;
}

export interface ServerMessage {
  // ... 其他字段
  isSubTalk?: number;
}
```

### 2. WebSocket处理 (`src/composables/useWebSocketAgent.ts`)

更新 `applySenderMeta` 函数，将 `isSubTalk` 字段从服务端消息复制到本地消息对象。

### 3. 子Agent面板组件 (`src/components/SubAgentPanel.vue`)

新增独立组件，实现：
- 右侧竖向Tab栏，根据 `workerName` 分组显示子Agent
- 消息计数徽章
- 可展开的消息面板
- 复用 `ChatMessage` 组件渲染子Agent消息

### 4. 主应用集成 (`src/App.vue`)

- 过滤主聊天区消息：`isSubTalk !== 1`
- 提取子Agent消息：`isSubTalk === 1`
- 根据 `workerName` 统计和分组子Agent
- 集成 `SubAgentPanel` 组件

### 5. 国际化支持 (`src/composables/useI18n.ts`)

添加翻译文本：`close`、`noMessages`、`subAgent`

## 协议说明

### 后端发送子Agent消息

```json
{
  "type": "content",
  "sessionId": "session-id",
  "messageId": "message-id",
  "data": "消息内容",
  "workerName": "worker_name",
  "workerRole": "Worker角色",
  "isSubTalk": 1
}
```

### 后端发送主Agent消息

```json
{
  "type": "content",
  "sessionId": "session-id",
  "messageId": "message-id",
  "data": "消息内容",
  "workerName": "AgentBee",
  "workerRole": "Assistant",
  "isSubTalk": 0
}
```

## 关键字段

- **isSubTalk**: `1` 表示子Agent消息，`0` 或不传表示主Agent消息
- **workerName**: 必需，用于识别和分组不同的子Agent
- **workerRole**: 可选，显示名称

## 消息分组逻辑

前端根据 `workerName` 对子Agent消息进行分组：
- 相同 `workerName` 的消息显示在同一个Tab下
- 每个Tab显示该子Agent的消息总数
- 点击Tab展开显示该子Agent的完整对话

## UI特性

- **位置**: 右侧竖向Tab栏，固定宽度420px面板
- **交互**: 点击Tab展开/收起面板
- **徽章**: 显示各子Agent的消息数量
- **样式**: 使用项目统一的CSS变量，支持明暗主题

## 兼容性

- ✅ 向后兼容：不带 `isSubTalk` 的消息正常显示在主聊天区
- ✅ 存储兼容：子Agent消息保存在localStorage，刷新后恢复
- ✅ 渐进增强：后端可以逐步采用此功能

## 文件清单

### 新增文件
- `src/components/SubAgentPanel.vue` - 子Agent面板组件
- `SUB_AGENT_FEATURE.md` - 详细功能文档

### 修改文件
- `src/protocol/types.ts` - 添加 `isSubTalk` 字段
- `src/composables/useWebSocketAgent.ts` - 处理 `isSubTalk` 字段
- `src/composables/useI18n.ts` - 添加国际化文本
- `src/App.vue` - 集成子Agent面板
- `README.md` - 更新功能列表
- `WS_BACKEND_TEMPLATE.md` - 添加协议说明

## 构建验证

- ✅ TypeScript类型检查通过
- ✅ Vite构建成功
- ✅ 无语法错误
- ✅ 组件正确集成

## 使用方法

1. 后端在需要发送子Agent消息时添加 `isSubTalk: 1` 字段
2. 确保提供 `workerName` 用于分组
3. 前端会自动识别并在右侧面板显示
4. 用户点击右侧Tab查看对应子Agent的对话

详细说明请参考 `SUB_AGENT_FEATURE.md`。
