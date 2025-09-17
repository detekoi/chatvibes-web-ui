// Viewer Settings JavaScript (Bootstrap 5 refactor with toasts)
document.addEventListener('DOMContentLoaded', async () => {
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

    // Get URL parameters
    const urlParams = new URLSearchParams(window.location.search);
    const channel = urlParams.get('channel');
    const token = urlParams.get('token');

    // API Configuration
    const API_BASE_URL = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
        ? ''
        : 'https://us-central1-chatvibestts.cloudfunctions.net/webUi';
    let appSessionToken = null;
    let currentChannel = channel;

    // UI Elements
    const authStatus = document.getElementById('auth-status');
    const preferencesPanel = document.getElementById('preferences-panel');
    const channelInput = document.getElementById('channel-input');
    const channelHint = document.getElementById('channel-hint');
    const voiceSelect = document.getElementById('voice-select');
    const pitchSlider = document.getElementById('pitch-slider');
    const pitchOutput = document.getElementById('pitch-value');
    const speedSlider = document.getElementById('speed-slider');
    const speedOutput = document.getElementById('speed-value');
    const emotionSelect = document.getElementById('emotion-select');
    const languageSelect = document.getElementById('language-select');
    const previewText = document.getElementById('preview-text');
    const previewBtn = document.getElementById('preview-btn');
    const previewTextMobile = document.getElementById('preview-text-mobile');
    const previewBtnMobile = document.getElementById('preview-btn-mobile');
    const ignoreTtsCheckbox = document.getElementById('ignore-tts');
    const ignoreMusicCheckbox = document.getElementById('ignore-music');
    const confirmModal = document.getElementById('confirm-modal');
    const confirmText = document.getElementById('confirm-text');
    const confirmYes = document.getElementById('confirm-yes');
    const confirmNo = document.getElementById('confirm-no');
    const logoutLink = document.getElementById('logout-link');

    // Reset buttons
    const voiceReset = document.getElementById('voice-reset');
    const pitchReset = document.getElementById('pitch-reset');
    const speedReset = document.getElementById('speed-reset');
    const emotionReset = document.getElementById('emotion-reset');
    const languageReset = document.getElementById('language-reset');
    const englishNormalizationCheckbox = document.getElementById('english-normalization-checkbox');
    const englishNormalizationReset = document.getElementById('english-normalization-reset');

    // State
    let availableVoices = [];
    let currentPreferences = {};
    let isAuthenticated = false;
    let pendingAction = null;

    // Auth status helper using Bootstrap alerts
    function showAuthStatus(message, type = 'info') {
        if (!authStatus) return;
        authStatus.innerHTML = message;
        const klass = type === 'success' ? 'alert-success' : type === 'error' ? 'alert-danger' : 'alert-info';
        authStatus.className = `alert ${klass} text-center`;
    }

    // Debounce
    function debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => { clearTimeout(timeout); func(...args); };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }

    async function fetchWithAuth(url, options = {}) {
        if (TEST_MODE) {
            // Simulate minimal successful responses when needed
            return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        if (!appSessionToken) throw new Error('Not authenticated');
        const headers = {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${appSessionToken}`,
            ...options.headers
        };
        const response = await fetch(url, { ...options, headers });
        if (!response.ok) {
            if (response.status === 401) throw new Error('Authentication failed. Please log in again.');
            throw new Error(`API Error: ${response.status} ${response.statusText}`);
        }
        return response;
    }

    async function initializeAuth() {
        if (TEST_MODE) {
            isAuthenticated = true;
            appSessionToken = 'TEST_SESSION_TOKEN';
            if (preferencesPanel) preferencesPanel.style.display = 'block';
            if (authStatus) authStatus.style.display = 'none';
            if (channel && channelInput) {
                channelInput.value = channel;
                currentChannel = channel;
            }
            return true;
        }
        const urlParams = new URLSearchParams(window.location.search);
        const sessionTokenParam = urlParams.get('session_token');
        const validatedParam = urlParams.get('validated');
        const errorParam = urlParams.get('error');
        const messageParam = urlParams.get('message');

        if (errorParam) {
            let errorMessage = 'Authentication failed';
            if (errorParam === 'access_denied') {
                errorMessage = messageParam ? decodeURIComponent(messageParam) : 'Access denied: You can only access your own preferences';
            } else if (errorParam === 'oauth_failed') {
                errorMessage = 'Twitch OAuth authentication failed';
            } else if (errorParam === 'state_mismatch') {
                errorMessage = 'Security validation failed';
            } else if (errorParam === 'auth_failed') {
                errorMessage = messageParam ? decodeURIComponent(messageParam) : 'Authentication failed';
            }
            showAuthStatus(errorMessage, 'error');
            setTimeout(() => { window.location.href = '/'; }, 5000);
            return false;
        }

        if (sessionTokenParam && validatedParam) {
            try {
                appSessionToken = sessionTokenParam;
                localStorage.setItem('app_session_token', appSessionToken);
                const tokenParts = appSessionToken.split('.');
                if (tokenParts.length === 3) {
                    const payload = JSON.parse(atob(tokenParts[1]));
                    localStorage.setItem('twitch_user_login', payload.userLogin);
                    localStorage.setItem('token_user', payload.tokenUser);
                    localStorage.setItem('token_channel', payload.tokenChannel);
                }
                isAuthenticated = true;
                showAuthStatus('Authentication successful! Welcome to your preferences.', 'success');
                preferencesPanel.style.display = 'block';
                authStatus.style.display = 'none';
                if (channel) {
                    channelInput.value = channel;
                    currentChannel = channel;
                }
                const cleanUrl = new URL(window.location);
                cleanUrl.searchParams.delete('session_token');
                cleanUrl.searchParams.delete('validated');
                window.history.replaceState({}, '', cleanUrl);
                return true;
            } catch (error) {
                console.error('Failed to process validated session token:', error);
                showAuthStatus('Authentication failed. Please try again.', 'error');
                return false;
            }
        }

        if (token) {
            try {
                const response = await fetch(`${API_BASE_URL}/api/viewer/auth`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ token, channel })
                });
                if (response.ok) {
                    const data = await response.json();
                    if (data.requiresTwitchAuth) {
                        return await requireTwitchAuth();
                    }
                    appSessionToken = data.sessionToken;
                    localStorage.setItem('app_session_token', appSessionToken);
                    localStorage.setItem('twitch_user_login', data.user.login);
                    if (data.tokenUser && data.tokenChannel) {
                        localStorage.setItem('token_user', data.tokenUser);
                        localStorage.setItem('token_channel', data.tokenChannel);
                    }
                    isAuthenticated = true;
                    showAuthStatus(`Welcome, ${data.user.displayName || data.user.login}!`, 'success');
                    preferencesPanel.style.display = 'block';
                    authStatus.style.display = 'none';
                    if (channel) channelInput.value = channel;
                    return true;
                } else if (response.status === 403) {
                    const data = await response.json();
                    showAuthStatus(data.error || 'Access denied', 'error');
                    setTimeout(() => { window.location.href = '/'; }, 5000);
                    return false;
                } else {
                    throw new Error('Invalid or expired token');
                }
            } catch (error) {
                console.error('Token authentication failed:', error);
                return checkExistingSession();
            }
        } else {
            return checkExistingSession();
        }
    }

    async function requireTwitchAuth() {
        showAuthStatus('For security, please verify your Twitch identity to access these preferences.', 'info');
        const loginButton = document.createElement('button');
        loginButton.textContent = 'Verify with Twitch';
        loginButton.className = 'btn btn-primary mt-2';
        loginButton.onclick = async () => {
            try {
                showAuthStatus('Redirecting to Twitch for verification...', 'info');
                const response = await fetch(`${API_BASE_URL}/auth/twitch/viewer?token=${encodeURIComponent(token)}&channel=${encodeURIComponent(channel)}`);
                const data = await response.json();
                if (data.success && data.twitchAuthUrl) {
                    window.location.href = data.twitchAuthUrl;
                } else {
                    throw new Error('Failed to initiate Twitch authentication');
                }
            } catch (error) {
                console.error('Failed to initiate Twitch auth:', error);
                showAuthStatus('Failed to start Twitch authentication. Please try again.', 'error');
            }
        };
        authStatus.appendChild(loginButton);
        return false;
    }

    async function checkExistingSession() {
        appSessionToken = localStorage.getItem('app_session_token');
        const tokenUser = localStorage.getItem('token_user');
        const currentUser = localStorage.getItem('twitch_user_login');
        if (!appSessionToken) {
            showAuthStatus('Please log in with Twitch to access your preferences.', 'error');
            setTimeout(() => { window.location.href = '/'; }, 3000);
            return false;
        }
        if (tokenUser && currentUser && tokenUser !== currentUser) {
            showAuthStatus('Access denied: You can only access your own preferences.', 'error');
            localStorage.clear();
            setTimeout(() => { window.location.href = '/'; }, 3000);
            return false;
        }
        try {
            const response = await fetchWithAuth(`${API_BASE_URL}/api/auth/status`);
            const data = await response.json();
            if (data.isAuthenticated) {
                isAuthenticated = true;
                const userName = data.user?.displayName || data.user?.login || 'there';
                showAuthStatus(`Welcome ${userName}!`, 'success');
                preferencesPanel.style.display = 'block';
                authStatus.style.display = 'none';
                return true;
            } else {
                throw new Error('Not authenticated');
            }
        } catch (error) {
            console.error('Session check failed:', error);
            showAuthStatus('Authentication expired. Redirecting to login...', 'error');
            localStorage.removeItem('app_session_token');
            setTimeout(() => { window.location.href = '/'; }, 3000);
            return false;
        }
    }

    async function loadVoices() {
        const fallbackVoices = [
            'Friendly_Person', 'Professional_Woman', 'Casual_Male', 'Energetic_Youth',
            'Warm_Grandmother', 'Confident_Leader', 'Soothing_Narrator', 'Cheerful_Assistant',
            'Deep_Narrator', 'Bright_Assistant', 'Calm_Guide', 'Energetic_Host'
        ];
        if (TEST_MODE) {
            availableVoices = fallbackVoices;
            voiceSelect.innerHTML = '<option value="">Use channel default</option>';
            fallbackVoices.forEach(voice => {
                const option = document.createElement('option');
                option.value = voice;
                option.textContent = voice.replace(/_/g, ' ');
                voiceSelect.appendChild(option);
            });
            return;
        }
        try {
            const BOT_API_BASE_URL = 'https://chatvibes-tts-service-h7kj56ct4q-uc.a.run.app/api';
            const response = await fetch(`${BOT_API_BASE_URL}/voices`);
            let voices = fallbackVoices;
            if (response.ok) {
                const voicesData = await response.json();
                voices = voicesData.voices || fallbackVoices;
            }
            availableVoices = voices;
            voiceSelect.innerHTML = '<option value="">Use channel default</option>';
            voices.forEach(voice => {
                const option = document.createElement('option');
                option.value = voice;
                option.textContent = voice.replace(/_/g, ' ');
                voiceSelect.appendChild(option);
            });
        } catch (error) {
            console.error('Failed to load voices, using fallback:', error);
            availableVoices = fallbackVoices;
            voiceSelect.innerHTML = '<option value="">Use channel default</option>';
            fallbackVoices.forEach(voice => {
                const option = document.createElement('option');
                option.value = voice;
                option.textContent = voice.replace(/_/g, ' ');
                voiceSelect.appendChild(option);
            });
        }
    }

    async function loadPreferences() {
        if (!currentChannel) return;
        if (TEST_MODE) {
            const data = {
                channelExists: true,
                voiceId: '',
                pitch: 0,
                speed: 1,
                emotion: '',
                language: '',
                englishNormalization: false,
                ttsIgnored: false,
                musicIgnored: false,
                channelDefaults: { englishNormalization: false }
            };
            currentPreferences = data;
            voiceSelect.value = data.voiceId || '';
            pitchSlider.value = data.pitch !== undefined ? data.pitch : 0;
            pitchOutput.textContent = pitchSlider.value;
            speedSlider.value = data.speed !== undefined ? data.speed : 1;
            speedOutput.textContent = Number(speedSlider.value).toFixed(2);
            emotionSelect.value = data.emotion || '';
            languageSelect.value = data.language || '';
            englishNormalizationCheckbox.checked = data.englishNormalization;
            ignoreTtsCheckbox.checked = data.ttsIgnored || false;
            ignoreTtsCheckbox.disabled = data.ttsIgnored || false;
            ignoreMusicCheckbox.checked = data.musicIgnored || false;
            ignoreMusicCheckbox.disabled = data.musicIgnored || false;
            channelHint.textContent = 'Channel found ✓ (test mode)';
            channelHint.className = 'form-text text-success';
            return;
        }
        try {
            const response = await fetchWithAuth(`${API_BASE_URL}/api/viewer/preferences/${encodeURIComponent(currentChannel)}`);
            const data = await response.json();
            currentPreferences = data;
            voiceSelect.value = data.voiceId || '';
            pitchSlider.value = data.pitch !== undefined ? data.pitch : 0;
            pitchOutput.textContent = pitchSlider.value;
            speedSlider.value = data.speed !== undefined ? data.speed : 1;
            speedOutput.textContent = Number(speedSlider.value).toFixed(2);
            emotionSelect.value = data.emotion || '';
            languageSelect.value = data.language || '';
            if (data.englishNormalization !== undefined) {
                englishNormalizationCheckbox.checked = data.englishNormalization;
            } else {
                const chDefault = data.channelDefaults?.englishNormalization;
                englishNormalizationCheckbox.checked = (chDefault !== null && chDefault !== undefined) ? chDefault : false;
            }
            ignoreTtsCheckbox.checked = data.ttsIgnored || false;
            ignoreTtsCheckbox.disabled = data.ttsIgnored || false;
            ignoreMusicCheckbox.checked = data.musicIgnored || false;
            ignoreMusicCheckbox.disabled = data.musicIgnored || false;
            if (data.channelExists) {
                channelHint.textContent = 'Channel found ✓';
                channelHint.className = 'form-text text-success';
            } else {
                channelHint.textContent = 'ChatVibes is not enabled for this channel';
                channelHint.className = 'form-text text-danger';
            }
        } catch (error) {
            console.error('Failed to load preferences:', error);
            if (String(error.message || '').includes('404')) {
                channelHint.textContent = 'Channel not found or ChatVibes not enabled';
                channelHint.className = 'form-text text-danger';
            } else {
                showToast('Failed to load preferences', 'error');
            }
        }
    }

    async function savePreference(key, value) {
        if (!currentChannel) return;
        if (TEST_MODE) { showToast('Preference updated (test mode)', 'success'); return; }
        try {
            const body = { [key]: value };
            await fetchWithAuth(`${API_BASE_URL}/api/viewer/preferences/${encodeURIComponent(currentChannel)}`, {
                method: 'PUT', body: JSON.stringify(body)
            });
            // Subtle confirmation to avoid spam
            showToast('Preference updated', 'success');
        } catch (error) {
            console.error(`Failed to save ${key}:`, error);
            showToast(`Failed to save ${key}`, 'error');
        }
    }

    async function resetPreference(key, element, fallbackValue) {
        let defaultValue = fallbackValue;
        if (currentPreferences && currentPreferences.channelDefaults) {
            const channelDefault = currentPreferences.channelDefaults[key];
            if (channelDefault !== null && channelDefault !== undefined) {
                defaultValue = channelDefault;
            }
        }
        if (element.type === 'checkbox') {
            element.checked = defaultValue;
        } else {
            element.value = defaultValue;
        }
        if (element.type === 'range') {
            const output = document.getElementById(element.id.replace('-slider', '-value'));
            if (output) {
                output.textContent = element.id === 'speed-slider' ? Number(defaultValue).toFixed(2) : defaultValue;
            }
        }
        await savePreference(key, null);
    }

    async function testVoice() {
        if (!currentChannel) { showToast('Please select a channel first', 'error'); return; }
        // Get text from either preview textarea (they should be in sync)
        const text = (previewText?.value || previewTextMobile?.value || '').trim();
        if (!text) { showToast('Please enter some text to test', 'warning'); return; }
        
        // Disable both buttons
        if (previewBtn) {
            previewBtn.disabled = true;
            previewBtn.textContent = 'Generating...';
        }
        if (previewBtnMobile) {
            previewBtnMobile.disabled = true;
            previewBtnMobile.textContent = 'Generating...';
        }
        
        if (TEST_MODE) {
            await new Promise(r => setTimeout(r, 400));
            showToast('Test validated ✓ (test mode)', 'success');
            if (previewBtn) {
                previewBtn.disabled = false;
                previewBtn.textContent = 'Send Preview';
            }
            if (previewBtnMobile) {
                previewBtnMobile.disabled = false;
                previewBtnMobile.textContent = 'Send Preview';
            }
            return;
        }
        try {
            const response = await fetchWithAuth(`${API_BASE_URL}/api/tts/test`, {
                method: 'POST',
                body: JSON.stringify({
                    channel: currentChannel,
                    text: text,
                    voiceId: voiceSelect.value || null,
                    pitch: Number(pitchSlider.value) !== 0 ? Number(pitchSlider.value) : null,
                    speed: Math.abs(Number(speedSlider.value) - 1) > 0.01 ? Number(speedSlider.value) : null,
                    emotion: emotionSelect.value || null,
                    languageBoost: languageSelect.value || null
                })
            });
            const data = await response.json();
            if (data.audioUrl) {
                const audio = new Audio(data.audioUrl);
                audio.onerror = () => { showToast('Failed to play audio', 'error'); };
                await audio.play();
            } else {
                throw new Error(data.message || 'No audio URL received');
            }
        } catch (error) {
            console.error('Voice test failed:', error);
            showToast(`Test failed: ${error.message}`, 'error');
        } finally {
            if (previewBtn) {
                previewBtn.disabled = false;
                previewBtn.textContent = 'Send Preview';
            }
            if (previewBtnMobile) {
                previewBtnMobile.disabled = false;
                previewBtnMobile.textContent = 'Send Preview';
            }
        }
    }

    function handleIgnoreAction(type) {
        const checkbox = type === 'tts' ? ignoreTtsCheckbox : ignoreMusicCheckbox;
        if (!checkbox.checked) return;
        if (TEST_MODE) {
            checkbox.disabled = true;
            showToast(`You have been opted out of ${type.toUpperCase()} (test mode)`, 'success');
            return;
        } else {
            pendingAction = { type, checkbox };
            confirmText.textContent = `Are you absolutely sure you want to opt out of ${type.toUpperCase()} in this channel? Only a moderator can undo this action.`;
            if (confirmModal && confirmModal.showModal) confirmModal.showModal();
        }
    }

    async function confirmIgnoreAction() {
        if (!pendingAction || !currentChannel) return;
        const { type, checkbox } = pendingAction;
        try {
            if (TEST_MODE) {
                checkbox.disabled = true;
                showToast(`You have been opted out of ${type.toUpperCase()} (test mode)`, 'success');
                if (confirmModal && confirmModal.close) confirmModal.close();
                pendingAction = null;
                return;
            }
            await fetchWithAuth(`${API_BASE_URL}/api/viewer/ignore/${type}/${encodeURIComponent(currentChannel)}`, { method: 'POST' });
            checkbox.disabled = true;
            showToast(`You have been opted out of ${type.toUpperCase()}`, 'success');
        } catch (error) {
            console.error(`Failed to opt out of ${type}:`, error);
            checkbox.checked = false;
            showToast(`Failed to opt out of ${type.toUpperCase()}`, 'error');
        }
        if (confirmModal && confirmModal.close) confirmModal.close();
        pendingAction = null;
    }

    function cancelIgnoreAction() {
        if (pendingAction) {
            pendingAction.checkbox.checked = false;
            pendingAction = null;
        }
        if (confirmModal && confirmModal.close) confirmModal.close();
    }

    // Event Listeners
    channelInput.addEventListener('input', debounce((e) => {
        currentChannel = e.target.value.trim().toLowerCase();
        if (currentChannel) {
            loadPreferences();
        } else {
            channelHint.textContent = '';
            channelHint.className = 'form-text';
        }
    }, 600));

    voiceSelect.addEventListener('change', () => { savePreference('voiceId', voiceSelect.value || null); });
    pitchSlider.addEventListener('input', () => { pitchOutput.textContent = pitchSlider.value; });
    pitchSlider.addEventListener('change', () => { const v = Number(pitchSlider.value); savePreference('pitch', v !== 0 ? v : null); });
    speedSlider.addEventListener('input', () => { speedOutput.textContent = Number(speedSlider.value).toFixed(2); });
    speedSlider.addEventListener('change', () => { const v = Number(speedSlider.value); savePreference('speed', Math.abs(v - 1) > 0.01 ? v : null); });
    emotionSelect.addEventListener('change', () => { savePreference('emotion', emotionSelect.value || null); });
    languageSelect.addEventListener('change', () => { savePreference('language', languageSelect.value || null); });

    voiceReset.addEventListener('click', () => resetPreference('voiceId', voiceSelect, ''));
    pitchReset.addEventListener('click', () => resetPreference('pitch', pitchSlider, 0));
    speedReset.addEventListener('click', () => resetPreference('speed', speedSlider, 1));
    emotionReset.addEventListener('click', () => resetPreference('emotion', emotionSelect, ''));
    languageReset.addEventListener('click', () => resetPreference('language', languageSelect, ''));
    englishNormalizationCheckbox.addEventListener('change', () => { savePreference('englishNormalization', englishNormalizationCheckbox.checked || false); });
    englishNormalizationReset.addEventListener('click', () => { resetPreference('englishNormalization', englishNormalizationCheckbox, false); });

    previewBtn.addEventListener('click', testVoice);
    if (previewBtnMobile) {
        previewBtnMobile.addEventListener('click', testVoice);
    }

    // Sync textareas between desktop and mobile
    if (previewText && previewTextMobile) {
        previewText.addEventListener('input', () => {
            previewTextMobile.value = previewText.value;
        });
        previewTextMobile.addEventListener('input', () => {
            previewText.value = previewTextMobile.value;
        });
    }

    ignoreTtsCheckbox.addEventListener('change', () => { if (ignoreTtsCheckbox.checked) handleIgnoreAction('tts'); });
    ignoreMusicCheckbox.addEventListener('change', () => { if (ignoreMusicCheckbox.checked) handleIgnoreAction('music'); });

    confirmYes.addEventListener('click', confirmIgnoreAction);
    confirmNo.addEventListener('click', cancelIgnoreAction);

    if (logoutLink) {
        logoutLink.addEventListener('click', (e) => {
            e.preventDefault();
            localStorage.removeItem('twitch_user_login');
            localStorage.removeItem('twitch_user_id');
            localStorage.removeItem('app_session_token');
            localStorage.removeItem('token_user');
            localStorage.removeItem('token_channel');
            appSessionToken = null;
            if (TEST_MODE) {
                showToast('Logged out (test mode)', 'success');
            } else {
                window.location.href = 'index.html';
            }
        });
    }

    // Initialize the application
    const authenticated = await initializeAuth();
    if (authenticated) {
        await loadVoices();
        if (currentChannel) await loadPreferences();
    }
});
