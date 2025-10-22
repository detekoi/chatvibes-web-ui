/**
 * Authentication helpers shared across ChatVibes pages.
 */

const STORAGE_KEYS = {
    login: 'twitch_user_login',
    userId: 'twitch_user_id',
    sessionToken: 'app_session_token',
    tokenUser: 'token_user',
    tokenChannel: 'token_channel',
};

/**
 * Clear session-related tokens and redirect to the landing page.
 * @param {string} [redirectTo='index.html']
 */
export function logout(redirectTo = 'index.html') {
    Object.values(STORAGE_KEYS).forEach(key => localStorage.removeItem(key));
    window.location.href = redirectTo;
}

/**
 * Get the currently stored session token, if any.
 * @returns {string|null}
 */
export function getStoredSessionToken() {
    return localStorage.getItem(STORAGE_KEYS.sessionToken);
}

/**
 * Retrieve stored Twitch user information from localStorage, if present.
 * @returns {{login: string, id: string, displayName: string}|null}
 */
export function getStoredUser() {
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
 * Persist Twitch user information and session token to localStorage.
 * @param {{login?: string, id?: string, sessionToken?: string, tokenUser?: string, tokenChannel?: string}} params
 */
export function storeSessionData({ login, id, sessionToken, tokenUser, tokenChannel }) {
    if (login) localStorage.setItem(STORAGE_KEYS.login, login);
    if (id) localStorage.setItem(STORAGE_KEYS.userId, id);
    if (sessionToken) localStorage.setItem(STORAGE_KEYS.sessionToken, sessionToken);
    if (tokenUser) localStorage.setItem(STORAGE_KEYS.tokenUser, tokenUser);
    if (tokenChannel) localStorage.setItem(STORAGE_KEYS.tokenChannel, tokenChannel);
}
