import type { ChatFile } from '../protocol/types';

export interface WorkspaceContext {
  workspacePath: string;
  workspaceUrl: string;
}

/** 浏览器能直接加载的协议：http(s) / data / blob。file:// 不在其中。 */
export function isBrowserLoadableUrl(value: string): boolean {
  return /^(?:https?:|data:|blob:)/i.test(value.trim());
}

export function isLocalFileUrl(value: string): boolean {
  return /^file:/i.test(value.trim());
}

/**
 * 把文件解析成可用的 URL。
 *
 * - 事件自带 `url` 时直接使用；
 * - 路径在工作区内且配置了 http(s) 的 `workspace_url` 时，拼成远程 URL；
 * - 其余本地路径降级为 `file://`（浏览器通常读不到，只用于展示路径）。
 */
export function resolveFileUrl(
  file: Pick<ChatFile, 'url' | 'path'>,
  context: WorkspaceContext,
): string {
  const explicit = file.url?.trim();
  if (explicit) return explicit;

  const path = file.path?.trim() || '';
  if (!path) return '';
  if (/^(?:https?:|data:|blob:|file:)/i.test(path)) return path;

  const root = context.workspacePath.trim().replace(/[\\/]+$/, '').replace(/\\/g, '/');
  const normalizedPath = path.replace(/\\/g, '/');
  const isAbsolutePath = /^(?:[A-Za-z]:\/|\/|\\\\)/.test(normalizedPath);
  const insideWorkspace = Boolean(root) && normalizedPath.toLowerCase().startsWith(`${root.toLowerCase()}/`);

  if (context.workspaceUrl.trim() && (!isAbsolutePath || insideWorkspace)) {
    const relative = insideWorkspace
      ? normalizedPath.slice(root.length).replace(/^\/+/, '')
      : normalizedPath;
    try {
      const base = context.workspaceUrl.endsWith('/') ? context.workspaceUrl : `${context.workspaceUrl}/`;
      return new URL(relative.split('/').map(encodeURIComponent).join('/'), base).toString();
    } catch {
      // 回落到本地 file:// 形式
    }
  }

  return toFileUrl(path);
}

export function toFileUrl(value: string): string {
  const normalizedValue = value.replace(/\\/g, '/');
  if (normalizedValue.startsWith('//')) {
    return `file://${normalizedValue.slice(2).split('/').map(encodeURIComponent).join('/')}`;
  }
  const normalized = normalizedValue.replace(/^\/+/, '');
  return `file:///${normalized
    .split('/')
    .map((part, index) => (index === 0 && /^[A-Za-z]:$/.test(part) ? part : encodeURIComponent(part)))
    .join('/')}`;
}
