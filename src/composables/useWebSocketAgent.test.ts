import { describe, expect, it } from 'vitest';
import {
  createWebSocketConnection,
  validateWebSocketUrl,
} from './useWebSocketAgent';

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
