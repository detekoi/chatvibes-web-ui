import { showToast } from '../common/ui.js';
import { apiErrorMessage, t } from '../common/i18n.js';

/**
 * Per-reward announcement toggles.
 *
 * "Announce Reward Redeems" is all-or-nothing; this panel carves out the
 * rewards that should stay silent — a soundboard plays its own audio, and
 * "so-and-so redeemed Air Horn" on top of it is noise. The channel config holds
 * an exclusion map, `mutedRewardIds`, keyed by Twitch's reward ID so a rename
 * does not shed the entry; the title stored alongside is display only. The
 * bot's src/lib/rewardMuteList.js owns the format.
 *
 * The reward list itself comes from Twitch (GET /api/rewards/all) and is
 * fetched once per page load, then re-rendered against whatever the settings
 * reload hands back. A muted ID Twitch no longer knows is shown as such with a
 * way to drop it, rather than hidden, so the map cannot fill with ghosts.
 */

/** A stored entry in its current shape. */
export interface MutedRewardEntry {
  title: string;
  by: string | null;
  at: string | null;
}

/** What the map may hold: the record, or a bare title from a hand edit. */
export type StoredMutedRewardValue = MutedRewardEntry | string | null | undefined;

interface TwitchReward {
  id: string;
  title: string;
  prompt: string;
  cost: number;
  isEnabled: boolean;
  isPaused: boolean;
  imageUrl: string | null;
}

interface MutedRewardsContext {
  apiPrefix: string;
  testMode: boolean;
}

interface MutedRewardsServices {
  getLoggedInUser: () => { login: string; id: string; displayName: string } | null;
  getSessionToken: () => string | null;
}

export interface MutedRewardsModule {
  /**
   * Render against the current settings. `muted` is the stored map;
   * `ttsRewardId` is the dashboard-managed TTS reward, which is left out of
   * the list because it is never announced in the first place.
   */
  displayMutedRewards: (muted: Record<string, StoredMutedRewardValue>, ttsRewardId?: string | null) => void;
  setOnChange: (fn: () => void) => void;
}

interface ErrorResponse {
  error?: string;
  code?: string;
}

const DEMO_REWARDS: TwitchReward[] = [
  { id: 'demo-horn', title: 'Air Horn', prompt: 'Plays a loud air horn', cost: 100, isEnabled: true, isPaused: false, imageUrl: null },
  { id: 'demo-hydrate', title: 'Hydrate!', prompt: 'Make the streamer drink water', cost: 250, isEnabled: true, isPaused: false, imageUrl: null },
  { id: 'demo-song', title: 'Song Request', prompt: '', cost: 500, isEnabled: true, isPaused: false, imageUrl: null },
];

/**
 * Read one stored value back into the full record shape.
 * @param value - Raw map value
 * @param rewardId - Used as the title of last resort
 */
export function normalizeMutedRewardEntry(value: StoredMutedRewardValue, rewardId: string): MutedRewardEntry {
  if (typeof value === 'string') return { title: value.trim() || rewardId, by: null, at: null };
  if (value && typeof value === 'object') {
    return {
      title: typeof value.title === 'string' && value.title.trim() ? value.title.trim() : rewardId,
      by: typeof value.by === 'string' ? value.by : null,
      at: typeof value.at === 'string' ? value.at : null,
    };
  }
  return { title: rewardId, by: null, at: null };
}

export function initMutedRewardsModule(
  context: MutedRewardsContext,
  services: MutedRewardsServices
): MutedRewardsModule {
  const { apiPrefix, testMode } = context;
  const { getLoggedInUser, getSessionToken } = services;
  let onChangeCallback: (() => void) | null = null;

  const listEl = document.getElementById('muted-rewards-list') as HTMLUListElement | null;
  const statusEl = document.getElementById('muted-rewards-status') as HTMLElement | null;
  const refreshBtn = document.getElementById('muted-rewards-refresh') as HTMLButtonElement | null;

  /** null until the first fetch completes; a failed fetch leaves it null and shows the reason. */
  let rewards: TwitchReward[] | null = null;
  let fetching: Promise<void> | null = null;
  let muted: Record<string, StoredMutedRewardValue> = {};
  let ttsRewardId: string | null = null;

  function authHeaders(): HeadersInit {
    const headers: HeadersInit = { 'Content-Type': 'application/json' };
    const token = getSessionToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;
    return headers;
  }

  function setStatus(text: string): void {
    if (statusEl) statusEl.textContent = text;
  }

  function isMuted(rewardId: string): boolean {
    return Object.prototype.hasOwnProperty.call(muted, rewardId);
  }

  async function fetchRewards(): Promise<void> {
    if (testMode) {
      rewards = DEMO_REWARDS;
      return;
    }
    setStatus(t('msg.mutedRewards.loading'));
    try {
      const response = await fetch(`${apiPrefix}/rewards/all`, { headers: authHeaders() });
      const data = await response.json().catch(() => ({})) as ErrorResponse & { rewards?: TwitchReward[] };
      if (!response.ok) {
        rewards = null;
        setStatus(response.status === 403
          ? t('msg.mutedRewards.unavailable')
          : apiErrorMessage(data, 'msg.mutedRewards.loadFailed'));
        return;
      }
      rewards = Array.isArray(data.rewards) ? data.rewards : [];
      setStatus('');
    } catch (error) {
      console.error('Failed to load channel point rewards:', error);
      rewards = null;
      setStatus(t('msg.mutedRewards.loadFailed'));
    }
  }

  function ensureRewards(): Promise<void> {
    if (rewards !== null) return Promise.resolve();
    if (!fetching) {
      fetching = fetchRewards().finally(() => { fetching = null; });
    }
    return fetching;
  }

  function render(): void {
    if (!listEl) return;
    listEl.innerHTML = '';

    // Rewards Twitch knows, minus the TTS reward, plus muted IDs Twitch no
    // longer returns (a deleted reward) so they can be cleared.
    const known = (rewards || []).filter(r => r.id !== ttsRewardId);
    const knownIds = new Set(known.map(r => r.id));
    const orphans = Object.keys(muted)
      .filter(id => !knownIds.has(id) && id !== ttsRewardId)
      .map(id => ({ id, ...normalizeMutedRewardEntry(muted[id], id) }));

    if (rewards === null && orphans.length === 0) return; // status line says why

    if (known.length === 0 && orphans.length === 0) {
      const li = document.createElement('li');
      li.className = 'list-group-item';
      const empty = document.createElement('span');
      empty.className = 'text-muted fst-italic';
      empty.textContent = t('msg.mutedRewards.empty');
      li.appendChild(empty);
      listEl.appendChild(li);
      return;
    }

    const sorted = [...known].sort((a, b) => a.title.localeCompare(b.title));
    sorted.forEach(reward => {
      const li = document.createElement('li');
      li.className = 'list-group-item d-flex justify-content-between align-items-center';
      li.dataset.rewardId = reward.id;

      const label = document.createElement('label');
      label.className = 'form-check-label text-truncate flex-grow-1 me-3';
      label.htmlFor = `muted-reward-${reward.id}`;
      label.textContent = reward.title;
      if (!reward.isEnabled || reward.isPaused) {
        // A disabled reward cannot be redeemed, so its toggle is moot for now;
        // say so rather than hide it, since it may be switched on again.
        const note = document.createElement('span');
        note.className = 'badge text-bg-secondary ms-2';
        note.textContent = reward.isPaused ? t('msg.mutedRewards.badgePaused') : t('msg.mutedRewards.badgeDisabled');
        label.appendChild(note);
      }

      const wrap = document.createElement('div');
      wrap.className = 'form-check form-switch flex-shrink-0';
      const input = document.createElement('input');
      input.className = 'form-check-input';
      input.type = 'checkbox';
      input.role = 'switch';
      input.id = `muted-reward-${reward.id}`;
      input.checked = !isMuted(reward.id);
      input.setAttribute('aria-label', t('msg.mutedRewards.announceLabel', { title: reward.title }));
      input.addEventListener('change', () => void toggle(reward, input));
      wrap.appendChild(input);

      li.appendChild(label);
      li.appendChild(wrap);
      listEl.appendChild(li);
    });

    orphans.sort((a, b) => a.title.localeCompare(b.title)).forEach(orphan => {
      const li = document.createElement('li');
      li.className = 'list-group-item d-flex justify-content-between align-items-center';
      li.dataset.rewardId = orphan.id;

      const nameSpan = document.createElement('span');
      nameSpan.className = 'text-truncate flex-grow-1 me-3';
      nameSpan.textContent = orphan.title;
      const note = document.createElement('span');
      note.className = 'badge text-bg-secondary ms-2';
      note.textContent = t('msg.mutedRewards.badgeMissing');
      nameSpan.appendChild(note);

      const btn = document.createElement('button');
      btn.className = 'btn btn-outline-danger btn-sm flex-shrink-0';
      btn.type = 'button';
      btn.setAttribute('aria-label', t('msg.mutedRewards.removeLabel', { title: orphan.title }));
      btn.textContent = t('msg.action.remove');
      btn.addEventListener('click', () => void unmute(orphan.id, orphan.title, null));

      li.appendChild(nameSpan);
      li.appendChild(btn);
      listEl.appendChild(li);
    });
  }

  async function toggle(reward: TwitchReward, input: HTMLInputElement): Promise<void> {
    input.disabled = true;
    try {
      if (input.checked) {
        await unmute(reward.id, reward.title, input);
      } else {
        await mute(reward, input);
      }
    } finally {
      input.disabled = false;
    }
  }

  async function mute(reward: TwitchReward, input: HTMLInputElement): Promise<void> {
    if (testMode) {
      muted = { ...muted, [reward.id]: { title: reward.title, by: null, at: null } };
      onChangeCallback?.();
      render();
      return;
    }
    const user = getLoggedInUser();
    if (!user?.login) {
      showToast(t('msg.auth.signedOut'), 'error');
      input.checked = true;
      return;
    }
    try {
      const response = await fetch(`${apiPrefix}/tts/muted-rewards/channel/${user.login.toLowerCase()}`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ rewardId: reward.id, title: reward.title }),
      });
      if (response.ok) {
        muted = { ...muted, [reward.id]: { title: reward.title, by: null, at: null } };
        showToast(t('msg.mutedRewards.muted', { title: reward.title }), 'success');
        onChangeCallback?.();
      } else {
        const errorData = await response.json().catch(() => ({})) as ErrorResponse;
        showToast(t('msg.mutedRewards.updateFailed', { title: reward.title, reason: apiErrorMessage(errorData, 'msg.api.requestFailed') }), 'error');
        input.checked = true;
      }
    } catch (error) {
      console.error('Failed to mute reward:', error);
      showToast(t('msg.mutedRewards.updateFailed', { title: reward.title, reason: t('msg.api.requestFailed') }), 'error');
      input.checked = true;
    }
  }

  async function unmute(rewardId: string, title: string, input: HTMLInputElement | null): Promise<void> {
    if (testMode) {
      const next = { ...muted };
      delete next[rewardId];
      muted = next;
      onChangeCallback?.();
      render();
      return;
    }
    const user = getLoggedInUser();
    if (!user?.login) {
      showToast(t('msg.auth.signedOut'), 'error');
      if (input) input.checked = false;
      return;
    }
    try {
      const response = await fetch(`${apiPrefix}/tts/muted-rewards/channel/${user.login.toLowerCase()}`, {
        method: 'DELETE',
        headers: authHeaders(),
        body: JSON.stringify({ rewardId }),
      });
      if (response.ok) {
        const next = { ...muted };
        delete next[rewardId];
        muted = next;
        showToast(t('msg.mutedRewards.announced', { title }), 'success');
        onChangeCallback?.();
        if (!input) render(); // an orphan row has no switch to reflect the change
      } else {
        const errorData = await response.json().catch(() => ({})) as ErrorResponse;
        showToast(t('msg.mutedRewards.updateFailed', { title, reason: apiErrorMessage(errorData, 'msg.api.requestFailed') }), 'error');
        if (input) input.checked = false;
      }
    } catch (error) {
      console.error('Failed to unmute reward:', error);
      showToast(t('msg.mutedRewards.updateFailed', { title, reason: t('msg.api.requestFailed') }), 'error');
      if (input) input.checked = false;
    }
  }

  function displayMutedRewards(next: Record<string, StoredMutedRewardValue>, nextTtsRewardId?: string | null): void {
    muted = next || {};
    ttsRewardId = nextTtsRewardId || null;
    void ensureRewards().then(render);
  }

  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
      rewards = null;
      void ensureRewards().then(render);
    });
  }

  return {
    displayMutedRewards,
    setOnChange(fn: () => void): void {
      onChangeCallback = typeof fn === 'function' ? fn : null;
    },
  };
}
