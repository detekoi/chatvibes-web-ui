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
/** The failure fields the API sends alongside its prose. */
export interface ApiErrorBody {
  code?: string;
  params?: Record<string, string>;
  details?: string;
  message?: string;
}

/**
 * A non-2xx response, with the body kept rather than flattened into a string.
 *
 * `fetchWithAuth` throws on every non-2xx, so a caller that wants to react to a
 * *particular* failure never gets to look at the response — the branch in
 * bot-management.ts that renders the "request access" link for an unapproved
 * channel was written against `res.status === 403` and could not run, so a
 * locked-out streamer saw a generic "cannot activate" with no way forward.
 * Carrying `status` and the body on the error is what makes that reachable, and
 * it lets `danger-zone.ts` test a number instead of matching on a message.
 */
export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly body: ApiErrorBody = {}) {
    super(message);
    this.name = 'ApiError';
  }
}

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
      throw new ApiError(t('msg.api.authFailed'), 401);
    }

    // Translated here rather than at each call site: every module surfaces this
    // as `err.message`, so resolving the API's `code` once is what gets the
    // whole failure path out of English.
    let errorMessage = response.statusText;
    let body: ApiErrorBody = {};
    try {
      body = await response.json() as ApiErrorBody;
      errorMessage = apiErrorMessage(body, 'msg.api.requestFailed');
    } catch (_) {
      // Ignore JSON parse errors and fall back to statusText.
    }

    // The `API Error: <status> ` prefix is load-bearing: voice-preview.ts strips
    // it back off for display and danger-zone.ts tests for "API Error: 403" to
    // tell a moderator mute from a network blip. Keep the shape.
    throw new ApiError(`API Error: ${response.status} ${errorMessage}`, response.status, body);
  }

  return response;
}
