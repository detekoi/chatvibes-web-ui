import { showToast } from '../common/ui.js';
import { apiErrorMessage, t } from '../common/i18n.js';

/**
 * Per-reward announcement toggles.
 *
 * "Announce Reward Redeems" is all-or-nothing; this carves out the rewards
 * that should stay silent — a soundboard plays its own audio, and "so-and-so
 * redeemed Air Horn" on top of it is noise. The channel config holds an
 * exclusion map, `mutedRewardIds`, keyed by Twitch's reward ID so a rename
 * does not shed the entry; the title stored alongside is display only. The
 * bot's src/lib/rewardMuteList.js owns the format.
 *
 * Two views of the same map. The settings page shows only what is muted, as
 * chips that can be cleared in place — that is the at-a-glance answer, and it
 * needs no call to Twitch. The full switch list lives in a dialog, fetched
 * from Twitch (GET /api/rewards/all) each time it opens so a reward added
 * since the page loaded is there. A muted ID Twitch no longer knows is listed
 * with a badge and its switch off, rather than hidden, so the map cannot fill
 * with ghosts.
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
  { id: 'demo-song', title: 'Song Request', prompt: '', cost: 500, isEnabled: false, isPaused: false, imageUrl: null },
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

  const summaryEl = document.getElementById('muted-rewards-summary') as HTMLElement | null;
  const openBtn = document.getElementById('muted-rewards-open') as HTMLButtonElement | null;
  const dialog = document.getElementById('muted-rewards-modal') as HTMLDialogElement | null;
  const closeBtn = document.getElementById('muted-rewards-close') as HTMLButtonElement | null;
  const searchEl = document.getElementById('muted-rewards-search') as HTMLInputElement | null;
  const listEl = document.getElementById('muted-rewards-list') as HTMLUListElement | null;
  const statusEl = document.getElementById('muted-rewards-status') as HTMLElement | null;

  /** null until a fetch completes; a failed fetch leaves it null and the status line says why. */
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

  function mutedEntries(): Array<{ id: string } & MutedRewardEntry> {
    return Object.keys(muted)
      .filter(id => id !== ttsRewardId)
      .map(id => ({ id, ...normalizeMutedRewardEntry(muted[id], id) }))
      .sort((a, b) => a.title.localeCompare(b.title));
  }

  // ---- Settings page: the summary chips ----

  function renderSummary(): void {
    if (!summaryEl) return;
    summaryEl.innerHTML = '';

    const entries = mutedEntries();
    if (entries.length === 0) {
      const none = document.createElement('span');
      none.className = 'text-muted small';
      none.textContent = t('msg.mutedRewards.noneMuted');
      summaryEl.appendChild(none);
      return;
    }

    // Red, like "Muted by you" in the ignore list: the same colour means the
    // same thing across the page — this entry is silenced.
    entries.forEach(entry => {
      const chip = document.createElement('span');
      chip.className = 'badge text-bg-danger muted-reward-chip';
      chip.dataset.rewardId = entry.id;
      chip.appendChild(document.createTextNode(entry.title));

      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'muted-reward-chip__remove';
      remove.setAttribute('aria-label', t('msg.mutedRewards.announceLabel', { title: entry.title }));
      remove.textContent = '×';
      remove.addEventListener('click', () => {
        remove.disabled = true;
        void unmute(entry.id, entry.title, null).finally(() => { remove.disabled = false; });
      });
      chip.appendChild(remove);

      summaryEl.appendChild(chip);
    });
  }

  // ---- Dialog: the full switch list ----

  async function fetchRewards(): Promise<void> {
    if (testMode) {
      rewards = DEMO_REWARDS;
      setStatus('');
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

  function badge(text: string): HTMLSpanElement {
    const el = document.createElement('span');
    el.className = 'badge text-bg-secondary';
    el.textContent = text;
    return el;
  }

  /** One row: title on the left; badge (if any) and switch together on the right. */
  function row(id: string, title: string, note: string | null, checked: boolean, onToggle: (input: HTMLInputElement) => void): HTMLLIElement {
    const li = document.createElement('li');
    li.className = 'list-group-item d-flex justify-content-between align-items-center';
    li.dataset.rewardId = id;
    li.dataset.title = title.toLowerCase();

    const label = document.createElement('label');
    label.className = 'form-check-label text-truncate flex-grow-1 me-3';
    label.htmlFor = `muted-reward-${id}`;
    label.textContent = title;

    const actions = document.createElement('div');
    actions.className = 'd-flex align-items-center gap-2 flex-shrink-0';
    if (note) actions.appendChild(badge(note));

    const wrap = document.createElement('div');
    wrap.className = 'form-check form-switch';
    const input = document.createElement('input');
    input.className = 'form-check-input';
    input.type = 'checkbox';
    input.role = 'switch';
    input.id = `muted-reward-${id}`;
    input.checked = checked;
    input.setAttribute('aria-label', t('msg.mutedRewards.announceLabel', { title }));
    input.addEventListener('change', () => onToggle(input));
    wrap.appendChild(input);
    actions.appendChild(wrap);

    li.appendChild(label);
    li.appendChild(actions);
    return li;
  }

  function renderList(): void {
    if (!listEl) return;
    listEl.innerHTML = '';

    // Nothing to compare against until Twitch has answered: without the list,
    // every muted reward would look like an orphan. The status line already
    // says the list is loading or why it failed.
    if (rewards === null) return;

    const known = rewards.filter(r => r.id !== ttsRewardId);
    const knownIds = new Set(known.map(r => r.id));
    const orphans = mutedEntries().filter(e => !knownIds.has(e.id));

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

    [...known].sort((a, b) => a.title.localeCompare(b.title)).forEach(reward => {
      // A disabled or paused reward cannot be redeemed, so its switch is moot
      // for now; say so rather than hide it, since it may come back.
      const note = reward.isPaused ? t('msg.mutedRewards.badgePaused')
        : !reward.isEnabled ? t('msg.mutedRewards.badgeDisabled')
        : null;
      listEl.appendChild(row(reward.id, reward.title, note, !isMuted(reward.id), input => void toggle(reward, input)));
    });

    orphans.forEach(orphan => {
      listEl.appendChild(row(orphan.id, orphan.title, t('msg.mutedRewards.badgeMissing'), false, input => {
        // The only way is up: switching on clears the stale entry.
        input.disabled = true;
        void unmute(orphan.id, orphan.title, input).finally(() => { input.disabled = false; });
      }));
    });

    applySearch();
  }

  /**
   * Reflect an unmute in the open list without redrawing it: a redraw would
   * destroy the switch that has focus. A reward Twitch still lists gets its
   * switch set on; an orphan row is removed, and focus moves to the search
   * box if it was on that row.
   */
  function syncRow(rewardId: string): void {
    if (!listEl || !dialog?.open) return;
    const li = listEl.querySelector<HTMLLIElement>(`li[data-reward-id="${CSS.escape(rewardId)}"]`);
    if (!li) return;
    if (rewards?.some(r => r.id === rewardId)) {
      const sw = li.querySelector<HTMLInputElement>('input[type="checkbox"]');
      if (sw) sw.checked = true;
      return;
    }
    const hadFocus = li.contains(document.activeElement);
    li.remove();
    if (hadFocus) (searchEl ?? closeBtn)?.focus();
    if (!listEl.querySelector('li')) renderList(); // nothing left: show the empty state
  }

  function applySearch(): void {
    if (!listEl) return;
    const query = (searchEl?.value || '').trim().toLowerCase();
    let shown = 0;
    listEl.querySelectorAll<HTMLLIElement>('li[data-reward-id]').forEach(li => {
      const match = !query || (li.dataset.title || '').includes(query);
      li.hidden = !match;
      if (match) shown++;
    });
    if (rewards !== null && query && shown === 0) {
      setStatus(t('msg.mutedRewards.noMatches'));
    } else if (rewards !== null) {
      setStatus('');
    }
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
      // No reload in test mode: settings would hand back the static demo map
      // and undo the toggle that was just made.
      muted = { ...muted, [reward.id]: { title: reward.title, by: null, at: null } };
      renderSummary();
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
        renderSummary();
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

  /**
   * `input` is the switch that asked, so a failure can flip it back. A chip
   * has no switch and passes null; on success the row it may have had in the
   * dialog is re-rendered away.
   */
  async function unmute(rewardId: string, title: string, input: HTMLInputElement | null): Promise<void> {
    const applyLocally = (): void => {
      const next = { ...muted };
      delete next[rewardId];
      muted = next;
      renderSummary();
      syncRow(rewardId);
    };

    if (testMode) {
      applyLocally();
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
        applyLocally();
        showToast(t('msg.mutedRewards.announced', { title }), 'success');
        onChangeCallback?.();
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

  function openDialog(): void {
    // showModal() throws on a dialog that is already open, which a double
    // click on the button would otherwise trigger.
    if (!dialog || dialog.open) return;
    if (searchEl) searchEl.value = '';
    // Fresh from Twitch on every open, so a reward created since the page
    // loaded is here. The dialog shows the loading line meanwhile.
    rewards = null;
    if (listEl) listEl.innerHTML = '';
    // showModal() puts the dialog in the top layer, traps focus inside it,
    // closes on Escape, and returns focus to the button that opened it.
    dialog.showModal();
    void ensureRewards().then(() => { if (dialog.open) renderList(); });
  }

  function displayMutedRewards(next: Record<string, StoredMutedRewardValue>, nextTtsRewardId?: string | null): void {
    muted = next || {};
    ttsRewardId = nextTtsRewardId || null;
    renderSummary();
    if (dialog?.open) renderList();
  }

  if (openBtn) openBtn.addEventListener('click', openDialog);
  if (closeBtn && dialog) closeBtn.addEventListener('click', () => dialog.close());
  if (dialog) {
    // A click on the backdrop lands on the dialog element itself, not on its
    // content. It has to start there too: a drag that begins on the content
    // (selecting text, say) and ends over the backdrop also reports the
    // dialog as its click target, and must not close it.
    let pressedOnBackdrop = false;
    dialog.addEventListener('mousedown', (event: MouseEvent) => {
      pressedOnBackdrop = event.target === dialog;
    });
    dialog.addEventListener('click', (event: MouseEvent) => {
      if (pressedOnBackdrop && event.target === dialog) dialog.close();
      pressedOnBackdrop = false;
    });
  }
  if (searchEl) searchEl.addEventListener('input', applySearch);

  return {
    displayMutedRewards,
    setOnChange(fn: () => void): void {
      onChangeCallback = typeof fn === 'function' ? fn : null;
    },
  };
}
