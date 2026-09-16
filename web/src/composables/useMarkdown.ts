import DOMPurify from 'dompurify';
import { marked } from 'marked';

marked.use({
  gfm: true,
  breaks: false,
});

export function useMarkdown() {
  function renderMarkdown(markdown: string): string {
    return DOMPurify.sanitize(marked.parse(markdown || '', { async: false }));
  }

  return { renderMarkdown };
}
