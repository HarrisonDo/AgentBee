<script setup lang="ts">
import { ArrowUp, LoaderCircle, MemoryStick, Paperclip, Plus, Square, X } from 'lucide-vue-next';
import { computed, nextTick, ref } from 'vue';
import type { ClientAttachment } from '../protocol/types';
import { shouldIgnoreCompositionEnter } from '../utils/composerKeyboard';

const props = defineProps<{
  availableModels: string[];
  disabled: boolean;
  generating: boolean;
  labels: Record<string, string>;
  modelName: string;
}>();

const emit = defineEmits<{
  selectModel: [modelName: string];
  send: [
    text: string,
    attachments: ClientAttachment[],
    onDispatched: (dispatched: boolean) => void,
  ];
  stop: [];
}>();

const text = ref('');
const attachments = ref<ClientAttachment[]>([]);
const fileInput = ref<HTMLInputElement | null>(null);
const textarea = ref<HTMLTextAreaElement | null>(null);
const uploadWarnings = ref<string[]>([]);
const isComposing = ref(false);
const submissionPending = ref(false);
const isMac = /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent);
const COMPOSITION_ENTER_GUARD_MS = 100;
const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
const MAX_TOTAL_ATTACHMENT_BYTES = 40 * 1024 * 1024;
let ignoreEnterUntil = 0;
const canSubmit = computed(() => (
  !submissionPending.value &&
  !isComposing.value &&
  (Boolean(text.value.trim()) || attachments.value.length > 0)
));

function submit() {
  if (!canSubmit.value) return;
  const submittedText = text.value;
  const value = submittedText.trim();
  if (!value && !attachments.value.length) return;
  const submittedAttachmentIds = new Set(attachments.value.map((attachment) => attachment.id));
  const submittedAttachments = attachments.value.map((attachment) => ({ ...attachment }));
  submissionPending.value = true;
  emit('send', value, submittedAttachments, (dispatched) => {
    submissionPending.value = false;
    if (!dispatched) return;
    if (text.value === submittedText) text.value = '';
    attachments.value = attachments.value.filter(
      (attachment) => !submittedAttachmentIds.has(attachment.id),
    );
    uploadWarnings.value = [];
    if (fileInput.value) fileInput.value.value = '';
    nextTick(resize);
  });
}

function saveMemory() {
  emit('send', props.labels.saveMemoryMessage, [], () => undefined);
}

function onModelChange(event: Event) {
  const modelName = (event.target as HTMLSelectElement).value;
  if (!modelName || modelName === props.modelName) return;
  emit('selectModel', modelName);
}

function onKeydown(event: KeyboardEvent) {
  if (event.key !== 'Enter') return;
  if (shouldIgnoreCompositionEnter(
    event,
    isComposing.value,
    performance.now() < ignoreEnterUntil,
  )) return;
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

function onCompositionStart() {
  isComposing.value = true;
  ignoreEnterUntil = 0;
}

function onCompositionEnd() {
  isComposing.value = false;
  ignoreEnterUntil = performance.now() + COMPOSITION_ENTER_GUARD_MS;
  nextTick(resize);
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

async function onFileChange(event: Event) {
  const input = event.target as HTMLInputElement;
  const files = Array.from(input.files || []);
  if (!files.length) return;

  uploadWarnings.value = [];
  let nextTotalSize = attachments.value.reduce((sum, attachment) => sum + attachment.size, 0);
  const acceptedFiles: File[] = [];
  files.forEach((file) => {
    if (file.size > MAX_ATTACHMENT_BYTES) {
      uploadWarnings.value.push(formatLabel(
        props.labels.fileTooLargeDetail,
        { limit: formatSize(MAX_ATTACHMENT_BYTES), name: file.name },
      ));
      return;
    }
    if (nextTotalSize + file.size > MAX_TOTAL_ATTACHMENT_BYTES) {
      uploadWarnings.value.push(formatLabel(
        props.labels.fileTotalTooLarge,
        { limit: formatSize(MAX_TOTAL_ATTACHMENT_BYTES) },
      ));
      return;
    }
    nextTotalSize += file.size;
    acceptedFiles.push(file);
  });

  const results = await Promise.allSettled(acceptedFiles.map(readAttachment));
  const loaded: ClientAttachment[] = [];
  results.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      loaded.push(result.value);
      return;
    }
    uploadWarnings.value.push(formatLabel(
      props.labels.fileReadFailed,
      { name: acceptedFiles[index].name },
    ));
  });
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
  return {
    id: makeAttachmentId(),
    name: file.name,
    size: file.size,
    type: file.type || 'application/octet-stream',
    base64: await readFileBase64(file),
  };
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

function formatLabel(template: string, values: Record<string, string>) {
  return Object.entries(values).reduce(
    (result, [key, value]) => result.split(`{${key}}`).join(value),
    template,
  );
}
</script>

<template>
  <footer class="composer">
    <div class="composer-panel">
      <div v-if="uploadWarnings.length" class="attachment-warnings" role="alert" aria-live="polite">
        <span v-for="(warning, index) in uploadWarnings" :key="`${index}-${warning}`">{{ warning }}</span>
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
      <textarea
        ref="textarea"
        v-model="text"
        rows="1"
        :placeholder="labels.composerPlaceholder"
        @input="resize"
        @keydown="onKeydown"
        @compositionstart="onCompositionStart"
        @compositionend="onCompositionEnd"
      ></textarea>

      <div class="composer-toolbar">
        <div class="composer-toolbar-group">
          <label
            class="attach-button composer-tool-button"
            :aria-label="labels.attachFiles"
            :data-tooltip="labels.attachFiles"
            :title="labels.attachFiles"
          >
            <input
              ref="fileInput"
              class="file-input"
              type="file"
              multiple
              :aria-label="labels.attachFiles"
              @change="onFileChange"
            />
            <Plus :size="19" aria-hidden="true" />
          </label>
          <button
            type="button"
            class="memory-send composer-text-button"
            :title="labels.saveMemory"
            :disabled="disabled"
            @click="saveMemory"
          >
            <MemoryStick :size="15" aria-hidden="true" />
            <span>{{ labels.saveMemory }}</span>
          </button>
        </div>

        <div class="composer-toolbar-group composer-toolbar-actions">
          <div class="composer-model-picker" :title="labels.modelName">
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
          <button
            v-if="generating"
            type="button"
            class="stop-send composer-submit-button"
            :aria-label="labels.stopGeneration"
            :data-tooltip="labels.stopGeneration"
            :title="labels.stopGeneration"
            @click="emit('stop')"
          >
            <Square :size="14" aria-hidden="true" />
          </button>
          <button
            type="button"
            class="send composer-submit-button"
            :aria-label="labels.send"
            :data-tooltip="submissionPending ? labels.connectingToSend : labels.send"
            :title="submissionPending ? labels.connectingToSend : labels.send"
            :disabled="!canSubmit"
            @click="submit"
          >
            <LoaderCircle v-if="submissionPending" class="spin" :size="17" aria-hidden="true" />
            <ArrowUp v-else :size="18" aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  </footer>
</template>
