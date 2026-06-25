/**
 * Viewer preferences service
 * Centralizes loading of global user preferences with ID-first, username-fallback lookup.
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
}

/**
 * Load global user preferences, trying by userId first with a
 * username fallback for backward compatibility.
 */
export async function loadGlobalUserPreferences(
  userId: string,
  username: string
): Promise<ViewerPreferences> {
  let userDoc = await db.collection(COLLECTIONS.TTS_USER_PREFS).doc(userId).get();

  if (!userDoc.exists) {
    userDoc = await db.collection(COLLECTIONS.TTS_USER_PREFS).doc(username).get();
  }

  return userDoc.exists ? (userDoc.data() as ViewerPreferences) : {};
}
