import { ApiError, fetchWithAuth } from '../common/api.js';
import { showToast } from '../common/ui.js';
import { displayError, t } from '../common/i18n.js';

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
 * `globalOptOut` is null when the server could not read it, which hides that
 * row rather than showing a guess.
 */
export interface OptOutState {
  channel: string | null;
  ignoreStatus?: IgnoreStatus;
  globalOptOut?: boolean | null;
}

/** What the channel opt-out endpoint answers with. */
interface IgnoreResponse {
  ignored?: boolean;
  source?: 'self' | 'moderator' | null;
}

/**
 * DOM elements used by the opt-out module.
 */
interface OptOutElements {
  section: HTMLElement | null;
  globalRow: HTMLElement | null;
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

/** The status a self opt-out has, which the viewer can lift. */
const SELF_OPT_OUT: IgnoreStatus = { tts: true, ttsSource: 'self', ttsCanSelfUndo: true };
const MODERATOR_MUTE: IgnoreStatus = { tts: true, ttsSource: 'moderator', ttsCanSelfUndo: false };

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
 *
 * Both switches send the state they want rather than asking the server to
 * toggle, and hold still until it answers. A toggle flipped the viewer the
 * wrong way on a double click or from a tab showing stale state, and the page
 * then claimed the opposite of what the server stored.
 */
export function initOptOutModule(
  context: OptOutContext,
  services: OptOutServices,
): OptOutModule {
  const { apiBaseUrl, testMode } = context;
  const { getCurrentChannel } = services;

  const elements: OptOutElements = {
    section: document.getElementById('opt-out-section'),
    globalRow: document.getElementById('opt-out-global-row'),
    globalCheckbox: document.getElementById('opt-out-global') as HTMLInputElement | null,
    channelRow: document.getElementById('opt-out-channel-row'),
    ignoreTtsCheckbox: document.getElementById('ignore-tts') as HTMLInputElement | null,
    ignoreTtsNote: document.getElementById('ignore-tts-note'),
  };

  attachListeners();

  return {
    update({ channel, ignoreStatus = {}, globalOptOut = null }: OptOutState): void {
      if (elements.globalCheckbox) elements.globalCheckbox.checked = globalOptOut === true;
      setRowsVisible(globalOptOut !== null, Boolean(channel));
      updateIgnoreCheckboxes(channel ? ignoreStatus : {});
    },
    clear(): void {
      // Without a response the opt-out state is unknown, so neither toggle can
      // show a value it does not have.
      setRowsVisible(false, false);
      updateIgnoreCheckboxes({});
    },
  };

  function attachListeners(): void {
    elements.globalCheckbox?.addEventListener('change', () => {
      void setGlobalOptOut(Boolean(elements.globalCheckbox?.checked));
    });
    elements.ignoreTtsCheckbox?.addEventListener('change', () => {
      void setChannelOptOut(Boolean(elements.ignoreTtsCheckbox?.checked));
    });
  }

  /** Shows the rows whose state is known, and the card only if one of them is. */
  function setRowsVisible(globalRow: boolean, channelRow: boolean): void {
    if (elements.globalRow) elements.globalRow.hidden = !globalRow;
    if (elements.channelRow) elements.channelRow.hidden = !channelRow;
    elements.section?.classList.toggle('d-none', !globalRow && !channelRow);
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

  /** Opt out of, or back in to, TTS in every channel. */
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
      showToast(displayError(error), 'error');
    } finally {
      checkbox.disabled = false;
    }
  }

  /**
   * Opt out of, or back in to, TTS in the loaded channel. The switch shows what
   * the server stored, not what was asked for: a moderator's mute answers an
   * opt-out request with `ignored: true` and stays a moderator's mute.
   */
  async function setChannelOptOut(optedOut: boolean): Promise<void> {
    const checkbox = elements.ignoreTtsCheckbox;
    if (!checkbox) return;
    const previous: IgnoreStatus = optedOut ? { tts: false } : SELF_OPT_OUT;

    if (testMode) {
      updateIgnoreCheckboxes(optedOut ? SELF_OPT_OUT : { tts: false });
      showToast(t(optedOut ? 'msg.optout.optedOutTestMode' : 'msg.optout.optedInTestMode'), 'success');
      return;
    }
    const targetChannel = getCurrentChannel();
    if (!targetChannel) {
      // The row is hidden without a channel, so this is a page state bug.
      updateIgnoreCheckboxes(previous);
      return;
    }

    // Held until the answer arrives, so a second click cannot race the first.
    checkbox.disabled = true;
    try {
      const response = await fetchWithAuth(
        `${apiBaseUrl}/api/viewer/ignore/tts/${encodeURIComponent(targetChannel)}`,
        { method: 'POST', body: JSON.stringify({ ignored: optedOut }) },
      );
      const { ignored, source } = await response.json() as IgnoreResponse;
      const stored = typeof ignored === 'boolean' ? ignored : optedOut;
      // Asking to opt out where a moderator already muted the viewer changes
      // nothing, and the switch must lock as it would on a fresh load.
      updateIgnoreCheckboxes(!stored ? { tts: false } : (source === 'moderator' ? MODERATOR_MUTE : SELF_OPT_OUT));
      showToast(t(stored ? 'msg.optout.optedOut' : 'msg.optout.optedIn'), 'success');
    } catch (error) {
      console.error('Failed to change the opt-out for this channel:', error);
      // Only a real 403 means a moderator took the entry over while the page was
      // open, and the control should lock. A network blip or a 500 must not tell
      // someone they were muted.
      if (error instanceof ApiError && error.status === 403) {
        updateIgnoreCheckboxes(MODERATOR_MUTE);
        showToast(moderatorNote(), 'error');
      } else {
        updateIgnoreCheckboxes(previous);
        showToast(displayError(error), 'error');
      }
    }
  }
}
