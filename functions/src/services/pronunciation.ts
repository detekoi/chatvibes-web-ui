/**
 * Pronunciation dictionary validation.
 *
 * These rules must stay identical to the bot's
 * src/lib/textRewrite/pronunciation.js. The shared limits come from
 * tts-config.json, which `npm run sync-constants` copies over from the bot, so
 * the caps cannot drift; the predicates below are the part that is duplicated
 * by hand because the two repos share no package.
 */

import * as ttsConfig from "./tts-config.json";

const LIMITS = ttsConfig.PRONUNCIATION_LIMITS;

// Letters or digits to start, then letters, digits, apostrophes, hyphens and
// single spaces. "." is excluded because Firestore splits field paths on it.
const MATCH_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N}'\- ]*$/u;

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001F\u007F-\u009F]/g;

const URL_PATTERN = /(https?:\/\/\S+|\b\w+\.[a-z]{2,}\b)/i;

export const PRONUNCIATION_LIMITS = LIMITS;

/**
 * Normalize a match key into its canonical stored form.
 * @param {unknown} raw - The caller-supplied key
 * @return {string | null} The normalized key, or null if unusable
 */
export function normalizeMatchKey(raw: unknown): string | null {
  if (typeof raw !== "string") return null;

  const key = raw
    .replace(CONTROL_CHARS, "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();

  if (!key) return null;
  if (key.length > LIMITS.MAX_MATCH_LENGTH) return null;
  if (key.startsWith("__")) return null; // Firestore reserves this prefix
  if (key.includes(".")) return null;
  if (!MATCH_PATTERN.test(key)) return null;

  return key;
}

export type SayResult =
  | { ok: true; value: string }
  | { ok: false; reason: string };

/**
 * Validate and normalize the spoken form.
 * @param {unknown} raw - The caller-supplied replacement text
 * @return {SayResult} The normalized value, or the reason it was rejected
 */
export function validateSay(raw: unknown): SayResult {
  if (typeof raw !== "string") return { ok: false, reason: "must be text" };

  const say = raw.replace(CONTROL_CHARS, "").trim().replace(/\s+/g, " ");

  // An empty value would let a message filter down to "", which the bot drops
  // rather than speaks. Removing an entry is a separate operation.
  if (!say) return { ok: false, reason: "cannot be empty" };
  if (say.length > LIMITS.MAX_SAY_LENGTH) {
    return {
      ok: false,
      reason: `must be ${LIMITS.MAX_SAY_LENGTH} characters or fewer`,
    };
  }
  if (URL_PATTERN.test(say)) {
    return { ok: false, reason: "cannot contain a link" };
  }

  return { ok: true, value: say };
}
