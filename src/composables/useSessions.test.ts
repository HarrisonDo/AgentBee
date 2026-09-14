import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildSessionTitle, useSessions } from './useSessions';

const storage = new Map<string, string>();

beforeEach(() => {
  storage.clear();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    removeItem: (key: string) => storage.delete(key),
    setItem: (key: string, value: string) => storage.set(key, value),
  });
  let counter = 0;
  vi.stubGlobal('window', {
    clearTimeout: vi.fn(),
    crypto: { randomUUID: () => `uuid-${counter += 1}` },
    setTimeout: vi.fn(() => 1),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('buildSessionTitle', () => {
  it('uses the first 8 characters of the first message', () => {
    expect(buildSessionTitle('帮我写一个网页')).toBe('帮我写一个网页');
    expect(buildSessionTitle('帮我写一个完整的登录页面')).toBe('帮我写一个完整的…');
  });

  it('collapses whitespace and falls back to a default', () => {
    expect(buildSessionTitle('  前端   预览  ')).toBe('前端 预览');
    expect(buildSessionTitle('   ')).toBe('New conversation');
  });
});

describe('useSessions', () => {
  it('starts with an empty list but still exposes a usable active session', () => {
    const sessions = useSessions();
    // 空列表是合法状态：不再凭空造一条「新对话」。
    expect(sessions.sessions.value).toHaveLength(0);
    expect(sessions.activeSessionId.value).toBe('');
    // 界面还要有东西可渲染，所以 activeSession 退回内存兜底。
    expect(sessions.activeSession.value).toBeTruthy();
    expect(sessions.activeSession.value.messages).toHaveLength(0);
  });

  it('uses the i18n placeholder for untitled sessions', () => {
    const sessions = useSessions({ defaultTitle: () => '新对话' });
    expect(sessions.activeSession.value.title).toBe('新对话');
    expect(sessions.createSession().title).toBe('新对话');

    sessions.addMessage('user', '   ');
    expect(sessions.activeSession.value.title).toBe('新对话');
  });

  it('finds a session by id and returns null for unknown ids', () => {
    const sessions = useSessions();
    const created = sessions.createSession();
    // sessions.value 里存的是响应式代理，按 id 比对即可。
    expect(sessions.getSessionById(created.id)?.id).toBe(created.id);
    expect(sessions.getSessionById(created.id)?.title).toBe(created.title);
    expect(sessions.getSessionById('missing')).toBeNull();
    expect(sessions.getSessionById('')).toBeNull();
  });

  it('keeps messages per session when switching', () => {
    const sessions = useSessions();
    // 列表为空时发消息会自动起一条会话。
    sessions.addMessage('user', '第一条消息');
    const first = sessions.activeSessionId.value;
    expect(first).toBeTruthy();
    expect(sessions.activeSession.value.title).toBe('第一条消息');

    sessions.createSession();
    const second = sessions.activeSessionId.value;
    expect(second).not.toBe(first);
    expect(sessions.activeSession.value.messages).toHaveLength(0);

    sessions.addMessage('user', '另一个会话');
    expect(sessions.sessions.value).toHaveLength(2);

    sessions.switchSession(first);
    expect(sessions.activeSession.value.id).toBe(first);
    expect(sessions.activeSession.value.messages.map((message) => message.content))
      .toEqual(['第一条消息']);
  });

  it('removes a session and falls back to another one', () => {
    const sessions = useSessions();
    sessions.createSession();
    const first = sessions.activeSessionId.value;
    sessions.createSession();
    const second = sessions.activeSessionId.value;

    expect(sessions.removeSession(second)).toBe(true);
    expect(sessions.sessions.value.map((session) => session.id)).toEqual([first]);
    expect(sessions.activeSessionId.value).toBe(first);
  });

  it('keeps the list empty after the last session is deleted', () => {
    const sessions = useSessions({ defaultTitle: () => '新对话' });
    sessions.createSession();

    expect(sessions.removeSession(sessions.activeSessionId.value)).toBe(true);
    // 删空就是删空，不再自动补一条，否则「删了刷新又冒出来」会一直复现。
    expect(sessions.sessions.value).toHaveLength(0);
    expect(sessions.activeSessionId.value).toBe('');
    expect(sessions.activeSession.value.messages).toHaveLength(0);
  });

  it('does not resurrect a session after the list is emptied and reloaded', () => {
    const first = useSessions({ defaultTitle: () => '新对话' });
    first.createSession();
    first.addMessage('user', '唯一的一条');
    first.removeSession(first.activeSessionId.value);
    expect(first.sessions.value).toHaveLength(0);
    first.saveSessions();

    // 刷新：localStorage 里不该残留任何会话（尤其是被自动补出来的空占位）。
    const second = useSessions({ defaultTitle: () => '新对话' });
    second.loadSessions();
    expect(second.sessions.value).toHaveLength(0);
    expect(second.activeSessionId.value).toBe('');
  });

  it('adds remote sessions without touching known ones', () => {
    const sessions = useSessions();
    sessions.addMessage('user', '本地在聊的话题');
    const local = sessions.activeSessionId.value;

    sessions.applyRemoteSessions([
      { session_id: local, session_name: '服务端的名字' },
      { session_id: 'remote-1', session_name: '秦始皇骑北极熊', create_time: '2026-09-14 08:00:00' },
      { session_id: 'remote-1', session_name: '重复项' },
      { session_id: '', session_name: '缺 id' },
    ]);

    const ids = sessions.sessions.value.map((session) => session.id);
    expect(ids).toContain('remote-1');
    expect(ids.filter((id) => id === 'remote-1')).toHaveLength(1);
    // 本地已有会话的消息不能被清掉。
    expect(sessions.activeSession.value.messages).toHaveLength(1);
    // 本地已经用第一句话起过标题，不覆盖。
    const renamed = sessions.sessions.value.find((session) => session.id === local);
    expect(renamed?.title).toBe('本地在聊的话题');
  });

  it('opens the most recent remote session on first load', () => {
    const sessions = useSessions({ defaultTitle: () => '新对话' });
    // 本地什么都没有，界面先渲染内存兜底。
    expect(sessions.sessions.value).toHaveLength(0);

    // 下面是后端 readSession 的真实返回（ORDER BY create_time DESC）。
    sessions.applyRemoteSessions([
      { session_id: '7bcad843-f95d-410d-9272-8bfb7eb7ade0', session_name: '新的对话', create_time: '2026-09-14 09:44:05' },
      { session_id: '9299e9a0-fcd4-4770-8acb-41e7321ac72c', session_name: '你好', create_time: '2026-09-14 09:44:00' },
    ]);

    expect(sessions.sessions.value.map((session) => session.id)).toEqual([
      '7bcad843-f95d-410d-9272-8bfb7eb7ade0',
      '9299e9a0-fcd4-4770-8acb-41e7321ac72c',
    ]);
    // 直接进入最近的一条，而不是停在内存兜底会话上。
    expect(sessions.activeSessionId.value).toBe('7bcad843-f95d-410d-9272-8bfb7eb7ade0');
    expect(sessions.activeSession.value.title).toBe('新的对话');
  });

  it('stays empty when the backend has no history', () => {
    const sessions = useSessions({ defaultTitle: () => '新对话' });

    sessions.applyRemoteSessions([]);

    // 后端也没有历史：列表保持为空，由用户自己点「新建会话」。
    expect(sessions.sessions.value).toHaveLength(0);
    expect(sessions.activeSessionId.value).toBe('');
  });

  it('drops locally cached sessions the backend no longer returns', () => {
    const sessions = useSessions({ defaultTitle: () => '新对话' });
    sessions.applyRemoteSessions([
      { session_id: 'keep', session_name: '留着的' },
      { session_id: 'gone', session_name: '被删掉的' },
    ]);

    // 模拟「删除已在服务端生效、本地却没同步到」：本地还留着 gone。
    sessions.applyRemoteSessions([{ session_id: 'keep', session_name: '留着的' }]);

    expect(sessions.sessions.value.map((session) => session.id)).toEqual(['keep']);
    expect(sessions.activeSessionId.value).toBe('keep');
  });

  it('does not jump away from a session the user already used', () => {
    const sessions = useSessions();
    sessions.addMessage('user', '我刚问的问题');
    const local = sessions.activeSessionId.value;

    sessions.applyRemoteSessions([
      { session_id: 'remote-new', session_name: '后端更新的会话', create_time: '2026-09-14 08:30:00' },
    ]);

    expect(sessions.activeSessionId.value).toBe(local);
    expect(sessions.activeSession.value.messages).toHaveLength(1);
  });

  it('cleans up a blank placeholder left behind by older local storage', () => {
    // 旧版本会把兜底占位一起存进 localStorage，加载后它还成了当前会话。
    storage.set('agentbee.sessions.v3', JSON.stringify([
      {
        id: 'stale-blank',
        title: '新对话',
        createdAt: '2026-09-14T09:50:00.000Z',
        updatedAt: '2026-09-14T09:50:00.000Z',
        messages: [],
      },
      {
        id: 'remote-1',
        title: '你好',
        remoteName: '你好',
        createdAt: '2026-09-14T09:44:00.000Z',
        updatedAt: '2026-09-14T09:44:00.000Z',
        messages: [],
      },
    ]));

    const sessions = useSessions({ defaultTitle: () => '新对话' });
    sessions.loadSessions();
    // 加载时就把历史遗留的兜底占位清掉，并落到还在的那条上。
    expect(sessions.sessions.value.map((session) => session.id)).toEqual(['remote-1']);
    expect(sessions.activeSessionId.value).toBe('remote-1');

    // 后端返回的这条本地早就知道，没有新增，列表保持不变。
    sessions.applyRemoteSessions([
      { session_id: 'remote-1', session_name: '你好', create_time: '2026-09-14 09:44:00' },
    ]);

    expect(sessions.sessions.value.map((session) => session.id)).toEqual(['remote-1']);
    expect(sessions.activeSessionId.value).toBe('remote-1');
  });

  it('keeps an empty session the user created on purpose', () => {
    const sessions = useSessions({ defaultTitle: () => '新对话' });
    sessions.addMessage('user', '旧话题');
    const previous = sessions.activeSessionId.value;
    const fresh = sessions.createSession();
    expect(sessions.activeSession.value.id).toBe(fresh.id);

    sessions.applyRemoteSessions([
      { session_id: 'remote-1', session_name: '服务端的会话', create_time: '2026-09-14 08:00:00' },
    ]);

    // 用户主动新建的空会话必须留着，而且仍然是当前会话。
    expect(sessions.sessions.value.map((session) => session.id)).toContain(fresh.id);
    expect(sessions.activeSessionId.value).toBe(fresh.id);
    expect(sessions.sessions.value.map((session) => session.id)).toContain(previous);

    // 一旦在里面说过话，就不再是空壳了（刷新也不会被当成占位）。
    sessions.addMessage('user', '新话题');
    expect(sessions.getSessionById(fresh.id)?.keepEmpty).toBeUndefined();
  });

  it('persists sessions and restores them', () => {
    const first = useSessions();
    first.addMessage('user', '要被记住的一句话');
    const id = first.activeSessionId.value;
    first.createSession();
    first.saveSessions();

    const second = useSessions();
    second.loadSessions();
    expect(second.sessions.value.map((session) => session.id)).toContain(id);
    expect(second.sessions.value.find((session) => session.id === id)?.messages)
      .toHaveLength(1);
  });
});
