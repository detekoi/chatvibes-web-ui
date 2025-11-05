import { fetchWithAuth } from '../common/api.js';
import { showToast } from '../common/ui.js';
import type { DashboardContext, DashboardServices } from './types.js';

/**
 * Content policy configuration
 */
interface ContentPolicy {
  blockLinks: boolean;
  bannedWords: string[];
}

/**
 * Channel Points reward configuration
 */
interface ChannelPointsConfig {
  enabled: boolean;
  title: string;
  cost: number;
  prompt: string;
  skipQueue: boolean;
  limitsEnabled: boolean;
  cooldownSeconds: number;
  perStreamLimit: number;
  perUserPerStreamLimit: number;
  rewardId?: string;
  lastSyncedAt?: string;
  contentPolicy?: ContentPolicy;
}

/**
 * API response for loading Channel Points configuration
 */
interface ChannelPointsData {
  channelPoints?: ChannelPointsConfig;
}

/**
 * API response for saving Channel Points configuration
 */
interface SaveResponse {
  channelPoints?: {
    rewardId?: string;
  };
  rewardId?: string;
  error?: string;
}

/**
 * API response for testing Channel Points redemption
 */
interface TestResponse {
  status?: string;
  error?: string;
}

/**
 * API response for deleting Channel Points reward
 */
interface DeleteResponse {
  error?: string;
}

/**
 * Dependencies for Channel Points module
 */
interface ChannelPointsDependencies {
  onSettingsRefresh?: () => Promise<void>;
}

/**
 * Channel Points module return type
 */
export interface ChannelPointsModule {
  load: () => Promise<void>;
}

/**
 * Channel Points reward management.
 */
export function initChannelPointsModule(
  context: DashboardContext,
  services: DashboardServices,
  deps: ChannelPointsDependencies = {}
): ChannelPointsModule {
  const { apiBaseUrl, testMode } = context;
  const { getSessionToken } = services;
  const { onSettingsRefresh } = deps;

  const cpEnabled = document.getElementById('cp-enabled') as HTMLInputElement | null;
  const cpTitle = document.getElementById('cp-title') as HTMLInputElement | null;
  const cpCost = document.getElementById('cp-cost') as HTMLInputElement | null;
  const cpPrompt = document.getElementById('cp-prompt') as HTMLTextAreaElement | null;
  const cpSkipQueue = document.getElementById('cp-skip-queue') as HTMLInputElement | null;
  const cpLimitsEnabled = document.getElementById('cp-limits-enabled') as HTMLInputElement | null;
  const cpCooldown = document.getElementById('cp-cooldown') as HTMLInputElement | null;
  const cpPerStream = document.getElementById('cp-per-stream') as HTMLInputElement | null;
  const cpPerUser = document.getElementById('cp-per-user') as HTMLInputElement | null;
  const cpBlockLinks = document.getElementById('cp-block-links') as HTMLInputElement | null;
  const cpBannedWords = document.getElementById('cp-banned-words') as HTMLTextAreaElement | null;
  const cpSaveBtn = document.getElementById('cp-save') as HTMLButtonElement | null;
  const cpTestBtn = document.getElementById('cp-test') as HTMLButtonElement | null;
  const cpDeleteBtn = document.getElementById('cp-delete') as HTMLButtonElement | null;
  const cpMsg = document.getElementById('cp-msg') as HTMLElement | null;
  const cpStatusLine = document.getElementById('cp-status-line') as HTMLElement | null;

  let lastSaveAt = 0;
  let timerId: ReturnType<typeof setTimeout> | null = null;
  const MIN_INTERVAL_MS = 1500;
  const DEBOUNCE_MS = 800;

  if (cpSaveBtn) cpSaveBtn.addEventListener('click', () => saveChannelPointsConfig(false));
  if (cpTestBtn) cpTestBtn.addEventListener('click', testChannelPointsRedeem);
  if (cpDeleteBtn) cpDeleteBtn.addEventListener('click', deleteChannelPointsReward);

  bindAutoSave();

  return {
    load: () => loadChannelPointsConfig(),
  };

  async function loadChannelPointsConfig(): Promise<void> {
    if (testMode) {
      if (cpEnabled) cpEnabled.checked = false;
      if (cpStatusLine) cpStatusLine.textContent = 'No reward created (test mode)';
      return;
    }

    try {
      const res = await fetchWithAuth(`${apiBaseUrl}/api/rewards/tts`, {
        method: 'GET',
        credentials: 'include'
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        console.warn('Failed to load Channel Points config:', err);
        return;
      }

      const data = await res.json() as ChannelPointsData;
      const cp = data.channelPoints || {} as ChannelPointsConfig;
      const policy = cp.contentPolicy || {} as ContentPolicy;
      if (cpEnabled) cpEnabled.checked = !!cp.enabled;
      if (cpTitle) cpTitle.value = cp.title ?? 'Text-to-Speech Message';
      if (cpCost) cpCost.value = String(cp.cost ?? 500);
      if (cpPrompt) cpPrompt.value = cp.prompt ?? 'Enter a message to be read aloud';
      if (cpSkipQueue) cpSkipQueue.checked = cp.skipQueue !== false;
      if (cpLimitsEnabled) cpLimitsEnabled.checked = cp.limitsEnabled ?? (cp.perStreamLimit > 0 || cp.perUserPerStreamLimit > 0);
      if (cpCooldown) cpCooldown.value = String(cp.limitsEnabled ? Math.max(1, cp.cooldownSeconds ?? 1) : (cp.cooldownSeconds ?? 0));
      if (cpPerStream) cpPerStream.value = cp.perStreamLimit > 0 ? String(cp.perStreamLimit) : '';
      if (cpPerUser) cpPerUser.value = cp.perUserPerStreamLimit > 0 ? String(cp.perUserPerStreamLimit) : '';
      if (cpBlockLinks) cpBlockLinks.checked = policy.blockLinks ?? false;
      if (cpBannedWords) cpBannedWords.value = (policy.bannedWords || []).join(', ');
      if (cpMsg) cpMsg.className = 'text-muted';
      if (cpStatusLine) {
        const lastSynced = cp.lastSyncedAt ? new Date(cp.lastSyncedAt).toLocaleTimeString() : 'never';
        const rewardInfo = cp.rewardId ? `Reward ID: ${cp.rewardId}` : 'No reward created';
        cpStatusLine.textContent = `${rewardInfo} · Last synced: ${lastSynced}`;
      }
    } catch (error) {
      console.warn('Failed to load Channel Points config:', error);
    }
  }

  async function saveChannelPointsConfig(isAuto: boolean = false): Promise<void> {
    if (testMode) {
      showToast('Channel Points saved ✓ (test mode)', 'success');
      if (cpStatusLine) cpStatusLine.textContent = 'No reward created · Last synced: ' + new Date().toLocaleTimeString();
      return;
    }
    if (!getSessionToken()) {
      showToast('Authentication required', 'error');
      return;
    }

    const payload: Omit<ChannelPointsConfig, 'rewardId' | 'lastSyncedAt'> = {
      enabled: !!cpEnabled?.checked,
      title: cpTitle?.value || 'Text-to-Speech Message',
      cost: parseInt(cpCost?.value || '500', 10),
      prompt: cpPrompt?.value || 'Enter a message to be read aloud',
      skipQueue: !!cpSkipQueue?.checked,
      limitsEnabled: !!cpLimitsEnabled?.checked,
      cooldownSeconds: parseInt(cpCooldown?.value || '0', 10),
      perStreamLimit: parseInt((cpPerStream?.value || '').toString().trim() || '0', 10),
      perUserPerStreamLimit: parseInt((cpPerUser?.value || '').toString().trim() || '0', 10),
      contentPolicy: {
        blockLinks: !!cpBlockLinks?.checked,
        bannedWords: (cpBannedWords?.value || '')
          .split(',')
          .map(word => word.trim())
          .filter(Boolean)
      }
    };

    if (!isAuto) {
      showToast('Saving Channel Points settings…', 'info');
    }

    try {
      const res = await fetchWithAuth(`${apiBaseUrl}/api/rewards/tts`, {
        method: 'POST',
        credentials: 'include',
        body: JSON.stringify(payload)
      });
      const data = await res.json().catch(() => ({})) as SaveResponse;
      if (!res.ok) {
        showToast(data.error || 'Failed to save Channel Points config', 'error');
        return;
      }
      if (isAuto) {
        showToast('Channel Points saved ✓', 'success');
      } else {
        showToast('Channel Points saved ✓', 'success');
      }
      if (cpStatusLine) {
        const rewardId = data.channelPoints?.rewardId || data.rewardId;
        const idPart = rewardId ? `Reward ID: ${rewardId}` : 'No reward created';
        cpStatusLine.textContent = `${idPart} · Last synced: ${new Date().toLocaleTimeString()}`;
      }
      await loadChannelPointsConfig();
      await onSettingsRefresh?.();
    } catch (error) {
      console.error('Failed to save Channel Points config:', error);
      showToast('Failed to save Channel Points config', 'error');
    }
  }

  async function testChannelPointsRedeem(): Promise<void> {
    if (testMode) {
      const text = prompt('Enter a test message to simulate a redemption:');
      if (text) showToast('Test validated ✓ (test mode)', 'success');
      return;
    }
    if (!getSessionToken()) {
      showToast('Authentication required', 'error');
      return;
    }
    const text = prompt('Enter a test message to simulate a redemption:');
    if (!text) return;
    try {
      showToast('Testing redeem…', 'info');
      const res = await fetchWithAuth(`${apiBaseUrl}/api/rewards/tts/test`, {
        method: 'POST',
        credentials: 'include',
        body: JSON.stringify({ text })
      });
      const data = await res.json().catch(() => ({})) as TestResponse;
      if (!res.ok) {
        showToast(data.error || 'Test failed', 'error');
        return;
      }
      showToast(`Test validated ✓ (${data.status || 'ok'})`, 'success');
    } catch (e) {
      showToast('Test failed', 'error');
    }
  }

  async function deleteChannelPointsReward(): Promise<void> {
    if (testMode) {
      if (cpEnabled) cpEnabled.checked = false;
      if (cpStatusLine) cpStatusLine.textContent = 'No reward created · Last synced: ' + new Date().toLocaleTimeString();
      showToast('Disabled & deleted ✓ (test mode)', 'success');
      return;
    }
    if (!getSessionToken()) {
      showToast('Authentication required', 'error');
      return;
    }
    if (!confirm('Disable & delete the Channel Points TTS reward?')) return;
    try {
      showToast('Deleting…', 'info');
      const res = await fetchWithAuth(`${apiBaseUrl}/api/rewards/tts`, {
        method: 'DELETE',
        credentials: 'include'
      });
      const data = await res.json().catch(() => ({})) as DeleteResponse;
      if (!res.ok) {
        showToast(data.error || 'Delete failed', 'error');
        return;
      }
      if (cpEnabled) cpEnabled.checked = false;
      if (cpStatusLine) cpStatusLine.textContent = 'No reward created · Last synced: ' + new Date().toLocaleTimeString();
      showToast('Disabled & deleted ✓', 'success');
      await loadChannelPointsConfig();
      await onSettingsRefresh?.();
    } catch (e) {
      showToast('Delete failed', 'error');
    }
  }

  function bindAutoSave(): void {
    const bind = (el: HTMLElement | null, events: string[] = ['input', 'change']): void => {
      if (!el) return;
      events.forEach(evt => el.addEventListener(evt, scheduleAutoSave));
    };

    bind(cpEnabled, ['change']);
    bind(cpTitle);
    bind(cpCost);
    bind(cpPrompt);
    bind(cpSkipQueue, ['change']);
    bind(cpLimitsEnabled, ['change']);
    bind(cpCooldown);
    bind(cpPerStream);
    bind(cpPerUser);
    bind(cpBlockLinks, ['change']);
    bind(cpBannedWords);

    const normalizeZeroToBlank = (el: HTMLInputElement | null): void => {
      if (!el) return;
      el.addEventListener('change', () => {
        if ((el.value || '').trim() === '0') {
          el.value = '';
        }
      });
    };
    normalizeZeroToBlank(cpPerStream);
    normalizeZeroToBlank(cpPerUser);

    if (cpCooldown) {
      cpCooldown.addEventListener('change', () => {
        const v = parseInt(cpCooldown.value || '0', 10);
        if (cpLimitsEnabled?.checked && v === 0) {
          cpCooldown.value = '1';
        }
      });
    }
  }

  function scheduleAutoSave(): void {
    const now = Date.now();
    const wait = Math.max(DEBOUNCE_MS, MIN_INTERVAL_MS - (now - lastSaveAt));

    if (timerId) {
      clearTimeout(timerId);
    }

    timerId = setTimeout(async () => {
      timerId = null;
      lastSaveAt = Date.now();
      await saveChannelPointsConfig(true);
    }, wait);
  }
}
