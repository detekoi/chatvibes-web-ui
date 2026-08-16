/**
 * Authentication helpers shared across WildcatTTS pages.
 */

const STORAGE_KEYS = {
  login: 'twitch_user_login',
  userId: 'twitch_user_id',
  sessionToken: 'app_session_token',
} as const;

/**
 * Decode a JWT's payload.
 *
 * JWT parts are base64url, not base64: they use - and _ in place of + and /,
 * and drop the trailing padding. atob() rejects those two characters outright,
 * so the segment has to be normalised first. Returns null when the token is
 * malformed rather than throwing.
 */
export function decodeJwtPayload<T = Record<string, unknown>>(token: string): T | null {
  const segment = token.split('.')[1];
  if (!segment) return null;

  let base64 = segment.replace(/-/g, '+').replace(/_/g, '/');
  base64 += '='.repeat((4 - (base64.length % 4)) % 4);

  try {
    const binary = atob(base64);
    const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
    const json = new TextDecoder().decode(bytes);
    return JSON.parse(json) as T;
  } catch (error) {
    console.warn('Could not decode JWT payload:', error);
    return null;
  }
}

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
}

/**
 * Persist Twitch user information and session token to localStorage.
 */
export function storeSessionData({ login, id, sessionToken }: SessionData): void {
  if (login) localStorage.setItem(STORAGE_KEYS.login, login);
  if (id) localStorage.setItem(STORAGE_KEYS.userId, id);
  if (sessionToken) localStorage.setItem(STORAGE_KEYS.sessionToken, sessionToken);
}
