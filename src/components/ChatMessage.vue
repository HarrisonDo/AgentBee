<script setup lang="ts">
import { computed, nextTick, onBeforeUpdate, onUpdated, ref } from 'vue';
import {
  Check,
  Copy,
  Eye,
  FileText,
  LoaderCircle,
  Paperclip,
  Pencil,
  RotateCcw,
  SquareTerminal,
  Trash2,
  X,
} from 'lucide-vue-next';
import FoldBlock from './FoldBlock.vue';
import ToolEventsBlock from './ToolEventsBlock.vue';
import { useMarkdown } from '../composables/useMarkdown';
import type { ChatFile, ChatMessage } from '../protocol/types';

const props = defineProps<{
  labels: Record<string, string>;
  message: ChatMessage;
  deletingMemory?: boolean;
  memoryDeleteDisabled?: boolean;
  showDebugInfo?: boolean;
}>();

const emit = defineEmits<{
  deleteMemoryMessage: [createId: number];
  resendUserMessage: [messageId: string];
  updateUserMessage: [messageId: string, content: string];
  previewFile: [file: ChatFile];
}>();

const { renderMarkdown } = useMarkdown();
const editTextarea = ref<HTMLTextAreaElement | null>(null);
const draft = ref('');
const isEditing = ref(false);
const copied = ref(false);
const markdownBody = ref<HTMLElement | null>(null);
const SCROLLABLE_MARKDOWN = '.markdown-table-scroll, .markdown-code-block > pre';
let horizontalScrollPositions: number[] = [];

onBeforeUpdate(() => {
  horizontalScrollPositions = Array.from(
    markdownBody.value?.querySelectorAll<HTMLElement>(SCROLLABLE_MARKDOWN) || [],
    (element) => element.scrollLeft,
  );
});

onUpdated(() => {
  // v-html replaces streaming blocks; retain the reader's column/line position.
  markdownBody.value?.querySelectorAll<HTMLElement>(SCROLLABLE_MARKDOWN).forEach((element, index) => {
    const scrollLeft = horizontalScrollPositions[index];
    if (scrollLeft > 0) element.scrollLeft = scrollLeft;
  });
});

const hasAssistantOutput = computed(() => (
  Boolean(props.message.content?.trim()) ||
  Boolean(props.message.think?.trim()) ||
  Boolean(props.message.images?.length) ||
  Boolean(props.message.files?.length) ||
  Boolean(props.message.toolEvents?.length)
));

const isWaitingForResponse = computed(() => (
  props.message.role === 'assistant' &&
  props.message.status === 'loading' &&
  !hasAssistantOutput.value
));

const endedWithoutResponse = computed(() => (
  props.message.role === 'assistant' &&
  props.message.status !== 'loading' &&
  !hasAssistantOutput.value
));

const renderedMarkdown = computed(() => {
  const markdown = props.message.content || '';
  if (props.message.status !== 'loading') {
    return { stable: renderMarkdownBlocks(markdown), tail: '' };
  }

  const split = splitStreamingMarkdown(markdown);
  return {
    stable: renderMarkdownBlocks(split.stable),
    tail: renderMarkdownBlocks(split.tail),
  };
});

const fullHtmlDocument = computed(() => {
  const content = props.message.content?.trim() || '';
  return /^(?:<!doctype\s+html\b[^>]*>\s*)?<html\b[\s\S]*<\/html>\s*$/i.test(content) ? content : '';
});

const senderIdentity = computed(() => {
  const senderName = props.message.senderName?.trim() || '';
  const senderRole = props.message.senderRole?.trim() || '';
  const messageId = props.message.messageId?.trim() || '';

  let identity = '';
  if (senderName && senderRole) {
    identity = `${senderName} - ${senderRole}`;
  } else {
    identity = senderName || senderRole || roleName(props.message.role);
  }

  if (props.showDebugInfo && messageId) {
    identity += ` [${messageId}]`;
  }

  return identity;
});

function roleName(role: ChatMessage['role']) {
  return {
    user: props.labels.roleUser,
    assistant: props.labels.roleAssistant,
    system: props.labels.roleSystem,
    error: props.labels.roleError,
    tool: props.labels.roleTool,
  }[role] || role;
}

async function copyMessage() {
  await copyText(props.message.content || '');
  copied.value = true;
  window.setTimeout(() => {
    copied.value = false;
  }, 1200);
}

async function copyMarkdownBlock(event: MouseEvent) {
  const target = event.target instanceof Element ? event.target : null;
  const button = target?.closest<HTMLButtonElement>('.markdown-code-copy');
  if (!button) return;

  const block = button.closest<HTMLElement>('.markdown-code-block');
  const code = block?.querySelector<HTMLElement>('pre code') || block?.querySelector<HTMLElement>('pre');
  const text = code?.textContent || '';
  if (!text.trim()) return;

  await copyText(text);
  const copyLabel = button.dataset.copyLabel || props.labels.copyMessage;
  const copiedLabel = button.dataset.copiedLabel || props.labels.copied;
  button.title = copiedLabel;
  button.setAttribute('aria-label', copiedLabel);
  button.classList.add('copied');
  window.setTimeout(() => {
    button.title = copyLabel;
    button.setAttribute('aria-label', copyLabel);
    button.classList.remove('copied');
  }, 1200);
}

function startEdit() {
  draft.value = props.message.content || '';
  isEditing.value = true;
  nextTick(() => {
    resizeEditTextarea();
    editTextarea.value?.focus();
  });
}

function cancelEdit() {
  isEditing.value = false;
  draft.value = '';
}

function saveEdit() {
  const nextContent = draft.value.trim();
  if (!nextContent) return;
  emit('updateUserMessage', props.message.id, nextContent);
  isEditing.value = false;
}

function resendMessage() {
  emit('resendUserMessage', props.message.id);
}

function onEditKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault();
    cancelEdit();
    return;
  }

  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
    event.preventDefault();
    saveEdit();
  }
}

function resizeEditTextarea() {
  if (!editTextarea.value) return;
  editTextarea.value.style.height = 'auto';
  editTextarea.value.style.height = `${Math.min(220, editTextarea.value.scrollHeight)}px`;
}

function formatSize(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function previewHtmlDocument() {
  if (!fullHtmlDocument.value) return;
  emit('previewFile', {
    id: `${props.message.id}-html`,
    name: 'response.html',
    mimeType: 'text/html',
    content: fullHtmlDocument.value,
    encoding: 'text',
    source: 'content',
    time: props.message.time,
  });
}

async function copyText(text: string) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Fall through to the textarea fallback for restricted clipboard contexts.
    }
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand('copy');
  document.body.removeChild(textarea);
}

function renderMarkdownBlocks(markdown: string) {
  const html = renderMarkdown(markdown);
  if (!/<(?:pre|table)\b/i.test(html)) return html;

  const container = document.createElement('div');
  container.innerHTML = html;
  container.querySelectorAll('pre').forEach((pre) => {
    if (pre.parentElement?.classList.contains('markdown-code-block')) return;

    const wrapper = document.createElement('div');
    wrapper.className = 'markdown-code-block';

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'markdown-code-copy';
    button.title = props.labels.copyMessage;
    button.setAttribute('aria-label', props.labels.copyMessage);
    button.dataset.copyLabel = props.labels.copyMessage;
    button.dataset.copiedLabel = props.labels.copied;
    button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>';

    pre.replaceWith(wrapper);
    wrapper.appendChild(button);
    wrapper.appendChild(pre);
    pre.tabIndex = 0;
    pre.setAttribute('role', 'region');
    pre.setAttribute('aria-label', props.labels.scrollableCode);
  });

  container.querySelectorAll('table').forEach((table) => {
    if (table.parentElement?.classList.contains('markdown-table-scroll')) return;

    const wrapper = document.createElement('div');
    wrapper.className = 'markdown-table-scroll';
    wrapper.tabIndex = 0;
    wrapper.setAttribute('role', 'region');
    wrapper.setAttribute('aria-label', props.labels.scrollableTable);
    table.replaceWith(wrapper);
    wrapper.appendChild(table);

    // Bound prose within each column without squeezing the table to the viewport.
    Array.from(table.rows).forEach((row) => {
      Array.from(row.cells).forEach((cell) => {
        const content = document.createElement('div');
        content.className = 'markdown-table-cell';
        while (cell.firstChild) content.appendChild(cell.firstChild);
        cell.appendChild(content);
      });
    });
  });

  return container.innerHTML;
}

const UNSAFE_STREAMING_BLOCK = /^(\s|[-*+]\s|\d+[.)]\s|\||\$\$)/;

function splitStreamingMarkdown(markdown: string): { stable: string; tail: string } {
  if (!markdown) return { stable: '', tail: '' };

  const lineBreak = markdown.includes('\r\n') ? '\r\n' : '\n';
  const lines = markdown.split(/\r?\n/);
  let fence: { marker: string; size: number } | null = null;
  let splitLine = -1;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const fenceMatch = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (fenceMatch) {
      const marker = fenceMatch[1][0];
      const size = fenceMatch[1].length;
      if (!fence) fence = { marker, size };
      else if (marker === fence.marker && size >= fence.size) fence = null;
      continue;
    }
    if (fence || line.trim() !== '') continue;

    let next = index + 1;
    while (next < lines.length && lines[next].trim() === '') next += 1;
    if (next < lines.length && !UNSAFE_STREAMING_BLOCK.test(lines[next])) {
      splitLine = next;
    }
  }

  if (splitLine <= 0) return { stable: '', tail: markdown };
  return {
    stable: lines.slice(0, splitLine).join(lineBreak),
    tail: lines.slice(splitLine).join(lineBreak),
  };
}
</script>

<template>
  <article class="message" :class="[message.role, { 'remote-history': message.isRemoteHistory }]">
    <div v-if="message.role === 'system'" class="system-log">
      <SquareTerminal :size="14" aria-hidden="true" />
      <span class="system-log-text">{{ message.content }}</span>
      <span class="system-log-time">{{ message.time }}</span>
    </div>
    <template v-else>
    <div class="meta">
      <span class="sender-identity">{{ senderIdentity }}</span>
      <span class="meta-separator">·</span>
      <span>{{ message.time }}</span>
    </div>
    <div class="bubble">
      <FoldBlock
        v-if="message.think"
        class-name="think-card"
        :expand-label="labels.expand"
        :collapse-label="labels.collapse"
        :title="message.status === 'loading' ? labels.thinking : labels.thinkingProcess"
        :text="message.think"
      />

      <ToolEventsBlock
        v-if="message.toolEvents?.length"
        :events="message.toolEvents"
        :labels="labels"
      />

      <div v-if="message.images?.length" class="message-images">
        <figure v-for="image in message.images" :key="image.id" class="message-image">
          <img :src="image.src" :alt="image.prompt || labels.imageAlt" loading="lazy" />
          <figcaption v-if="image.prompt">{{ image.prompt }}</figcaption>
        </figure>
      </div>

      <div v-if="message.attachments?.length" class="message-attachments">
        <span v-for="attachment in message.attachments" :key="attachment.id" class="message-attachment-chip">
          <Paperclip :size="13" aria-hidden="true" />
          <span class="attachment-name">{{ attachment.name }}</span>
          <span class="attachment-size">{{ formatSize(attachment.size) }}</span>
        </span>
      </div>

      <div v-if="message.files?.length" class="message-files">
        <article v-for="file in message.files" :key="file.id" class="message-file-card">
          <FileText :size="16" aria-hidden="true" />
          <span class="message-file-copy">
            <strong>{{ file.name }}</strong>
            <small>{{ file.mimeType }}</small>
          </span>
          <button type="button" class="icon-button" :title="labels.preview" @click="emit('previewFile', file)">
            <Eye :size="15" aria-hidden="true" />
          </button>
        </article>
      </div>

      <button v-if="fullHtmlDocument" type="button" class="html-preview-entry" @click="previewHtmlDocument">
        <Eye :size="15" aria-hidden="true" />
        <span>{{ labels.previewHtml }}</span>
      </button>

      <div v-if="isWaitingForResponse" class="message-loading" aria-live="polite">
        <span>{{ labels.waitingForResponse }}</span>
        <span class="typing-dots" aria-hidden="true">
          <span></span>
          <span></span>
          <span></span>
        </span>
      </div>

      <div v-else-if="endedWithoutResponse" class="message-ended">
        {{ labels.noResponseEnded }}
      </div>

      <div
        v-else-if="message.role === 'assistant'"
        ref="markdownBody"
        class="markdown-body"
        @click="copyMarkdownBlock"
      >
        <div v-if="renderedMarkdown.stable" v-html="renderedMarkdown.stable"></div>
        <div v-if="renderedMarkdown.tail" v-html="renderedMarkdown.tail"></div>
      </div>
      <div v-else-if="isEditing" class="user-edit-form">
        <textarea
          ref="editTextarea"
          v-model="draft"
          rows="2"
          class="user-edit-textarea"
          @input="resizeEditTextarea"
          @keydown="onEditKeydown"
        ></textarea>
        <div class="user-edit-actions">
          <button type="button" class="message-action-button" :title="labels.cancelEdit" @click="cancelEdit">
            <X :size="14" aria-hidden="true" />
          </button>
          <button type="button" class="message-action-button primary" :title="labels.saveEdit" @click="saveEdit">
            <Check :size="14" aria-hidden="true" />
          </button>
        </div>
      </div>
      <div v-else class="markdown-body plain">{{ message.content }}</div>
    </div>

    <div v-if="message.role === 'user'" class="user-message-actions">
      <button
        v-if="!isEditing"
        type="button"
        class="message-action-button"
        :title="labels.resendMessage"
        @click="resendMessage"
      >
        <RotateCcw :size="14" aria-hidden="true" />
      </button>
      <button
        type="button"
        class="message-action-button"
        :title="copied ? labels.copied : labels.copyMessage"
        @click="copyMessage"
      >
        <Check v-if="copied" :size="14" aria-hidden="true" />
        <Copy v-else :size="14" aria-hidden="true" />
      </button>
      <button
        v-if="!isEditing"
        type="button"
        class="message-action-button"
        :title="labels.editMessage"
        @click="startEdit"
      >
        <Pencil :size="14" aria-hidden="true" />
      </button>
      <button
        v-if="message.memoryCreateId"
        type="button"
        class="message-action-button history-delete-button"
        :title="labels.deleteMemoryRecord"
        :disabled="deletingMemory || memoryDeleteDisabled"
        @click="emit('deleteMemoryMessage', message.memoryCreateId)"
      >
        <LoaderCircle v-if="deletingMemory" class="spin" :size="14" aria-hidden="true" />
        <Trash2 v-else :size="14" aria-hidden="true" />
      </button>
    </div>
    </template>
    <div v-if="message.memoryCreateId && message.role !== 'user'" class="history-message-actions">
      <button
        type="button"
        class="message-action-button history-delete-button"
        :title="labels.deleteMemoryRecord"
        :disabled="deletingMemory || memoryDeleteDisabled"
        @click="emit('deleteMemoryMessage', message.memoryCreateId)"
      >
        <LoaderCircle v-if="deletingMemory" class="spin" :size="14" aria-hidden="true" />
        <Trash2 v-else :size="14" aria-hidden="true" />
      </button>
    </div>
  </article>
</template>
