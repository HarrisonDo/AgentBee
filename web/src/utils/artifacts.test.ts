import { describe, expect, it } from 'vitest';
import type { ToolEvent } from '../protocol/types';
import {
  artifactRank,
  extractContentArtifacts,
  extractMessageArtifacts,
  isAutoOpenCandidate,
  pickInlinePreviewArtifact,
  pickPrimaryArtifact,
} from './artifacts';

function toolResult(data: string): ToolEvent {
  return {
    id: 'tool-1',
    kind: 'tool_result',
    name: 'ImageMaker',
    summary: 'ImageMaker',
    data,
    time: '',
  };
}

const FULL_HTML = '<!doctype html>\n<html><body><h1>报告</h1></body></html>';

describe('extractContentArtifacts', () => {
  it('recognizes a full HTML document in the reply body', () => {
    const [artifact] = extractContentArtifacts({ content: FULL_HTML, toolEvents: [] });
    expect(artifact).toMatchObject({ name: 'response.html', mimeType: 'text/html', encoding: 'text' });
    expect(artifact.content).toBe(FULL_HTML);
    expect(isAutoOpenCandidate(artifact)).toBe(true);
  });

  it('recognizes a fenced html block embedded in prose', () => {
    const content = [
      '这是为你生成的页面：',
      '',
      '```html',
      '<html><body><button>hello</button></body></html>',
      '```',
      '',
      '可以点击右侧预览查看。',
    ].join('\n');
    const artifacts = extractContentArtifacts({ content, toolEvents: [] });
    const html = artifacts.find((file) => file.mimeType === 'text/html');
    expect(html).toBeTruthy();
    expect(html?.content).toContain('<button>hello</button>');
    expect(isAutoOpenCandidate(html!)).toBe(true);
  });

  it('recognizes a fenced markdown document', () => {
    const content = ['说明：', '', '```md', '# 标题', '', '正文', '```'].join('\n');
    const artifacts = extractContentArtifacts({ content, toolEvents: [] });
    expect(artifacts.some((file) => file.mimeType === 'text/markdown')).toBe(true);
  });

  it('treats a long structured markdown reply as a document but does not auto-open it', () => {
    const content = [
      '## 背景',
      '这里是背景说明，'.repeat(20),
      '## 方案',
      '这里是方案说明，'.repeat(20),
      '## 结论',
      '这里是结论，'.repeat(20),
    ].join('\n\n');
    const artifacts = extractContentArtifacts({ content, toolEvents: [] });
    const markdown = artifacts.find((file) => file.mimeType === 'text/markdown');
    expect(markdown).toBeTruthy();
    expect(isAutoOpenCandidate(markdown!)).toBe(false);
  });

  it('extracts workspace and absolute file paths without folding them into URLs', () => {
    const content = [
      '产物：workspace/reports/demo.html',
      '绝对路径：D:/AgentBee/workspace/秦始皇骑北极熊.png',
    ].join('\n');
    const artifacts = extractContentArtifacts({ content, toolEvents: [] });
    const names = artifacts.map((file) => file.name);

    expect(names).toContain('demo.html');
    expect(names).toContain('秦始皇骑北极熊.png');
    expect(artifacts.every((file) => file.source === 'path')).toBe(true);
    expect(artifacts.find((file) => file.name === '秦始皇骑北极熊.png')?.mimeType).toBe('image/png');
  });

  it('does not turn a fenced HTML document body into extra path artifacts', () => {
    const content = [
      '```html',
      '<html><head><link href="style.css" rel="stylesheet"></head><body>hi</body></html>',
      '```',
    ].join('\n');
    const artifacts = extractContentArtifacts({ content, toolEvents: [] });
    expect(artifacts.map((file) => file.name)).not.toContain('style.css');
  });

  it('extracts files from tool_result payloads', () => {
    const data = JSON.stringify({
      status: 'success',
      saved_files: [
        { file_name: '2026-09-11_001.png', file_path: 'D:/AgentBee/workspace/ImageMaker/2026-09-11_001.png', save_bytes: 1024 },
      ],
    });
    const artifacts = extractContentArtifacts({ content: '图片已生成。', toolEvents: [toolResult(data)] });
    const image = artifacts.find((file) => file.name === '2026-09-11_001.png');
    expect(image).toBeTruthy();
    expect(image?.mimeType).toBe('image/png');
  });
});

describe('extractContentArtifacts — remote links', () => {
  const WORKSPACE_PAGE = 'https://agentbee.example.com/dd/workspace/pelican_bike.html';

  it('turns a workspace URL into a previewable artifact', () => {
    const artifacts = extractContentArtifacts({ content: `做好了：${WORKSPACE_PAGE}`, toolEvents: [] });
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]).toMatchObject({
      name: 'pelican_bike.html',
      mimeType: 'text/html',
      url: WORKSPACE_PAGE,
      source: 'url',
    });
    expect(artifacts[0].content).toBeUndefined();
    expect(artifacts[0].path).toBeUndefined();
    expect(isAutoOpenCandidate(artifacts[0])).toBe(true);
  });

  it('picks up markdown links and strips trailing punctuation', () => {
    const fromSyntax = extractContentArtifacts({
      content: '报告在这里：[周报](https://example.test/out/weekly.md)。',
      toolEvents: [],
    });
    expect(fromSyntax.map((file) => file.url)).toEqual(['https://example.test/out/weekly.md']);

    const withJunk = extractContentArtifacts({
      content: '完成。见 (https://example.test/a/b.html)。',
      toolEvents: [],
    });
    expect(withJunk.map((file) => file.url)).toEqual(['https://example.test/a/b.html']);
  });

  it('ignores links without a previewable file extension', () => {
    const artifacts = extractContentArtifacts({
      content: '参考 https://example.test/about 和 https://example.test/docs/guide',
      toolEvents: [],
    });
    expect(artifacts).toHaveLength(0);
  });

  it('does not auto-open remote types the browser cannot render', () => {
    const artifacts = extractContentArtifacts({ content: '数据 https://example.test/data.csv', toolEvents: [] });
    expect(artifacts).toHaveLength(1);
    expect(isAutoOpenCandidate(artifacts[0])).toBe(false);
    expect(pickPrimaryArtifact(artifacts)).toBeNull();
  });

  it('prefers inline bytes over a remote link of the same type', () => {
    const content = [
      '```html',
      '<html><body><h1>page</h1></body></html>',
      '```',
      '',
      `预览地址：${WORKSPACE_PAGE}`,
    ].join('\n');
    const artifacts = extractContentArtifacts({ content, toolEvents: [] });
    expect(artifacts.filter((file) => file.mimeType === 'text/html')).toHaveLength(2);
    expect(pickPrimaryArtifact(artifacts)?.content).toContain('<h1>page</h1>');
  });

});

describe('pickPrimaryArtifact', () => {
  it('prefers an HTML artifact with bytes over markdown and path-only files', () => {
    const content = [
      '```html',
      '<html><body><h1>page</h1></body></html>',
      '```',
      '',
      '同时生成了 workspace/report.md 和 workspace/data.csv',
    ].join('\n');
    const artifacts = extractContentArtifacts({ content, toolEvents: [] });
    const primary = pickPrimaryArtifact(artifacts);
    expect(primary?.mimeType).toBe('text/html');
  });

  it('does not auto-open a path-only generic file', () => {
    const artifacts = extractContentArtifacts({
      content: '产物保存在 workspace/data.csv',
      toolEvents: [],
    });
    expect(artifacts.map((file) => file.name)).toContain('data.csv');
    expect(pickPrimaryArtifact(artifacts)).toBeNull();
  });
});

describe('pickInlinePreviewArtifact', () => {
  it('offers a preview for a full HTML document in a history record', () => {
    const artifact = pickInlinePreviewArtifact({ content: FULL_HTML, toolEvents: [] });
    expect(artifact?.name).toBe('response.html');
  });

  it('offers a preview for fenced html and markdown blocks', () => {
    const fencedHtml = ['说明：', '', '```html', '<div>ok</div>', '```'].join('\n');
    expect(pickInlinePreviewArtifact({ content: fencedHtml, toolEvents: [] })?.mimeType).toBe('text/html');

    const fencedMarkdown = ['说明：', '', '```md', '# 周报', '', '正文', '```'].join('\n');
    expect(pickInlinePreviewArtifact({ content: fencedMarkdown, toolEvents: [] })?.mimeType).toBe('text/markdown');
  });

  it('offers a preview for a long structured markdown reply', () => {
    const content = [
      '## 背景',
      '这里是背景说明，'.repeat(20),
      '## 方案',
      '这里是方案说明，'.repeat(20),
      '## 结论',
      '这里是结论，'.repeat(20),
    ].join('\n\n');
    expect(pickInlinePreviewArtifact({ content, toolEvents: [] })?.name).toBe('response.md');
  });

  it('offers a preview for a workspace URL in a history record', () => {
    const picked = pickInlinePreviewArtifact({
      content: '页面已生成：https://agentbee.example.com/dd/workspace/pelican_bike.html',
      toolEvents: [],
    });
    expect(picked?.name).toBe('pelican_bike.html');
    expect(picked?.url).toBe('https://agentbee.example.com/dd/workspace/pelican_bike.html');
  });

  it('withholds the button for plain chat and path-only mentions', () => {
    expect(pickInlinePreviewArtifact({
      content: '好的，我已经把文件保存到 workspace/reports/demo.html 了。',
      toolEvents: [],
    })).toBeNull();
    expect(pickInlinePreviewArtifact({ content: '收到，我这就去处理。', toolEvents: [] })).toBeNull();
    expect(pickInlinePreviewArtifact({ content: '', toolEvents: [] })).toBeNull();
  });

  it('ignores tool_result paths because they carry no bytes', () => {
    const data = JSON.stringify({ file_path: 'workspace/a.html' });
    expect(pickInlinePreviewArtifact({ content: '', toolEvents: [toolResult(data)] })).toBeNull();
  });

  it('prefers HTML content over markdown when both are present', () => {
    const content = [
      '## 一',
      '内容，'.repeat(120),
      '## 二',
      '内容，'.repeat(120),
      '',
      '```html',
      '<div>ok</div>',
      '```',
    ].join('\n\n');
    expect(pickInlinePreviewArtifact({ content, toolEvents: [] })?.mimeType).toBe('text/html');
  });
});

describe('extractMessageArtifacts', () => {
  it('merges server file events with content-derived artifacts and dedupes by path', () => {
    const shared = {
      id: 'server-1',
      name: 'demo.html',
      mimeType: 'text/html',
      path: 'workspace/reports/demo.html',
      source: 'path' as const,
      time: '',
    };
    const artifacts = extractMessageArtifacts({
      content: '产物：workspace/reports/demo.html',
      files: [shared],
      toolEvents: [],
    });
    const matches = artifacts.filter((file) => file.name === 'demo.html');
    expect(matches).toHaveLength(1);
  });

  it('ranks html above markdown above generic files', () => {
    const base = { id: 'x', source: 'content' as const, time: '' };
    expect(artifactRank({ ...base, name: 'a.html', mimeType: 'text/html', content: '<html></html>' }))
      .toBeGreaterThan(artifactRank({ ...base, name: 'a.md', mimeType: 'text/markdown', content: '# a' }));
    expect(artifactRank({ ...base, name: 'a.md', mimeType: 'text/markdown', content: '# a' }))
      .toBeGreaterThan(artifactRank({ ...base, name: 'a.csv', mimeType: 'text/csv', content: 'a,b' }));
  });
});
