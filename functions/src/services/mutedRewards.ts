/**
 * Muted channel point rewards: redemptions the bot does not announce.
 *
 * The format is owned by the bot's src/lib/rewardMuteList.js and duplicated
 * here by hand, as ignoreEntries.ts is, because the repos share no package.
 *
 * Entries on the channel config's `mutedRewardIds` map are keyed by Twitch's
 * custom reward ID, which survives a rename, and hold:
 *
 *   title  Display text only; nothing matches on it, and it goes stale on rename.
 *   by     The acting account's key ("twitch:<id>"), or null.
 *   at     ISO 8601 string, display only.
 *
 * It is an exclusion list: every reward is announced unless it is here, so a
 * channel that never touches it hears no change.
 */

/** A stored entry in its current shape. */
export interface MutedRewardEntry {
  title: string;
  by: string | null;
  at: string | null;
}

/** What the map may hold: the record, or a bare title from a hand edit. */
export type StoredMutedRewardValue = MutedRewardEntry | string | null | undefined;

/** Twitch reward IDs are UUIDs; anything else is not something Twitch sent. */
const REWARD_ID_PATTERN = /^[A-Za-z0-9-]{1,64}$/;

/** Twitch caps a reward title at 45 characters. */
export const MUTED_REWARD_TITLE_MAX = 60;

/**
 * Whether a string is shaped like a custom reward ID.
 * @param {unknown} id - The candidate
 * @return {boolean} True when it can be stored as a map key
 */
export function isValidRewardId(id: unknown): id is string {
  return typeof id === "string" && REWARD_ID_PATTERN.test(id);
}

/**
 * Build the value to store. Every field is written every time: writes go
 * through `{ merge: true }`, which deep-merges into the entry object, so a
 * partial write would inherit whatever the previous one left.
 * @param {object} fields - The entry's title and acting account
 * @param {string} [fields.title] - Display text
 * @param {string | null} [fields.by] - The acting account's key
 * @return {MutedRewardEntry} The complete record to write
 */
export function buildMutedRewardEntry(
  fields: { title?: string; by?: string | null } = {},
): MutedRewardEntry {
  return {
    title: (fields.title || "").trim(),
    by: fields.by || null,
    at: new Date().toISOString(),
  };
}
