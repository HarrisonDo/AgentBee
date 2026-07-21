<script setup lang="ts">
import { Bot, MemoryStick, Paperclip, SendHorizontal, Square, X } from 'lucide-vue-next';
import { nextTick, ref } from 'vue';
import type { ClientAttachment } from '../protocol/types';

const props = defineProps<{
  availableModels: string[];
  disabled: boolean;
  labels: Record<string, string>;
  modelName: string;
}>();

const emit = defineEmits<{
  selectModel: [modelName: string];
  send: [text: string, attachments: ClientAttachment[]];
  stop: [];
}>();

const text = ref('');
const attachments = ref<ClientAttachment[]>([]);
const fileInput = ref<HTMLInputElement | null>(null);
const textarea = ref<HTMLTextAreaElement | null>(null);
const uploadWarnings = ref<string[]>([]);
const isMac = /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent);
const TEXT_FILE_IDENTIFIERS = new Set([
  'adoc',
  'asciidoc',
  'ass',
  'astro',
  'atom',
  'asp',
  'aspx',
  'bash',
  'bashrc',
  'bat',
  'babelrc',
  'bib',
  'blade.php',
  'cfg',
  'c',
  'cc',
  'cfignore',
  'cjs',
  'clj',
  'cljs',
  'clang-format',
  'clang-tidy',
  'cmake',
  'cmd',
  'coffee',
  'conf',
  'config',
  'containerfile',
  'cpp',
  'cr',
  'cshtml',
  'csv',
  'cue',
  'cql',
  'cxx',
  'd',
  'desktop',
  'dif',
  'diff',
  'directory',
  'dockerfile',
  'dockerignore',
  'dtd',
  'ddl',
  'dml',
  'dta',
  'editorconfig',
  'edn',
  'ejs',
  'elm',
  'eml',
  'env',
  'erb',
  'erl',
  'err',
  'eslintignore',
  'eslintrc',
  'ex',
  'exs',
  'f',
  'f03',
  'f08',
  'f90',
  'f95',
  'fish',
  'flake8',
  'for',
  'geojson',
  'git',
  'gitattributes',
  'gitignore',
  'gitkeep',
  'gitmodules',
  'gnumakefile',
  'go',
  'gpx',
  'graphql',
  'groovy',
  'h',
  'haml',
  'hbs',
  'hcl',
  'hgignore',
  'hpp',
  'hrl',
  'hs',
  'htaccess',
  'htm',
  'html',
  'htmlhintrc',
  'htpasswd',
  'hql',
  'hxx',
  'ical',
  'ics',
  'idx',
  'ini',
  'inf',
  'inl',
  'ipynb',
  'ipp',
  'jade',
  'java',
  'jl',
  'js',
  'json',
  'json5',
  'jsonl',
  'jsp',
  'jsx',
  'jshintignore',
  'kml',
  'ksh',
  'kt',
  'kts',
  'latte',
  'latex',
  'lhs',
  'link',
  'liquid',
  'log',
  'logrotate.d',
  'lua',
  'm',
  'm3u',
  'm3u8',
  'mailmap',
  'makefile',
  'markdown',
  'mat',
  'mathml',
  'md',
  'mediawiki',
  'mjs',
  'ml',
  'mli',
  'mm',
  'mml',
  'mustache',
  'my.cnf',
  'mypy.ini',
  'n3',
  'nginx.conf',
  'nim',
  'njk',
  'nomad',
  'npmignore',
  'nt',
  'out',
  'owl',
  'osm',
  'pas',
  'patch',
  'pgsql',
  'php',
  'php.ini',
  'php3',
  'php4',
  'php5',
  'phpt',
  'phtml',
  'pkl',
  'pl',
  'plist',
  'pls',
  'plsql',
  'pm',
  'pod',
  'por',
  'pp',
  'prettierignore',
  'prettierrc',
  'profile',
  'prop',
  'properties',
  'ps1',
  'psd1',
  'psm1',
  'psql',
  'psv',
  'pug',
  'py',
  'python',
  'pyi',
  'pylintrc',
  'pytest.ini',
  'pyw',
  'r',
  'raku',
  'rb',
  'rdf',
  'reg',
  'redis.conf',
  'rhtml',
  'ris',
  'rmd',
  'rst',
  'rtf',
  'ru',
  'rss',
  'rs',
  'sas',
  'sav',
  'scala',
  'screenrc',
  'service',
  'sh',
  'slim',
  'slm',
  'slugignore',
  'smarty',
  'socket',
  'sql',
  'sqlite',
  'sps',
  'ssa',
  'stata',
  'stylelintignore',
  'stylelintrc',
  'sub',
  'svelte',
  'svnignore',
  'svg',
  'swift',
  'systemd',
  't',
  'target',
  'tex',
  'text',
  'tf',
  'tfvars',
  'tmux.conf',
  'toml',
  'topojson',
  'tox.ini',
  'tpl',
  'trig',
  'trix',
  'ts',
  'tsv',
  'tsx',
  'ttl',
  'twig',
  'txt',
  'url',
  'v',
  'vba',
  'vbs',
  'vcal',
  'vcard',
  'vcf',
  'vimrc',
  'vue',
  'vbhtml',
  'volt',
  'vtt',
  'wiki',
  'xhtml',
  'xml',
  'xsl',
  'xslt',
  'yaml',
  'yml',
  'zig',
  'zsh',
  'zshrc',
]);

function submit() {
  const value = text.value.trim();
  if (!value && !attachments.value.length) return;
  emit('send', value, attachments.value);
  text.value = '';
  attachments.value = [];
  uploadWarnings.value = [];
  if (fileInput.value) fileInput.value.value = '';
  nextTick(resize);
}

function saveMemory() {
  emit('send', props.labels.saveMemoryMessage, []);
}

function onModelChange(event: Event) {
  const modelName = (event.target as HTMLSelectElement).value;
  if (!modelName || modelName === props.modelName) return;
  emit('selectModel', modelName);
}

function onKeydown(event: KeyboardEvent) {
  if (event.key !== 'Enter') return;
  const shouldInsertNewline = isMac ? event.metaKey : event.ctrlKey;
  if (shouldInsertNewline) {
    event.preventDefault();
    insertNewlineAtCursor();
    return;
  }
  if (!event.shiftKey) {
    event.preventDefault();
    submit();
  }
}

function insertNewlineAtCursor() {
  const input = textarea.value;
  if (!input) {
    text.value = `${text.value}\n`;
    nextTick(resize);
    return;
  }

  const start = input.selectionStart;
  const end = input.selectionEnd;
  text.value = `${text.value.slice(0, start)}\n${text.value.slice(end)}`;
  nextTick(() => {
    input.selectionStart = start + 1;
    input.selectionEnd = start + 1;
    resize();
  });
}

function resize() {
  if (!textarea.value) return;
  textarea.value.style.height = 'auto';
  textarea.value.style.height = `${Math.min(150, textarea.value.scrollHeight)}px`;
}

function openFilePicker() {
  fileInput.value?.click();
}

async function onFileChange(event: Event) {
  const input = event.target as HTMLInputElement;
  const files = Array.from(input.files || []);
  if (!files.length) return;

  const unsupported = files.filter((file) => getAttachmentKind(file) === 'binary');
  const readable = files.filter((file) => getAttachmentKind(file) !== 'binary');
  uploadWarnings.value = [
    ...unsupported.map((file) => `${props.labels.unsupportedFile}: ${file.name}`),
  ];
  const loaded = await Promise.all(readable.map(readAttachment));
  attachments.value = [...attachments.value, ...loaded];
  input.value = '';
}

function removeAttachment(id: string) {
  attachments.value = attachments.value.filter((attachment) => attachment.id !== id);
}

function formatSize(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

async function readAttachment(file: File): Promise<ClientAttachment> {
  const kind = getAttachmentKind(file);
  const base = {
    id: makeAttachmentId(),
    kind,
    name: file.name,
    size: file.size,
    type: file.type || 'application/octet-stream',
  } satisfies Omit<ClientAttachment, 'text' | 'base64'>;

  if (kind === 'text') {
    return {
      ...base,
      text: await file.text(),
    };
  }

  return {
    ...base,
    base64: await readFileBase64(file),
  };
}

function getAttachmentKind(file: File): ClientAttachment['kind'] {
  if (file.type.startsWith('image/')) return 'image';
  if (isTextFile(file)) return 'text';
  return 'binary';
}

function isTextFile(file: File) {
  if (file.type.startsWith('text/')) return true;
  const identifiers = getFileIdentifiers(file.name);
  return identifiers.some((identifier) => TEXT_FILE_IDENTIFIERS.has(identifier));
}

function getFileIdentifiers(fileName: string) {
  const normalized = fileName.trim().toLowerCase();
  const basename = normalized.split(/[\\/]/).pop() || normalized;
  const withoutLeadingDots = basename.replace(/^\.+/, '');
  const parts = withoutLeadingDots.split('.').filter(Boolean);
  const identifiers = new Set<string>([basename, withoutLeadingDots]);

  parts.forEach((part) => identifiers.add(part));
  for (let index = 0; index < parts.length - 1; index += 1) {
    identifiers.add(parts.slice(index).join('.'));
  }

  return Array.from(identifiers);
}

function readFileBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      resolve(result.includes(',') ? result.split(',')[1] : result);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function makeAttachmentId() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  return `file-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
</script>

<template>
  <footer class="composer">
    <div v-if="uploadWarnings.length" class="attachment-warnings" role="status">
      <span v-for="warning in uploadWarnings" :key="warning">{{ warning }}</span>
    </div>
    <div v-if="attachments.length" class="attachment-list" :aria-label="labels.attachedFiles">
      <span v-for="attachment in attachments" :key="attachment.id" class="attachment-chip">
        <Paperclip :size="13" aria-hidden="true" />
        <span class="attachment-name">{{ attachment.name }}</span>
        <span class="attachment-size">{{ formatSize(attachment.size) }}</span>
        <button type="button" :title="labels.removeFile" @click="removeAttachment(attachment.id)">
          <X :size="13" aria-hidden="true" />
        </button>
      </span>
    </div>
    <button
      type="button"
      class="memory-send icon-button"
      :aria-label="labels.saveMemory"
      :data-tooltip="labels.saveMemory"
      :title="labels.saveMemory"
      @click="saveMemory"
    >
      <MemoryStick :size="17" aria-hidden="true" />
    </button>
    <div class="composer-input-shell">
      <textarea
        ref="textarea"
        v-model="text"
        rows="1"
        :placeholder="labels.composerPlaceholder"
        :disabled="disabled"
        @input="resize"
        @keydown="onKeydown"
      ></textarea>
      <div class="composer-model-picker" :title="labels.modelName">
        <Bot :size="14" aria-hidden="true" />
        <select
          :aria-label="labels.modelName"
          :value="modelName"
          :disabled="disabled || (!availableModels.length && !modelName)"
          @change="onModelChange"
        >
          <option v-if="!availableModels.length" :value="modelName">
            {{ modelName || labels.noModelsAvailable }}
          </option>
          <option
            v-else-if="modelName && !availableModels.includes(modelName)"
            :value="modelName"
          >
            {{ modelName }}
          </option>
          <option v-for="model in availableModels" :key="model" :value="model">
            {{ model }}
          </option>
        </select>
      </div>
    </div>
    <input
      ref="fileInput"
      class="file-input"
      type="file"
      multiple
      :disabled="disabled"
      @change="onFileChange"
    />
    <button
      type="button"
      class="attach-button icon-button"
      :aria-label="labels.attachFiles"
      :data-tooltip="labels.attachFiles"
      :title="labels.attachFiles"
      :disabled="disabled"
      @click="openFilePicker"
    >
      <Paperclip :size="17" aria-hidden="true" />
    </button>
    <button
      type="button"
      class="stop-send icon-button"
      :aria-label="labels.stopGeneration"
      :data-tooltip="labels.stopGeneration"
      :title="labels.stopGeneration"
      @click="emit('stop')"
    >
      <Square :size="16" aria-hidden="true" />
    </button>
    <button
      type="button"
      class="send icon-button"
      :aria-label="labels.send"
      :data-tooltip="labels.send"
      :title="labels.send"
      @click="submit"
    >
      <SendHorizontal :size="17" aria-hidden="true" />
    </button>
  </footer>
</template>
