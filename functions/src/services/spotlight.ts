/**
 * Spotlight mode: the bot picks the chat messages that TTS reads.
 *
 * The bot owns the behavior. This module holds the two things that the web UI
 * validates: the streamer guidance, and the pick log that the bot writes.
 */

import * as ttsConfig from "./tts-config.json";

const DEFAULT_GUIDANCE_MAX = 300;

/**
 * The longest guidance, in characters. The bot mirrors this limit in
 * tts-config.json as SPOTLIGHT.GUIDANCE_MAX. That file is copied from the bot
 * by a sync script, so an older copy can lack the key. The fallback is 300.
 */
export const SPOTLIGHT_GUIDANCE_MAX: number =
  (ttsConfig as { SPOTLIGHT?: { GUIDANCE_MAX?: number } }).SPOTLIGHT?.GUIDANCE_MAX ?? DEFAULT_GUIDANCE_MAX;

/** The most picks that the log holds, and that the API returns. */
export const SPOTLIGHT_PICKS_MAX = 30;

// Control characters, which include line breaks. The guidance is one line of text.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/g;

export type GuidanceValidation =
  | { ok: true; value: string }
  | { ok: false; reasonCode: "spotlight_guidance_invalid" | "spotlight_guidance_too_long"; reasonParams?: { max: number } };

/**
 * Validate the guidance before it is stored. A text that is too long is
 * refused, so that a person does not save a cut-off sentence.
 * @param text - The typed guidance. "" clears the setting.
 * @return The clean guidance, or a reason code
 */
export function validateSpotlightGuidance(text: unknown): GuidanceValidation {
  if (typeof text !== "string") return { ok: false, reasonCode: "spotlight_guidance_invalid" };
  const clean = text.replace(CONTROL_CHARS, " ").replace(/\s+/g, " ").trim();
  if (clean.length > SPOTLIGHT_GUIDANCE_MAX) {
    return { ok: false, reasonCode: "spotlight_guidance_too_long", reasonParams: { max: SPOTLIGHT_GUIDANCE_MAX } };
  }
  return { ok: true, value: clean };
}

export interface SpotlightPick {
  user: string;
  userId: string | null;
  text: string;
  reason: string;
  /** Epoch milliseconds. */
  at: number;
  platform?: "twitch" | "youtube";
}

/**
 * Read the stored pick log into the shape that the API returns. The bot is the
 * only writer, but the document is not trusted: only the known fields pass, and
 * an entry that lacks text or a time is dropped.
 * @param stored - The `picks` field of the log document, oldest first
 * @return At most SPOTLIGHT_PICKS_MAX picks, newest first
 */
export function normalizeSpotlightPicks(stored: unknown): SpotlightPick[] {
  if (!Array.isArray(stored)) return [];
  const picks: SpotlightPick[] = [];
  for (const entry of stored.slice(-SPOTLIGHT_PICKS_MAX)) {
    if (!entry || typeof entry !== "object") continue;
    const raw = entry as Record<string, unknown>;
    if (typeof raw.text !== "string" || typeof raw.at !== "number" || !Number.isFinite(raw.at)) continue;
    const pick: SpotlightPick = {
      user: typeof raw.user === "string" ? raw.user : "",
      userId: typeof raw.userId === "string" ? raw.userId : null,
      text: raw.text,
      reason: typeof raw.reason === "string" ? raw.reason : "",
      at: raw.at,
    };
    if (raw.platform === "twitch" || raw.platform === "youtube") pick.platform = raw.platform;
    picks.push(pick);
  }
  return picks.reverse();
}
