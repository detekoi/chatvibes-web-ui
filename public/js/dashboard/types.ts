/**
 * Shared TypeScript types for dashboard modules
 */

import type { StoredIgnoreValue } from '../common/ignoreEntries.js';
import type { StoredMutedRewardValue } from './muted-rewards.js';

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
  announceUnfulfilledRedemptions?: boolean; // Announce queued rewards on redeem rather than on streamer approval (default on; absent reads as true)
  speakWatchStreakEvents?: boolean; // Announce watch streak milestones via TTS
  anonymizeFollowers?: boolean; // Hide follower names in TTS announcements (default: true)
  allowViewerPreferences?: boolean;
  readFullUrls?: boolean;
  readCheerMessages?: boolean;
  readCommandMessages?: boolean;
  bitsMinimumAmount?: number;
  voiceId?: string;
  emotion?: string;
  /** Free text that tells the voice model how to speak. Not empty means that it replaces the emotion. */
  style?: string;
  pitch?: number;
  speed?: number;
  languageBoost?: string;
  /** Canonical names from SOUND_TAGS that the channel turned off. */
  disabledSoundTags?: string[];
  emoteMode?: string;
  /**
   * TTS ignore list, keyed by immutable platform account ID ("twitch:<id>").
   * The value records who imposed the entry, with a display label for rendering
   * only — nothing matches on it. A bare string is the pre-provenance shape and
   * reads as moderator-imposed; see common/ignoreEntries.ts.
   */
  ignoredUserIds?: Record<string, StoredIgnoreValue>;
  /**
   * Channel point rewards whose redemptions are not announced, keyed by Twitch
   * reward ID. The title is display only. See muted-rewards.ts.
   */
  mutedRewardIds?: Record<string, StoredMutedRewardValue>;
  /** The TTS reward the dashboard manages; it is never in the announcement list. */
  channelPoints?: { rewardId?: string | null; enabled?: boolean };
  bannedWords?: string[];
  voiceVolumes?: Record<string, number>;
  youtubeEnabled?: boolean;
  youtubeHandle?: string;
  /** Channel overrides for the built-in acronym dictionary, keyed by lowercased match. */
  pronunciations?: Record<string, string>;
  pronunciationEnabled?: boolean;
  profanityFilterEnabled?: boolean;
  /** Spotlight mode: what the streamer wants the bot to look for. Empty or absent means no guidance. */
  spotlightGuidance?: string;
  /** Spotlight mode: show a card with the viewer and the message in the browser source. Absent reads as false. */
  spotlightCard?: boolean;
}

/**
 * One message that Spotlight mode picked. The bot writes the log
 * (`ttsSpotlightLog/<broadcasterId>`) and the API returns it newest first.
 */
export interface SpotlightPick {
  user: string;
  userId: string | null;
  text: string;
  reason: string;
  /** Epoch milliseconds. */
  at: number;
  platform?: 'twitch' | 'youtube';
}

export interface SpotlightPicksResponse {
  picks: SpotlightPick[];
}

/**
 * API response for settings endpoints
 */
export interface SettingsResponse {
  settings: TtsSettings;
}

/**
 * Error response from API
 */
export interface ErrorResponse {
  error?: string;
  message?: string;
  details?: string;
  /** Stable failure code, resolved to `err.<code>` by apiErrorMessage. */
  code?: string;
  /** Values the message interpolates. */
  params?: Record<string, string | number>;
}

export interface VoiceLookupResponse {
  success: boolean;
  username: string;
  /** The Gemini voice that the bot speaks with. */
  voiceId: string | null;
  /** The ID in the viewer record, sent only when it differs (an old MiniMax ID). */
  storedVoiceId?: string;
  message?: string;
  error?: string;
}
