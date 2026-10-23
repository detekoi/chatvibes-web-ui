import { fetchWithAuth } from '../common/api.js';
import { showToast } from '../common/ui.js';
import { t } from '../common/i18n.js';
import { decorateCardHeaders } from '../common/card-meta.js';

/**
 * Context object passed to the opt-out module.
 */
export interface OptOutContext {
  apiBaseUrl: string;
  testMode: boolean;
}

/**
 * Services provided to the opt-out module.
 */
export interface OptOutServices {
  getCurrentChannel: () => string | null;
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
 * What the card shows. `channel` is null when no channel context is loaded,
 * which hides the channel row; the every-channel row needs no channel.
 */
export interface OptOutState {
  channel: string | null;
  ignoreStatus?: IgnoreStatus;
  globalOptOut?: boolean;
}

/**
 * DOM elements used by the opt-out module.
 */
interface OptOutElements {
  section: HTMLElement | null;
  globalCheckbox: HTMLInputElement | null;
  channelRow: HTMLElement | null;
  ignoreTtsCheckbox: HTMLInputElement | null;
  ignoreTtsNote: HTMLElement | null;
}

/** Copy shown under the toggle, which depends on who put the viewer on the list. */
// Resolved per call rather than at module load: these are read after the
// catalogs are in, and a constant captured at import time would freeze the
// English copy in place for the whole session.
const moderatorNote = (): string => t('msg.optout.moderatorNote');
const selfNote = (): string => t('msg.optout.selfNote');

/**
 * Return type of the opt-out module.
 */
export interface OptOutModule {
  update(state: OptOutState): void;
  clear(): void;
}

/**
 * Handles the viewer's TTS opt-outs: one for every channel, one for the loaded
 * channel. Both apply at once and need no confirmation, because the viewer can
 * turn either back off. The one exception is a channel opt-out that a moderator
 * set, which locks the channel toggle.
 */
export function initOptOutModule(
  context: OptOutContext,
  services: OptOutServices,
): OptOutModule {
  const { apiBaseUrl, testMode } = context;
  const { getCurrentChannel } = services;

  const elements: OptOutElements = {
    section: document.getElementById('opt-out-section'),
    globalCheckbox: document.getElementById('opt-out-global') as HTMLInputElement | null,
    channelRow: document.getElementById('opt-out-channel-row'),
    ignoreTtsCheckbox: document.getElementById('ignore-tts') as HTMLInputElement | null,
    ignoreTtsNote: document.getElementById('ignore-tts-note'),
  };

  attachListeners();

  return {
    update({ channel, ignoreStatus = {}, globalOptOut = false }: OptOutState): void {
      elements.section?.classList.remove('d-none');
      if (elements.globalCheckbox) elements.globalCheckbox.checked = globalOptOut;
      setChannelRowVisible(Boolean(channel));
      updateIgnoreCheckboxes(channel ? ignoreStatus : {});
    },
    clear(): void {
      // Without a response the opt-out state is unknown, so neither toggle can
      // show a value it does not have.
      elements.section?.classList.add('d-none');
      setChannelRowVisible(false);
      updateIgnoreCheckboxes({});
    },
  };

  function attachListeners(): void {
    elements.globalCheckbox?.addEventListener('change', () => {
      void setGlobalOptOut(Boolean(elements.globalCheckbox?.checked));
    });
    elements.ignoreTtsCheckbox?.addEventListener('change', () => {
      if (elements.ignoreTtsCheckbox?.checked) void handleIgnoreAction();
      else void handleUnignoreAction();
    });
  }

  function setChannelRowVisible(visible: boolean): void {
    if (elements.channelRow) elements.channelRow.hidden = !visible;
    // The header counts the rows it shows.
    decorateCardHeaders();
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
      ignoreTtsNote.textContent = !ignored ? '' : (moderatorImposed ? moderatorNote() : selfNote());
      ignoreTtsNote.classList.toggle('d-none', !ignored);
    }
  }

  /**
   * Opt out of, or back in to, TTS in every channel. The request carries the
   * state to set rather than a toggle, so a retry cannot undo itself.
   */
  async function setGlobalOptOut(optedOut: boolean): Promise<void> {
    const checkbox = elements.globalCheckbox;
    if (!checkbox) return;

    if (testMode) {
      showToast(t(optedOut ? 'msg.optout.globalOptedOutTestMode' : 'msg.optout.optedInTestMode'), 'success');
      return;
    }

    // Held until the answer arrives, so a second click cannot race the first.
    checkbox.disabled = true;
    try {
      await fetchWithAuth(`${apiBaseUrl}/api/viewer/opt-out`, { method: 'PUT', body: JSON.stringify({ optedOut }) });
      showToast(t(optedOut ? 'msg.optout.globalOptedOut' : 'msg.optout.globalOptedIn'), 'success');
    } catch (error) {
      console.error('Failed to change the opt-out for every channel:', error);
      checkbox.checked = !optedOut;
      showToast(t(optedOut ? 'msg.optout.optOutFailed' : 'msg.optout.optInFailed'), 'error');
    } finally {
      checkbox.disabled = false;
    }
  }

  /** Opt out of TTS in the loaded channel. Self-imposed, so it stays reversible. */
  async function handleIgnoreAction(): Promise<void> {
    const targetChannel = getCurrentChannel();
    if (testMode) {
      updateIgnoreCheckboxes({ tts: true, ttsSource: 'self', ttsCanSelfUndo: true });
      showToast(t('msg.optout.optedOutTestMode'), 'success');
      return;
    }
    if (!targetChannel) {
      // The row is hidden without a channel, so this is a page state bug.
      updateIgnoreCheckboxes({});
      return;
    }

    try {
      await fetchWithAuth(`${apiBaseUrl}/api/viewer/ignore/tts/${encodeURIComponent(targetChannel)}`, { method: 'POST' });
      updateIgnoreCheckboxes({ tts: true, ttsSource: 'self', ttsCanSelfUndo: true });
      showToast(t('msg.optout.optedOut'), 'success');
    } catch (error) {
      console.error('Failed to opt out of TTS:', error);
      updateIgnoreCheckboxes({});
      showToast(t('msg.optout.optOutFailed'), 'error');
    }
  }

  /**
   * Turn TTS back on for this viewer. Only ever reachable for an opt-out they
   * imposed themselves; a moderator's mute leaves the control disabled, and the
   * server refuses it regardless.
   */
  async function handleUnignoreAction(): Promise<void> {
    const targetChannel = getCurrentChannel();
    if (testMode) {
      updateIgnoreCheckboxes({ tts: false });
      showToast(t('msg.optout.optedInTestMode'), 'success');
      return;
    }
    if (!targetChannel) {
      updateIgnoreCheckboxes({});
      return;
    }

    try {
      await fetchWithAuth(`${apiBaseUrl}/api/viewer/ignore/tts/${encodeURIComponent(targetChannel)}`, { method: 'POST' });
      updateIgnoreCheckboxes({ tts: false });
      showToast(t('msg.optout.optedIn'), 'success');
    } catch (error) {
      // Either way the viewer is still opted out, so the toggle goes back on. Only
      // a real 403 means a moderator took the entry over while the page was open
      // and the control should lock; a network blip or a 500 must not tell someone
      // they were muted. fetchWithAuth folds the status into the message, which is
      // the only signal it passes through.
      console.error('Failed to opt back in to TTS:', error);
      const message = error instanceof Error ? error.message : String(error);
      const moderatorImposed = message.includes('API Error: 403');
      updateIgnoreCheckboxes(moderatorImposed ?
        { tts: true, ttsSource: 'moderator', ttsCanSelfUndo: false } :
        { tts: true, ttsSource: 'self', ttsCanSelfUndo: true });
      showToast(moderatorImposed ? moderatorNote() : t('msg.optout.optInFailed'), 'error');
    }
  }
}
