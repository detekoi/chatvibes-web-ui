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
 * Status of whether a user is ignored for TTS, and whether they may undo it.
 *
 * A viewer can lift their own opt-out but not a moderator's mute, so the page
 * needs the provenance, not just the boolean. `ttsSource` is null when the
 * viewer is not on the list at all.
 */
export interface IgnoreStatus {
  tts?: boolean;
  ttsSource?: 'self' | 'moderator' | null;
  ttsCanSelfUndo?: boolean;
}

/**
 * DOM elements used by the danger zone module.
 */
interface DangerZoneElements {
  dangerZoneSection: HTMLElement | null;
  dangerTtsToggle: HTMLElement | null;
  ignoreTtsCheckbox: HTMLInputElement | null;
  ignoreTtsNote: HTMLElement | null;
  confirmModal: HTMLDialogElement | null;
  confirmText: HTMLElement | null;
  confirmYes: HTMLButtonElement | null;
  confirmNo: HTMLButtonElement | null;
}

/**
 * Pending action state.
 */
interface PendingAction {
  type: 'tts';
  checkbox: HTMLInputElement;
}

/** Copy shown under the toggle, which depends on who put the viewer on the list. */
const MODERATOR_NOTE = 'A channel moderator opted you out of TTS here. Only a moderator can undo this.';
const SELF_NOTE = 'You opted out of TTS here. You can turn this back on at any time.';

/**
 * Return type of the danger zone module.
 */
export interface DangerZoneModule {
  updateChannel(channelName: string, ignoreStatus?: IgnoreStatus): void;
  clear(): void;
}

/**
 * Handles viewer opt-out toggles for TTS.
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
    ignoreTtsCheckbox: document.getElementById('ignore-tts') as HTMLInputElement | null,
    ignoreTtsNote: document.getElementById('ignore-tts-note'),
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
        // Unchecking used to be unreachable — the box was disabled the moment the
        // viewer was ignored. It is now the way back out of their own opt-out,
        // and needs no confirmation: turning TTS back on is not destructive.
        if (elements.ignoreTtsCheckbox?.checked) handleIgnoreAction('tts');
        else handleUnignoreAction('tts');
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
  }

  function updateIgnoreCheckboxes(ignoreStatus: IgnoreStatus): void {
    const { ignoreTtsCheckbox, ignoreTtsNote } = elements;
    if (!ignoreTtsCheckbox) return;

    const ignored = ignoreStatus.tts === true;
    // Being ignored is no longer reason enough to freeze the control — only being
    // ignored by somebody else is. A viewer who opted themselves out can undo it,
    // which is the whole point; the backend enforces the same rule, so a viewer
    // who re-enables the input by hand still gets a 403.
    const moderatorImposed = ignored && ignoreStatus.ttsCanSelfUndo !== true;

    ignoreTtsCheckbox.checked = ignored;
    ignoreTtsCheckbox.disabled = moderatorImposed;

    if (ignoreTtsNote) {
      ignoreTtsNote.textContent = !ignored ? '' : (moderatorImposed ? MODERATOR_NOTE : SELF_NOTE);
      ignoreTtsNote.classList.toggle('d-none', !ignored);
    }
  }

  /**
   * Turn TTS back on for this viewer. Only ever reachable for an opt-out they
   * imposed themselves; a moderator's mute leaves the control disabled, and the
   * server refuses it regardless.
   */
  async function handleUnignoreAction(type: 'tts'): Promise<void> {
    const checkbox = elements.ignoreTtsCheckbox;
    if (!checkbox) return;

    const targetChannel = getCurrentChannel();
    if (testMode) {
      updateIgnoreCheckboxes({ tts: false });
      showToast(`You opted back in to ${type.toUpperCase()} (test mode).`, 'success');
      return;
    }
    if (!targetChannel) {
      showToast('Select a channel first.', 'warning');
      checkbox.checked = true;
      return;
    }

    try {
      await fetchWithAuth(`${apiBaseUrl}/api/viewer/ignore/${type}/${encodeURIComponent(targetChannel)}`, { method: 'POST' });
      updateIgnoreCheckboxes({ tts: false });
      showToast(`You opted back in to ${type.toUpperCase()}.`, 'success');
    } catch (error) {
      // Either way the viewer is still opted out, so the toggle goes back on. Only
      // a real 403 means a moderator took the entry over while the page was open
      // and the control should lock; a network blip or a 500 must not tell someone
      // they were muted. fetchWithAuth folds the status into the message, which is
      // the only signal it passes through.
      console.error(`Failed to opt back in to ${type}:`, error);
      const message = error instanceof Error ? error.message : String(error);
      const moderatorImposed = message.includes('API Error: 403');
      updateIgnoreCheckboxes(moderatorImposed ?
        { tts: true, ttsSource: 'moderator', ttsCanSelfUndo: false } :
        { tts: true, ttsSource: 'self', ttsCanSelfUndo: true });
      showToast(moderatorImposed ? MODERATOR_NOTE : `Cannot opt back in to ${type.toUpperCase()}.`, 'error');
    }
  }

  function handleIgnoreAction(type: 'tts'): void {
    const checkbox = elements.ignoreTtsCheckbox;
    if (!checkbox) return;

    if (testMode) {
      updateIgnoreCheckboxes({ tts: true, ttsSource: 'self', ttsCanSelfUndo: true });
      showToast(`You opted out of ${type.toUpperCase()} (test mode).`, 'success');
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
      showToast('Select a channel first.', 'warning');
      checkbox.checked = false;
    }
  }

  function showConfirmModal(type: 'tts', channelName: string): void {
    if (!elements.confirmModal) return;
    if (elements.confirmText) {
      elements.confirmText.textContent = `Do you want to opt out of ${type.toUpperCase()} in #${channelName}? Your messages will not be read aloud. You can turn this back on at any time.`;
    }
    openDialog(elements.confirmModal);
  }

  async function confirmIgnoreAction(): Promise<void> {
    if (!pendingAction) return;
    const { type, checkbox } = pendingAction;
    try {
      if (testMode) {
        updateIgnoreCheckboxes({ tts: true, ttsSource: 'self', ttsCanSelfUndo: true });
        showToast(`You opted out of ${type.toUpperCase()} (test mode).`, 'success');
        closeDialog(elements.confirmModal);
        pendingAction = null;
        pendingChannel = null;
        return;
      }
      const targetChannel = pendingChannel || getCurrentChannel();
      if (!targetChannel) {
        showToast('Specify a channel.', 'error');
        checkbox.checked = false;
        closeDialog(elements.confirmModal);
        pendingAction = null;
        pendingChannel = null;
        return;
      }
      await fetchWithAuth(`${apiBaseUrl}/api/viewer/ignore/${type}/${encodeURIComponent(targetChannel)}`, { method: 'POST' });
      // Self-imposed, so it stays reversible from here.
      updateIgnoreCheckboxes({ tts: true, ttsSource: 'self', ttsCanSelfUndo: true });
      showToast(`You opted out of ${type.toUpperCase()}.`, 'success');
    } catch (error) {
      console.error(`Failed to opt out of ${type}:`, error);
      checkbox.checked = false;
      showToast(`Cannot opt out of ${type.toUpperCase()}.`, 'error');
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
