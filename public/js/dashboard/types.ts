/**
 * Shared TypeScript types for dashboard modules
 */

import type { StoredIgnoreValue } from '../common/ignoreEntries.js';

/**
 * User information stored in session
 */
export interface UserInfo {
  login: string;
  id: string;
  displayName: string;
}

/**
 * Dashboard context shared across modules
 */
export interface DashboardContext {
  apiBaseUrl: string;
  testMode: boolean;
}

/**
 * Services provided to dashboard modules
 */
export interface DashboardServices {
  getSessionToken: () => string | null;
  getLoggedInUser: () => UserInfo | null;
}

/**
 * TTS settings stored in database
 */
export interface TtsSettings {
  engineEnabled?: boolean;
  botRespondsInChat?: boolean;
  mode?: string;
  ttsPermissionLevel?: string;
  speakEvents?: boolean;
  speakCheerEvents?: boolean; // Granular toggle for cheer events specifically
  speakRedemptionEvents?: boolean; // Announce channel point reward redemptions via TTS
  announceUnfulfilledRedemptions?: boolean; // Announce queued rewards immediately without waiting for streamer approval
  speakWatchStreakEvents?: boolean; // Announce watch streak milestones via TTS
  anonymizeFollowers?: boolean; // Hide follower names in TTS announcements (default: true)
  allowViewerPreferences?: boolean;
  readFullUrls?: boolean;
  bitsModeEnabled?: boolean;
  bitsMinimumAmount?: number;
  voiceId?: string;
  emotion?: string;
  pitch?: number;
  speed?: number;
  languageBoost?: string;
  englishNormalization?: boolean;
  emoteMode?: string;
  /**
   * TTS ignore list, keyed by immutable platform account ID ("twitch:<id>").
   * The value records who imposed the entry, with a display label for rendering
   * only — nothing matches on it. A bare string is the pre-provenance shape and
   * reads as moderator-imposed; see common/ignoreEntries.ts.
   */
  ignoredUserIds?: Record<string, StoredIgnoreValue>;
  bannedWords?: string[];
  voiceVolumes?: Record<string, number>;
  youtubeEnabled?: boolean;
  youtubeHandle?: string;
  /** Channel overrides for the built-in acronym dictionary, keyed by lowercased match. */
  pronunciations?: Record<string, string>;
  pronunciationEnabled?: boolean;
  profanityFilterEnabled?: boolean;
}

/**
 * API response for settings endpoints
 */
export interface SettingsResponse {
  settings: TtsSettings;
}

/**
 * API response for voices endpoint
 */
export interface VoicesResponse {
  voices?: string[];
}

/**
 * Error response from API
 */
export interface ErrorResponse {
  error?: string;
  message?: string;
  details?: string;
}

export interface VoiceLookupResponse {
  success: boolean;
  username: string;
  voiceId: string | null;
  message?: string;
  error?: string;
}
