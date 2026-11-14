/**
 * Gemini TTS takes one free-text style for a clip. It has no speed, pitch or
 * emotion numbers. This module turns the stored settings into that text.
 *
 * A port of src/components/tts/styleBuilder.js in the tts-twitch repo. Both
 * read the same tables from tts-config.json. Keep the two identical.
 */

import * as ttsConfig from "./tts-config.json";

interface Step {
  key: string;
  value: number;
  upTo: number | null;
  style: string;
}

export interface StyleSettings {
  style?: unknown;
  voiceStyle?: unknown;
  emotion?: unknown;
  speed?: unknown;
  pitch?: unknown;
}

export const STYLE_MAX_LENGTH: number = ttsConfig.STYLE.MAX_LENGTH;
export const STYLE_PRESETS = ttsConfig.STYLE_PRESETS as Record<string, string>;
export const SPEED_STEPS = ttsConfig.SPEED_STEPS as Step[];
export const PITCH_STEPS = ttsConfig.PITCH_STEPS as Step[];
export const SOUND_TAG_NAMES: string[] = ttsConfig.SOUND_TAGS.map((entry) => entry.tag);

function stepFor(steps: Step[], value: unknown, fallbackKey = "normal"): Step | undefined {
  // Number(null) and Number("") are 0, which is not a speed or a pitch anyone chose.
  const number = value === null || value === undefined || value === "" ? NaN : Number(value);
  if (!Number.isFinite(number)) return steps.find((step) => step.key === fallbackKey);
  return steps.find((step) => step.upTo === null || number <= step.upTo);
}

/** The step that a stored speed (0.5 to 2.0) belongs to. */
export function speedStep(speed: unknown): Step | undefined {
  // A speed of 0 or less is not a valid stored value.
  return stepFor(SPEED_STEPS, Number(speed) > 0 ? speed : null);
}

/** The step that a stored pitch (-12 to 12) belongs to. */
export function pitchStep(pitch: unknown): Step | undefined {
  return stepFor(PITCH_STEPS, pitch);
}

// Control characters and the brackets that could open markup or a template.
// eslint-disable-next-line no-control-regex
const UNSAFE_STYLE_CHARS = /[\u0000-\u001f\u007f<>{}]/g;

function cleanStyle(text: string): string {
  return text.replace(UNSAFE_STYLE_CHARS, " ").replace(/\s+/g, " ").trim();
}

/**
 * Clean a style that a person typed. The style is an instruction to the model
 * and is never spoken, so this only keeps it short and on one line.
 * @param text - The typed style
 * @return The clean style, or "" for nothing usable
 */
export function sanitizeStyle(text: unknown): string {
  if (typeof text !== "string") return "";
  return cleanStyle(text).slice(0, STYLE_MAX_LENGTH).trim();
}

export type StyleValidation =
  | { ok: true; value: string }
  | { ok: false; reasonCode: "style_invalid" | "style_too_long"; reasonParams?: { max: number } };

/**
 * Validate a style before it is stored. Unlike sanitizeStyle this refuses a
 * style that is too long, so that a person does not save a cut-off sentence.
 * @param text - The typed style. "" clears the setting.
 * @return The clean style, or a reason code
 */
export function validateStyle(text: unknown): StyleValidation {
  if (typeof text !== "string") return { ok: false, reasonCode: "style_invalid" };
  const clean = cleanStyle(text);
  if (clean.length > STYLE_MAX_LENGTH) {
    return { ok: false, reasonCode: "style_too_long", reasonParams: { max: STYLE_MAX_LENGTH } };
  }
  return { ok: true, value: clean };
}

/**
 * The style text for one clip.
 *
 * A custom style replaces the emotion preset. The manner of a mapped MiniMax
 * voice (voiceStyle) goes first, and the pace and pitch words go last.
 * @param settings - The stored settings of the clip
 * @return The style, or "" when the clip needs none
 */
export function buildStyle({ style, voiceStyle, emotion, speed, pitch }: StyleSettings = {}): string {
  const custom = sanitizeStyle(style);
  const preset = typeof emotion === "string" && Object.hasOwn(STYLE_PRESETS, emotion) ? STYLE_PRESETS[emotion] : "";
  const parts = [
    sanitizeStyle(voiceStyle),
    custom || preset,
    speedStep(speed)?.style,
    pitchStep(pitch)?.style,
  ];
  return parts.filter(Boolean).join(", ");
}

export type SoundTagValidation =
  | { ok: true; value: string[] }
  | { ok: false; reasonCode: "sound_tags_invalid" | "sound_tag_unknown"; reasonParams?: { tag: string } };

/**
 * Validate the list of sound tags a channel turned off.
 * @param value - Canonical tag names from SOUND_TAGS, in any order
 * @return The names without duplicates, in catalog order, or a reason code
 */
export function validateDisabledSoundTags(value: unknown): SoundTagValidation {
  if (!Array.isArray(value)) return { ok: false, reasonCode: "sound_tags_invalid" };
  const wanted = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== "string") return { ok: false, reasonCode: "sound_tags_invalid" };
    const tag = entry.trim().toLowerCase();
    if (!SOUND_TAG_NAMES.includes(tag)) {
      return { ok: false, reasonCode: "sound_tag_unknown", reasonParams: { tag: entry.slice(0, 40) } };
    }
    wanted.add(tag);
  }
  return { ok: true, value: SOUND_TAG_NAMES.filter((tag) => wanted.has(tag)) };
}
