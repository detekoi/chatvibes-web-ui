document.addEventListener('DOMContentLoaded', () => {
    // Test mode: enable with ?test=1 in the URL to bypass auth and API calls
    const TEST_MODE = new URLSearchParams(window.location.search).has('test');
    // Toast helper
    const toastContainer = document.getElementById('toast-container') || (() => {
        const c = document.createElement('div');
        c.id = 'toast-container';
        c.className = 'toast-container position-fixed bottom-0 end-0 p-3';
        document.body.appendChild(c);
        return c;
    })();
    function showToast(message, type = 'success') {
        const toastEl = document.createElement('div');
        toastEl.className = 'toast align-items-center border-0';
        toastEl.setAttribute('role', 'alert');
        toastEl.setAttribute('aria-live', 'assertive');
        toastEl.setAttribute('aria-atomic', 'true');
        const bgClass = type === 'error' || type === 'danger' ? 'text-bg-danger' : type === 'warning' ? 'text-bg-warning' : type === 'info' ? 'text-bg-info' : 'text-bg-success';
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

    // Dashboard UI Elements
    const twitchUsernameEl = document.getElementById('twitch-username');
    const channelNameStatusEl = document.getElementById('channel-name-status');
    const botStatusEl = document.getElementById('bot-status');
    const addBotBtn = document.getElementById('add-bot-btn');
    const removeBotBtn = document.getElementById('remove-bot-btn');
    const logoutLink = document.getElementById('logout-link');

    // TTS URL Elements
    const ttsUrlField = document.getElementById('tts-url-field');
    const copyTtsUrlBtn = document.getElementById('copy-tts-url-btn');
    const regenerateTtsUrlBtn = document.getElementById('regenerate-tts-url-btn');

    // Use Hosting rewrites for local/prod; fall back to prod Functions when needed
    const API_BASE_URL = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
        ? ''
        : 'https://us-central1-chatvibestts.cloudfunctions.net/webUi';
    let appSessionToken = null;
    let loggedInUser = null;

    async function loadExistingTtsUrl(userLoginName) {
        if (!ttsUrlField) return;
        if (TEST_MODE) {
            ttsUrlField.value = `https://example.com/tts/test?channel=${encodeURIComponent(userLoginName || 'demo')}`;
            ttsUrlField.placeholder = 'Test mode URL';
            return;
        }
        if (!userLoginName || userLoginName.trim() === '' || userLoginName === 'loading...') {
            ttsUrlField.value = '';
            ttsUrlField.placeholder = 'Could not determine TTS URL.';
            return;
        }
        ttsUrlField.value = 'Loading existing URL...';
        ttsUrlField.placeholder = '';
        try {
            const response = await fetch(`${API_BASE_URL}/api/obs/getToken`, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${appSessionToken}`,
                    'Content-Type': 'application/json'
                }
            });
            if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            const data = await response.json();
            if (data.success && data.browserSourceUrl) {
                ttsUrlField.value = data.browserSourceUrl;
                ttsUrlField.placeholder = 'Your existing OBS Browser Source URL';
                console.log('Dashboard: Loaded existing OBS URL for', userLoginName);
            } else {
                ttsUrlField.value = '';
                ttsUrlField.placeholder = 'Click "Regenerate URL" to generate your OBS Browser Source URL';
            }
        } catch (error) {
            console.error('Dashboard: Error loading existing TTS URL:', error);
            ttsUrlField.value = '';
            ttsUrlField.placeholder = 'Click "Regenerate URL" to generate your OBS Browser Source URL';
        }
    }

    async function updateTtsUrl(userLoginName) {
        if (!ttsUrlField) return;
        if (TEST_MODE) {
            ttsUrlField.value = `https://example.com/tts/new-test-url?channel=${encodeURIComponent(userLoginName || 'demo')}`;
            ttsUrlField.placeholder = 'Test mode URL';
            showToast('Generated a new URL successfully. (test mode)', 'success');
            return;
        }
        if (!userLoginName || userLoginName.trim() === '' || userLoginName === 'loading...') {
            ttsUrlField.value = '';
            ttsUrlField.placeholder = 'Could not determine TTS URL.';
            return;
        }
        ttsUrlField.value = 'Generating secure URL...';
        ttsUrlField.placeholder = '';
        try {
            const response = await fetch(`${API_BASE_URL}/api/obs/generateToken`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${appSessionToken}`,
                    'Content-Type': 'application/json'
                }
            });
            if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            const data = await response.json();
            if (data.success && data.browserSourceUrl) {
                ttsUrlField.value = data.browserSourceUrl;
                ttsUrlField.placeholder = 'Your secure OBS Browser Source URL';
                showToast('Generated a new URL successfully.', 'success');
            } else {
                throw new Error(data.message || 'Failed to generate OBS URL');
            }
        } catch (error) {
            console.error('Dashboard: Error generating OBS URL:', error);
            ttsUrlField.value = '';
            ttsUrlField.placeholder = 'Error generating URL. Please try refreshing.';
            showToast('Failed to generate OBS URL. Please try again.', 'error');
        }
    }

    async function initializeDashboard() {
        appSessionToken = localStorage.getItem('app_session_token');
        console.log('Dashboard: Loaded app_session_token from localStorage:', appSessionToken);
        const userLoginFromStorage = localStorage.getItem('twitch_user_login');
        const userIdFromStorage = localStorage.getItem('twitch_user_id');
        if (TEST_MODE) {
            loggedInUser = { login: 'demostreamer', id: '123456', displayName: 'Demo Streamer' };
            appSessionToken = 'TEST_SESSION_TOKEN';
            if (twitchUsernameEl) twitchUsernameEl.textContent = loggedInUser.displayName;
            if (channelNameStatusEl) channelNameStatusEl.textContent = loggedInUser.login;
            await loadExistingTtsUrl(loggedInUser.login);
            updateBotStatusUI(false);
            return;
        } else if (userLoginFromStorage && userIdFromStorage) {
            loggedInUser = { login: userLoginFromStorage, id: userIdFromStorage, displayName: userLoginFromStorage };
            if (twitchUsernameEl) twitchUsernameEl.textContent = loggedInUser.displayName;
            if (channelNameStatusEl) channelNameStatusEl.textContent = loggedInUser.login;
            await loadExistingTtsUrl(loggedInUser.login);
            if (!appSessionToken) {
                showToast('Authentication token missing. Please log in again.', 'error');
                return;
            }
            try {
                const headers = { 'Authorization': `Bearer ${appSessionToken}` };
                const statusRes = await fetch(`${API_BASE_URL}/api/bot/status`, { method: 'GET', headers });
                if (!statusRes.ok) {
                    if (statusRes.status === 401) {
                        showToast('Session potentially expired. Please log in again.', 'error');
                    } else {
                        const errorData = await statusRes.json().catch(() => ({ message: statusRes.statusText }));
                        showToast(`Failed to fetch status: ${errorData.message || statusRes.statusText}`, 'error');
                    }
                    if (botStatusEl) botStatusEl.textContent = 'Error';
                    return;
                }
                const statusData = await statusRes.json();
                if (statusData.success) {
                    updateBotStatusUI(statusData.isActive);
                } else {
                    showToast(`Error: ${statusData.message}`, 'error');
                    if (botStatusEl) botStatusEl.textContent = 'Error';
                }
            } catch (error) {
                console.error('Error fetching bot status:', error);
                showToast('Failed to load bot status. ' + error.message, 'error');
                if (botStatusEl) botStatusEl.textContent = 'Error';
            }
        } else {
            window.location.href = 'index.html';
        }
    }

    function updateBotStatusUI(isActive) {
        if (isActive) {
            if (botStatusEl) {
                botStatusEl.textContent = 'Active';
                botStatusEl.className = 'fw-semibold text-success';
            }
            if (addBotBtn) addBotBtn.style.display = 'none';
            if (removeBotBtn) removeBotBtn.style.display = 'inline-block';
        } else {
            if (botStatusEl) {
                botStatusEl.textContent = 'Inactive / Not Joined';
                botStatusEl.className = 'fw-semibold text-secondary';
            }
            if (addBotBtn) addBotBtn.style.display = 'inline-block';
            if (removeBotBtn) removeBotBtn.style.display = 'none';
        }
    }

    if (addBotBtn) {
        addBotBtn.addEventListener('click', async () => {
            if (TEST_MODE) {
                showToast('Bot added to channel! (test mode)', 'success');
                updateBotStatusUI(true);
                return;
            }
            if (!appSessionToken) {
                showToast('Authentication token missing. Please log in again.', 'error');
                return;
            }
            showToast('Requesting bot to join...', 'info');
            try {
                const res = await fetch(`${API_BASE_URL}/api/bot/add`, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${appSessionToken}`,
                        'Content-Type': 'application/json'
                    }
                });
                const data = await res.json();
                if (data.success) {
                    showToast(data.message || 'Bot added to channel!', 'success');
                    updateBotStatusUI(true);
                } else {
                    if (data.code === 'not_allowed') {
                        const errorText = data.details || data.message || 'Channel not authorized.';
                        const html = errorText.includes('https://detekoi.github.io/#contact-me')
                            ? errorText.replace('https://detekoi.github.io/#contact-me', '<a href="https://detekoi.github.io/#contact-me" target="_blank" class="link-light">this link</a>')
                            : `${errorText} <a href="https://detekoi.github.io/#contact-me" target="_blank" class="link-light">Request access here</a>.`;
                        showToast(html, 'error');
                    } else {
                        showToast(data.message || 'Failed to add bot.', 'error');
                    }
                }
            } catch (error) {
                console.error('Error adding bot:', error);
                showToast('Failed to send request to add bot.', 'error');
            }
        });
    }

    if (removeBotBtn) {
        removeBotBtn.addEventListener('click', async () => {
            if (TEST_MODE) {
                showToast('Bot removed from channel. (test mode)', 'success');
                updateBotStatusUI(false);
                return;
            }
            if (!appSessionToken) {
                showToast('Authentication token missing. Please log in again.', 'error');
                return;
            }
            showToast('Requesting bot to leave...', 'info');
            try {
                const res = await fetch(`${API_BASE_URL}/api/bot/remove`, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${appSessionToken}`,
                        'Content-Type': 'application/json'
                    }
                });
                const data = await res.json();
                showToast(data.message || 'Request sent.', data.success ? 'success' : 'error');
                if (data.success) updateBotStatusUI(false);
            } catch (error) {
                console.error('Error removing bot:', error);
                showToast('Failed to send request to remove bot.', 'error');
            }
        });
    }

    if (logoutLink) {
        logoutLink.addEventListener('click', (e) => {
            e.preventDefault();
            localStorage.removeItem('twitch_user_login');
            localStorage.removeItem('twitch_user_id');
            localStorage.removeItem('app_session_token');
            appSessionToken = null;
            window.location.href = 'index.html';
        });
    }

    if (copyTtsUrlBtn && ttsUrlField) {
        copyTtsUrlBtn.addEventListener('click', () => {
            if (!ttsUrlField.value) {
                showToast('URL not available yet.', 'warning');
                return;
            }
            ttsUrlField.select();
            ttsUrlField.setSelectionRange(0, 99999);
            try {
                navigator.clipboard.writeText(ttsUrlField.value).then(() => {
                    showToast('Copied to clipboard!', 'success');
                    const original = copyTtsUrlBtn.textContent;
                    copyTtsUrlBtn.textContent = 'Copied!';
                    setTimeout(() => { copyTtsUrlBtn.textContent = original; }, 2000);
                }, () => {
                    if (document.execCommand('copy')) {
                        showToast('Copied to clipboard!', 'success');
                        const original = copyTtsUrlBtn.textContent;
                        copyTtsUrlBtn.textContent = 'Copied!';
                        setTimeout(() => { copyTtsUrlBtn.textContent = original; }, 2000);
                    } else {
                        showToast('Copy failed.', 'error');
                    }
                });
            } catch (err) {
                console.error('Copy attempt error:', err);
                showToast('Failed to copy.', 'error');
            }
        });
    }

    if (regenerateTtsUrlBtn) {
        regenerateTtsUrlBtn.addEventListener('click', async (e) => {
            e.preventDefault();
            if (TEST_MODE) {
                const originalText = regenerateTtsUrlBtn.textContent;
                regenerateTtsUrlBtn.textContent = 'Generating...';
                regenerateTtsUrlBtn.style.pointerEvents = 'none';
                await new Promise(r => setTimeout(r, 500));
                await updateTtsUrl(loggedInUser?.login || 'demo');
                regenerateTtsUrlBtn.style.pointerEvents = 'auto';
                regenerateTtsUrlBtn.textContent = originalText;
                return;
            }
            if (!loggedInUser || !loggedInUser.login) {
                showToast('Error: User not logged in.', 'error');
                return;
            }
            const originalText = regenerateTtsUrlBtn.textContent;
            regenerateTtsUrlBtn.textContent = 'Generating...';
            regenerateTtsUrlBtn.style.pointerEvents = 'none';
            try {
                await updateTtsUrl(loggedInUser.login);
            } catch (e) {
                // already handled inside
            } finally {
                regenerateTtsUrlBtn.style.pointerEvents = 'auto';
                regenerateTtsUrlBtn.textContent = originalText;
            }
        });
    }

    // Settings Panel Elements
    const defaultVoiceSelect = document.getElementById('default-voice');
    const defaultEmotionSelect = document.getElementById('default-emotion');
    const defaultPitchSlider = document.getElementById('default-pitch');
    const pitchValueSpan = document.getElementById('pitch-value');
    const defaultSpeedSlider = document.getElementById('default-speed');
    const speedValueSpan = document.getElementById('speed-value');
    const resetPitchBtn = document.getElementById('reset-pitch-btn');
    const resetSpeedBtn = document.getElementById('reset-speed-btn');
    const defaultLanguageSelect = document.getElementById('default-language');
    const englishNormalizationCheckbox = document.getElementById('english-normalization');

    const ttsEnabledCheckbox = document.getElementById('tts-enabled');
    const ttsModeSelect = document.getElementById('tts-mode');
    const ttsPermissionSelect = document.getElementById('tts-permission');
    const eventsEnabledCheckbox = document.getElementById('events-enabled');
    const allowViewerPreferencesCheckbox = document.getElementById('allow-viewer-preferences');
    const readFullUrlsCheckbox = document.getElementById('read-full-urls');
    const bitsEnabledCheckbox = document.getElementById('bits-enabled');
    const bitsAmountInput = document.getElementById('bits-amount');
    const musicEnabledCheckbox = document.getElementById('music-enabled');
    const musicModeSelect = document.getElementById('music-mode');
    const musicBitsEnabledCheckbox = document.getElementById('music-bits-enabled');
    const musicBitsAmountInput = document.getElementById('music-bits-amount');

    const saveSettingsBtn = document.getElementById('save-settings-btn');

    const voiceTestTextInput = document.getElementById('voice-test-text');
    const voiceTestBtn = document.getElementById('voice-test-btn');
    if (voiceTestBtn) voiceTestBtn.disabled = true;

    // Channel Points elements
    const cpEnabled = document.getElementById('cp-enabled');
    const cpTitle = document.getElementById('cp-title');
    const cpCost = document.getElementById('cp-cost');
    const cpPrompt = document.getElementById('cp-prompt');
    const cpSkipQueue = document.getElementById('cp-skip-queue');
    const cpLimitsEnabled = document.getElementById('cp-limits-enabled');
    const cpCooldown = document.getElementById('cp-cooldown');
    const cpPerStream = document.getElementById('cp-per-stream');
    const cpPerUser = document.getElementById('cp-per-user');
    const cpMin = document.getElementById('cp-min');
    const cpMax = document.getElementById('cp-max');
    const cpBlockLinks = document.getElementById('cp-block-links');
    const cpBannedWords = document.getElementById('cp-banned-words');
    const cpSaveBtn = document.getElementById('cp-save');
    const cpTestBtn = document.getElementById('cp-test');
    const cpDeleteBtn = document.getElementById('cp-delete');
    const cpMsg = document.getElementById('cp-msg');
    const cpStatusLine = document.getElementById('cp-status-line');

    // Bot settings API URL
    const BOT_API_BASE_URL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' 
        ? 'http://localhost:8080/api'
        : 'https://chatvibes-tts-service-h7kj56ct4q-uc.a.run.app/api';

    let originalSettings = {};
    let isInitializing = true;
    let lastSuccessToastAt = 0;
    // Resolve when settings (voices + saved preferences) are loaded
    let settingsInitialized = false;
    let settingsInitializedPromiseResolve;
    const settingsInitializedPromise = new Promise((resolve) => {
        settingsInitializedPromiseResolve = resolve;
    });

    function debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => { clearTimeout(timeout); func.apply(this, args); };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }

    function maybeSuccessToast(message) {
        const now = Date.now();
        if (now - lastSuccessToastAt > 5000) {
            showToast(message, 'success');
            lastSuccessToastAt = now;
        }
    }

    function getChannelName() {
        return loggedInUser?.login?.toLowerCase();
    }

    function authHeaders() {
        const headers = { 'Content-Type': 'application/json' };
        if (appSessionToken) headers['Authorization'] = `Bearer ${appSessionToken}`;
        return headers;
    }

    // Compute effective TTS settings using current UI values for voice preview
    function getEffectiveTtsSettings() {
        const voiceId = defaultVoiceSelect?.value || 'Friendly_Person';
        const emotion = defaultEmotionSelect?.value || 'auto';
        const pitch = parseInt(defaultPitchSlider?.value || '0', 10);
        const speed = parseFloat(defaultSpeedSlider?.value || '1.0');
        const languageBoost = defaultLanguageSelect?.value || 'Automatic';
        const englishNormalization = englishNormalizationCheckbox?.checked || false;
        return { voiceId, emotion, pitch, speed, languageBoost, englishNormalization };
    }

    async function saveTtsSetting(key, value, label) {
        if (isInitializing) return;
        const channelName = getChannelName();
        if (TEST_MODE) { maybeSuccessToast('Saved'); return; }
        if (!channelName) { showToast('Not logged in', 'error'); return; }
        try {
            const response = await fetch(`${BOT_API_BASE_URL}/tts/settings/channel/${channelName}`, {
                method: 'PUT', headers: authHeaders(), body: JSON.stringify({ key, value })
            });
            if (response.ok) {
                maybeSuccessToast('Saved');
            } else if (response.status === 403) {
                const errorData = await response.json().catch(() => ({}));
                const errorText = errorData.details || errorData.message || 'Channel is not allowed to use this service';
                const html = errorText.includes('https://detekoi.github.io/#contact-me')
                    ? errorText.replace('https://detekoi.github.io/#contact-me', '<a href="https://detekoi.github.io/#contact-me" target="_blank" class="link-light">this link</a>')
                    : `${errorText} <a href=\"https://detekoi.github.io/#contact-me\" target=\"_blank\" class=\"link-light\">Request access here</a>.`;
                showToast(html, 'error');
            } else if (response.status === 500 || response.status === 404) {
                showToast('Settings management not available yet - bot needs API update', 'warning');
            } else {
                const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
                showToast(`${label || 'Setting'}: ${errorData.error}`, 'error');
            }
        } catch (error) {
            console.error('Failed to save setting:', key, error);
            showToast(`Failed to save ${label || key}`, 'error');
        }
    }

    async function saveMusicEnabled(enabled) {
        if (isInitializing) return;
        const channelName = getChannelName();
        if (TEST_MODE) { maybeSuccessToast('Saved'); return; }
        if (!channelName) { showToast('Not logged in', 'error'); return; }
        try {
            const response = await fetch(`${BOT_API_BASE_URL}/music/settings/channel/${channelName}`, {
                method: 'PUT', headers: authHeaders(), body: JSON.stringify({ key: 'enabled', value: enabled })
            });
            if (response.ok) { maybeSuccessToast('Saved'); }
            else if (response.status === 403) {
                const errorData = await response.json().catch(() => ({}));
                const errorText = errorData.details || errorData.message || 'Channel is not allowed to use this service';
                showToast(`Forbidden: ${errorText}`, 'error');
            } else if (response.status !== 500 && response.status !== 404) {
                const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
                showToast(`Music Generation: ${errorData.error}`, 'error');
            } else {
                showToast('Settings management not available yet - bot needs API update', 'warning');
            }
        } catch (e) {
            showToast('Failed to save Music Generation', 'error');
        }
    }

    async function saveMusicAllowedRoles(modeValue) {
        if (isInitializing) return;
        const channelName = getChannelName();
        if (TEST_MODE) { maybeSuccessToast('Saved'); return; }
        if (!channelName) { showToast('Not logged in', 'error'); return; }
        const roles = modeValue === 'everyone' ? ['everyone'] : ['moderator'];
        try {
            const response = await fetch(`${BOT_API_BASE_URL}/music/settings/channel/${channelName}`, {
                method: 'PUT', headers: authHeaders(), body: JSON.stringify({ key: 'allowedRoles', value: roles })
            });
            if (response.ok) { maybeSuccessToast('Saved'); }
            else if (response.status === 403) {
                const errorData = await response.json().catch(() => ({}));
                const errorText = errorData.details || errorData.message || 'Channel is not allowed to use this service';
                showToast(`Forbidden: ${errorText}`, 'error');
            } else if (response.status !== 500 && response.status !== 404) {
                const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
                showToast(`Music Access: ${errorData.error}`, 'error');
            } else {
                showToast('Settings management not available yet - bot needs API update', 'warning');
            }
        } catch (e) {
            showToast('Failed to save Music Access', 'error');
        }
    }

    async function saveMusicBitsConfig(enabled, minimumAmount) {
        if (isInitializing) return;
        const channelName = getChannelName();
        if (TEST_MODE) { maybeSuccessToast('Saved'); return; }
        if (!channelName) { showToast('Not logged in', 'error'); return; }
        try {
            const response = await fetch(`${BOT_API_BASE_URL}/music/settings/channel/${channelName}`, {
                method: 'PUT', headers: authHeaders(),
                body: JSON.stringify({ key: 'bitsConfig', value: { enabled, minimumAmount } })
            });
            if (response.ok) { maybeSuccessToast('Saved'); }
            else if (response.status === 403) {
                const errorData = await response.json().catch(() => ({}));
                const errorText = errorData.details || errorData.message || 'Channel is not allowed to use this service';
                showToast(`Forbidden: ${errorText}`, 'error');
            } else if (response.status !== 500 && response.status !== 404) {
                const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
                showToast(`Music Bits: ${errorData.error}`, 'error');
            } else {
                showToast('Settings management not available yet - bot needs API update', 'warning');
            }
        } catch (e) {
            showToast('Failed to save Music Bits', 'error');
        }
    }

    if (defaultPitchSlider && pitchValueSpan) {
        defaultPitchSlider.addEventListener('input', () => {
            pitchValueSpan.textContent = defaultPitchSlider.value;
        });
    }
    if (defaultSpeedSlider && speedValueSpan) {
        defaultSpeedSlider.addEventListener('input', () => {
            speedValueSpan.textContent = defaultSpeedSlider.value;
        });
    }

    // Minimal, reliable global handlers for Reset buttons
    window.resetPitchDefault = function() {
        console.log('resetPitchDefault called');
        const slider = document.getElementById('default-pitch');
        const valueEl = document.getElementById('pitch-value');
        console.log('Pitch slider:', slider, 'Value element:', valueEl);
        if (!slider) {
            console.error('Pitch slider not found');
            return;
        }
        slider.value = '0';
        if (valueEl) valueEl.textContent = '0';
        console.log('Pitch reset to 0, calling saveTtsSetting');
        saveTtsSetting('pitch', 0, 'Default Pitch');
    };
    window.resetSpeedDefault = function() {
        console.log('resetSpeedDefault called');
        const slider = document.getElementById('default-speed');
        const valueEl = document.getElementById('speed-value');
        console.log('Speed slider:', slider, 'Value element:', valueEl);
        if (!slider) {
            console.error('Speed slider not found');
            return;
        }
        slider.value = '1.0';
        if (valueEl) valueEl.textContent = '1.0';
        console.log('Speed reset to 1.0, calling saveTtsSetting');
        saveTtsSetting('speed', 1.0, 'Default Speed');
    };

    async function loadAvailableVoices() {
        if (!defaultVoiceSelect) return;
        const fallbackVoices = [
            'Friendly_Person', 'Professional_Woman', 'Casual_Male', 'Energetic_Youth',
            'Warm_Grandmother', 'Confident_Leader', 'Soothing_Narrator', 'Cheerful_Assistant',
            'Deep_Narrator', 'Bright_Assistant', 'Calm_Guide', 'Energetic_Host'
        ];
        if (TEST_MODE) {
            populateVoices(fallbackVoices);
            return;
        }
        try {
            const response = await fetch(`${BOT_API_BASE_URL}/voices`);
            if (response.ok) {
                const voicesData = await response.json();
                const voices = voicesData.voices || fallbackVoices;
                populateVoices(voices);
                return;
            }
        } catch (error) {
            console.warn('Failed to load voices from bot API, using fallback:', error);
        }
        populateVoices(fallbackVoices);
    }

    function populateVoices(voices) {
        defaultVoiceSelect.innerHTML = '';
        voices.forEach(voice => {
            const option = document.createElement('option');
            option.value = voice;
            option.textContent = voice.replace(/[_-]/g, ' ').replace(/\b\w/g, chr => chr.toUpperCase());
            defaultVoiceSelect.appendChild(option);
        });
        defaultVoiceSelect.value = 'Friendly_Person';
    }

    async function loadBotSettings() {
        if (!loggedInUser?.login) {
            console.warn('No logged in user, cannot load bot settings');
            return;
        }
        if (TEST_MODE) {
            // Populate UI with demo values
            const demoTts = {
                engineEnabled: true,
                mode: 'command',
                ttsPermissionLevel: 'everyone',
                speakEvents: true,
                readFullUrls: false,
                bitsModeEnabled: true,
                bitsMinimumAmount: 100,
                voiceId: 'Friendly_Person',
                emotion: 'auto',
                pitch: 0,
                speed: 1.0,
                languageBoost: 'Automatic',
                englishNormalization: false,
                ignoredUsers: ['spammer1', 'troll2']
            };
            const demoMusic = {
                enabled: false,
                allowedRoles: ['everyone'],
                bitsModeEnabled: false,
                bitsMinimumAmount: 100,
                ignoredUsers: ['loudguy']
            };
            if (ttsEnabledCheckbox) ttsEnabledCheckbox.checked = demoTts.engineEnabled;
            if (ttsModeSelect) ttsModeSelect.value = demoTts.mode;
            if (ttsPermissionSelect) ttsPermissionSelect.value = demoTts.ttsPermissionLevel;
            if (eventsEnabledCheckbox) eventsEnabledCheckbox.checked = demoTts.speakEvents;
            if (readFullUrlsCheckbox) readFullUrlsCheckbox.checked = demoTts.readFullUrls;
            if (bitsEnabledCheckbox) bitsEnabledCheckbox.checked = demoTts.bitsModeEnabled;
            if (bitsAmountInput) bitsAmountInput.value = demoTts.bitsMinimumAmount;
            if (defaultVoiceSelect) defaultVoiceSelect.value = demoTts.voiceId;
            if (defaultEmotionSelect) defaultEmotionSelect.value = demoTts.emotion;
            if (defaultPitchSlider) { defaultPitchSlider.value = demoTts.pitch; if (pitchValueSpan) pitchValueSpan.textContent = demoTts.pitch; }
            if (defaultSpeedSlider) { defaultSpeedSlider.value = demoTts.speed; if (speedValueSpan) speedValueSpan.textContent = demoTts.speed; }
            if (defaultLanguageSelect) defaultLanguageSelect.value = demoTts.languageBoost;
            if (englishNormalizationCheckbox) englishNormalizationCheckbox.checked = demoTts.englishNormalization;
            if (musicEnabledCheckbox) musicEnabledCheckbox.checked = demoMusic.enabled;
            if (musicModeSelect) musicModeSelect.value = demoMusic.allowedRoles.includes('everyone') ? 'everyone' : 'moderator';
            if (musicBitsEnabledCheckbox) musicBitsEnabledCheckbox.checked = demoMusic.bitsModeEnabled;
            if (musicBitsAmountInput) musicBitsAmountInput.value = demoMusic.bitsMinimumAmount;
            displayIgnoreList('tts', demoTts.ignoredUsers);
            displayIgnoreList('music', demoMusic.ignoredUsers);
            originalSettings = { tts: demoTts, music: demoMusic };
            if (cpEnabled) cpEnabled.checked = false;
            if (cpStatusLine) cpStatusLine.textContent = 'No reward created (test mode)';
            return;
        }
        try {
            const channelName = loggedInUser.login.toLowerCase();
            const headers = { 'Content-Type': 'application/json' };
            if (appSessionToken) headers['Authorization'] = `Bearer ${appSessionToken}`;

            // TTS settings
            let ttsData = { settings: {} };
            const ttsResponse = await fetch(`${BOT_API_BASE_URL}/tts/settings/channel/${channelName}`, { headers });
            if (ttsResponse.status === 403) {
                const errorData = await ttsResponse.json().catch(() => ({}));
                const errorText = errorData.details || errorData.message || 'This channel is not permitted to use this service.';
                const html = errorText.includes('https://detekoi.github.io/#contact-me')
                    ? errorText.replace('https://detekoi.github.io/#contact-me', '<a href="https://detekoi.github.io/#contact-me" target="_blank" class="link-light">this link</a>')
                    : `${errorText} <a href=\"https://detekoi.github.io/#contact-me\" target=\"_blank\" class=\"link-light\">Request access here</a>.`;
                showToast(html, 'error');
                return;
            } else if (ttsResponse.ok) {
                ttsData = await ttsResponse.json();
                const settings = ttsData.settings || {};
                if (ttsEnabledCheckbox) ttsEnabledCheckbox.checked = settings.engineEnabled || false;
                if (ttsModeSelect) ttsModeSelect.value = settings.mode || 'command';
                if (ttsPermissionSelect) ttsPermissionSelect.value = settings.ttsPermissionLevel || 'everyone';
                if (eventsEnabledCheckbox) eventsEnabledCheckbox.checked = settings.speakEvents !== false;
                if (allowViewerPreferencesCheckbox) allowViewerPreferencesCheckbox.checked = settings.allowViewerPreferences !== false;
                if (readFullUrlsCheckbox) readFullUrlsCheckbox.checked = settings.readFullUrls || false;
                if (bitsEnabledCheckbox) bitsEnabledCheckbox.checked = settings.bitsModeEnabled || false;
                if (bitsAmountInput) bitsAmountInput.value = settings.bitsMinimumAmount || 100;
                if (defaultVoiceSelect) defaultVoiceSelect.value = settings.voiceId || 'Friendly_Person';
                if (defaultEmotionSelect) defaultEmotionSelect.value = settings.emotion || 'auto';
                if (defaultPitchSlider) {
                    defaultPitchSlider.value = settings.pitch || 0;
                    if (pitchValueSpan) pitchValueSpan.textContent = settings.pitch || 0;
                }
                if (defaultSpeedSlider) {
                    defaultSpeedSlider.value = settings.speed || 1.0;
                    if (speedValueSpan) speedValueSpan.textContent = settings.speed || 1.0;
                }
                if (defaultLanguageSelect) defaultLanguageSelect.value = settings.languageBoost || 'Automatic';
                if (englishNormalizationCheckbox) englishNormalizationCheckbox.checked = settings.englishNormalization || false;
            }

            // Music settings
            let musicData = { settings: {} };
            const musicResponse = await fetch(`${BOT_API_BASE_URL}/music/settings/channel/${channelName}`, { headers });
            if (musicResponse.status === 403) {
                return;
            } else if (musicResponse.ok) {
                musicData = await musicResponse.json();
                const settings = musicData.settings || {};
                if (musicEnabledCheckbox) musicEnabledCheckbox.checked = settings.enabled || false;
                if (musicModeSelect) {
                    const mode = settings.allowedRoles?.includes('everyone') ? 'everyone' : 'moderator';
                    musicModeSelect.value = mode;
                }
                if (musicBitsEnabledCheckbox) musicBitsEnabledCheckbox.checked = settings.bitsModeEnabled || false;
                if (musicBitsAmountInput) musicBitsAmountInput.value = settings.bitsMinimumAmount || 100;
            }

            // Ignore lists
            displayIgnoreList('tts', ttsData.settings?.ignoredUsers || []);
            displayIgnoreList('music', musicData.settings?.ignoredUsers || []);

            originalSettings = {
                tts: ttsData.settings || {},
                music: musicData.settings || {}
            };

            // Load Channel Points config from Cloud Functions
            try {
                const res = await fetch(`${API_BASE_URL}/api/rewards/tts`, {
                    method: 'GET',
                    headers: { 'Authorization': `Bearer ${appSessionToken}` },
                    credentials: 'include'
                });
                if (res.ok) {
                    const data = await res.json();
                    const cp = data.channelPoints || {};
                    if (cpEnabled) cpEnabled.checked = !!cp.enabled;
                    if (cpTitle) cpTitle.value = cp.title ?? 'Text-to-Speech Message';
                    if (cpCost) cpCost.value = cp.cost ?? 500;
                    if (cpPrompt) cpPrompt.value = cp.prompt ?? 'Enter a message to be read aloud';
                    if (cpSkipQueue) cpSkipQueue.checked = cp.skipQueue !== false;
                    if (cpLimitsEnabled) cpLimitsEnabled.checked = cp.limitsEnabled ?? (cp.perStreamLimit > 0);
                    if (cpCooldown) cpCooldown.value = (cp.limitsEnabled ? Math.max(1, cp.cooldownSeconds ?? 1) : (cp.cooldownSeconds ?? 0));
                    if (cpPerStream) cpPerStream.value = (cp.perStreamLimit && cp.perStreamLimit > 0) ? cp.perStreamLimit : '';
                    if (cpPerUser) cpPerUser.value = (cp.perUserPerStreamLimit && cp.perUserPerStreamLimit > 0) ? cp.perUserPerStreamLimit : '';
                    if (cpMin) cpMin.value = cp.contentPolicy?.minChars ?? 1;
                    if (cpMax) cpMax.value = cp.contentPolicy?.maxChars ?? 200;
                    if (cpBlockLinks) cpBlockLinks.checked = cp.contentPolicy?.blockLinks !== false;
                    if (cpBannedWords) cpBannedWords.value = (cp.contentPolicy?.bannedWords || []).join(', ');
                    if (cpStatusLine) {
                        const idPart = cp.rewardId ? `Reward ID: ${cp.rewardId}` : 'No reward created';
                        const syncPart = cp.lastSyncedAt ? ` · Last synced: ${new Date(cp.lastSyncedAt).toLocaleTimeString()}` : '';
                        cpStatusLine.textContent = `${idPart}${syncPart}`;
                    }
                }
            } catch (err) {
                console.warn('Failed to load Channel Points TTS config:', err);
            }
        } catch (error) {
            console.error('Failed to load bot settings:', error);
            showToast('Failed to load current settings. Using defaults.', 'warning');
        }
    }

    async function saveBotSettings() {
        if (!loggedInUser?.login) {
            console.warn('No logged in user, cannot save bot settings');
            return;
        }
        if (TEST_MODE) {
            showToast('✅ Settings saved successfully! (test mode)', 'success');
            return;
        }
        try {
            const channelName = loggedInUser.login.toLowerCase();
            const errors = [];
            const changedSettings = [];
            const headers = { 'Content-Type': 'application/json' };
            if (appSessionToken) headers['Authorization'] = `Bearer ${appSessionToken}`;

            const currentTtsSettings = [
                { key: 'engineEnabled', value: ttsEnabledCheckbox?.checked || false, label: 'TTS Engine' },
                { key: 'mode', value: ttsModeSelect?.value || 'command', label: 'TTS Mode' },
                { key: 'ttsPermissionLevel', value: ttsPermissionSelect?.value || 'everyone', label: 'TTS Permission' },
                { key: 'speakEvents', value: eventsEnabledCheckbox?.checked !== false, label: 'Event Announcements' },
                { key: 'readFullUrls', value: readFullUrlsCheckbox?.checked || false, label: 'Read Full URLs' },
                { key: 'bitsModeEnabled', value: bitsEnabledCheckbox?.checked || false, label: 'Bits-for-TTS' },
                { key: 'bitsMinimumAmount', value: parseInt(bitsAmountInput?.value || '100'), label: 'Minimum Bits' },
                { key: 'voiceId', value: defaultVoiceSelect?.value || 'Friendly_Person', label: 'Default Voice' },
                { key: 'emotion', value: defaultEmotionSelect?.value || 'auto', label: 'Default Emotion' },
                { key: 'pitch', value: parseInt(defaultPitchSlider?.value || '0'), label: 'Default Pitch' },
                { key: 'speed', value: parseFloat(defaultSpeedSlider?.value || '1.0'), label: 'Default Speed' },
                { key: 'languageBoost', value: defaultLanguageSelect?.value || 'Automatic', label: 'Default Language' },
                { key: 'englishNormalization', value: englishNormalizationCheckbox?.checked || false, label: 'English Normalization' }
            ];

            for (const setting of currentTtsSettings) {
                const originalValue = originalSettings.tts?.[setting.key];
                if (originalValue !== setting.value) {
                    const response = await fetch(`${BOT_API_BASE_URL}/tts/settings/channel/${channelName}`, {
                        method: 'PUT', headers, body: JSON.stringify(setting)
                    });
                    if (response.ok) {
                        changedSettings.push(`${setting.label}`);
                    } else if (response.status === 403) {
                        const errorData = await response.json().catch(() => ({}));
                        const errorText = errorData.details || errorData.message || 'Channel is not allowed to use this service';
                        errors.push(`Forbidden: ${errorText}`);
                        break;
                    } else if (response.status === 400) {
                        const errorData = await response.json().catch(() => ({ error: 'Validation error' }));
                        console.warn(`TTS setting ${setting.key} validation failed:`, errorData.error);
                    } else if (response.status === 500 || response.status === 404) {
                        errors.push('Settings management not available yet - bot needs API update');
                        break;
                    } else {
                        const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
                        errors.push(`TTS ${setting.label}: ${errorData.error}`);
                    }
                }
            }

            const currentMusicEnabled = musicEnabledCheckbox?.checked || false;
            const currentMusicMode = musicModeSelect?.value === 'everyone' ? ['everyone'] : ['moderator'];
            const currentMusicBitsEnabled = musicBitsEnabledCheckbox?.checked || false;
            const currentMusicBitsAmount = parseInt(musicBitsAmountInput?.value || '100');

            if (originalSettings.music?.enabled !== currentMusicEnabled) {
                const response = await fetch(`${BOT_API_BASE_URL}/music/settings/channel/${channelName}`, {
                    method: 'PUT', headers, body: JSON.stringify({ key: 'enabled', value: currentMusicEnabled })
                });
                if (response.ok) {
                    changedSettings.push('Music Generation');
                } else if (response.status === 403) {
                    const errorData = await response.json().catch(() => ({}));
                    const errorText = errorData.details || errorData.message || 'Channel is not allowed to use this service';
                    errors.push(`Forbidden: ${errorText}`);
                } else if (response.status !== 500 && response.status !== 404) {
                    const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
                    errors.push(`Music Generation: ${errorData.error}`);
                }
            }

            if (JSON.stringify(originalSettings.music?.allowedRoles) !== JSON.stringify(currentMusicMode)) {
                const response = await fetch(`${BOT_API_BASE_URL}/music/settings/channel/${channelName}`, {
                    method: 'PUT', headers, body: JSON.stringify({ key: 'allowedRoles', value: currentMusicMode })
                });
                if (response.ok) {
                    changedSettings.push('Music Access');
                } else if (response.status === 403) {
                    const errorData = await response.json().catch(() => ({}));
                    const errorText = errorData.details || errorData.message || 'Channel is not allowed to use this service';
                    errors.push(`Forbidden: ${errorText}`);
                } else if (response.status !== 500 && response.status !== 404) {
                    const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
                    errors.push(`Music Access: ${errorData.error}`);
                }
            }

            if (originalSettings.music?.bitsModeEnabled !== currentMusicBitsEnabled ||
                originalSettings.music?.bitsMinimumAmount !== currentMusicBitsAmount) {
                const response = await fetch(`${BOT_API_BASE_URL}/music/settings/channel/${channelName}`, {
                    method: 'PUT', headers,
                    body: JSON.stringify({ key: 'bitsConfig', value: { enabled: currentMusicBitsEnabled, minimumAmount: currentMusicBitsAmount } })
                });
                if (response.ok) {
                    changedSettings.push('Music Bits');
                } else if (response.status === 403) {
                    const errorData = await response.json().catch(() => ({}));
                    const errorText = errorData.details || errorData.message || 'Channel is not allowed to use this service';
                    errors.push(`Forbidden: ${errorText}`);
                } else if (response.status !== 500 && response.status !== 404) {
                    const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
                    errors.push(`Music Bits: ${errorData.error}`);
                }
            }

            if (errors.length > 0) {
                showToast(`Some settings failed to save: ${errors.join(', ')}`,'error');
            } else if (changedSettings.length > 0) {
                const changedCount = changedSettings.length;
                showToast(`✅ Settings saved successfully! (${changedCount} change${changedCount > 1 ? 's' : ''})`, 'success');
                await loadBotSettings();
            } else {
                showToast('No changes to save.', 'info');
            }
        } catch (error) {
            console.error('Failed to save bot settings:', error);
            showToast('Failed to save settings. Please try again.', 'error');
        }
    }

    // Hide legacy Save button; auto-save is enabled
    if (saveSettingsBtn) {
        saveSettingsBtn.style.display = 'none';
        saveSettingsBtn.disabled = true;
    }

    // Auto-save listeners for Broadcaster settings (TTS)
    if (ttsEnabledCheckbox) ttsEnabledCheckbox.addEventListener('change', () => saveTtsSetting('engineEnabled', !!ttsEnabledCheckbox.checked, 'TTS Engine'));
    if (ttsModeSelect) ttsModeSelect.addEventListener('change', () => saveTtsSetting('mode', ttsModeSelect.value || 'command', 'TTS Mode'));
    if (ttsPermissionSelect) ttsPermissionSelect.addEventListener('change', () => saveTtsSetting('ttsPermissionLevel', ttsPermissionSelect.value || 'everyone', 'TTS Permission'));
    if (eventsEnabledCheckbox) eventsEnabledCheckbox.addEventListener('change', () => saveTtsSetting('speakEvents', eventsEnabledCheckbox.checked !== false, 'Event Announcements'));
    if (allowViewerPreferencesCheckbox) allowViewerPreferencesCheckbox.addEventListener('change', () => saveTtsSetting('allowViewerPreferences', !!allowViewerPreferencesCheckbox.checked, 'Allow Viewer Voice Preferences'));
    if (readFullUrlsCheckbox) readFullUrlsCheckbox.addEventListener('change', () => saveTtsSetting('readFullUrls', !!readFullUrlsCheckbox.checked, 'Read Full URLs'));
    if (bitsEnabledCheckbox) bitsEnabledCheckbox.addEventListener('change', () => saveTtsSetting('bitsModeEnabled', !!bitsEnabledCheckbox.checked, 'Bits for TTS'));
    if (bitsAmountInput) {
        const debouncedBitsAmountSave = debounce(() => saveTtsSetting('bitsMinimumAmount', parseInt(bitsAmountInput.value || '100', 10), 'Minimum Bits'), 600);
        bitsAmountInput.addEventListener('input', () => { if (!isInitializing) debouncedBitsAmountSave(); });
        bitsAmountInput.addEventListener('change', () => saveTtsSetting('bitsMinimumAmount', parseInt(bitsAmountInput.value || '100', 10), 'Minimum Bits'));
    }

    if (defaultVoiceSelect) defaultVoiceSelect.addEventListener('change', () => saveTtsSetting('voiceId', defaultVoiceSelect.value || 'Friendly_Person', 'Default Voice'));
    if (defaultEmotionSelect) defaultEmotionSelect.addEventListener('change', () => saveTtsSetting('emotion', defaultEmotionSelect.value || 'auto', 'Default Emotion'));
    if (defaultPitchSlider) {
        const debouncedPitchSave = debounce(() => saveTtsSetting('pitch', parseInt(defaultPitchSlider.value || '0', 10), 'Default Pitch'), 400);
        defaultPitchSlider.addEventListener('input', () => { if (!isInitializing) debouncedPitchSave(); });
        defaultPitchSlider.addEventListener('change', () => saveTtsSetting('pitch', parseInt(defaultPitchSlider.value || '0', 10), 'Default Pitch'));
    }
    if (defaultSpeedSlider) {
        const debouncedSpeedSave = debounce(() => saveTtsSetting('speed', parseFloat(defaultSpeedSlider.value || '1.0'), 'Default Speed'), 400);
        defaultSpeedSlider.addEventListener('input', () => { if (!isInitializing) debouncedSpeedSave(); });
        defaultSpeedSlider.addEventListener('change', () => saveTtsSetting('speed', parseFloat(defaultSpeedSlider.value || '1.0'), 'Default Speed'));
    }
    if (defaultLanguageSelect) defaultLanguageSelect.addEventListener('change', () => saveTtsSetting('languageBoost', defaultLanguageSelect.value || 'Automatic', 'Default Language'));
    if (englishNormalizationCheckbox) englishNormalizationCheckbox.addEventListener('change', () => saveTtsSetting('englishNormalization', !!englishNormalizationCheckbox.checked, 'English Normalization'));

    // Auto-save listeners for Music settings
    if (musicEnabledCheckbox) musicEnabledCheckbox.addEventListener('change', () => saveMusicEnabled(!!musicEnabledCheckbox.checked));
    if (musicModeSelect) musicModeSelect.addEventListener('change', () => saveMusicAllowedRoles(musicModeSelect.value || 'everyone'));
    if (musicBitsEnabledCheckbox || musicBitsAmountInput) {
        const saveBits = () => saveMusicBitsConfig(!!musicBitsEnabledCheckbox?.checked, parseInt(musicBitsAmountInput?.value || '100', 10));
        const debouncedSaveBits = debounce(() => { if (!isInitializing) saveBits(); }, 600);
        if (musicBitsEnabledCheckbox) musicBitsEnabledCheckbox.addEventListener('change', () => saveBits());
        if (musicBitsAmountInput) {
            musicBitsAmountInput.addEventListener('input', () => debouncedSaveBits());
            musicBitsAmountInput.addEventListener('change', () => saveBits());
        }
    }

    // Channel Points actions
    async function saveChannelPointsConfig(isAuto = false) {
        if (TEST_MODE) { showToast('Channel Points saved ✓ (test mode)', 'success'); if (cpStatusLine) cpStatusLine.textContent = 'No reward created · Last synced: ' + new Date().toLocaleTimeString(); return; }
        if (!appSessionToken) { showToast('Authentication required', 'error'); return; }
        const payload = {
            enabled: !!cpEnabled?.checked,
            title: cpTitle?.value || 'Text-to-Speech Message',
            cost: parseInt(cpCost?.value || '500', 10),
            prompt: cpPrompt?.value || 'Enter a message to be read aloud',
            skipQueue: !!cpSkipQueue?.checked,
            cooldownSeconds: parseInt(cpCooldown?.value || '0', 10),
            perStreamLimit: parseInt(cpPerStream?.value || '0', 10),
            perUserPerStreamLimit: parseInt(cpPerUser?.value || '0', 10),
            contentPolicy: {
                minChars: parseInt(cpMin?.value || '1', 10),
                maxChars: parseInt(cpMax?.value || '200', 10),
                blockLinks: !!cpBlockLinks?.checked,
                bannedWords: (cpBannedWords?.value || '')
                    .split(',')
                    .map(s => s.trim())
                    .filter(Boolean)
            },
            limitsEnabled: !!cpLimitsEnabled?.checked
        };
        // Enforce UX/validation rules:
        if (payload.limitsEnabled) {
            // cooldown minimum 1 when enabled
            payload.cooldownSeconds = Math.max(1, parseInt(cpCooldown?.value || '1', 10));
        }
        // Allow blanks -> disabled for per-stream/per-user
        const perStreamRaw = (cpPerStream?.value || '').toString().trim();
        const perUserRaw = (cpPerUser?.value || '').toString().trim();
        payload.perStreamLimit = perStreamRaw === '' ? 0 : Math.max(0, parseInt(perStreamRaw || '0', 10));
        payload.perUserPerStreamLimit = perUserRaw === '' ? 0 : Math.max(0, parseInt(perUserRaw || '0', 10));
        try {
            if (!isAuto) showToast('Saving Channel Points config…', 'info');
            const res = await fetch(`${API_BASE_URL}/api/rewards/tts`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${appSessionToken}`, 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify(payload)
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                showToast(data.error || 'Save failed', 'error');
                return;
            }
            if (isAuto) { maybeSuccessToast('Channel Points saved ✓'); } else { showToast('Channel Points saved ✓', 'success'); }
            if (cpStatusLine) {
                const rewardFromResponse = data.channelPoints?.rewardId || data.rewardId;
                const idPart = rewardFromResponse ? `Reward ID: ${rewardFromResponse}` : 'No reward created';
                cpStatusLine.textContent = `${idPart} · Last synced: ${new Date().toLocaleTimeString()}`;
            }
        } catch (e) {
            showToast('Save failed', 'error');
        }
    }

    // Rate-limited, debounced auto-save for Channel Points
    (function setupChannelPointsAutoSave() {
        const MIN_INTERVAL_MS = 1500;
        const DEBOUNCE_MS = 800;
        let lastSaveAt = 0;
        let timerId = null;
        function scheduleCpAutoSave() {
            if (isInitializing) return;
            if (timerId) clearTimeout(timerId);
            const now = Date.now();
            const wait = Math.max(DEBOUNCE_MS, MIN_INTERVAL_MS - (now - lastSaveAt));
            timerId = setTimeout(async () => {
                await saveChannelPointsConfig(true);
                lastSaveAt = Date.now();
            }, wait);
        }
        const bind = (el, events = ['input', 'change']) => {
            if (!el) return;
            events.forEach(evt => el.addEventListener(evt, scheduleCpAutoSave));
        };
        bind(cpEnabled, ['change']);
        bind(cpTitle);
        bind(cpCost);
        bind(cpPrompt);
        bind(cpSkipQueue, ['change']);
        bind(cpLimitsEnabled, ['change']);
        bind(cpCooldown);
        bind(cpPerStream);
        bind(cpPerUser);
        bind(cpMin);
        bind(cpMax);
        bind(cpBlockLinks, ['change']);
        bind(cpBannedWords);

        // UX normalization: entering 0 in limits clears the field (disables on Twitch)
        const normalizeZeroToBlank = (el) => {
            if (!el) return;
            el.addEventListener('change', () => {
                const v = (el.value || '').trim();
                if (v === '0') {
                    el.value = '';
                }
            });
        };
        normalizeZeroToBlank(cpPerStream);
        normalizeZeroToBlank(cpPerUser);

        // Cooldown: if limits are enabled, coerce 0 -> 1 on change for clarity
        if (cpCooldown) {
            cpCooldown.addEventListener('change', () => {
                const v = parseInt(cpCooldown.value || '0', 10);
                if (cpLimitsEnabled?.checked && v === 0) {
                    cpCooldown.value = '1';
                }
            });
        }
    })();

    async function testChannelPointsRedeem() {
        if (TEST_MODE) { const text = prompt('Enter a test message to simulate a redemption:'); if (text) showToast('Test validated ✓ (test mode)', 'success'); return; }
        if (!appSessionToken) { showToast('Authentication required', 'error'); return; }
        const text = prompt('Enter a test message to simulate a redemption:');
        if (!text) return;
        try {
            showToast('Testing redeem…', 'info');
            const res = await fetch(`${API_BASE_URL}/api/rewards/tts/test`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${appSessionToken}`, 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ text })
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                showToast(data.error || 'Test failed', 'error');
                return;
            }
            showToast(`Test validated ✓ (${data.status || 'ok'})`, 'success');
        } catch (e) {
            showToast('Test failed', 'error');
        }
    }

    async function deleteChannelPointsReward() {
        if (TEST_MODE) { if (cpEnabled) cpEnabled.checked = false; if (cpStatusLine) cpStatusLine.textContent = 'No reward created · Last synced: ' + new Date().toLocaleTimeString(); showToast('Disabled & deleted ✓ (test mode)', 'success'); return; }
        if (!appSessionToken) { showToast('Authentication required', 'error'); return; }
        if (!confirm('Disable & delete the Channel Points TTS reward?')) return;
        try {
            showToast('Deleting…', 'info');
            const res = await fetch(`${API_BASE_URL}/api/rewards/tts`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${appSessionToken}` },
                credentials: 'include'
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) { showToast(data.error || 'Delete failed', 'error'); return; }
            if (cpEnabled) cpEnabled.checked = false;
            if (cpStatusLine) cpStatusLine.textContent = 'No reward created · Last synced: ' + new Date().toLocaleTimeString();
            showToast('Disabled & deleted ✓', 'success');
        } catch (e) {
            showToast('Delete failed', 'error');
        }
    }

    if (cpSaveBtn) cpSaveBtn.addEventListener('click', saveChannelPointsConfig);
    if (cpTestBtn) cpTestBtn.addEventListener('click', testChannelPointsRedeem);
    if (cpDeleteBtn) cpDeleteBtn.addEventListener('click', deleteChannelPointsReward);

    function displayIgnoreList(type, users) {
        const listEl = document.getElementById(`${type}-ignore-list`);
        if (!listEl) return;
        listEl.innerHTML = '';
        users.forEach(username => {
            const li = document.createElement('li');
            li.className = 'list-group-item';
            li.innerHTML = `<span>${username}</span><button class="btn btn-outline-danger btn-sm" onclick="removeFromIgnoreList('${type}', '${username}')">Remove</button>`;
            listEl.appendChild(li);
        });
        if (users.length === 0) {
            const li = document.createElement('li');
            li.className = 'list-group-item';
            li.innerHTML = '<span class="text-muted fst-italic">No ignored users</span>';
            listEl.appendChild(li);
        }
    }

    async function addToIgnoreList(type) {
        const inputEl = document.getElementById(`${type}-ignore-username`);
        const username = inputEl?.value?.trim();
        if (!username) { showToast('Please enter a username', 'warning'); return; }
        if (TEST_MODE) {
            const listEl = document.getElementById(`${type}-ignore-list`);
            if (listEl) {
                const current = Array.from(listEl.querySelectorAll('li span')).map(s => s.textContent);
                current.push(username);
                displayIgnoreList(type, current);
            }
            inputEl.value = '';
            return;
        }
        if (!loggedInUser?.login) { showToast('Not logged in', 'error'); return; }
        try {
            const channelName = loggedInUser.login.toLowerCase();
            const headers = { 'Content-Type': 'application/json' };
            if (appSessionToken) headers['Authorization'] = `Bearer ${appSessionToken}`;
            const response = await fetch(`${BOT_API_BASE_URL}/${type}/ignore/channel/${channelName}`, {
                method: 'POST', headers, body: JSON.stringify({ username })
            });
            if (response.ok) {
                inputEl.value = '';
                loadBotSettings();
            } else {
                if (response.status === 500 || response.status === 404) {
                    showToast('Settings management is not available yet. The bot needs to be updated with the new REST API endpoints.', 'warning');
                } else {
                    const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
                    showToast(`Failed to add user: ${errorData.error}`, 'error');
                }
            }
        } catch (error) {
            console.error(`Failed to add user to ${type} ignore list:`, error);
            showToast('Failed to add user to ignore list', 'error');
        }
    }

    async function removeFromIgnoreList(type, username) {
        if (TEST_MODE) {
            const listEl = document.getElementById(`${type}-ignore-list`);
            if (listEl) {
                const remaining = Array.from(listEl.querySelectorAll('li span')).map(s => s.textContent).filter(u => u !== username);
                displayIgnoreList(type, remaining);
            }
            return;
        }
        if (!loggedInUser?.login) { showToast('Not logged in', 'error'); return; }
        try {
            const channelName = loggedInUser.login.toLowerCase();
            const headers = { 'Content-Type': 'application/json' };
            if (appSessionToken) headers['Authorization'] = `Bearer ${appSessionToken}`;
            const response = await fetch(`${BOT_API_BASE_URL}/${type}/ignore/channel/${channelName}`, {
                method: 'DELETE', headers, body: JSON.stringify({ username })
            });
            if (response.ok) {
                loadBotSettings();
            } else {
                if (response.status === 500 || response.status === 404) {
                    showToast('Settings management is not available yet. The bot needs to be updated with the new REST API endpoints.', 'warning');
                } else {
                    const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
                    showToast(`Failed to remove user: ${errorData.error}`, 'error');
                }
            }
        } catch (error) {
            console.error(`Failed to remove user from ${type} ignore list:`, error);
            showToast('Failed to remove user from ignore list', 'error');
        }
    }

    // Expose for inline onclick
    window.removeFromIgnoreList = removeFromIgnoreList;

    const addTtsIgnoreBtn = document.getElementById('add-tts-ignore-btn');
    const addMusicIgnoreBtn = document.getElementById('add-music-ignore-btn');
    if (addTtsIgnoreBtn) addTtsIgnoreBtn.addEventListener('click', () => addToIgnoreList('tts'));
    if (addMusicIgnoreBtn) addMusicIgnoreBtn.addEventListener('click', () => addToIgnoreList('music'));

    async function testVoice() {
        if (!voiceTestTextInput || !voiceTestBtn) {
            console.error('Voice test elements not found');
            return;
        }
        // Always ensure settings have finished loading to avoid UI race conditions
        try { await settingsInitializedPromise; } catch (_) {}
        const text = voiceTestTextInput.value.trim();
        if (!text) { showToast('Please enter some text to test', 'warning'); return; }
        if (text.length > 500) { showToast('Text must be 500 characters or less', 'error'); return; }
        if (TEST_MODE) { showToast('Playing preview… (test mode)', 'success'); return; }
        if (!appSessionToken) { showToast('Authentication required', 'error'); return; }
        voiceTestBtn.disabled = true;
        voiceTestBtn.textContent = 'Generating...';
        try {
            const effective = getEffectiveTtsSettings();
            const voiceSettings = {
                text: text,
                voiceId: effective.voiceId,
                emotion: effective.emotion,
                pitch: effective.pitch,
                speed: effective.speed,
                languageBoost: effective.languageBoost,
                englishNormalization: effective.englishNormalization
            };
            const response = await fetch(`${API_BASE_URL}/api/tts/test`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${appSessionToken}`, 'Content-Type': 'application/json' },
                body: JSON.stringify(voiceSettings)
            });
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({ message: response.statusText }));
                throw new Error(errorData.message || `Request failed with status ${response.status}`);
            }
            const contentType = response.headers.get('Content-Type') || '';
            if (contentType.startsWith('audio/')) {
                const blob = await response.blob();
                const url = URL.createObjectURL(blob);
                try {
                    const audio = new Audio(url);
                    audio.onerror = () => { showToast('Error playing audio sample', 'error'); };
                    await audio.play();
                } finally {
                    URL.revokeObjectURL(url);
                }
            } else {
                const data = await response.json();
                const candidateUrl = (
                    data.audioUrl ||
                    data.audio_url ||
                    data.url ||
                    data.audio ||
                    (Array.isArray(data.output) ? data.output[0] : (
                        data.output?.audio || data.output?.audio_url || data.output?.url || data.output
                    ))
                );
                if (candidateUrl && typeof candidateUrl === 'string') {
                    const audio = new Audio(candidateUrl);
                    audio.onerror = () => { showToast('Error playing audio sample', 'error'); };
                    await audio.play();
                } else if (data.audioUrl) {
                    const audio = new Audio(data.audioUrl);
                    audio.onerror = () => { showToast('Error playing audio sample', 'error'); };
                    await audio.play();
                } else if (data.audioBase64) {
                    const byteString = atob(data.audioBase64);
                    const arrayBuffer = new Uint8Array(byteString.length);
                    for (let i = 0; i < byteString.length; i++) arrayBuffer[i] = byteString.charCodeAt(i);
                    const blob = new Blob([arrayBuffer], { type: 'audio/mpeg' });
                    const url = URL.createObjectURL(blob);
                    try {
                        const audio = new Audio(url);
                        audio.onerror = () => { showToast('Error playing audio sample', 'error'); };
                        await audio.play();
                    } finally {
                        URL.revokeObjectURL(url);
                    }
                } else if (data.success) {
                    throw new Error('Server indicated success but did not return an audio URL');
                } else {
                    const msg = data.message || data.error || 'No audio returned by server';
                    throw new Error(msg);
                }
            }
        } catch (error) {
            console.error('Voice test error:', error);
            showToast(`Voice test failed: ${error.message}`, 'error');
        } finally {
            voiceTestBtn.disabled = false;
            voiceTestBtn.textContent = 'Send Preview';
        }
    }

    if (voiceTestBtn) voiceTestBtn.addEventListener('click', testVoice);

    async function initializeSettingsPanel() {
        await loadAvailableVoices();
        await loadBotSettings();
        isInitializing = false;
        settingsInitialized = true;
        try { settingsInitializedPromiseResolve && settingsInitializedPromiseResolve(); } catch (_) {}
        if (voiceTestBtn) voiceTestBtn.disabled = false;
    }

    initializeDashboard().then(() => {
        initializeSettingsPanel();
    });
});
