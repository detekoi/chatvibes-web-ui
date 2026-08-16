import { showToast } from '../common/ui.js';

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
   * ("twitch:<id>"); the value is the display label. Removal sends the key, so
   * an entry whose label has gone stale still deletes the right account.
   */
  displayIgnoreList: (type: IgnoreListType, entries: Record<string, string>) => void;
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

  function displayIgnoreList(type: IgnoreListType, entries: Record<string, string>): void {
    const listEl = document.getElementById(`${type}-ignore-list`);
    if (!listEl) return;

    listEl.innerHTML = '';
    const sorted = Object.entries(entries || {})
      .map(([key, label]) => ({ key, label: label || key }))
      .sort((a, b) => a.label.localeCompare(b.label));

    if (sorted.length === 0) {
      const li = document.createElement('li');
      li.className = 'list-group-item';
      li.innerHTML = '<span class="text-muted fst-italic">No ignored users.</span>';
      listEl.appendChild(li);
      return;
    }

    sorted.forEach(({ key, label }) => {
      const li = document.createElement('li');
      li.className = 'list-group-item d-flex justify-content-between align-items-center';
      li.dataset.ignoreKey = key;

      const nameSpan = document.createElement('span');
      nameSpan.textContent = label;

      const btn = document.createElement('button');
      btn.className = 'btn btn-outline-danger btn-sm';
      btn.type = 'button';
      btn.setAttribute('aria-label', `Remove ${label} from the ignore list`);
      btn.textContent = 'Remove';
      btn.addEventListener('click', () => removeFromIgnoreList(type, key, label));

      li.appendChild(nameSpan);
      li.appendChild(btn);
      listEl.appendChild(li);
    });
  }

  async function addToIgnoreList(type: IgnoreListType): Promise<void> {
    const inputEl = document.getElementById(`${type}-ignore-username`) as HTMLInputElement | null;
    const username = inputEl?.value?.trim();
    if (!inputEl || !username) {
      showToast('Enter a username.', 'warning');
      return;
    }

    if (testMode) {
      const listEl = document.getElementById(`${type}-ignore-list`);
      if (listEl) {
        // No Helix lookup in test mode, so stand in a synthetic key. It only has
        // to be unique within the rendered list.
        const current: Record<string, string> = {};
        listEl.querySelectorAll<HTMLElement>('li[data-ignore-key]').forEach(el => {
          current[el.dataset.ignoreKey as string] = el.querySelector('span')?.textContent || '';
        });
        current[`twitch:demo-${username.toLowerCase()}`] = username;
        displayIgnoreList(type, current);
      }
      inputEl.value = '';
      onChangeCallback?.();
      return;
    }

    const user = getLoggedInUser();
    if (!user?.login) {
      showToast('You are not signed in.', 'error');
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
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' })) as IgnoreListErrorResponse;
        // A 404 means the name resolved to no Twitch account, and the message
        // already says so — prefixing it would read as a server failure.
        showToast(response.status === 404 ? (errorData.error || 'No such Twitch account') :
          `Cannot add user: ${errorData.error}`, 'error');
      }
    } catch (error) {
      console.error(`Failed to add user to ${type} ignore list:`, error);
      showToast('Cannot add user to ignore list.', 'error');
    }
  }

  async function removeFromIgnoreList(type: IgnoreListType, key: string, label: string): Promise<void> {
    if (testMode) {
      const listEl = document.getElementById(`${type}-ignore-list`);
      if (listEl) {
        const remaining: Record<string, string> = {};
        listEl.querySelectorAll<HTMLElement>('li[data-ignore-key]').forEach(el => {
          if (el.dataset.ignoreKey === key) return;
          remaining[el.dataset.ignoreKey as string] = el.querySelector('span')?.textContent || '';
        });
        displayIgnoreList(type, remaining);
      }
      onChangeCallback?.();
      return;
    }

    const user = getLoggedInUser();
    if (!user?.login) {
      showToast('You are not signed in.', 'error');
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
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' })) as IgnoreListErrorResponse;
        showToast(`Cannot remove ${label}: ${errorData.error}`, 'error');
      }
    } catch (error) {
      console.error(`Failed to remove ${label} from ${type} ignore list:`, error);
      showToast('Cannot remove user from ignore list.', 'error');
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
