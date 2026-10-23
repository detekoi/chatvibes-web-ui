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
  englishNormalization?: boolean;
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
