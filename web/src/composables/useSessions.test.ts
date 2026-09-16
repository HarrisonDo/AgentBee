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

describe('renameSession', () => {
  it('renames a session and flags the title as manually edited', () => {
    const sessions = useSessions();
    sessions.addMessage('user', '原来叫这个名字');
    const id = sessions.activeSessionId.value;

    expect(sessions.renameSession(id, '  我的   分析报告  ')).toBe('我的 分析报告');
    const session = sessions.getSessionById(id);
    expect(session?.title).toBe('我的 分析报告');
    expect(session?.titleEdited).toBe(true);
  });

  it('rejects a blank title instead of clearing the old one', () => {
    const sessions = useSessions();
    sessions.addMessage('user', '别把我清空');
    const id = sessions.activeSessionId.value;

    expect(sessions.renameSession(id, '   ')).toBeNull();
    expect(sessions.renameSession(id, '')).toBeNull();
    expect(sessions.getSessionById(id)?.title).toBe('别把我清空');
    // 被拒绝的这次操作不该留下「改过名」的痕迹。
    expect(sessions.getSessionById(id)?.titleEdited).toBeUndefined();
  });

  it('returns null for an unknown session id', () => {
    const sessions = useSessions();
    sessions.addMessage('user', '存在的一条');
    expect(sessions.renameSession('missing', '新名字')).toBeNull();
    expect(sessions.renameSession('', '新名字')).toBeNull();
    expect(sessions.sessions.value[0].title).toBe('存在的一条');
  });

  it('truncates and stays idempotent for over-long titles', () => {
    const sessions = useSessions();
    sessions.addMessage('user', '起点');
    const id = sessions.activeSessionId.value;
    const long = '一二三四五六七八九十'.repeat(6);

    const trimmed = sessions.renameSession(id, long);
    expect(trimmed).toHaveLength(40);
    // 再编辑一次同一个标题不该继续增长（截断不带省略号的原因）。
    expect(sessions.renameSession(id, trimmed as string)).toBe(trimmed);
  });

  it('is not overwritten by the backend session_name on reconnect', () => {
    const sessions = useSessions();
    sessions.addMessage('user', '第一句话');
    const id = sessions.activeSessionId.value;
    sessions.renameSession(id, '我起的名字');

    sessions.applyRemoteSessions([
      { session_id: id, session_name: '第一句话', create_time: '2026-09-14 09:44:00' },
    ]);

    expect(sessions.getSessionById(id)?.title).toBe('我起的名字');
    // 后端的原名还是要记下来，将来同步改名要以它为准。
    expect(sessions.getSessionById(id)?.remoteName).toBe('第一句话');
  });

  it('is not overwritten by the first-message auto title', () => {
    const sessions = useSessions({ defaultTitle: () => '新对话' });
    const fresh = sessions.createSession();
    // 还没说话就先改好名字（用户主动命名一个空会话）。
    expect(sessions.renameSession(fresh.id, '先起好名字')).toBe('先起好名字');

    sessions.addMessage('user', '这句话不该变成标题');
    expect(sessions.getSessionById(fresh.id)?.title).toBe('先起好名字');
  });

  it('does not reorder the list or touch the timestamp', () => {
    const sessions = useSessions();
    sessions.addMessage('user', '第一个话题');
    const older = sessions.activeSessionId.value;
    sessions.createSession();
    sessions.addMessage('user', '第二个话题');
    const newer = sessions.activeSessionId.value;

    expect(sessions.sessions.value.map((session) => session.id)).toEqual([newer, older]);
    const before = sessions.getSessionById(older)?.updatedAt;

    sessions.renameSession(older, '改个名字');

    // 改名不是一次会话活动：不该把它顶到最前，时间戳也该继续显示最后一次聊天的时间。
    expect(sessions.sessions.value.map((session) => session.id)).toEqual([newer, older]);
    expect(sessions.getSessionById(older)?.updatedAt).toBe(before);
  });

  it('survives a reload and keeps the flag', () => {
    const first = useSessions({ defaultTitle: () => '新对话' });
    first.addMessage('user', '会被记住的会话');
    const id = first.activeSessionId.value;
    first.renameSession(id, '我改过的名字');
    first.saveSessions();

    const second = useSessions({ defaultTitle: () => '新对话' });
    second.loadSessions();
    expect(second.getSessionById(id)?.title).toBe('我改过的名字');
    expect(second.getSessionById(id)?.titleEdited).toBe(true);
  });

  it('rolls a failed backend rename back, including the edited flag', () => {
    const sessions = useSessions();
    sessions.addMessage('user', '原来的标题');
    const id = sessions.activeSessionId.value;
    const previous = sessions.getSessionById(id)?.title as string;
    expect(sessions.getSessionById(id)?.titleEdited).toBeUndefined();

    sessions.renameSession(id, '改过的名字');
    expect(sessions.getSessionById(id)?.titleEdited).toBe(true);

    // 后端回 error → 回滚不仅要把名字退回去，`titleEdited` 也得还原成 false：
    // 这次改名根本没生效，不该留下「用户手动命名过」的痕迹。
    expect(sessions.restoreSessionTitle(id, previous, false)).toBe(true);
    expect(sessions.getSessionById(id)?.title).toBe(previous);
    expect(sessions.getSessionById(id)?.titleEdited).toBeUndefined();
  });

  it('rolls back to the previous name when an earlier rename had already succeeded', () => {
    const sessions = useSessions();
    sessions.addMessage('user', '起点');
    const id = sessions.activeSessionId.value;

    sessions.renameSession(id, '第一次改名');
    sessions.renameSession(id, '第二次改名');
    sessions.restoreSessionTitle(id, '第一次改名', true);

    expect(sessions.getSessionById(id)?.title).toBe('第一次改名');
    // 第一次改名是成功的，所以标记要留着。
    expect(sessions.getSessionById(id)?.titleEdited).toBe(true);
  });
});

describe('opening the window', () => {
  it('never persists an unused new session, and drops legacy ones on load', () => {
    // 1) 用户点了「新建会话」但一句话都没说 → 不写盘。
    const first = useSessions({ defaultTitle: () => '新对话' });
    first.createSession();
    expect(first.sessions.value).toHaveLength(1);
    first.saveSessions();

    const second = useSessions({ defaultTitle: () => '新对话' });
    second.loadSessions();
    expect(second.sessions.value).toHaveLength(0);

    // 2) 早期版本把它连 `keepEmpty` 一起存了下来 → 打开时清掉。
    //    否则它会排在列表最前面，看起来就像「一打开窗口又自动新建了一个」。
    storage.set('agentbee.sessions.v3', JSON.stringify([
      {
        id: 'legacy-shell',
        title: '新对话',
        createdAt: '2026-09-15T09:00:00.000Z',
        updatedAt: '2026-09-15T09:00:00.000Z',
        keepEmpty: true,
        messages: [],
      },
      {
        id: 'real',
        title: '聊过的',
        remoteName: '聊过的',
        createdAt: '2026-09-14T09:00:00.000Z',
        updatedAt: '2026-09-14T09:00:00.000Z',
        messages: [{ id: 'm1', role: 'user', content: 'hi', time: '' }],
      },
    ]));

    const third = useSessions({ defaultTitle: () => '新对话' });
    third.loadSessions();
    expect(third.sessions.value.map((session) => session.id)).toEqual(['real']);
    expect(third.activeSessionId.value).toBe('real');
  });

  it('lands on the first session when the first readSession arrives', () => {
    // 上次退出时停在缓存里的这一条上。注意时间要用**绝对时刻**比：
    // 后端 `create_time` 是本地时间字符串，存进本地的是 ISO(UTC)，两边的时刻要对得上。
    storage.set('agentbee.sessions.v3', JSON.stringify([
      {
        id: 'cached',
        title: '缓存里的',
        remoteName: '缓存里的',
        createdAt: '2026-09-13T01:00:00.000Z',
        updatedAt: '2026-09-13T01:00:00.000Z',
        messages: [{ id: 'm1', role: 'user', content: 'hi', time: '' }],
      },
    ]));

    const sessions = useSessions({ defaultTitle: () => '新对话' });
    sessions.loadSessions();
    expect(sessions.activeSessionId.value).toBe('cached');

    // 打开窗口后的第一份 readSession：应该定位到第一条（最近一条），
    // 而不是停在缓存里那条，更不该凭空造一个新的。
    sessions.applyRemoteSessions([
      { session_id: 'newest', session_name: '刚聊的', create_time: '2026-09-14 10:00:00' },
      { session_id: 'cached', session_name: '缓存里的', create_time: '2026-09-13 09:00:00' },
    ]);

    expect(sessions.sessions.value.map((session) => session.id)).toEqual(['newest', 'cached']);
    expect(sessions.activeSessionId.value).toBe('newest');
  });

  it('does not drag the user back on later refreshes', () => {
    const sessions = useSessions({ defaultTitle: () => '新对话' });
    const remote = [
      { session_id: 'newest', session_name: '最近的', create_time: '2026-09-14 10:00:00' },
      { session_id: 'older', session_name: '早一点的', create_time: '2026-09-14 09:00:00' },
    ];
    sessions.applyRemoteSessions(remote);
    expect(sessions.activeSessionId.value).toBe('newest');

    expect(sessions.switchSession('older')).toBe(true);
    // 手动点刷新：用户已经在 older 里了，不能再被拽回第一条。
    sessions.applyRemoteSessions(remote);

    expect(sessions.activeSessionId.value).toBe('older');
  });

  it('does not drag the user back after they already sent a message', () => {
    const sessions = useSessions({ defaultTitle: () => '新对话' });
    sessions.applyRemoteSessions([
      { session_id: 'first', session_name: '第一个', create_time: '2026-09-14 10:00:00' },
      { session_id: 'second', session_name: '第二个', create_time: '2026-09-14 09:00:00' },
    ]);
    sessions.switchSession('second');
    sessions.addMessage('user', '我在这里说话了');

    sessions.applyRemoteSessions([
      { session_id: 'first', session_name: '第一个', create_time: '2026-09-14 10:00:00' },
      { session_id: 'second', session_name: '第二个', create_time: '2026-09-14 09:00:00' },
    ]);

    expect(sessions.activeSessionId.value).toBe('second');
  });
});

describe('connection logs', () => {
  it('does not spawn a session for a system or error log', () => {
    const sessions = useSessions({ defaultTitle: () => '新对话' });

    // 登录成功那一刻后端/客户端会推这类日志。列表此时通常是空的。
    sessions.addMessage('system', 'WebSocket connected.');
    sessions.addMessage('error', 'Not connected, system request was not sent.');

    // 不该因此冒出一条空会话；消息落进内存兜底就够（界面照样能显示）。
    expect(sessions.sessions.value).toHaveLength(0);
    expect(sessions.activeSession.value.messages).toHaveLength(2);
  });

  it('still opens the most recent session when a log arrives before readSession', () => {
    const sessions = useSessions({ defaultTitle: () => '新对话' });
    sessions.addMessage('system', 'WebSocket connected.');

    sessions.applyRemoteSessions([
      { session_id: 'newest', session_name: '刚聊的', create_time: '2026-09-15 10:00:00' },
      { session_id: 'older', session_name: '早一点的', create_time: '2026-09-15 09:00:00' },
    ]);

    // 日志不能把「首次落点」用掉：仍然要定位到最近的一条，且不留下幽灵会话。
    expect(sessions.sessions.value.map((session) => session.id)).toEqual(['newest', 'older']);
    expect(sessions.activeSessionId.value).toBe('newest');
  });

  it('still opens a session for the first user message', () => {
    const sessions = useSessions();
    sessions.addMessage('user', '你好');

    expect(sessions.sessions.value).toHaveLength(1);
    expect(sessions.activeSession.value.title).toBe('你好');
  });
});
