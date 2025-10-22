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

/**
 * Sends a TTS preview request and plays the resulting audio.
 * @param {object} payload - The request body for the /api/tts/test endpoint.
 * @param {HTMLButtonElement[]} buttons - An array of buttons to disable/enable during the request.
 * @param {object} options - Additional options for audio handling
 * @param {string} options.defaultText - Default text for pre-made audio matching
 * @param {object} options.playerElements - Audio player elements for desktop/mobile
 * @param {object} options.hintElements - Hint elements for desktop/mobile
 * @param {function} options.onAudioGenerated - Callback when audio is generated
 */
async function performVoiceTest(payload, buttons, options = {}) {
    buttons.forEach(btn => {
        if (btn) {
            btn.disabled = true;
            btn.textContent = 'Generating...';
        }
    });

    try {
        let audioUrl = null;

        // Try loading pre-made recording first if conditions are met
        if (options.defaultText && isDefaultSettings(payload, options.defaultText)) {
            audioUrl = await tryLoadPreMadeRecording(payload, options.defaultText);
            if (audioUrl) {
                console.log('Using pre-made recording');
            }
        }

        if (!audioUrl) {
            // Generate via API
            const response = await fetchWithAuth(`${getApiBaseUrl()}/api/tts/test`, {
                method: 'POST',
                body: JSON.stringify(payload)
            });

            const contentType = response.headers.get('Content-Type') || '';
            if (contentType.startsWith('audio/')) {
                const blob = await response.blob();
                audioUrl = URL.createObjectURL(blob);
            } else {
                const data = await response.json();
                const candidateUrl = (
                    data.audioUrl || data.audio_url || data.url || data.audio ||
                    (Array.isArray(data.output) ? data.output[0] : (
                        data.output?.audio || data.output?.audio_url || data.output?.url || data.output
                    ))
                );

                if (candidateUrl && typeof candidateUrl === 'string') {
                    audioUrl = candidateUrl;
                } else if (data.audioBase64) {
                    const byteString = atob(data.audioBase64);
                    const arrayBuffer = new Uint8Array(byteString.length);
                    for (let i = 0; i < byteString.length; i++) {
                        arrayBuffer[i] = byteString.charCodeAt(i);
                    }
                    const blob = new Blob([arrayBuffer], { type: 'audio/mpeg' });
                    audioUrl = URL.createObjectURL(blob);
                } else {
                    throw new Error(data.message || data.error || 'No audio returned by server');
                }
            }
        }

        // Handle audio playback and UI updates
        if (options.playerElements) {
            await handleAudioPlayer(audioUrl, options.playerElements, options.hintElements);
        } else {
            // Simple audio playback for basic cases
            const audio = new Audio(audioUrl);
            await audio.play();
            audio.addEventListener('ended', () => {
                if (audioUrl.startsWith('blob:')) {
                    URL.revokeObjectURL(audioUrl);
                }
            });
        }

        // Call callback if provided
        if (options.onAudioGenerated) {
            options.onAudioGenerated(audioUrl, payload);
        }

    } catch (error) {
        console.error('Voice test failed:', error);
        let errorMessage = error.message;
        if (error.message && error.message.includes('API Error:')) {
            const match = error.message.match(/API Error: \d+ (.+)/);
            if (match) {
                errorMessage = match[1];
            }
        }
        showToast(`Test failed: ${errorMessage}`, 'error');
    } finally {
        buttons.forEach(btn => {
            if (btn) {
                btn.disabled = false;
                btn.textContent = 'Regenerate';
            }
        });
    }
}

/**
 * Checks if the current settings match default values for pre-made audio
 * @param {object} payload - The voice settings payload
 * @param {string} defaultText - The default text to match
 * @returns {boolean} Whether settings are default
 */
function isDefaultSettings(payload, defaultText) {
    const isDefaultText = payload.text.trim().toLowerCase() === defaultText.toLowerCase();
    const isDefaultSettings = (
        (!payload.pitch || payload.pitch === 0) &&
        (!payload.speed || payload.speed === 1.0) &&
        (!payload.emotion || payload.emotion === 'auto' || payload.emotion === 'neutral') &&
        (!payload.languageBoost || payload.languageBoost === 'Automatic' || payload.languageBoost === 'auto')
    );
    return isDefaultText && isDefaultSettings;
}

/**
 * Tries to load a pre-made recording for default settings
 * @param {object} payload - The voice settings payload
 * @param {string} defaultText - The default text to match
 * @returns {Promise<string|null>} The audio URL or null if not found
 */
async function tryLoadPreMadeRecording(payload, defaultText) {
    const voiceId = payload.voiceId || 'Friendly_Person';
    const fileName = defaultText.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
    const preMadeUrl = `/assets/voices/${voiceId}-${fileName}.mp3`;

    try {
        const response = await fetch(preMadeUrl);
        if (response.ok) {
            const blob = await response.blob();
            return URL.createObjectURL(blob);
        }
    } catch (error) {
        console.log('No pre-made recording available for', voiceId, 'with text:', defaultText);
    }

    return null;
}

/**
 * Handles audio player UI updates and playback
 * @param {string} audioUrl - The audio URL to play
 * @param {object} playerElements - Object containing player elements
 * @param {object} hintElements - Object containing hint elements
 */
async function handleAudioPlayer(audioUrl, playerElements, hintElements) {
    const { playerEl, playerElMobile, sourceEl, sourceElMobile } = playerElements;
    const { hintEl, hintElMobile } = hintElements || {};

    // Show audio player (both desktop and mobile)
    if (sourceEl && playerEl) {
        sourceEl.src = audioUrl;
        const audioElement = playerEl.querySelector('audio');
        if (audioElement) {
            audioElement.load();
            try {
                await audioElement.play();
            } catch (err) {
                console.error('Error playing audio:', err);
                showToast('Error playing audio sample', 'error');
            }
        }
        playerEl.style.display = 'block';
        if (hintEl) hintEl.style.display = 'none';
    }

    if (sourceElMobile && playerElMobile) {
        sourceElMobile.src = audioUrl;
        const audioElementMobile = playerElMobile.querySelector('audio');
        if (audioElementMobile) {
            audioElementMobile.load();
        }
        playerElMobile.style.display = 'block';
        if (hintElMobile) hintElMobile.style.display = 'none';
    }

    // Clean up object URL after audio ends
    if (audioUrl.startsWith('blob:')) {
        const audioElements = [];
        if (playerEl) {
            const audioEl = playerEl.querySelector('audio');
            if (audioEl) audioElements.push(audioEl);
        }
        if (playerElMobile) {
            const audioElMobile = playerElMobile.querySelector('audio');
            if (audioElMobile) audioElements.push(audioElMobile);
        }

        audioElements.forEach(audioEl => {
            audioEl.addEventListener('ended', () => {
                URL.revokeObjectURL(audioUrl);
            });
        });
    }
}

/**
 * Syncs the value of two textarea elements.
 * @param {HTMLTextAreaElement} el1 - The first textarea element.
 * @param {HTMLTextAreaElement} el2 - The second textarea element.
 */
function syncTextareas(el1, el2) {
    if (el1 && el2) {
        el1.addEventListener('input', () => {
            el2.value = el1.value;
        });
        el2.addEventListener('input', () => {
            el1.value = el2.value;
        });
    }
}
