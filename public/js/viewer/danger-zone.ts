import { fetchWithAuth } from '../common/api.js';
import { showToast, openDialog, closeDialog } from '../common/ui.js';

/**
 * Context object passed to the danger zone module.
 */
export interface DangerZoneContext {
  apiBaseUrl: string;
  testMode: boolean;
}

/**
 * Services provided to the danger zone module.
 */
export interface DangerZoneServices {
  getCurrentChannel: () => string | null;
}

/**
 * Options for requesting a channel from the user.
 */
export interface RequestChannelOptions {
  title: string;
  description: string;
  confirmLabel: string;
  confirmClass: string;
  onConfirm: (channelName: string) => void;
}

/**
 * Dependencies that can be injected into the module.
 */
export interface DangerZoneDeps {
  requestChannel?: (options: RequestChannelOptions) => void;
}

/**
 * Status of whether a user is ignored for TTS/music.
 */
export interface IgnoreStatus {
  tts?: boolean;
  music?: boolean;
}

/**
 * DOM elements used by the danger zone module.
 */
interface DangerZoneElements {
  dangerZoneSection: HTMLElement | null;
  dangerTtsToggle: HTMLElement | null;
  dangerMusicToggle: HTMLElement | null;
  ignoreTtsCheckbox: HTMLInputElement | null;
  ignoreMusicCheckbox: HTMLInputElement | null;
  confirmModal: HTMLDialogElement | null;
  confirmText: HTMLElement | null;
  confirmYes: HTMLButtonElement | null;
  confirmNo: HTMLButtonElement | null;
}

/**
 * Pending action state.
 */
interface PendingAction {
  type: 'tts' | 'music';
  checkbox: HTMLInputElement;
}

/**
 * Return type of the danger zone module.
 */
export interface DangerZoneModule {
  updateChannel(channelName: string, ignoreStatus?: IgnoreStatus): void;
  clear(): void;
}

/**
 * Handles viewer opt-out toggles for TTS and music.
 */
export function initDangerZoneModule(
  context: DangerZoneContext,
  services: DangerZoneServices,
  deps: DangerZoneDeps = {}
): DangerZoneModule {
  const { apiBaseUrl, testMode } = context;
  const { getCurrentChannel } = services;
  const { requestChannel } = deps;

  const elements: DangerZoneElements = {
    dangerZoneSection: document.getElementById('danger-zone-section'),
    dangerTtsToggle: document.getElementById('danger-tts-toggle'),
    dangerMusicToggle: document.getElementById('danger-music-toggle'),
    ignoreTtsCheckbox: document.getElementById('ignore-tts') as HTMLInputElement | null,
    ignoreMusicCheckbox: document.getElementById('ignore-music') as HTMLInputElement | null,
    confirmModal: document.getElementById('confirm-modal') as HTMLDialogElement | null,
    confirmText: document.getElementById('confirm-text'),
    confirmYes: document.getElementById('confirm-yes') as HTMLButtonElement | null,
    confirmNo: document.getElementById('confirm-no') as HTMLButtonElement | null,
  };

  let pendingAction: PendingAction | null = null;
  let pendingChannel: string | null = null;

  attachListeners();

  return {
    updateChannel(channelName: string, ignoreStatus: IgnoreStatus = {}): void {
      const hasChannel = Boolean(channelName);
      toggleVisibility(hasChannel);
      updateIgnoreCheckboxes(ignoreStatus);
    },
    clear(): void {
      toggleVisibility(false);
      updateIgnoreCheckboxes({});
    },
  };

  function attachListeners(): void {
    if (elements.ignoreTtsCheckbox) {
      elements.ignoreTtsCheckbox.addEventListener('change', () => {
        if (elements.ignoreTtsCheckbox?.checked) handleIgnoreAction('tts');
      });
    }
    if (elements.ignoreMusicCheckbox) {
      elements.ignoreMusicCheckbox.addEventListener('change', () => {
        if (elements.ignoreMusicCheckbox?.checked) handleIgnoreAction('music');
      });
    }
    if (elements.confirmYes) {
      elements.confirmYes.addEventListener('click', confirmIgnoreAction);
    }
    if (elements.confirmNo) {
      elements.confirmNo.addEventListener('click', cancelIgnoreAction);
    }
  }

  function toggleVisibility(visible: boolean): void {
    if (elements.dangerZoneSection) {
      elements.dangerZoneSection.classList.toggle('d-none', !visible);
    }
    if (elements.dangerTtsToggle) {
      elements.dangerTtsToggle.style.display = visible ? '' : 'none';
    }
    if (elements.dangerMusicToggle) {
      elements.dangerMusicToggle.style.display = visible ? '' : 'none';
    }
  }

  function updateIgnoreCheckboxes(ignoreStatus: IgnoreStatus): void {
    const { ignoreTtsCheckbox, ignoreMusicCheckbox } = elements;
    if (ignoreTtsCheckbox) {
      const disabled = ignoreStatus.tts === true;
      ignoreTtsCheckbox.checked = disabled;
      ignoreTtsCheckbox.disabled = disabled;
    }
    if (ignoreMusicCheckbox) {
      const disabled = ignoreStatus.music === true;
      ignoreMusicCheckbox.checked = disabled;
      ignoreMusicCheckbox.disabled = disabled;
    }
  }

  function handleIgnoreAction(type: 'tts' | 'music'): void {
    const checkbox = type === 'tts' ? elements.ignoreTtsCheckbox : elements.ignoreMusicCheckbox;
    if (!checkbox) return;

    if (testMode) {
      checkbox.disabled = true;
      showToast(`You have been opted out of ${type.toUpperCase()} (test mode)`, 'success');
      return;
    }

    const currentChannel = getCurrentChannel();
    if (currentChannel) {
      pendingAction = { type, checkbox };
      pendingChannel = currentChannel;
      showConfirmModal(type, currentChannel);
    } else if (typeof requestChannel === 'function') {
      requestChannel({
        title: `Confirm channel for ${type.toUpperCase()} opt-out`,
        description: 'Enter the channel name to continue:',
        confirmLabel: 'Continue',
        confirmClass: 'btn-danger',
        onConfirm: (channelName: string) => {
          pendingAction = { type, checkbox };
          pendingChannel = channelName;
          showConfirmModal(type, channelName);
        },
      });
    } else {
      showToast('Please select a channel first.', 'warning');
      checkbox.checked = false;
    }
  }

  function showConfirmModal(type: 'tts' | 'music', channelName: string): void {
    if (!elements.confirmModal) return;
    if (elements.confirmText) {
      elements.confirmText.textContent = `Are you absolutely sure you want to opt out of ${type.toUpperCase()} in #${channelName}? Only a moderator can undo this action.`;
    }
    openDialog(elements.confirmModal);
  }

  async function confirmIgnoreAction(): Promise<void> {
    if (!pendingAction) return;
    const { type, checkbox } = pendingAction;
    try {
      if (testMode) {
        checkbox.disabled = true;
        showToast(`You have been opted out of ${type.toUpperCase()} (test mode)`, 'success');
        closeDialog(elements.confirmModal);
        pendingAction = null;
        pendingChannel = null;
        return;
      }
      const targetChannel = pendingChannel || getCurrentChannel();
      if (!targetChannel) {
        showToast('Please specify a channel', 'error');
        checkbox.checked = false;
        closeDialog(elements.confirmModal);
        pendingAction = null;
        pendingChannel = null;
        return;
      }
      await fetchWithAuth(`${apiBaseUrl}/api/viewer/ignore/${type}/${encodeURIComponent(targetChannel)}`, { method: 'POST' });
      checkbox.disabled = true;
      showToast(`You have been opted out of ${type.toUpperCase()}`, 'success');
    } catch (error) {
      console.error(`Failed to opt out of ${type}:`, error);
      checkbox.checked = false;
      showToast(`Failed to opt out of ${type.toUpperCase()}`, 'error');
    }
    closeDialog(elements.confirmModal);
    pendingAction = null;
    pendingChannel = null;
  }

  function cancelIgnoreAction(): void {
    if (pendingAction?.checkbox) {
      pendingAction.checkbox.checked = false;
    }
    pendingAction = null;
    pendingChannel = null;
    if (elements.confirmModal) closeDialog(elements.confirmModal);
  }
}
