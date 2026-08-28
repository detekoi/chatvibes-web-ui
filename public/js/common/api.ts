/**
 * Shared API helpers for WildcatTTS Web UI.
 */
import { apiErrorMessage, t } from './i18n.js';

/**
 * Returns the base URL for the API based on the current environment.
 */
export function getApiBaseUrl(): string {
  if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
    return '';
  }
  return ''; // Use Firebase Hosting rewrites
}

/**
 * Performs a fetch request adding the stored authorization token.
 * Throws informative errors for non-OK responses.
 */
export async function fetchWithAuth(url: string, options: RequestInit = {}): Promise<Response> {
  const appSessionToken = localStorage.getItem('app_session_token');
  if (!appSessionToken) {
    throw new Error(t('msg.api.notAuthenticated'));
  }

  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    ...options.headers,
    'Authorization': `Bearer ${appSessionToken}`,
  };

  const response = await fetch(url, { ...options, headers });

  if (!response.ok) {
    if (response.status === 401) {
      throw new Error(t('msg.api.authFailed'));
    }

    // Translated here rather than at each call site: every module surfaces this
    // as `err.message`, so resolving the API's `code` once is what gets the
    // whole failure path out of English.
    let errorMessage = response.statusText;
    try {
      errorMessage = apiErrorMessage(await response.json(), 'msg.api.requestFailed');
    } catch (_) {
      // Ignore JSON parse errors and fall back to statusText.
    }

    // The `API Error: <status> ` prefix is load-bearing: voice-preview.ts strips
    // it back off for display and danger-zone.ts tests for "API Error: 403" to
    // tell a moderator mute from a network blip. Keep the shape.
    throw new Error(`API Error: ${response.status} ${errorMessage}`);
  }

  return response;
}
