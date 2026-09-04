<script setup lang="ts">
import {
  Bot,
  ChevronDown,
  ChevronRight,
  Code2,
  DownloadCloud,
  FolderOpen,
  KeyRound,
  Languages,
  Link,
  LogIn,
  LogOut,
  Moon,
  Palette,
  RotateCcw,
  Save,
  Server,
  ShieldCheck,
  Sun,
} from 'lucide-vue-next';
import { ref } from 'vue';

type Locale = 'zh' | 'en';
type StatusTone = 'success' | 'warning' | 'error';
type Theme = 'light' | 'dark';

interface BasicSettings {
  apiKey: string;
  apiUrl: string;
  inSandbox: boolean;
  modelName: string;
  workspacePath: string;
}

defineProps<{
  appVersion: string;
  basicSettings: BasicSettings;
  connected: boolean;
  connecting: boolean;
  connectionError: string;
  configJson: string;
  configJsonError: string;
  labels: Record<string, string>;
  locale: Locale;
  settingStatus: string;
  settingStatusTone: StatusTone;
  showDebugInfo: boolean;
  theme: Theme;
  wsToken: string;
  wsUrl: string;
}>();

const emit = defineEmits<{
  connect: [];
  disconnect: [];
  getConfig: [];
  getDefaultConfig: [];
  saveConfig: [];
  setLocale: [locale: Locale];
  setTheme: [theme: Theme];
  'update:basicSetting': [field: keyof BasicSettings, value: boolean | string];
  'update:configJson': [value: string];
  'update:showDebugInfo': [value: boolean];
  'update:wsToken': [value: string];
  'update:wsUrl': [value: string];
}>();

const advancedExpanded = ref(false);
</script>

<template>
  <section class="settings-view">
    <div class="settings-section appearance-section">
      <div class="settings-section-title">
        <Palette :size="17" aria-hidden="true" />
        <div>
          <h2>{{ labels.appearanceSettings }}</h2>
          <p>{{ labels.appearanceSettingsHint }}</p>
        </div>
      </div>
      <div class="settings-preferences">
        <div class="settings-preference-row">
          <span class="settings-preference-label">
            <Sun :size="14" aria-hidden="true" />
            {{ labels.theme }}
          </span>
          <div class="settings-segmented" role="group" :aria-label="labels.theme">
            <button
              type="button"
              :class="{ active: theme === 'light' }"
              @click="emit('setTheme', 'light')"
            >
              <Sun :size="14" aria-hidden="true" />
              <span>{{ labels.themeLight }}</span>
            </button>
            <button
              type="button"
              :class="{ active: theme === 'dark' }"
              @click="emit('setTheme', 'dark')"
            >
              <Moon :size="14" aria-hidden="true" />
              <span>{{ labels.themeDark }}</span>
            </button>
          </div>
        </div>
        <div class="settings-preference-row">
          <span class="settings-preference-label">
            <Languages :size="14" aria-hidden="true" />
            {{ labels.language }}
          </span>
          <div class="settings-segmented" role="group" :aria-label="labels.language">
            <button
              type="button"
              :class="{ active: locale === 'zh' }"
              @click="emit('setLocale', 'zh')"
            >
              中文
            </button>
            <button
              type="button"
              :class="{ active: locale === 'en' }"
              @click="emit('setLocale', 'en')"
            >
              EN
            </button>
          </div>
        </div>
        <div class="settings-preference-row">
          <span class="settings-preference-label">
            <Code2 :size="14" aria-hidden="true" />
            Debug Info
          </span>
          <div class="settings-segmented" role="group" aria-label="Debug Info">
            <button
              type="button"
              :class="{ active: !showDebugInfo }"
              @click="emit('update:showDebugInfo', false)"
            >
              <span>Off</span>
            </button>
            <button
              type="button"
              :class="{ active: showDebugInfo }"
              @click="emit('update:showDebugInfo', true)"
            >
              <span>On</span>
            </button>
          </div>
        </div>
        <div class="settings-preference-row">
          <span class="settings-preference-label">
            <Code2 :size="14" aria-hidden="true" />
            Version
          </span>
          <span class="settings-version">v{{ appVersion }}</span>
        </div>
      </div>
    </div>

    <div class="settings-section">
      <div class="settings-section-title">
        <Link :size="17" aria-hidden="true" />
        <div>
          <h2>{{ labels.wsSettings }}</h2>
          <p>{{ labels.wsSettingsHint }}</p>
        </div>
      </div>
      <label class="settings-field" for="agentServerWsUrl">
        <span>
          <Link :size="14" aria-hidden="true" />
          {{ labels.wsUrl }}
        </span>
        <div class="settings-input-actions">
          <input
            id="agentServerWsUrl"
            :value="wsUrl"
            type="text"
            placeholder="ws://127.0.0.1:8686"
            @input="emit('update:wsUrl', ($event.target as HTMLInputElement).value)"
          />
          <div class="settings-input-button-group">
            <button
              type="button"
              class="icon-button"
              :title="labels.connect"
              :disabled="connected || connecting"
              @click="emit('connect')"
            >
              <LogIn :size="15" aria-hidden="true" />
            </button>
            <button
              type="button"
              class="icon-button"
              :title="labels.disconnect"
              :disabled="!connected && !connecting"
              @click="emit('disconnect')"
            >
              <LogOut :size="15" aria-hidden="true" />
            </button>
          </div>
        </div>
      </label>
      <label class="settings-field" for="agentServerWsToken">
        <span>
          <KeyRound :size="14" aria-hidden="true" />
          {{ labels.wsToken }}
        </span>
        <input
          id="agentServerWsToken"
          :value="wsToken"
          type="password"
          autocomplete="off"
          :placeholder="labels.wsTokenPlaceholder"
          @input="emit('update:wsToken', ($event.target as HTMLInputElement).value)"
        />
      </label>
      <div v-if="connectionError" class="settings-error connection-settings-error" role="alert">
        {{ connectionError }}
      </div>
    </div>

    <div class="settings-section">
      <div class="settings-grid two-column">
        <label class="settings-field" for="customModelApiUrl">
          <span>
            <Server :size="14" aria-hidden="true" />
            {{ labels.apiUrl }}
          </span>
          <input
            id="customModelApiUrl"
            :value="basicSettings.apiUrl"
            type="text"
            placeholder="https://api.example.com/v1"
            @input="emit('update:basicSetting', 'apiUrl', ($event.target as HTMLInputElement).value)"
          />
        </label>
        <label class="settings-field" for="customModelApiKey">
          <span>
            <KeyRound :size="14" aria-hidden="true" />
            {{ labels.apiKey }}
          </span>
          <input
            id="customModelApiKey"
            :value="basicSettings.apiKey"
            type="password"
            autocomplete="off"
            placeholder="sk-..."
            @input="emit('update:basicSetting', 'apiKey', ($event.target as HTMLInputElement).value)"
          />
          <small class="settings-field-hint">{{ labels.apiKeyEncryptedHint }}</small>
        </label>
        <label class="settings-field" for="agentWorkspacePath">
          <span>
            <FolderOpen :size="14" aria-hidden="true" />
            {{ labels.workspaceConfig }}
          </span>
          <input
            id="agentWorkspacePath"
            :value="basicSettings.workspacePath"
            type="text"
            placeholder="D:\\Projects\\AgentBee"
            @input="emit('update:basicSetting', 'workspacePath', ($event.target as HTMLInputElement).value)"
          />
        </label>
        <label class="settings-field settings-switch-field" for="agentSandboxMode">
          <span>
            <ShieldCheck :size="14" aria-hidden="true" />
            {{ labels.sandboxMode }}
          </span>
          <span class="settings-switch-row">
            <span class="settings-switch-copy">{{ labels.sandboxModeHint }}</span>
            <input
              id="agentSandboxMode"
              class="settings-switch-input"
              type="checkbox"
              :checked="basicSettings.inSandbox"
              @change="emit('update:basicSetting', 'inSandbox', ($event.target as HTMLInputElement).checked)"
            />
            <span class="settings-switch" aria-hidden="true">
              <span></span>
            </span>
          </span>
        </label>
      </div>
      <div class="settings-actions">
        <button type="button" class="icon-text-button primary-action" @click="emit('saveConfig')">
          <Save :size="15" aria-hidden="true" />
          <span>{{ labels.saveConfig }}</span>
        </button>
      </div>
      <div v-if="configJsonError" class="settings-error" role="status">{{ configJsonError }}</div>
      <div
        v-else-if="settingStatus"
        class="settings-status"
        :class="`settings-status-${settingStatusTone}`"
        role="status"
      >
        {{ settingStatus }}
      </div>
    </div>

    <div class="settings-section">
      <button type="button" class="settings-collapse" @click="advancedExpanded = !advancedExpanded">
        <div class="settings-section-title">
          <Code2 :size="17" aria-hidden="true" />
          <div>
            <h2>{{ labels.advancedJsonSettings }}</h2>
            <p>{{ labels.advancedJsonSettingsHint }}</p>
          </div>
        </div>
        <span class="settings-collapse-icon" :title="advancedExpanded ? labels.collapse : labels.expand">
          <ChevronDown v-if="advancedExpanded" :size="16" aria-hidden="true" />
          <ChevronRight v-else :size="16" aria-hidden="true" />
        </span>
      </button>
      <div v-show="advancedExpanded" class="settings-collapse-body">
        <div class="settings-actions">
          <button type="button" class="icon-text-button" @click="emit('getConfig')">
            <DownloadCloud :size="15" aria-hidden="true" />
            <span>{{ labels.getConfig }}</span>
          </button>
          <button type="button" class="icon-text-button" @click="emit('getDefaultConfig')">
            <RotateCcw :size="15" aria-hidden="true" />
            <span>{{ labels.getDefaultConfig }}</span>
          </button>
        </div>
        <label class="settings-field" for="advancedConfigJson">
          <span>{{ labels.fullConfigJson }}</span>
          <textarea
            id="advancedConfigJson"
            class="settings-json"
            spellcheck="false"
            :value="configJson"
            @input="emit('update:configJson', ($event.target as HTMLTextAreaElement).value)"
          ></textarea>
        </label>
      </div>
    </div>
  </section>
</template>
