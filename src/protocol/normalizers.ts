import type { ChatImage, ServerMessage, ToolEvent } from './types';

const DEFAULT_IMAGE_MIME = 'image/png';

export function normalizePayload(msg: ServerMessage): string {
  const data = msg.data ?? msg.text ?? msg.content ?? msg.delta ?? '';
  return typeof data === 'string' ? data : JSON.stringify(data, null, 2);
}

export function normalizeServerError(msg: ServerMessage): string {
  const isErrorEvent = msg.status === 'error' || getServerType(msg) === 'error' || msg.error !== undefined;
  if (!isErrorEvent) return '';

  const error = asRecord(msg.error);
  const message = asString(error.message) || asString(msg.error) || msg.message || '';

  const details = [
    asString(error.code),
    asString(error.type),
  ].filter(Boolean);
  const suffix = details.length ? ` (${details.join(', ')})` : '';
  const act = msg.act ? `${msg.act}: ` : '';

  return `${act}${message || 'Server returned an error.'}${suffix}`;
}

export function getServerType(msg: ServerMessage): string {
  return String(msg.type || msg.event || msg.role || '');
}

export function getMessageId(msg: ServerMessage): string | null {
  return msg.messageId || msg.turnId || msg.requestId || null;
}

export function parseServerMessage(raw: string): ServerMessage | string {
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : String(raw);
  } catch {
    return raw;
  }
}

export function normalizeToolEvent(
  kind: ToolEvent['kind'],
  msg: ServerMessage,
  makeId: () => string,
  nowTime: () => string,
): ToolEvent {
  if (kind === 'tool_calls') {
    const calls = Array.isArray(msg.data) ? msg.data : [msg.data || msg];
    const primary = asRecord(calls[0]);
    const fn = asRecord(primary.function);

    return {
      id: msg.toolCallId || asString(primary.id) || makeId(),
      kind,
      name: asString(fn.name) || asString(primary.name) || msg.name || msg.tool || '',
      ok: msg.ok,
      summary: calls
        .map((call) => {
          const record = asRecord(call);
          const callFn = asRecord(record.function);
          return asString(callFn.name) || asString(record.name) || asString(record.id) || 'tool call';
        })
        .join(', '),
      data: calls.map(formatToolCall).join('\n\n'),
      time: nowTime(),
    };
  }

  const data = msg.data && typeof msg.data === 'object' && !Array.isArray(msg.data) ? asRecord(msg.data) : {};

  return {
    id: msg.toolCallId || asString(data.tool_call_id) || makeId(),
    kind,
    name: asString(data.function_name) || msg.name || msg.tool || '',
    ok: msg.ok ?? asBoolean(data.ok),
    summary: asString(data.function_name) || asString(data.tool_call_id) || '',
    data: formatToolResult(data, msg),
    time: nowTime(),
  };
}

export function normalizeImageEvent(
  msg: ServerMessage,
  makeId: () => string,
  nowTime: () => string,
): ChatImage | null {
  const payload = msg.data ?? msg.content ?? msg.text;
  const record = asRecord(payload);

  // 优先支持新格式：data 直接是 base64 字符串，prompt 在同级
  const base64 = asString(payload)
    || asString(record.url)
    || asString(record.base64)
    || asString(record.data)
    || asString(record.image);
  if (!base64.trim()) return null;

  // 优先从 msg.prompt 读取（新格式），然后才是嵌套在 data 里的 prompt
  const mimeType = asString(record.mimeType) || asString(record.mime_type) || asString(msg.mimeType) || DEFAULT_IMAGE_MIME;
  const prompt = msg.prompt
    || asString(record.prompt)
    || asString(record.text)
    || asString(msg.text)
    || msg.message
    || '';

  return {
    id: asString(record.id) || msg.messageId || makeId(),
    src: toImageDataUrl(base64.trim(), mimeType),
    prompt: asString(prompt).trim(),
    time: nowTime(),
  };
}

function toImageDataUrl(value: string, mimeType: string): string {
  if (/^(data:|https?:\/\/)/i.test(value)) return value;
  return `data:${mimeType};base64,${value}`;
}

function formatToolCall(call: unknown): string {
  const record = asRecord(call);
  const fn = asRecord(record.function);
  const details = {
    id: record.id,
    type: record.type,
    name: fn.name || record.name,
    arguments: parseJsonMaybe(fn.arguments || record.arguments || record.args),
  };

  return formatObject(details);
}

function formatToolResult(data: Record<string, unknown>, msg: ServerMessage): string {
  if (Object.keys(data).length) {
    return formatObject(parseToolResultData(data));
  }

  return formatObject(parseJsonMaybe(msg.result ?? msg.content ?? msg.data));
}

function parseToolResultData(data: Record<string, unknown>): Record<string, unknown> {
  const parsed = { ...data };
  for (const key of ['result', 'content', 'data', 'output']) {
    if (key in parsed) parsed[key] = parseJsonMaybe(parsed[key]);
  }
  return parsed;
}

function parseJsonMaybe(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function formatObject(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}
