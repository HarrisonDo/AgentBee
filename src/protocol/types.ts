export type MessageRole = 'user' | 'assistant' | 'system' | 'error' | 'tool';
export type AssistantStatus = 'loading' | 'done' | 'error' | 'stopped';
export type ServerEventType =
  | 'history'
  | 'memory'
  | 'content'
  | 'assistant'
  | 'message'
  | 'think'
  | 'thinking'
  | 'status'
  | 'tool_calls'
  | 'tool_call'
  | 'tool'
  | 'tool_result'
  | 'image'
  | 'file'
  | 'html'
  | 'document'
  | 'error'
  | 'end'
  | 'done'
  | 'finish'
  | 'close';

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  time: string;
  attachments?: ChatAttachment[];
  messageId?: string;
  senderName?: string;
  senderRole?: string;
  WindowName?: string;
  think?: string;
  images?: ChatImage[];
  files?: ChatFile[];
  toolEvents?: ToolEvent[];
  status?: AssistantStatus;
  isSubTalk?: number;
  /** Runtime-only metadata for records loaded through memory/read. */
  memoryCreateId?: number;
  isRemoteHistory?: boolean;
}

export interface ChatAttachment {
  id: string;
  name: string;
  size: number;
  type: string;
  base64?: string;
}

export interface ChatImage {
  id: string;
  /** Data URL ready for an img src, built from the server base64 payload. */
  src: string;
  prompt: string;
  time: string;
}

export type ChatFileSource = 'content' | 'url' | 'path';

export interface ChatFile {
  id: string;
  name: string;
  mimeType: string;
  size?: number;
  /** Raw text, base64, or a data URL supplied by the server. */
  content?: string;
  /** Whether content is base64 encoded. Data URLs do not need this flag. */
  encoding?: 'text' | 'base64';
  /** Remote URL or a generated workspace URL. */
  url?: string;
  /** Original local/workspace path when the server did not return bytes. */
  path?: string;
  source: ChatFileSource;
  time: string;
}

export interface ChatSession {
  /** 同时作为发给后端的 sessionId；新建会话由前端生成。 */
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  /** 后端 readSession 里同步过来的名称；本地标题会被第一句话覆盖。 */
  remoteName?: string;
  /**
   * 用户在界面上主动点的「新建会话」留的空壳。
   * 它和 `ensureSession()` 兜底出来的空占位长得一样，但语义不同：
   * 兜底占位在后端有历史时要被丢掉（直接进最近一条会话），用户主动新建的要留着。
   * 一旦这个会话发出第一条消息，标记就没意义了。
   */
  keepEmpty?: boolean;
  messages: ChatMessage[];
}

export interface ToolEvent {
  id: string;
  kind: 'tool_calls' | 'tool_result';
  name: string;
  ok?: boolean;
  summary: string;
  data: string;
  time: string;
}

export interface ClientAttachment extends ChatAttachment {}

export interface ClientChatMessage {
  type: 'chat';
  sessionId: string;
  messageId: string;
  content: ClientChatContentPart[];
  createdAt: string;
}

export type ClientChatContentPart =
  | {
    type: 'text';
    text: string;
  }
  | {
    type: 'file';
    file: {
      filename: string;
      mimeType: string;
      content: string;
    };
  };

export interface ClientHistoryRequest {
  type: 'history_request';
  sessionId: string;
}

/**
 * 会话 CRUD 目前复用 memory 这个 type：后端 `process_memory` 里
 * 直接 switch 了 read / delete / readSession / deleteSession 四个 act。
 */
export type ClientMemoryAct = 'read' | 'delete' | ClientSessionAct;

export interface ClientMemoryReadRequest {
  type: 'memory';
  /**
   * 必须带当前会话 id：后端 `go.php:863` 会用这个**顶层**字段覆盖 `utils->session_id`，
   * 而 `message.php process_memory` 的 read 分支把这个值传给 `Memory::read()`，
   * 只有非空时才会给 `agent_memory` 加 `session_id` 过滤。
   * 不带就等于「读全局历史」——新建的会话会看到别的会话的记录。
   */
  sessionId?: string;
  content: {
    act: 'read';
    length: number;
    create_id: number;
  };
}

export interface ClientMemoryDeleteRequest {
  type: 'memory';
  content: {
    act: 'delete';
    create_ids: number[];
  };
}

export interface ClientMemorySessionRequest {
  type: 'memory';
  content: {
    act: ClientSessionAct;
    sessionId?: string;
  };
}

export interface MemoryRecord {
  content: string;
  create_id: number;
  create_time: string;
  level: string;
  role: MessageRole;
}

export interface ClientStopRequest {
  type: 'stop';
  sessionId: string | null;
  messageId: string | null;
}

export type ClientSettingAct = 'getConfig' | 'getDefaultConfig' | 'saveConfig';

export interface ClientSettingRequest {
  type: 'setting';
  content: {
    act: ClientSettingAct;
    data?: unknown;
  };
}

export type ClientSystemAct = 'getModels';

export interface ClientSystemRequest {
  type: 'system';
  content: {
    act: ClientSystemAct;
    data?: unknown;
  };
}

export type ClientSessionAct = 'readSession' | 'deleteSession';

export interface ClientSessionRequest {
  type: 'session';
  content: {
    act: ClientSessionAct;
    sessionId?: string;
    [key: string]: unknown;
  };
}

/** 后端 readSession 返回的一条会话记录。 */
export interface RemoteSession {
  session_id: string;
  session_name?: string;
  session_status?: string | number;
  create_time?: string | number;
}

export type ClientMessage =
  | ClientChatMessage
  | ClientHistoryRequest
  | ClientMemoryReadRequest
  | ClientMemoryDeleteRequest
  | ClientMemorySessionRequest
  | ClientStopRequest
  | ClientSettingRequest
  | ClientSystemRequest
  | ClientSessionRequest;

export interface ServerMessage {
  type?: ServerEventType | string;
  act?: string;
  event?: string;
  role?: string;
  sessionId?: string;
  messageId?: string;
  workerName?: string;
  workerRole?: string;
  WindowName?: string;
  turnId?: string;
  requestId?: string;
  status?: string;
  total?: number;
  deleted?: number;
  create_id?: number;
  message?: string;
  error?: unknown;
  data?: unknown;
  text?: unknown;
  content?: unknown;
  delta?: unknown;
  messages?: Array<Record<string, unknown>>;
  toolCallId?: string;
  name?: string;
  tool?: string;
  ok?: boolean;
  result?: unknown;
  isSubTalk?: number;
  prompt?: string;
  mimeType?: string;
  filename?: string;
  file?: unknown;
  path?: string;
  url?: string;
  href?: string;
  encoding?: string;
}
