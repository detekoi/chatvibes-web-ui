/**
 * Viewer preferences service
 * Centralizes loading of global user preferences, keyed by Twitch user ID.
 */

import { db, COLLECTIONS } from "./firestore";

// Type definitions for viewer preferences
export interface ViewerPreferences {
  voiceId?: string | null;
  pitch?: number | null;
  speed?: number | null;
  emotion?: string | null;
  languageBoost?: string | null;
  // A free-text manner of speaking. It replaces the emotion preset.
  style?: string | null;
  // The manner that the voice backfill adds for a mapped MiniMax voice. It
  // belongs to the stored voiceId and is removed when the voice changes.
  voiceStyle?: string | null;
  // The language of a mapped MiniMax voice whose new voice is a studio voice.
  // The backfill writes it, and it is removed when the voice changes.
  voiceLanguage?: string | null;
  emoteMode?: string | null;
  // The viewer's opt-out from TTS in every channel. Written only by
  // PUT /api/viewer/opt-out, never by the preference routes, and read by the bot
  // in ttsQueue.enqueue (chatvibes src/lib/globalOptOut.js).
  globalOptOut?: boolean;
  globalOptOutAt?: string;
}

/**
 * Load global user preferences for a Twitch user ID.
 */
export async function loadGlobalUserPreferences(userId: string): Promise<ViewerPreferences> {
  const userDoc = await db.collection(COLLECTIONS.TTS_USER_PREFS).doc(userId).get();
  return userDoc.exists ? (userDoc.data() as ViewerPreferences) : {};
}
