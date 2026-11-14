/**
 * The Gemini voice catalog, and the bridge from a stored MiniMax voice ID to a
 * Gemini voice. Mirrors src/components/tts/voiceResolver.js in the tts-twitch repo.
 *
 * gemini-voices.json and minimax-to-gemini-voices.json are copied here by
 * `npm run sync-constants` in that repo. The second file is optional: without
 * it only Gemini IDs are known.
 */

import { createHash } from "crypto";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import * as catalogFile from "./gemini-voices.json";

export interface GeminiVoice {
  id: string;
  name: string;
  studio: boolean;
  language: string;
  region: string;
  accent: string;
  gender: string;
  pitch: string;
  persona: string;
  context: string;
  description: string;
}

interface LegacyVoiceRow {
  voice: string;
  style?: string;
  languageCode?: string;
}

export interface ResolvedVoice {
  voice: string;
  // The manner the mapping adds for a MiniMax voice. Empty for a Gemini voice.
  voiceStyle: string;
  // The BCP-47 language hint that the voice brings, or null.
  language: string | null;
  legacy: boolean;
  // True when the ID was unknown and the default voice was used.
  fallback: boolean;
}

const CATALOG = catalogFile.voices as GeminiVoice[];
const BY_ID = new Map(CATALOG.map((voice) => [voice.id.toLowerCase(), voice]));

/** Used when the configured default is not in the catalog. */
const LAST_RESORT_VOICE = "puck";

const LEGACY_MAP_FILE = "minimax-to-gemini-voices.json";
// tsc does not copy a file that no import names, so the compiled module in
// lib/src/services also looks in the deployed source directory.
const LEGACY_MAP_PATHS = [
  join(__dirname, LEGACY_MAP_FILE),
  join(__dirname, "..", "..", "..", "src", "services", LEGACY_MAP_FILE),
];

let legacyByLower = new Map<string, LegacyVoiceRow>();

/**
 * Load the MiniMax to Gemini map from the first path that exists. A missing or
 * unreadable file leaves the map empty.
 * @param paths - Candidate files. The default is the synced map.
 * @return The number of MiniMax IDs loaded
 */
export function loadLegacyVoiceMap(paths: string[] = LEGACY_MAP_PATHS): number {
  legacyByLower = new Map();
  const file = paths.find((candidate) => existsSync(candidate));
  if (!file) return 0;
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as Record<string, LegacyVoiceRow>;
    for (const [id, row] of Object.entries(parsed)) {
      if (row && typeof row === "object" && typeof row.voice === "string") {
        legacyByLower.set(id.toLowerCase(), row);
      }
    }
  } catch {
    legacyByLower = new Map();
  }
  return legacyByLower.size;
}

loadLegacyVoiceMap();

/** Every voice of the catalog. */
export function getVoiceCatalog(): GeminiVoice[] {
  return CATALOG;
}

/** The catalog entry of a Gemini voice ID (any letter case), or null. */
export function getGeminiVoice(voiceId: unknown): GeminiVoice | null {
  if (typeof voiceId !== "string") return null;
  return BY_ID.get(voiceId.trim().toLowerCase()) ?? null;
}

export function isGeminiVoiceId(voiceId: unknown): boolean {
  return getGeminiVoice(voiceId) !== null;
}

/** True when the ID is a MiniMax voice that the map sends to a Gemini voice. */
export function isLegacyVoiceId(voiceId: unknown): boolean {
  return typeof voiceId === "string" && !getGeminiVoice(voiceId) && resolveKnown(voiceId) !== null;
}

/**
 * The form of a voice ID to store, or null when the ID is not known. A Gemini
 * ID is stored in its catalog spelling. A MiniMax ID is stored as it was sent,
 * until the backfill replaces it.
 */
export function canonicalVoiceId(voiceId: unknown): string | null {
  const gemini = getGeminiVoice(voiceId);
  if (gemini) return gemini.id;
  return isLegacyVoiceId(voiceId) ? (voiceId as string) : null;
}

export function getDefaultVoiceId(): string {
  return resolveKnown(process.env.TTS_DEFAULT_VOICE_ID)?.voice ?? LAST_RESORT_VOICE;
}

const isEnglish = (tag: unknown): boolean => typeof tag !== "string" || tag.toLowerCase().startsWith("en");

/**
 * The language that a voice brings with it, as a hint for the speech model.
 * A library voice is a native speaker of one language. A studio voice speaks
 * every language and brings none. English is never a hint: the model assumes it.
 * @param voice - A catalog voice
 * @return The BCP-47 tag, or null
 */
function nativeLanguage(voice: GeminiVoice): string | null {
  return voice.studio || isEnglish(voice.language) ? null : voice.language;
}

function resolveKnown(voiceId: unknown): Omit<ResolvedVoice, "fallback"> | null {
  const gemini = getGeminiVoice(voiceId);
  if (gemini) return { voice: gemini.id, voiceStyle: "", language: nativeLanguage(gemini), legacy: false };
  if (typeof voiceId !== "string") return null;
  const row = legacyByLower.get(voiceId.trim().toLowerCase());
  const mapped = row ? getGeminiVoice(row.voice) : null;
  if (row && mapped) {
    // A MiniMax voice had a language of its own. Many of them (Cantonese, Thai)
    // map to a studio voice, which has none, so the language comes from the map row.
    const language = isEnglish(row.languageCode) ? nativeLanguage(mapped) : (row.languageCode as string);
    return { voice: mapped.id, voiceStyle: typeof row.style === "string" ? row.style : "", language, legacy: true };
  }
  return null;
}

/**
 * The Gemini voice to synthesize with for whatever ID is stored.
 * @param storedVoiceId - A Gemini ID, a MiniMax ID, or anything else
 * @return The voice, the manner and the language it brings, and how it was found
 */
export function resolveVoice(storedVoiceId: unknown): ResolvedVoice {
  const known = resolveKnown(storedVoiceId);
  if (known) return { ...known, fallback: false };
  return { voice: getDefaultVoiceId(), voiceStyle: "", language: null, legacy: false, fallback: true };
}

// A short hash of the catalog, so a client can tell when its copy is old.
const CATALOG_VERSION = createHash("sha256").update(JSON.stringify(CATALOG)).digest("hex").slice(0, 12);

export function getVoiceCatalogVersion(): string {
  return CATALOG_VERSION;
}
