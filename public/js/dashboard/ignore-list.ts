import { showToast } from '../common/ui.js';
import { apiErrorMessage, t } from '../common/i18n.js';
import {
  normalizeIgnoreEntry,
  IGNORE_SOURCE_SELF,
  IGNORE_SOURCE_MODERATOR,
  type StoredIgnoreValue,
} from '../common/ignoreEntries.js';

/**
 * Ignore list type
 */
export type IgnoreListType = 'tts';

/**
 * Ignore list module context
 */
interface IgnoreListContext {
  apiPrefix: string;
  testMode: boolean;
}

/**
 * Ignore list module services
 */
interface IgnoreListServices {
  getLoggedInUser: () => { login: string; id: string; displayName: string } | null;
  getSessionToken: () => string | null;
}

/**
 * Ignore list module return type
 */
export interface IgnoreListModule {
  /**
   * Render the list. Entries are keyed by immutable account ID
   * ("twitch:<id>"); the value records who imposed the entry and carries a
   * display label. Removal sends the key, so an entry whose label has gone stale
   * still deletes the right account.
   */
  displayIgnoreList: (type: IgnoreListType, entries: Record<string, StoredIgnoreValue>) => void;
  setOnChange: (fn: () => void) => void;
}

/**
 * Ignore list API error response
 */
interface IgnoreListErrorResponse {
  error?: string;
}

/**
 * Manage TTS ignore lists.
 */
export function initIgnoreListModule(
  context: IgnoreListContext,
  services: IgnoreListServices
): IgnoreListModule {
  const { apiPrefix, testMode } = context;
  const { getLoggedInUser, getSessionToken } = services;
  let onChangeCallback: (() => void) | null = null;

  const addTtsIgnoreBtn = document.getElementById('add-tts-ignore-btn');

  function authHeaders(): HeadersInit {
    const headers: HeadersInit = { 'Content-Type': 'application/json' };
    const token = getSessionToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;
    return headers;
  }

  /**
   * Read one rendered row back into a stored entry. Test mode has no server to
   * re-read, so it rebuilds the list from the DOM — which has to round-trip the
   * provenance too, or every redraw would demote self opt-outs to moderator.
   */
  function readRenderedEntry(el: HTMLElement): StoredIgnoreValue {
    const label = el.querySelector<HTMLElement>('[data-ignore-label]')?.textContent || '';
    // Read from the data attribute, never the badge's words: those are
    // translated, so comparing them would resolve every locale but English to
    // "moderator" and quietly make a viewer's own opt-out unremovable.
    const source = el.querySelector<HTMLElement>('.badge')?.dataset.ignoreSource === IGNORE_SOURCE_SELF
      ? IGNORE_SOURCE_SELF : IGNORE_SOURCE_MODERATOR;
    return { label, source, by: null, at: null };
  }

  function displayIgnoreList(type: IgnoreListType, entries: Record<string, StoredIgnoreValue>): void {
    const listEl = document.getElementById(`${type}-ignore-list`);
    if (!listEl) return;

    listEl.innerHTML = '';
    const sorted = Object.entries(entries || {})
      .map(([key, value]) => ({ key, ...normalizeIgnoreEntry(value, key) }))
      .sort((a, b) => a.label.localeCompare(b.label));

    if (sorted.length === 0) {
      const li = document.createElement('li');
      li.className = 'list-group-item';
      const empty = document.createElement('span');
      empty.className = 'text-muted fst-italic';
      empty.textContent = t('msg.ignore.empty');
      li.appendChild(empty);
      listEl.appendChild(li);
      return;
    }

    sorted.forEach(({ key, label, source }) => {
      const li = document.createElement('li');
      li.className = 'list-group-item d-flex justify-content-between align-items-center';
      li.dataset.ignoreKey = key;

      // Who imposed the entry decides who can lift it, so it belongs on the row:
      // removing someone's own opt-out reads very differently from removing a
      // mute you placed, and only one of the two can come back on its own.
      const isSelf = source === IGNORE_SOURCE_SELF;

      // The label is marked so test mode can read it back without picking up the
      // badge text. Nesting the badge inside the label span made
      // querySelector('span').textContent return "Spammer1Muted by you", which
      // then went back through the list as a bare string — losing the provenance
      // and growing another badge on every render.
      const nameSpan = document.createElement('span');
      nameSpan.dataset.ignoreLabel = '';
      nameSpan.className = 'text-truncate flex-grow-1';
      nameSpan.textContent = label;

      const actionsDiv = document.createElement('div');
      actionsDiv.className = 'd-flex align-items-center gap-2 flex-shrink-0';

      const sourceSpan = document.createElement('span');
      sourceSpan.className = `badge ${isSelf ? 'text-bg-secondary' : 'text-bg-danger'}`;
      sourceSpan.dataset.ignoreSource = source;
      sourceSpan.textContent = isSelf ? t('msg.ignore.badgeSelf') : t('msg.ignore.badgeModerator');

      const btn = document.createElement('button');
      btn.className = 'btn btn-outline-danger btn-sm';
      btn.type = 'button';
      btn.setAttribute('aria-label',
        t('msg.ignore.removeLabel', { label, source: isSelf ? 'self' : 'moderator' }));
      btn.textContent = t('msg.action.remove');
      btn.addEventListener('click', () => removeFromIgnoreList(type, key, label));

      actionsDiv.appendChild(sourceSpan);
      actionsDiv.appendChild(btn);

      li.appendChild(nameSpan);
      li.appendChild(actionsDiv);
      listEl.appendChild(li);
    });
  }

  async function addToIgnoreList(type: IgnoreListType): Promise<void> {
    const inputEl = document.getElementById(`${type}-ignore-username`) as HTMLInputElement | null;
    const username = inputEl?.value?.trim();
    if (!inputEl || !username) {
      showToast(t('msg.ignore.enterUsername'), 'warning');
      return;
    }

    if (testMode) {
      const listEl = document.getElementById(`${type}-ignore-list`);
      if (listEl) {
        // No Helix lookup in test mode, so stand in a synthetic key. It only has
        // to be unique within the rendered list.
        const current: Record<string, StoredIgnoreValue> = {};
        listEl.querySelectorAll<HTMLElement>('li[data-ignore-key]').forEach(el => {
          current[el.dataset.ignoreKey as string] = readRenderedEntry(el);
        });
        // Anything added from this page is broadcaster-imposed, matching what the
        // real POST route writes.
        current[`twitch:demo-${username.toLowerCase()}`] = {
          label: username, source: IGNORE_SOURCE_MODERATOR, by: null, at: null,
        };
        displayIgnoreList(type, current);
      }
      inputEl.value = '';
      onChangeCallback?.();
      return;
    }

    const user = getLoggedInUser();
    if (!user?.login) {
      showToast(t('msg.auth.signedOut'), 'error');
      return;
    }

    try {
      const channelName = user.login.toLowerCase();
      const response = await fetch(`${apiPrefix}/${type}/ignore/channel/${channelName}`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ username })
      });
      if (response.ok) {
        inputEl.value = '';
        onChangeCallback?.();
      } else {
        const errorData = await response.json().catch(() => ({})) as IgnoreListErrorResponse;
        // A 404 means the name resolved to no Twitch account, and the message
        // already says so — prefixing it would read as a server failure.
        showToast(response.status === 404
          ? apiErrorMessage(errorData, 'msg.ignore.noSuchAccount')
          : t('msg.ignore.addFailedReason', { reason: apiErrorMessage(errorData, 'msg.ignore.addFailed') }),
        'error');
      }
    } catch (error) {
      console.error(`Failed to add user to ${type} ignore list:`, error);
      showToast(t('msg.ignore.addFailed'), 'error');
    }
  }

  async function removeFromIgnoreList(type: IgnoreListType, key: string, label: string): Promise<void> {
    if (testMode) {
      const listEl = document.getElementById(`${type}-ignore-list`);
      if (listEl) {
        const remaining: Record<string, StoredIgnoreValue> = {};
        listEl.querySelectorAll<HTMLElement>('li[data-ignore-key]').forEach(el => {
          if (el.dataset.ignoreKey === key) return;
          remaining[el.dataset.ignoreKey as string] = readRenderedEntry(el);
        });
        displayIgnoreList(type, remaining);
      }
      onChangeCallback?.();
      return;
    }

    const user = getLoggedInUser();
    if (!user?.login) {
      showToast(t('msg.auth.signedOut'), 'error');
      return;
    }

    try {
      const channelName = user.login.toLowerCase();
      const response = await fetch(`${apiPrefix}/${type}/ignore/channel/${channelName}`, {
        method: 'DELETE',
        headers: authHeaders(),
        body: JSON.stringify({ key })
      });
      if (response.ok) {
        onChangeCallback?.();
      } else {
        const errorData = await response.json().catch(() => ({})) as IgnoreListErrorResponse;
        showToast(t('msg.ignore.removeFailedReason', { label, reason: apiErrorMessage(errorData, 'msg.ignore.removeFailed') }), 'error');
      }
    } catch (error) {
      console.error(`Failed to remove ${label} from ${type} ignore list:`, error);
      showToast(t('msg.ignore.removeFailed'), 'error');
    }
  }

  if (addTtsIgnoreBtn) {
    addTtsIgnoreBtn.addEventListener('click', () => addToIgnoreList('tts'));
  }

  return {
    displayIgnoreList,
    setOnChange(fn: () => void): void {
      onChangeCallback = typeof fn === 'function' ? fn : null;
    },
  };
}
