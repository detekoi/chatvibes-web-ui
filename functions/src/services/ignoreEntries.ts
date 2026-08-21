/**
 * TTS ignore-list entry format.
 *
 * These rules must stay identical to the bot's src/lib/ignoreList.js, which owns
 * the format. The two repos share no package, so this is duplicated by hand — as
 * pronunciation.ts is for the same reason.
 *
 * Entries on the channel config's `ignoredUserIds` map are keyed by immutable
 * account ID ("<platform>:<accountId>") and hold a record of who imposed them:
 *
 *   label   Display text only; nothing matches on it, and it goes stale on rename.
 *   source  "self" or "moderator" — decides who may lift the entry. A viewer may
 *           clear their own opt-out; only a moderator may clear a moderator's mute.
 *   by      The acting account's key, an immutable ID so the trail survives renames.
 *   at      ISO 8601 string, display only.
 *
 * A value may also be a bare display-name string, the shape this map held before
 * provenance existed. Those read as moderator-imposed: unknown provenance is never
 * self-clearable, so no mute predating this change can be shed by its subject.
 */

/** The viewer put themselves on the list, and may take themselves back off. */
export const IGNORE_SOURCE_SELF = "self";
/** A moderator or the broadcaster imposed it; only they can lift it. */
export const IGNORE_SOURCE_MODERATOR = "moderator";

export type IgnoreSource = typeof IGNORE_SOURCE_SELF | typeof IGNORE_SOURCE_MODERATOR;

/** A stored entry in its current shape. */
export interface IgnoreEntry {
  label: string;
  source: IgnoreSource;
  by: string | null;
  at: string | null;
}

/** What the map may hold: the current record, or a legacy display-name string. */
export type StoredIgnoreValue = IgnoreEntry | string | null | undefined;

/**
 * Read one stored value into the current entry shape.
 *
 * Anything that is not a plain object — a legacy string, but equally a null or an
 * array from a hand-edited document — reads as moderator-imposed, as does an
 * object whose `source` is missing or unrecognized. The default runs one way on
 * purpose: guessing "self" would hand an abuser the ability to lift their own
 * mute, while guessing "moderator" only costs a viewer one moderator action.
 *
 * @param {StoredIgnoreValue} value - Raw map value
 * @param {string} key - The entry's key, used as the label of last resort
 * @return {IgnoreEntry} The normalized entry
 */
export function normalizeIgnoreEntry(value: StoredIgnoreValue, key: string): IgnoreEntry {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    const label = typeof value === "string" && value ? value : key;
    return { label, source: IGNORE_SOURCE_MODERATOR, by: null, at: null };
  }
  return {
    label: value.label || key,
    source: value.source === IGNORE_SOURCE_SELF ? IGNORE_SOURCE_SELF : IGNORE_SOURCE_MODERATOR,
    by: value.by || null,
    at: value.at || null,
  };
}

/**
 * The stored entry for one key, or null when it is not on the list.
 *
 * The presence check is prototype-safe, so an account whose key spells
 * "constructor" cannot inherit a match from Object.prototype.
 *
 * @param {Record<string, StoredIgnoreValue> | undefined} entries - The ignoredUserIds map
 * @param {string} key - The entry key to look up
 * @return {IgnoreEntry | null} The normalized entry, or null
 */
export function getIgnoreEntry(
  entries: Record<string, StoredIgnoreValue> | undefined,
  key: string,
): IgnoreEntry | null {
  const map = entries || {};
  if (!Object.prototype.hasOwnProperty.call(map, key)) return null;
  return normalizeIgnoreEntry(map[key], key);
}

/**
 * Whether the account an entry belongs to may remove it themselves.
 * @param {IgnoreEntry | null | undefined} entry - From getIgnoreEntry
 * @return {boolean} True only for a self-imposed entry
 */
export function canSelfUnignore(entry: IgnoreEntry | null | undefined): boolean {
  return entry?.source === IGNORE_SOURCE_SELF;
}

/**
 * Build the value to store for one entry.
 *
 * Every field is written every time, never a partial object. Writes go through
 * Firestore's `{ merge: true }`, which deep-merges into the entry object as well
 * as into the map — so omitting `source` here would silently inherit whatever the
 * previous write left, and a moderator muting someone who had opted out
 * themselves would leave the entry marked self, and still self-clearable.
 *
 * @param {object} fields - The entry's label, source and acting account
 * @param {string} [fields.label] - Display text
 * @param {IgnoreSource} [fields.source] - Who imposed it; defaults to moderator
 * @param {string | null} [fields.by] - The acting account's key
 * @return {IgnoreEntry} The complete record to write
 */
export function buildIgnoreEntry(
  fields: { label?: string; source?: string; by?: string | null } = {},
): IgnoreEntry {
  return {
    label: fields.label || "",
    source: fields.source === IGNORE_SOURCE_SELF ? IGNORE_SOURCE_SELF : IGNORE_SOURCE_MODERATOR,
    by: fields.by || null,
    at: new Date().toISOString(),
  };
}
