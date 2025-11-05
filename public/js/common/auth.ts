/**
 * Authentication helpers shared across ChatVibes pages.
 */

const STORAGE_KEYS = {
  login: 'twitch_user_login',
  userId: 'twitch_user_id',
  sessionToken: 'app_session_token',
  tokenUser: 'token_user',
  tokenChannel: 'token_channel',
} as const;

/**
 * Clear session-related tokens and redirect to the landing page.
 */
export function logout(redirectTo: string = 'index.html'): void {
  Object.values(STORAGE_KEYS).forEach(key => localStorage.removeItem(key));
  window.location.href = redirectTo;
}

/**
 * Get the currently stored session token, if any.
 */
export function getStoredSessionToken(): string | null {
  return localStorage.getItem(STORAGE_KEYS.sessionToken);
}

/**
 * Stored user information
 */
export interface StoredUser {
  login: string;
  id: string;
  displayName: string;
}

/**
 * Retrieve stored Twitch user information from localStorage, if present.
 */
export function getStoredUser(): StoredUser | null {
  const login = localStorage.getItem(STORAGE_KEYS.login);
  const id = localStorage.getItem(STORAGE_KEYS.userId);
  if (!login || !id) return null;
  return {
    login,
    id,
    displayName: login,
  };
}

/**
 * Session data to store
 */
export interface SessionData {
  login?: string;
  id?: string;
  sessionToken?: string;
  tokenUser?: string;
  tokenChannel?: string;
}

/**
 * Persist Twitch user information and session token to localStorage.
 */
export function storeSessionData({ login, id, sessionToken, tokenUser, tokenChannel }: SessionData): void {
  if (login) localStorage.setItem(STORAGE_KEYS.login, login);
  if (id) localStorage.setItem(STORAGE_KEYS.userId, id);
  if (sessionToken) localStorage.setItem(STORAGE_KEYS.sessionToken, sessionToken);
  if (tokenUser) localStorage.setItem(STORAGE_KEYS.tokenUser, tokenUser);
  if (tokenChannel) localStorage.setItem(STORAGE_KEYS.tokenChannel, tokenChannel);
}
