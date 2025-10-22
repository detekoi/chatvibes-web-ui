/**
 * ChatVibes Web UI - Shared Application Functions
 * Contains common utilities and functions used across dashboard and viewer-settings pages
 */

/**
 * Displays a toast notification with a specified message and type.
 * @param {string} message - The message to display in the toast.
 * @param {string} [type='success'] - The type of toast ('success', 'error', 'warning', 'info').
 */
function showToast(message, type = 'success') {
    const toastContainer = document.getElementById('toast-container') || (() => {
        const c = document.createElement('div');
        c.id = 'toast-container';
        c.className = 'toast-container position-fixed bottom-0 end-0 p-3';
        document.body.appendChild(c);
        return c;
    })();
    
    const toastEl = document.createElement('div');
    toastEl.className = 'toast align-items-center border-0';
    toastEl.setAttribute('role', 'alert');
    toastEl.setAttribute('aria-live', 'assertive');
    toastEl.setAttribute('aria-atomic', 'true');
    
    const bgClass = type === 'error' || type === 'danger' ? 'text-bg-danger' : 
                   type === 'warning' ? 'text-bg-warning' : 
                   type === 'info' ? 'text-bg-info' : 'text-bg-success';
    toastEl.classList.add(bgClass);
    
    const inner = document.createElement('div');
    inner.className = 'd-flex';
    
    const body = document.createElement('div');
    body.className = 'toast-body';
    body.innerHTML = message;
    
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn-close btn-close-white me-2 m-auto';
    btn.setAttribute('data-bs-dismiss', 'toast');
    btn.setAttribute('aria-label', 'Close');
    
    inner.appendChild(body);
    inner.appendChild(btn);
    toastEl.appendChild(inner);
    toastContainer.appendChild(toastEl);
    
    const bsToast = new bootstrap.Toast(toastEl, { delay: 5000 });
    bsToast.show();
    toastEl.addEventListener('hidden.bs.toast', () => toastEl.remove());
}

/**
 * Logs out the current user by clearing session data from local storage.
 */
function logout() {
    localStorage.removeItem('twitch_user_login');
    localStorage.removeItem('twitch_user_id');
    localStorage.removeItem('app_session_token');
    localStorage.removeItem('token_user');
    localStorage.removeItem('token_channel');
    window.location.href = 'index.html';
}

/**
 * Returns the base URL for the API based on the current environment.
 * @returns {string} The base URL for the API.
 */
function getApiBaseUrl() {
    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
        return '';
    }
    return ''; // Use Firebase Hosting rewrites
}

/**
 * Performs a fetch request with the authorization token.
 * @param {string} url - The URL to fetch.
 * @param {object} options - The options for the fetch request.
 * @returns {Promise<Response>} A promise that resolves with the response.
 */
async function fetchWithAuth(url, options = {}) {
    const appSessionToken = localStorage.getItem('app_session_token');
    if (!appSessionToken) {
        throw new Error('Not authenticated');
    }
    
    const headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${appSessionToken}`,
        ...options.headers,
    };
    
    const response = await fetch(url, { ...options, headers });
    
    if (!response.ok) {
        if (response.status === 401) {
            throw new Error('Authentication failed. Please log in again.');
        }
        
        // Try to extract error message from response body
        let errorMessage = response.statusText;
        try {
            const errorData = await response.json();
            if (errorData.error) {
                errorMessage = errorData.error;
            }
        } catch (e) {
            // Could not parse error response as JSON, use statusText
        }
        
        throw new Error(`API Error: ${response.status} ${errorMessage}`);
    }
    
    return response;
}

/**
 * Creates a debounced function that delays invoking the provided function until after `wait` milliseconds have passed.
 * @param {Function} func - The function to debounce.
 * @param {number} wait - The number of milliseconds to delay.
 * @returns {Function} The new debounced function.
 */
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func.apply(this, args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

/**
 * Dialog helpers with fallback for browsers without <dialog>.showModal/close
 * @param {HTMLElement} dialogEl - The dialog element to open/close
 */
function openDialog(dialogEl) {
    if (!dialogEl) return;
    if (typeof dialogEl.showModal === 'function') {
        dialogEl.showModal();
    } else {
        dialogEl.setAttribute('open', '');
    }
}

function closeDialog(dialogEl) {
    if (!dialogEl) return;
    if (typeof dialogEl.close === 'function') {
        dialogEl.close();
    } else {
        dialogEl.removeAttribute('open');
    }
}

/**
 * Format number for compact display (removes trailing zeros)
 * @param {number} n - The number to format
 * @returns {string} The formatted number string
 */
function formatNumberCompact(n) {
    const s = Number(n).toFixed(2);
    return s.replace(/\.0+$/, '').replace(/(\.\d*[1-9])0+$/, '$1');
}

/**
 * Format voice name for display (replace underscores/hyphens with spaces, capitalize)
 * @param {string} voice - The voice identifier
 * @returns {string} The formatted voice name
 */
function formatVoiceName(voice) {
    return voice.replace(/[_-]/g, ' ').replace(/\b\w/g, chr => chr.toUpperCase());
}

/**
 * Copy text to clipboard with fallback for older browsers
 * @param {string} text - The text to copy
 * @returns {Promise<boolean>} Whether the copy was successful
 */
async function copyToClipboard(text) {
    try {
        if (navigator.clipboard && window.isSecureContext) {
            await navigator.clipboard.writeText(text);
            return true;
        } else {
            // Fallback for older browsers
            const textArea = document.createElement('textarea');
            textArea.value = text;
            textArea.style.position = 'fixed';
            textArea.style.left = '-999999px';
            textArea.style.top = '-999999px';
            document.body.appendChild(textArea);
            textArea.focus();
            textArea.select();
            const result = document.execCommand('copy');
            document.body.removeChild(textArea);
            return result;
        }
    } catch (err) {
        console.error('Failed to copy text: ', err);
        return false;
    }
}
