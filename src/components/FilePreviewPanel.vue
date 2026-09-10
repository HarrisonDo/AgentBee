<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { Check, Copy, Download, ExternalLink, FileText, X } from 'lucide-vue-next';
import { useMarkdown } from '../composables/useMarkdown';
import type { ChatFile } from '../protocol/types';

const props = defineProps<{
  file: ChatFile;
  labels: Record<string, string>;
  workspacePath: string;
  workspaceUrl: string;
}>();

const emit = defineEmits<{ close: [] }>();
const { renderMarkdown } = useMarkdown();
const sourceVisible = ref(false);
const copied = ref(false);
const remoteText = ref('');
const remoteError = ref('');
let requestController: AbortController | null = null;

const mimeType = computed(() => props.file.mimeType.toLowerCase());
const textContent = computed(() => decodeContent(props.file));
const previewText = computed(() => textContent.value || remoteText.value);
const isHtml = computed(() => mimeType.value.includes('html') || /\.(?:html?|xhtml)$/i.test(props.file.name));
const isMarkdown = computed(() => mimeType.value.includes('markdown') || /\.(?:md|markdown)$/i.test(props.file.name));
const isImage = computed(() => mimeType.value.startsWith('image/'));
const isPdf = computed(() => mimeType.value === 'application/pdf' || /\.pdf$/i.test(props.file.name));
const isText = computed(() => isMarkdown.value || isHtml.value || mimeType.value.startsWith('text/') || /(?:json|javascript|typescript|xml|css|yaml|toml)/i.test(mimeType.value));
const resolvedUrl = computed(() => resolveFileUrl(props.file, props.workspacePath, props.workspaceUrl));
const isLocalFile = computed(() => /^file:/i.test(resolvedUrl.value));
const imageSrc = computed(() => {
  if (resolvedUrl.value && !isLocalFile.value) return resolvedUrl.value;
  if (props.file.content && /^data:/i.test(props.file.content)) return props.file.content;
  if (!props.file.content || props.file.encoding !== 'base64') return '';
  return /^data:/i.test(props.file.content) ? props.file.content : `data:${props.file.mimeType};base64,${props.file.content}`;
});

async function copySource() {
  const value = textContent.value || resolvedUrl.value || props.file.path || '';
  if (!value) return;
  if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(value);
  copied.value = true;
  window.setTimeout(() => { copied.value = false; }, 1200);
}

function downloadFile() {
  if (resolvedUrl.value && !props.file.content) { window.open(resolvedUrl.value, '_blank', 'noopener,noreferrer'); return; }
  const content = props.file.encoding === 'base64' ? decodeBase64Bytes(props.file.content || '') : (props.file.content || '');
  const url = URL.createObjectURL(new Blob([content], { type: props.file.mimeType || 'application/octet-stream' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = props.file.name;
  anchor.click();
  URL.revokeObjectURL(url);
}

function resolveFileUrl(file: ChatFile, workspacePath: string, workspaceUrl: string): string {
  if (file.url?.trim()) return file.url.trim();
  const path = file.path?.trim() || '';
  if (!path) return '';
  if (/^(?:https?:|data:|blob:|file:)/i.test(path)) return path;
  const root = workspacePath.trim().replace(/[\\/]+$/, '').replace(/\\/g, '/');
  const normalizedPath = path.replace(/\\/g, '/');
  const isAbsolutePath = /^(?:[A-Za-z]:\/|\/|\\\\)/.test(normalizedPath);
  if (workspaceUrl.trim() && ((!isAbsolutePath) || (root && normalizedPath.toLowerCase().startsWith(`${root.toLowerCase()}/`)))) {
    const relative = root ? normalizedPath.slice(root.length).replace(/^\/+/, '') : normalizedPath;
    try {
      const base = workspaceUrl.endsWith('/') ? workspaceUrl : `${workspaceUrl}/`;
      return new URL(relative.split('/').map(encodeURIComponent).join('/'), base).toString();
    } catch { /* fall through to local URL */ }
  }
  return toFileUrl(path);
}

function toFileUrl(value: string) {
  const normalizedValue = value.replace(/\\/g, '/');
  if (normalizedValue.startsWith('//')) {
    return `file://${normalizedValue.slice(2).split('/').map(encodeURIComponent).join('/')}`;
  }
  const normalized = normalizedValue.replace(/^\/+/, '');
  return `file:///${normalized.split('/').map((part, index) => index === 0 && /^[A-Za-z]:$/.test(part) ? part : encodeURIComponent(part)).join('/')}`;
}

function decodeContent(file: ChatFile) {
  if (!file.content) return '';
  if (file.encoding !== 'base64' || /^data:/i.test(file.content)) return file.content;
  return decodeBase64(file.content);
}

function decodeBase64(value: string) {
  try { return decodeURIComponent(escape(atob(value))); } catch { return atob(value); }
}

function decodeBase64Bytes(value: string) {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function loadRemoteText() {
  requestController?.abort();
  requestController = null;
  remoteText.value = '';
  remoteError.value = '';
  if (!isText.value || textContent.value || !resolvedUrl.value || isLocalFile.value || !/^https?:/i.test(resolvedUrl.value)) return;
  const controller = new AbortController();
  requestController = controller;
  try {
    const response = await fetch(resolvedUrl.value, { signal: controller.signal });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`.trim());
    remoteText.value = await response.text();
  } catch (error) {
    if (controller.signal.aborted) return;
    remoteError.value = error instanceof Error ? error.message : String(error);
  }
}

watch([() => props.file.id, resolvedUrl], loadRemoteText, { immediate: true });
onBeforeUnmount(() => requestController?.abort());
</script>

<template>
  <aside class="file-preview-panel" :aria-label="labels.filePreview">
    <header class="file-preview-header">
      <FileText :size="16" aria-hidden="true" />
      <div class="file-preview-title"><strong>{{ file.name }}</strong><span>{{ file.mimeType }}</span></div>
      <button type="button" class="icon-button" :title="labels.closePreview" @click="emit('close')"><X :size="16" aria-hidden="true" /></button>
    </header>
    <div class="file-preview-toolbar">
      <button v-if="isText" type="button" class="icon-text-button" @click="sourceVisible = !sourceVisible"><FileText :size="14" /><span>{{ sourceVisible ? labels.preview : labels.source }}</span></button>
      <button v-if="isText" type="button" class="icon-text-button" :title="copied ? labels.copied : labels.copyMessage" @click="copySource"><Check v-if="copied" :size="14" /><Copy v-else :size="14" /><span>{{ copied ? labels.copied : labels.copyMessage }}</span></button>
      <button type="button" class="icon-text-button" @click="downloadFile"><Download :size="14" /><span>{{ labels.download }}</span></button>
      <a v-if="resolvedUrl && !isLocalFile" class="icon-text-button" :href="resolvedUrl" target="_blank" rel="noopener noreferrer"><ExternalLink :size="14" /><span>{{ labels.openInNewWindow }}</span></a>
    </div>
    <div v-if="isLocalFile && !previewText && !imageSrc" class="file-preview-notice" role="status">{{ labels.localFileUnavailable }}<code>{{ resolvedUrl }}</code></div>
    <div v-else-if="sourceVisible" class="file-preview-content source"><pre>{{ previewText }}</pre></div>
    <div v-else-if="isHtml && (textContent || resolvedUrl)" class="file-preview-content html"><iframe :src="textContent ? undefined : resolvedUrl" :srcdoc="textContent || undefined" sandbox="allow-scripts" :title="file.name"></iframe></div>
    <div v-else-if="isMarkdown && previewText" class="file-preview-content markdown" v-html="renderMarkdown(previewText)"></div>
    <div v-else-if="isImage && imageSrc" class="file-preview-content image"><img :src="imageSrc" :alt="file.name" /></div>
    <div v-else-if="isPdf && resolvedUrl" class="file-preview-content pdf"><iframe :src="resolvedUrl" :title="file.name"></iframe></div>
    <div v-else-if="isText && previewText" class="file-preview-content source"><pre>{{ previewText }}</pre></div>
    <div v-else-if="remoteError" class="file-preview-content empty-preview"><span>{{ labels.previewLoadFailed }}: {{ remoteError }}</span></div>
    <div v-else-if="resolvedUrl" class="file-preview-content empty-preview"><ExternalLink :size="18" /><span>{{ labels.previewUnavailable }}</span></div>
    <div v-else class="file-preview-content empty-preview"><span>{{ labels.noPreviewContent }}</span></div>
  </aside>
</template>
