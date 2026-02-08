/**
 * Shared TypeScript types for dashboard modules
 */

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
  ignoredUsers?: string[];
  bannedWords?: string[];
  voiceVolumes?: Record<string, number>;
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
