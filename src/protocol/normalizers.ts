import type { ServerMessage, ToolEvent } from './types';

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
