import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChatMessage, ChatSession } from '../protocol/types';
import {
  createWebSocketConnection,
  useWebSocketAgent,
  validateWebSocketUrl,
} from './useWebSocketAgent';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('validateWebSocketUrl', () => {
  it('accepts ws and wss URLs on an HTTP page', () => {
    expect(validateWebSocketUrl('ws://127.0.0.1:8686', 'http:')).toBeNull();
    expect(validateWebSocketUrl('wss://agent.example.test/socket', 'http:')).toBeNull();
  });

  it('accepts wss on an HTTPS page', () => {
    expect(validateWebSocketUrl('wss://agent.example.test/socket', 'https:')).toBeNull();
  });

  it('reports malformed and unsupported URLs', () => {
    expect(validateWebSocketUrl('127.0.0.1:8686', 'http:')?.kind).toBe('invalid-url');
    expect(validateWebSocketUrl('https://agent.example.test', 'http:')?.kind).toBe('invalid-url');
  });

  it('reports insecure ws from an HTTPS page as mixed content', () => {
    expect(validateWebSocketUrl('ws://agent.example.test/socket', 'https:')?.kind).toBe('mixed-content');
  });
});

describe('createWebSocketConnection', () => {
  it('omits the subprotocol argument when the token is empty', () => {
    const calls: Array<[string, string | string[] | undefined]> = [];
    class FakeWebSocket {
      constructor(url: string, protocols?: string | string[]) {
        calls.push([url, protocols]);
      }
    }

    createWebSocketConnection(
      'ws://127.0.0.1:8686',
      '   ',
      FakeWebSocket as unknown as typeof WebSocket,
    );

    expect(calls).toEqual([['ws://127.0.0.1:8686', undefined]]);
  });

  it('uses a non-empty token as the WebSocket subprotocol', () => {
    const calls: Array<[string, string | string[] | undefined]> = [];
    class FakeWebSocket {
      constructor(url: string, protocols?: string | string[]) {
        calls.push([url, protocols]);
      }
    }

    createWebSocketConnection(
      'wss://agent.example.test/socket',
      ' token-value ',
      FakeWebSocket as unknown as typeof WebSocket,
    );

    expect(calls).toEqual([['wss://agent.example.test/socket', ['token-value']]]);
  });
});

describe('sendText reconnect dispatch', () => {
  it('opens one connection and sends the queued message only after it is open', () => {
    const sockets: FakeWebSocket[] = [];
    class FakeWebSocket {
      static readonly CLOSED = 3;
      static readonly CONNECTING = 0;
      static readonly OPEN = 1;

      readonly [Symbol.toStringTag] = 'WebSocket';

      onclose: ((event: CloseEvent) => void) | null = null;
      onerror: (() => void) | null = null;
      onmessage: ((event: MessageEvent) => void) | null = null;
      onopen: (() => void) | null = null;
      readyState = FakeWebSocket.CONNECTING;
      sent: string[] = [];

      constructor() {
        sockets.push(this);
      }

      close() {
        this.readyState = FakeWebSocket.CLOSED;
      }

      open() {
        this.readyState = FakeWebSocket.OPEN;
        this.onopen?.();
      }

      send(payload: string) {
        this.sent.push(payload);
      }
    }

    let nextId = 0;
    const session: ChatSession = {
      id: 'session-1',
      title: 'Test',
      createdAt: '',
      updatedAt: '',
      messages: [],
    };
    const addMessage = vi.fn((
      role: ChatMessage['role'],
      content: string,
      extra: Partial<ChatMessage> = {},
    ) => {
      const message: ChatMessage = {
        id: `local-${nextId += 1}`,
        role,
        content,
        time: '',
        ...extra,
      };
      session.messages.push(message);
      return message;
    });
    const storage = new Map<string, string>();
    vi.stubGlobal('WebSocket', FakeWebSocket);
    vi.stubGlobal('navigator', { onLine: true });
    vi.stubGlobal('document', {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      visibilityState: 'visible',
    });
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      removeItem: (key: string) => storage.delete(key),
      setItem: (key: string, value: string) => storage.set(key, value),
    });
    vi.stubGlobal('window', {
      addEventListener: vi.fn(),
      clearTimeout: vi.fn(),
      crypto: { randomUUID: () => `uuid-${nextId += 1}` },
      location: { protocol: 'http:' },
      removeEventListener: vi.fn(),
      setTimeout: vi.fn(() => 1),
    });
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const agent = useWebSocketAgent({
      activeSession: () => session,
      addMessage,
      saveSessions: vi.fn(),
      scheduleSaveSessions: vi.fn(),
      touchSession: vi.fn(),
    });
    const dispatched = vi.fn();

    expect(agent.sendText('send after reconnect', [], dispatched)).toBe(true);
    expect(sockets).toHaveLength(1);
    expect(session.messages.some((message) => message.role === 'user')).toBe(false);
    expect(dispatched).not.toHaveBeenCalled();

    sockets[0].open();

    expect(dispatched).toHaveBeenCalledOnce();
    expect(dispatched).toHaveBeenCalledWith(true);
    expect(session.messages.some((message) => (
      message.role === 'user' && message.content === 'send after reconnect'
    ))).toBe(true);
    expect(sockets[0].sent).toHaveLength(1);
    expect(JSON.parse(sockets[0].sent[0])).toMatchObject({
      content: [{ type: 'text', text: 'send after reconnect' }],
      sessionId: 'session-1',
      type: 'chat',
    });
  });
});
