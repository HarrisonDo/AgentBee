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

export interface ChatSession {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
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

export interface ClientMemoryReadRequest {
  type: 'memory';
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

export type ClientMessage =
  | ClientChatMessage
  | ClientHistoryRequest
  | ClientMemoryReadRequest
  | ClientMemoryDeleteRequest
  | ClientStopRequest
  | ClientSettingRequest
  | ClientSystemRequest;

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
}
