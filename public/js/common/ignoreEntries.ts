/**
 * TTS ignore-list entry format, for the browser.
 *
 * Mirrors functions/src/services/ignoreEntries.ts, which in turn mirrors the
 * bot's src/lib/ignoreList.js — the module that owns the format. Duplicated by
 * hand because the frontend, the Cloud Functions and the bot share no package.
 *
 * The value stored against each immutable account key records who imposed the
 * entry. A bare string is the shape the map held before provenance existed, and
 * reads as moderator-imposed: unknown provenance is never self-clearable.
 */

export const IGNORE_SOURCE_SELF = 'self';
export const IGNORE_SOURCE_MODERATOR = 'moderator';

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
 * Read one stored value into the current entry shape. Anything that is not a
 * plain object, and any object without a recognized `source`, reads as
 * moderator-imposed.
 */
export function normalizeIgnoreEntry(value: StoredIgnoreValue, key: string): IgnoreEntry {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    const label = typeof value === 'string' && value ? value : key;
    return { label, source: IGNORE_SOURCE_MODERATOR, by: null, at: null };
  }
  return {
    label: value.label || key,
    source: value.source === IGNORE_SOURCE_SELF ? IGNORE_SOURCE_SELF : IGNORE_SOURCE_MODERATOR,
    by: value.by || null,
    at: value.at || null,
  };
}
