/**
 * Shared API helpers for ChatVibes Web UI.
 */

/**
 * Returns the base URL for the API based on the current environment.
 * @returns {string}
 */
export function getApiBaseUrl() {
    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
        return '';
    }
    return ''; // Use Firebase Hosting rewrites
}

/**
 * Performs a fetch request adding the stored authorization token.
 * Throws informative errors for non-OK responses.
 * @param {string} url
 * @param {RequestInit} [options]
 * @returns {Promise<Response>}
 */
export async function fetchWithAuth(url, options = {}) {
    const appSessionToken = localStorage.getItem('app_session_token');
    if (!appSessionToken) {
        throw new Error('Not authenticated');
    }

    const headers = {
        'Content-Type': 'application/json',
        ...options.headers,
        'Authorization': `Bearer ${appSessionToken}`,
    };

    const response = await fetch(url, { ...options, headers });

    if (!response.ok) {
        if (response.status === 401) {
            throw new Error('Authentication failed. Please log in again.');
        }

        let errorMessage = response.statusText;
        try {
            const errorData = await response.json();
            if (errorData.error) {
                errorMessage = errorData.error;
            }
        } catch (_) {
            // Ignore JSON parse errors and fall back to statusText.
        }

        throw new Error(`API Error: ${response.status} ${errorMessage}`);
    }

    return response;
}
