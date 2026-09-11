import type { ChatFile, ChatMessage, ToolEvent } from '../protocol/types';
import { inferMimeType } from '../protocol/normalizers';

/**
 * 从后端返回的消息里提取「可预览产物」。
 *
 * 后端目前不发 file/html/document 事件，所以这里负责从已有信号里推断：
 *  - content 里的完整 HTML 文档
 *  - content 里的 ```html / ```md 围栏块
 *  - content 里的长 Markdown 文档
 *  - content 正文里出现的文件路径
 *  - tool_result 里的 saved_files / file_path / path 等字段
 */

const FULL_HTML_DOCUMENT = /^\s*(?:<!doctype\s+html\b[^>]*>\s*)?<html\b[\s\S]*?<\/html>\s*$/i;
const FENCE_BLOCK_SOURCE = '^ {0,3}(`{3,}|~{3,})[ \\t]*([A-Za-z0-9_+.-]*)[^\\n]*\\n([\\s\\S]*?)^ {0,3}\\1[ \\t]*$';
const MARKDOWN_HEADING = /^ {0,3}#{1,6}[ \t]+\S/m;

const HTML_LANGS = new Set(['html', 'htm', 'xhtml']);
const MARKDOWN_LANGS = new Set(['md', 'markdown', 'mdown']);
const HTML_MAX_LEN = 400_000;
const MARKDOWN_DOC_MIN_LEN = 400;
const MARKDOWN_DOC_MIN_HEADINGS = 2;
const MAX_PATH_ARTIFACTS = 8;
const MAX_TOOL_DEPTH = 6;
const MAX_TOOL_ARTIFACTS = 20;

const PREVIEWABLE_EXTENSIONS = [
  'html', 'htm', 'xhtml', 'md', 'markdown', 'txt', 'json', 'csv', 'tsv', 'pdf',
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif',
  'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'vue', 'py', 'php', 'rb', 'go', 'rs',
  'java', 'kt', 'c', 'h', 'cpp', 'hpp', 'cs', 'swift', 'sh', 'bash', 'zsh', 'bat', 'cmd', 'ps1',
  'xml', 'yaml', 'yml', 'toml', 'ini', 'cfg', 'conf', 'env', 'log', 'sql', 'diff', 'patch',
  'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'zip', 'gz', 'tar', '7z', 'rar',
  'mp3', 'wav', 'ogg', 'mp4', 'webm', 'mov',
];

const PATH_EXPRESSION = new RegExp(
  `^(?:[A-Za-z]:[\\\\/]|\\\\\\\\|/|\\.{1,2}[\\\\/])?[\\w\\-\\u4e00-\\u9fa5.@+]+(?:[\\\\/][\\w\\-\\u4e00-\\u9fa5.@+]+)*\\.(?:${PREVIEWABLE_EXTENSIONS.join('|')})$`,
  'i',
);

const PATH_SCAN_PATTERN = new RegExp(
  `(?:[A-Za-z]:[\\\\/]|\\\\\\\\|/|\\.{1,2}[\\\\/])?[\\w\\-\\u4e00-\\u9fa5.@+]+(?:[\\\\/][\\w\\-\\u4e00-\\u9fa5.@+]+)*\\.(?:${PREVIEWABLE_EXTENSIONS.join('|')})(?![A-Za-z0-9])`,
  'gi',
);

const TOOL_PATH_KEYS = new Set([
  'file_path', 'filepath', 'path', 'save_path', 'output_path', 'full_path',
  'saved_files', 'files', 'file', 'filename', 'file_name',
]);

/** 分数越高越适合自动打开。 */
export function artifactRank(file: ChatFile): number {
  const mime = (file.mimeType || '').toLowerCase();
  const name = (file.name || '').toLowerCase();
  let base = 20;
  if (mime.includes('html') || /\.(?:html?|xhtml)$/.test(name)) base = 100;
  else if (mime.includes('markdown') || /\.(?:md|markdown)$/.test(name)) base = 60;
  else if (mime.startsWith('image/') || mime === 'application/pdf') base = 40;
  if (file.content !== undefined || file.url) base += 8;
  return base;
}

/**
 * 是否值得「自动打开侧边栏」。
 *
 * 判断标准偏保守，避免每一条长回复都弹侧栏：
 *  - HTML 文档 / 代码块：明确是「网页产物」→ 打开
 *  - ```md 围栏块：agent 主动写了一份文档 → 打开
 *  - 聊天正文里的普通 Markdown：只给按钮，不自动打开
 *  - 图片：气泡里已经内联显示 → 不重复打开
 */
export function isAutoOpenCandidate(file: ChatFile): boolean {
  const mime = (file.mimeType || '').toLowerCase();
  const name = (file.name || '').toLowerCase();
  if (mime.includes('html') || /\.(?:html?|xhtml)$/.test(name)) return true;
  if (mime.includes('markdown') || /\.(?:md|markdown)$/.test(name)) return file.id.includes(':snippet:');
  if (mime.startsWith('image/')) return false;
  if (mime === 'application/pdf') return true;
  return file.content !== undefined || Boolean(file.url);
}

export function pickPrimaryArtifact(files: ChatFile[]): ChatFile | null {
  return pickByRank(files.filter(isAutoOpenCandidate));
}

function pickByRank(files: ChatFile[]): ChatFile | null {
  let best: ChatFile | null = null;
  let bestRank = -1;
  files.forEach((file) => {
    const rank = artifactRank(file);
    if (rank > bestRank) {
      best = file;
      bestRank = rank;
    }
  });
  return best;
}

/** 只从正文和工具结果里推断的产物，不含后端直接下发的 file 事件。 */
export function extractContentArtifacts(
  message: Pick<ChatMessage, 'content' | 'toolEvents'>,
): ChatFile[] {
  const found: ChatFile[] = [];
  const content = message.content || '';

  collectContentArtifacts(content, found);
  collectToolEventArtifacts(message.toolEvents, found);

  return sortByRank(dedupe(found));
}

/** 消息上所有可预览产物：后端 file 事件 + 正文/工具推断。 */
export function extractMessageArtifacts(
  message: Pick<ChatMessage, 'content' | 'files' | 'toolEvents'>,
): ChatFile[] {
  const found: ChatFile[] = [...(message.files || [])];
  found.push(...extractContentArtifacts(message));
  return sortByRank(dedupe(found));
}

function collectContentArtifacts(content: string, found: ChatFile[]) {
  const trimmed = content.trim();
  if (!trimmed) return;

  let htmlSeen = false;

  if (FULL_HTML_DOCUMENT.test(trimmed) && trimmed.length <= HTML_MAX_LEN) {
    found.push(buildTextArtifact('response.html', 'text/html', trimmed, 'html:document'));
    htmlSeen = true;
  }

  const fences = new RegExp(FENCE_BLOCK_SOURCE, 'gm');
  const remainder = trimmed.split('');
  let index = 0;

  for (const match of trimmed.matchAll(fences)) {
    const start = match.index ?? 0;
    const body = match[3] || '';
    const lang = (match[2] || '').toLowerCase();
    const looksLikeHtml = /^\s*(?:<!doctype\s+html\b|<html\b)/i.test(body);
    index += 1;

    if (HTML_LANGS.has(lang) || (lang === '' && looksLikeHtml)) {
      found.push(buildTextArtifact(`snippet-${index}.html`, 'text/html', body.trim(), `html:snippet:${index}`));
      htmlSeen = true;
    } else if (MARKDOWN_LANGS.has(lang)) {
      found.push(buildTextArtifact(`snippet-${index}.md`, 'text/markdown', body.trim(), `markdown:snippet:${index}`));
    } else if (body.length > 160 && looksLikeMarkdownDocument(body)) {
      found.push(buildTextArtifact(`snippet-${index}.md`, 'text/markdown', body.trim(), `markdown:snippet:${index}`));
    } else {
      continue;
    }

    // 已被提取为文档的正文不再参与路径扫描，避免文档内的相对资源变成噪音。
    for (let cursor = start; cursor < start + match[0].length; cursor += 1) {
      remainder[cursor] = remainder[cursor] === '\n' ? '\n' : ' ';
    }
  }

  if (!htmlSeen && looksLikeMarkdownDocument(trimmed)) {
    found.push(buildTextArtifact('response.md', 'text/markdown', trimmed, 'markdown:document'));
  }

  collectPathArtifacts(remainder.join(''), found);
}

function looksLikeMarkdownDocument(content: string): boolean {
  const trimmed = content.trim();
  if (trimmed.length < MARKDOWN_DOC_MIN_LEN) return false;
  if (trimmed.startsWith('<')) return false;
  const headings = trimmed.match(/^ {0,3}#{1,6}[ \t]+\S/gm);
  return Boolean(headings && headings.length >= MARKDOWN_DOC_MIN_HEADINGS && MARKDOWN_HEADING.test(trimmed));
}

function collectPathArtifacts(text: string, found: ChatFile[]) {
  if (!text.trim()) return;
  const pattern = new RegExp(PATH_SCAN_PATTERN.source, 'gi');
  const seen = new Set<string>();
  let added = 0;

  for (const match of text.matchAll(pattern)) {
    if (added >= MAX_PATH_ARTIFACTS) break;
    const value = match[0];
    const at = match.index ?? 0;
    if (isPartOfUrl(text, at)) continue;
    if (!PATH_EXPRESSION.test(value)) continue;

    const key = value.replace(/\\/g, '/').toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    added += 1;
    found.push(buildPathArtifact(value));
  }
}

function collectToolEventArtifacts(toolEvents: ToolEvent[] | undefined, found: ChatFile[]) {
  if (!toolEvents?.length) return;
  const seen = new Set<string>();

  toolEvents.forEach((event) => {
    if (event.kind !== 'tool_result') return;
    const parsed = parseJsonMaybe(event.data);
    if (parsed === null) return;
    walkToolData(parsed, found, seen, 0);
  });
}

function walkToolData(value: unknown, found: ChatFile[], seen: Set<string>, depth: number) {
  if (depth > MAX_TOOL_DEPTH || found.length >= MAX_TOOL_ARTIFACTS) return;

  if (Array.isArray(value)) {
    value.forEach((item) => walkToolData(item, found, seen, depth + 1));
    return;
  }
  if (!value || typeof value !== 'object') return;

  Object.entries(value as Record<string, unknown>).forEach(([key, entry]) => {
    if (entry && typeof entry === 'object') {
      walkToolData(entry, found, seen, depth + 1);
      return;
    }
    if (typeof entry !== 'string') return;
    if (!TOOL_PATH_KEYS.has(key.toLowerCase())) return;

    const candidate = entry.replace(/\\/g, '/').trim();
    if (!PATH_EXPRESSION.test(candidate)) return;

    const dedupeKey = candidate.toLowerCase();
    if (seen.has(dedupeKey)) return;
    seen.add(dedupeKey);
    found.push(buildPathArtifact(candidate));
  });
}

/** 判断某个位置是否落在带协议头的 URL 里；URL 不当作本地文件产物。 */
const TOKEN_DELIMITERS = new Set([
  ' ', '\t', '\n', '\r', '"', "'", '`', '<', '>', '(', ')', '[', ']',
  '，', '。', '；', '、', '：', '！', '？', '“', '”', '‘', '’', '《', '》', '【', '】', '—',
]);

function isPartOfUrl(text: string, at: number): boolean {
  let start = at;
  while (start > 0 && !TOKEN_DELIMITERS.has(text[start - 1])) start -= 1;
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(text.slice(start, at + 1));
}

function buildTextArtifact(name: string, mimeType: string, content: string, idSuffix: string): ChatFile {
  return {
    id: `artifact:${idSuffix}`,
    name,
    mimeType,
    content,
    encoding: 'text',
    source: 'content',
    time: '',
  };
}

function buildPathArtifact(path: string): ChatFile {
  const normalized = path.replace(/\\/g, '/');
  const name = normalized.split('/').filter(Boolean).pop() || normalized;
  return {
    id: `artifact:path:${normalized.toLowerCase()}`,
    name,
    mimeType: inferMimeType(name),
    path: normalized,
    source: 'path',
    time: '',
  };
}

function dedupe(files: ChatFile[]): ChatFile[] {
  const byKey = new Map<string, ChatFile>();
  files.forEach((file) => {
    const key = dedupeKey(file);
    const existing = byKey.get(key);
    // 有字节的产物优先保留，能直接渲染。
    if (!existing || (existing.content === undefined && file.content !== undefined)) {
      byKey.set(key, file);
    }
  });
  return Array.from(byKey.values());
}

function dedupeKey(file: ChatFile): string {
  const path = (file.path || '').replace(/\\/g, '/').toLowerCase();
  if (path) return `path:${path}`;
  if (file.url) return `url:${file.url}`;
  if (file.id) return `id:${file.id}`;
  return `name:${file.name}:${file.mimeType}`;
}

function sortByRank(files: ChatFile[]): ChatFile[] {
  return [...files].sort((left, right) => artifactRank(right) - artifactRank(left));
}

function parseJsonMaybe(value: unknown): unknown {
  if (typeof value !== 'string') return value ?? null;
  const trimmed = value.trim();
  if (!trimmed || (!trimmed.startsWith('{') && !trimmed.startsWith('['))) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}
