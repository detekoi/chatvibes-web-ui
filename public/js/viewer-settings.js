// Viewer Settings JavaScript (Bootstrap 5 refactor with toasts)
document.addEventListener('DOMContentLoaded', async () => {
    // Test mode: enable with ?test=1 in the URL to bypass auth and API calls
    const TEST_MODE = new URLSearchParams(window.location.search).has('test');

    // Get URL parameters
    const urlParams = new URLSearchParams(window.location.search);
    const channel = urlParams.get('channel');
    const token = urlParams.get('token');

    // API Configuration
    const API_BASE_URL = getApiBaseUrl();
    let appSessionToken = null;
    let currentChannel = channel;

    // UI Elements
    const authStatus = document.getElementById('auth-status');
    const loggedInStatus = document.getElementById('logged-in-status');
    const loggedInUsername = document.getElementById('logged-in-username');
    const preferencesPanel = document.getElementById('preferences-panel');
    const channelContextCard = document.getElementById('channel-context-card');
    const addChannelContextCard = document.getElementById('add-channel-context-card');
    const channelContextNameEl = document.getElementById('channel-context-name');
    const channelHint = document.getElementById('channel-hint');
    const prefsDisabledNote = document.getElementById('prefs-disabled-note');
    const voiceSelect = document.getElementById('voice-select');
    const pitchSlider = document.getElementById('pitch-slider');
    const pitchOutput = document.getElementById('pitch-value');
    const speedSlider = document.getElementById('speed-slider');
    const speedOutput = document.getElementById('speed-value');
    const emotionSelect = document.getElementById('emotion-select');
    const languageSelect = document.getElementById('language-select');
    const hintVoice = document.getElementById('hint-voice');
    const hintPitch = document.getElementById('hint-pitch');
    const hintSpeed = document.getElementById('hint-speed');
    const hintEmotion = document.getElementById('hint-emotion');
    const hintLanguage = document.getElementById('hint-language');
    const hintEnglishNorm = document.getElementById('hint-englishNormalization');
    const previewText = document.getElementById('preview-text');
    const previewBtn = document.getElementById('preview-btn');
    const previewTextMobile = document.getElementById('preview-text-mobile');
    const previewBtnMobile = document.getElementById('preview-btn-mobile');

    // Sync the text areas
    syncTextareas(previewText, previewTextMobile);
    const ignoreTtsCheckbox = document.getElementById('ignore-tts');
    const ignoreMusicCheckbox = document.getElementById('ignore-music');
    const dangerZoneSection = document.getElementById('danger-zone-section');
    const dangerTtsToggle = document.getElementById('danger-tts-toggle');
    const dangerMusicToggle = document.getElementById('danger-music-toggle');
    const confirmModal = document.getElementById('confirm-modal');
    const confirmText = document.getElementById('confirm-text');
    const confirmYes = document.getElementById('confirm-yes');
    const confirmNo = document.getElementById('confirm-no');
    const channelInputModal = document.getElementById('channel-input-modal');
    const channelInputModalText = document.getElementById('channel-input-modal-text');
    const channelInputConfirm = document.getElementById('channel-input-confirm');
    const channelInputCancel = document.getElementById('channel-input-cancel');
    const openChannelContextModalBtn = document.getElementById('open-channel-context-modal-btn');
    const clearChannelContextBtn = document.getElementById('clear-channel-context-btn');
    const channelInputTitle = document.getElementById('channel-input-title');
    const channelInputDesc = document.getElementById('channel-input-desc');
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
    let pendingChannel = null;

    // Auth status helper using Bootstrap alerts
    function showAuthStatus(message, type = 'info') {
        if (!authStatus) return;
        // Only show if there's actually a message
        if (message) {
            authStatus.innerHTML = message;
            authStatus.style.display = 'block';
            const klass = type === 'success' ? 'alert-success' : type === 'error' ? 'alert-danger' : 'alert-info';
            authStatus.className = `alert ${klass} text-center`;
        } else {
            authStatus.innerHTML = '';
            authStatus.className = '';
            authStatus.style.display = 'none';
        }
    }



    function formatValueForHint(key, value) {
        if (value === '' || value === undefined || value === null) return value;
        if (key === 'speed') return formatNumberCompact(value);
        return value;
    }
    function describePreferenceHint(key) {
        const cd = (currentPreferences && currentPreferences.channelDefaults) ? currentPreferences.channelDefaults : {};
        const userVal = currentPreferences ? currentPreferences[key] : undefined;
        const defVal = cd[key];
        const hasUser = userVal !== null && userVal !== undefined && userVal !== '';
        const hasDef = defVal !== null && defVal !== undefined && defVal !== '';
        if (hasUser) return `Using your global preference: ${formatValueForHint(key, userVal)}`;
        if (hasDef) return `Using channel default: ${formatValueForHint(key, defVal)}`;
        return 'Using system default';
    }
    function updateSingleHint(key) {
        const map = {
            voiceId: hintVoice,
            pitch: hintPitch,
            speed: hintSpeed,
            emotion: hintEmotion,
            language: hintLanguage,
            englishNormalization: hintEnglishNorm
        };
        const el = map[key];
        if (!el || !currentChannel) return;

        const newHint = describePreferenceHint(key);
        el.textContent = newHint;
        el.style.display = '';
        // Force DOM update to happen immediately
        el.offsetHeight;
    }

    function updateHints(keys) {
        const map = {
            voiceId: hintVoice,
            pitch: hintPitch,
            speed: hintSpeed,
            emotion: hintEmotion,
            language: hintLanguage,
            englishNormalization: hintEnglishNorm
        };
        const toUpdate = Array.isArray(keys) ? keys : Object.keys(map);
        toUpdate.forEach(k => {
            const el = map[k];
            if (!el) return;
            if (currentChannel) {
                const newHint = describePreferenceHint(k);
                // Force DOM update to happen immediately
                el.textContent = newHint;
                el.style.display = '';
                // Trigger a reflow to ensure immediate visual update
                el.offsetHeight;
            } else {
                el.style.display = 'none';
            }
        });
    }


    async function initializeAuth() {
        if (TEST_MODE) {
            isAuthenticated = true;
            appSessionToken = 'TEST_SESSION_TOKEN';
            if (preferencesPanel) preferencesPanel.style.display = 'block';

            // Completely hide auth status
            if (authStatus) {
                authStatus.innerHTML = '';
                authStatus.className = '';
                authStatus.style.display = 'none';
            }

            if (loggedInUsername) loggedInUsername.textContent = 'Test User';
            if (loggedInStatus) loggedInStatus.style.display = 'block';
            if (channel && channelContextCard) {
                channelContextCard.classList.remove('d-none');
                if (channelContextNameEl) channelContextNameEl.textContent = channel;
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
                let userDisplayName = null;
                if (tokenParts.length === 3) {
                    const payload = JSON.parse(atob(tokenParts[1]));
                    localStorage.setItem('twitch_user_login', payload.userLogin);
                    localStorage.setItem('token_user', payload.tokenUser);
                    localStorage.setItem('token_channel', payload.tokenChannel);
                    userDisplayName = payload.displayName || payload.userLogin;
                }
                isAuthenticated = true;
                preferencesPanel.style.display = 'block';

                // Completely hide auth status
                if (authStatus) {
                    authStatus.innerHTML = '';
                    authStatus.className = '';
                    authStatus.style.display = 'none';
                }

                // Show logged in status
                if (loggedInUsername) loggedInUsername.textContent = userDisplayName || 'User';
                if (loggedInStatus) loggedInStatus.style.display = 'block';
                if (channel && channelContextCard) {
                    channelContextCard.classList.remove('d-none');
                    if (channelContextNameEl) channelContextNameEl.textContent = channel;
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
                    preferencesPanel.style.display = 'block';

                    // Completely hide auth status
                    if (authStatus) {
                        authStatus.innerHTML = '';
                        authStatus.style.display = 'none';
                    }

                    // Show logged in status
                    if (loggedInUsername) loggedInUsername.textContent = data.user.displayName || data.user.login;
                    if (loggedInStatus) loggedInStatus.style.display = 'block';
                    if (channel && channelContextCard) {
                        channelContextCard.classList.remove('d-none');
                        if (channelContextNameEl) channelContextNameEl.textContent = channel;
                    }
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
        // Show auth prompt with button
        authStatus.innerHTML = '';
        authStatus.style.display = 'block';

        showAuthStatus('Please verify your Twitch identity to access viewer preferences.', 'info');
        const loginButton = document.createElement('button');
        loginButton.textContent = 'Sign in with Twitch';
        loginButton.className = 'btn btn-primary mt-2';
        loginButton.onclick = async () => {
            try {
                showAuthStatus('Redirecting to Twitch for authentication...', 'info');

                // For viewer auth, always use viewer endpoint
                const authUrl = token && channel
                    ? `${API_BASE_URL}/auth/twitch/viewer?token=${encodeURIComponent(token)}&channel=${encodeURIComponent(channel)}`
                    : `${API_BASE_URL}/auth/twitch/viewer`;

                const response = await fetch(authUrl);
                const data = await response.json();

                if (data.success && data.twitchAuthUrl && data.state) {
                    // Store the OAuth state for CSRF protection
                    sessionStorage.setItem('oauth_csrf_state', data.state);
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

        console.log('checkExistingSession: appSessionToken from localStorage:', appSessionToken ? 'Present (length: ' + appSessionToken.length + ')' : 'Missing');
        console.log('checkExistingSession: tokenUser:', tokenUser);
        console.log('checkExistingSession: currentUser:', currentUser);

        if (!appSessionToken) {
            // No token found, show authentication prompt instead of redirecting
            return requireTwitchAuth();
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
            console.log('Auth status response:', data);
            console.log('data.success:', data.success);
            console.log('data.user:', data.user);
            console.log('Condition check: data.success && data.user =', Boolean(data.success && data.user));
            if (data.success === true && data.user) {
                isAuthenticated = true;
                preferencesPanel.style.display = 'block';

                // Completely hide auth status
                if (authStatus) {
                    authStatus.innerHTML = '';
                    authStatus.className = '';
                    authStatus.style.display = 'none';
                }

                // Show logged in status
                if (loggedInUsername) loggedInUsername.textContent = data.user.displayName || data.user.userLogin || data.user.login;
                if (loggedInStatus) loggedInStatus.style.display = 'block';

                return true;
            } else {
                console.error('Auth validation failed - data.success:', data.success, 'data.user:', data.user);
                throw new Error('Not authenticated');
            }
        } catch (error) {
            console.error('Session check failed:', error);
            // Clear invalid token and show auth prompt
            localStorage.removeItem('app_session_token');
            return requireTwitchAuth();
        }
    }

    let currentlyPlayingAudio = null;
    let currentlyPlayingVoiceId = null;
    let allVoices = [];

    async function loadVoices() {
        const fallbackVoices = [
            'Friendly_Person', 'Professional_Woman', 'Casual_Male', 'Energetic_Youth',
            'Warm_Grandmother', 'Confident_Leader', 'Soothing_Narrator', 'Cheerful_Assistant',
            'Deep_Narrator', 'Bright_Assistant', 'Calm_Guide', 'Energetic_Host'
        ];

        let voices = fallbackVoices;

        if (!TEST_MODE) {
            try {
                const BOT_API_BASE_URL = 'https://chatvibes-tts-service-h7kj56ct4q-uc.a.run.app/api';
                const response = await fetch(`${BOT_API_BASE_URL}/voices`);
                if (response.ok) {
                    const voicesData = await response.json();
                    voices = voicesData.voices || fallbackVoices;
                }
            } catch (error) {
                console.error('Failed to load voices, using fallback:', error);
            }
        }

        availableVoices = voices;
        allVoices = voices;

        const searchInput = document.getElementById('voice-search');
        const hiddenInput = document.getElementById('voice-select');
        const dropdown = document.getElementById('voice-dropdown');
        const menu = document.getElementById('voice-menu');
        const list = menu.querySelector('.voice-dropdown-list');

        if (!searchInput || !hiddenInput || !menu || !list) {
            console.error('Custom dropdown elements not found');
            return;
        }

        // Set initial value to empty (use channel default)
        hiddenInput.value = '';
        searchInput.value = 'Use channel default';

        // Render all voices initially (including channel default option)
        renderVoiceList(voices, list);

        // Toggle dropdown on click
        searchInput.addEventListener('click', (e) => {
            e.stopPropagation();
            const isOpen = menu.classList.contains('show');
            if (isOpen) {
                closeDropdown();
            } else {
                openDropdown();
            }
        });

        // Filter voices on input
        searchInput.addEventListener('input', () => {
            const query = searchInput.value.toLowerCase();
            if (query === '' || query === 'use channel default') {
                renderVoiceList(voices, list);
                return;
            }
            const filtered = voices.filter(voice =>
                formatVoiceName(voice).toLowerCase().includes(query)
            );
            renderVoiceList(filtered, list, false); // Don't show channel default when filtering
        });

        // Close dropdown when clicking outside
        document.addEventListener('click', (e) => {
            if (!dropdown.contains(e.target)) {
                closeDropdown();
            }
        });

        function openDropdown() {
            menu.classList.add('show');
            searchInput.removeAttribute('readonly');
            searchInput.focus();
            searchInput.select();
        }

        function closeDropdown() {
            menu.classList.remove('show');
            searchInput.setAttribute('readonly', 'readonly');
            // Restore selected value if search was cleared
            const currentValue = hiddenInput.value;
            searchInput.value = currentValue ? formatVoiceName(currentValue) : 'Use channel default';
        }

        function renderVoiceList(voicesToRender, container, showChannelDefault = true) {
            container.innerHTML = '';

            // Add "Use channel default" option at the top
            if (showChannelDefault) {
                const defaultItem = document.createElement('div');
                defaultItem.className = 'voice-dropdown-item';

                const defaultLabel = document.createElement('span');
                defaultLabel.className = 'voice-label';
                defaultLabel.textContent = 'Use channel default';
                defaultLabel.addEventListener('click', () => {
                    selectVoice('');
                });

                defaultItem.appendChild(defaultLabel);
                container.appendChild(defaultItem);
            }

            if (voicesToRender.length === 0) {
                container.innerHTML += '<div class="voice-dropdown-item no-results">No voices found</div>';
                return;
            }

            voicesToRender.forEach(voice => {
                const item = document.createElement('div');
                item.className = 'voice-dropdown-item';
                item.setAttribute('data-voice-id', voice);

                const label = document.createElement('span');
                label.className = 'voice-label';
                label.textContent = formatVoiceName(voice);

                // Click label to select voice
                label.addEventListener('click', () => {
                    selectVoice(voice);
                });

                const playBtn = document.createElement('button');
                playBtn.type = 'button';
                playBtn.className = 'voice-play-btn';
                playBtn.setAttribute('data-voice-id', voice);
                playBtn.setAttribute('aria-label', `Preview ${voice}`);

                // Check if this voice is currently playing
                if (voice === currentlyPlayingVoiceId) {
                    playBtn.innerHTML = `
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z"/>
                        </svg>
                    `;
                    playBtn.classList.add('playing');
                } else {
                    playBtn.innerHTML = `
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M8 5v14l11-7z"/>
                        </svg>
                    `;
                }

                // Click play button to preview
                playBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    playVoicePreview(voice, playBtn);
                });

                item.appendChild(label);
                item.appendChild(playBtn);
                container.appendChild(item);
            });
        }

        function selectVoice(voiceId) {
            hiddenInput.value = voiceId;
            searchInput.value = voiceId ? formatVoiceName(voiceId) : 'Use channel default';
            closeDropdown();
            // Trigger change event for save handler
            hiddenInput.dispatchEvent(new Event('change', { bubbles: true }));
        }

    }

    async function playVoicePreview(voiceId, buttonElement) {
        // If already playing this voice, stop it
        if (currentlyPlayingVoiceId === voiceId && currentlyPlayingAudio) {
            currentlyPlayingAudio.pause();
            currentlyPlayingAudio = null;
            currentlyPlayingVoiceId = null;
            updatePlayButton(buttonElement, false);
            return;
        }

        // Stop any currently playing audio
        if (currentlyPlayingAudio) {
            currentlyPlayingAudio.pause();
            const oldBtn = document.querySelector(`.voice-play-btn[data-voice-id="${currentlyPlayingVoiceId}"]`);
            if (oldBtn) updatePlayButton(oldBtn, false);
        }

        // Try to load the pre-made recording
        const preMadeUrl = `/assets/voices/${voiceId}-chat-is-this-real.mp3`;

        try {
            const response = await fetch(preMadeUrl);
            if (!response.ok) {
                console.log('No pre-made recording for', voiceId);
                return;
            }

            const blob = await response.blob();
            const audioUrl = URL.createObjectURL(blob);

            currentlyPlayingAudio = new Audio(audioUrl);
            currentlyPlayingVoiceId = voiceId;
            updatePlayButton(buttonElement, true);

            currentlyPlayingAudio.onended = () => {
                URL.revokeObjectURL(audioUrl);
                currentlyPlayingAudio = null;
                currentlyPlayingVoiceId = null;
                updatePlayButton(buttonElement, false);
            };

            currentlyPlayingAudio.onerror = () => {
                URL.revokeObjectURL(audioUrl);
                currentlyPlayingAudio = null;
                currentlyPlayingVoiceId = null;
                updatePlayButton(buttonElement, false);
            };

            await currentlyPlayingAudio.play();
        } catch (error) {
            console.error('Error playing voice preview:', error);
            currentlyPlayingAudio = null;
            currentlyPlayingVoiceId = null;
            updatePlayButton(buttonElement, false);
        }
    }

    function updatePlayButton(buttonElement, isPlaying) {
        if (!buttonElement) return;

        if (isPlaying) {
            buttonElement.innerHTML = `
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z"/>
                </svg>
            `;
            buttonElement.classList.add('playing');
        } else {
            buttonElement.innerHTML = `
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M8 5v14l11-7z"/>
                </svg>
            `;
            buttonElement.classList.remove('playing');
        }
    }

    async function loadPreferences() {
        if (TEST_MODE) {
            const data = {
                voiceId: '',
                pitch: 0,
                speed: 1,
                emotion: '',
                language: '',
                englishNormalization: false
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
            if (currentChannel) {
                if (channelContextCard) channelContextCard.classList.remove('d-none');
                if (channelContextNameEl) channelContextNameEl.textContent = currentChannel;
                if (dangerZoneSection) dangerZoneSection.classList.remove('d-none');
                if (dangerTtsToggle) dangerTtsToggle.style.display = '';
                if (dangerMusicToggle) dangerMusicToggle.style.display = '';
                if (channelHint) { channelHint.textContent = 'Channel found ✓ (test mode)'; channelHint.className = 'form-text text-success'; }
            } else {
                if (dangerZoneSection) dangerZoneSection.classList.add('d-none');
            }
            return;
        }
        try {
            let response;
            if (currentChannel) {
                response = await fetchWithAuth(`${API_BASE_URL}/api/viewer/preferences/${encodeURIComponent(currentChannel)}`);
            } else {
                response = await fetchWithAuth(`${API_BASE_URL}/api/viewer/preferences`);
            }
            const data = await response.json();
            currentPreferences = data;
            const cd = data.channelDefaults || {};
            const allowViewerPrefs = cd.allowViewerPreferences !== false; // default to true unless explicitly false

            voiceSelect.value = data.voiceId || '';
            // Show user preference if set, otherwise show what the user will actually hear (channel default or system default)
            pitchSlider.value = (data.pitch !== undefined && data.pitch !== null) ? data.pitch : (cd.pitch !== undefined && cd.pitch !== null) ? cd.pitch : 0;
            pitchOutput.textContent = pitchSlider.value;
            speedSlider.value = (data.speed !== undefined && data.speed !== null) ? data.speed : (cd.speed !== undefined && cd.speed !== null) ? cd.speed : 1;
            speedOutput.textContent = Number(speedSlider.value).toFixed(2);
            emotionSelect.value = data.emotion || '';
            languageSelect.value = data.language || '';
            if (data.englishNormalization !== undefined) {
                englishNormalizationCheckbox.checked = data.englishNormalization;
            }
            // Dynamic default labels and hints
            if (voiceSelect && voiceSelect.options && voiceSelect.options.length) {
                voiceSelect.options[0].textContent = cd.voiceId ? `Use channel default (${cd.voiceId})` : 'Use channel default';
            }
            if (emotionSelect && emotionSelect.options && emotionSelect.options.length) {
                emotionSelect.options[0].textContent = cd.emotion ? `Use channel default (${cd.emotion})` : 'Use channel default';
            }
            if (languageSelect && languageSelect.options && languageSelect.options.length) {
                languageSelect.options[0].textContent = cd.language ? `Use channel default (${cd.language})` : 'Use channel default';
            }
            updateHints();
            // Handle channel policy: if viewer prefs disabled, show note and disable inputs
            if (currentChannel) {
                if (!allowViewerPrefs) {
                    if (prefsDisabledNote) prefsDisabledNote.classList.remove('d-none');
                    // Disable preference inputs (but still allow viewing channel defaults)
                    if (voiceSelect) voiceSelect.disabled = true;
                    if (pitchSlider) pitchSlider.disabled = true;
                    if (speedSlider) speedSlider.disabled = true;
                    if (emotionSelect) emotionSelect.disabled = true;
                    if (languageSelect) languageSelect.disabled = true;
                    if (englishNormalizationCheckbox) englishNormalizationCheckbox.disabled = true;
                    // Disable reset buttons
                    if (voiceReset) voiceReset.disabled = true;
                    if (pitchReset) pitchReset.disabled = true;
                    if (speedReset) speedReset.disabled = true;
                    if (emotionReset) emotionReset.disabled = true;
                    if (languageReset) languageReset.disabled = true;
                } else {
                    if (prefsDisabledNote) prefsDisabledNote.classList.add('d-none');
                    if (voiceSelect) voiceSelect.disabled = false;
                    if (pitchSlider) pitchSlider.disabled = false;
                    if (speedSlider) speedSlider.disabled = false;
                    if (emotionSelect) emotionSelect.disabled = false;
                    if (languageSelect) languageSelect.disabled = false;
                    if (englishNormalizationCheckbox) englishNormalizationCheckbox.disabled = false;
                    if (voiceReset) voiceReset.disabled = false;
                    if (pitchReset) pitchReset.disabled = false;
                    if (speedReset) speedReset.disabled = false;
                    if (emotionReset) emotionReset.disabled = false;
                    if (languageReset) languageReset.disabled = false;
                }
            }
            // Danger zone visibility
            if (currentChannel) {
                if (channelContextCard) channelContextCard.classList.remove('d-none');
                if (channelContextNameEl) channelContextNameEl.textContent = currentChannel;
                if (dangerZoneSection) dangerZoneSection.classList.remove('d-none');
                if (dangerTtsToggle) dangerTtsToggle.style.display = '';
                if (dangerMusicToggle) dangerMusicToggle.style.display = '';
                if (channelHint) { channelHint.textContent = 'Channel found ✓'; channelHint.className = 'form-text text-success'; }
            } else {
                if (dangerZoneSection) dangerZoneSection.classList.add('d-none');
            }
        } catch (error) {
            console.error('Failed to load preferences:', error);
            showToast('Failed to load preferences', 'error');
        }
    }

    async function savePreference(key, value) {
        // Optimistically update local state and hints so UI reflects the change immediately
        const previous = currentPreferences ? currentPreferences[key] : undefined;
        if (currentPreferences) {
            currentPreferences[key] = value;
            // Update the specific hint immediately with the new value
            updateSingleHint(key);
        }

        if (TEST_MODE) { showToast('Preference updated (test mode)', 'success'); return; }
        try {
            const body = { [key]: value };
            const url = currentChannel
                ? `${API_BASE_URL}/api/viewer/preferences/${encodeURIComponent(currentChannel)}`
                : `${API_BASE_URL}/api/viewer/preferences`;
            await fetchWithAuth(url, {
                method: 'PUT', body: JSON.stringify(body)
            });
            // Subtle confirmation to avoid spam
            showToast('Preference updated', 'success');
        } catch (error) {
            // Revert optimistic update on failure
            if (currentPreferences) {
                currentPreferences[key] = previous;
                updateSingleHint(key);
            }
            console.error(`Failed to save ${key}:`, error);
            showToast(`Failed to save ${key}: ${error.message}`, 'error');
        }
    }

    async function resetPreference(key, element, fallbackValue) {
        // Clear override: set UI to default, but save null so backend uses defaults
        const cd = (currentPreferences && currentPreferences.channelDefaults) ? currentPreferences.channelDefaults : {};
        const defaultValue = (cd[key] !== undefined && cd[key] !== null) ? cd[key] : fallbackValue;
        if (element.type === 'checkbox') {
            element.checked = Boolean(defaultValue);
        } else {
            element.value = (defaultValue === undefined || defaultValue === null) ? '' : defaultValue;
        }
        if (element.type === 'range') {
            const output = document.getElementById(element.id.replace('-slider', '-value'));
            if (output) {
                const outVal = element.id === 'speed-slider' ? Number(defaultValue ?? 1).toFixed(2) : (defaultValue ?? 0);
                output.textContent = outVal;
            }
        }
        await savePreference(key, null);
    }

    // Voice preview audio caching
    let cachedAudioUrl = null;
    let cachedSettings = null;
    let isDirty = false;

    function clearAudioCache() {
        if (cachedAudioUrl) {
            URL.revokeObjectURL(cachedAudioUrl);
            cachedAudioUrl = null;
        }
        cachedSettings = null;
        const playerEl = document.getElementById('voice-preview-player');
        const playerElMobile = document.getElementById('voice-preview-player-mobile');
        if (playerEl) playerEl.style.display = 'none';
        if (playerElMobile) playerElMobile.style.display = 'none';
        if (previewBtn) previewBtn.textContent = 'Send Preview';
        if (previewBtnMobile) previewBtnMobile.textContent = 'Send Preview';
        isDirty = false;
    }

    function markSettingsAsDirty() {
        isDirty = true;
        const hint = document.getElementById('voice-preview-hint');
        const hintMobile = document.getElementById('voice-preview-hint-mobile');
        if (hint && cachedAudioUrl) hint.style.display = 'block';
        if (hintMobile && cachedAudioUrl) hintMobile.style.display = 'block';
    }

    async function tryLoadPreMadeRecording(settings, text) {
        // Check if this is eligible for pre-made recording
        const isDefaultText = text.trim().toLowerCase() === 'chat is this real?';
        const cd = (currentPreferences && currentPreferences.channelDefaults) ? currentPreferences.channelDefaults : {};

        // Get effective settings (user override or channel default)
        const effectiveVoiceId = settings.voiceId || cd.voiceId || 'Friendly_Person';
        const effectivePitch = (settings.pitch !== undefined && settings.pitch !== null) ? settings.pitch : (cd.pitch !== undefined && cd.pitch !== null) ? cd.pitch : 0;
        const effectiveSpeed = (settings.speed !== undefined && settings.speed !== null) ? settings.speed : (cd.speed !== undefined && cd.speed !== null) ? cd.speed : 1.0;
        const effectiveEmotion = settings.emotion || cd.emotion || '';
        const effectiveLanguage = settings.languageBoost || cd.language || '';

        const isDefaultSettings = (
            effectivePitch === 0 &&
            effectiveSpeed === 1.0 &&
            (!effectiveEmotion || effectiveEmotion === 'neutral') &&
            (!effectiveLanguage || effectiveLanguage === 'auto' || effectiveLanguage === 'Automatic')
        );

        if (!isDefaultText || !isDefaultSettings) {
            return null; // Not eligible for pre-made recording
        }

        const preMadeUrl = `/assets/voices/${effectiveVoiceId}-chat-is-this-real.mp3`;

        try {
            const response = await fetch(preMadeUrl);
            if (response.ok) {
                const blob = await response.blob();
                return URL.createObjectURL(blob);
            }
        } catch (error) {
            console.log('No pre-made recording available for', effectiveVoiceId);
        }

        return null;
    }

    async function testVoice() {
        const text = (previewText?.value || previewTextMobile?.value || '').trim();
        if (!text) {
            showToast('Please enter some text to test', 'warning');
            return;
        }

        if (TEST_MODE) {
            showToast('Test validated ✓ (test mode)', 'success');
            return;
        }

        const pitchHasOverride = currentPreferences?.pitch !== undefined && currentPreferences?.pitch !== null;
        const speedHasOverride = currentPreferences?.speed !== undefined && currentPreferences?.speed !== null;

        const payload = {
            channel: currentChannel,
            text: text,
            voiceId: voiceSelect.value || null,
            pitch: pitchHasOverride ? Number(pitchSlider.value) : null,
            speed: speedHasOverride ? Number(speedSlider.value) : null,
            emotion: emotionSelect.value || null,
            languageBoost: languageSelect.value || null
        };
        
        // Use the shared function from app.js
        await performVoiceTest(payload, [previewBtn, previewBtnMobile]);
    }

    // Settings change listeners to mark preview as dirty
    voiceSelect.addEventListener('change', markSettingsAsDirty);
    pitchSlider.addEventListener('change', markSettingsAsDirty);
    speedSlider.addEventListener('change', markSettingsAsDirty);
    emotionSelect.addEventListener('change', markSettingsAsDirty);
    languageSelect.addEventListener('change', markSettingsAsDirty);
    englishNormalizationCheckbox.addEventListener('change', markSettingsAsDirty);

    // Cleanup cached audio on page unload
    window.addEventListener('beforeunload', () => {
        if (cachedAudioUrl) URL.revokeObjectURL(cachedAudioUrl);
    });

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
            openDialog(confirmModal);
        }
    }

    async function confirmIgnoreAction() {
        if (!pendingAction) return;
        const { type, checkbox } = pendingAction;
        try {
            if (TEST_MODE) {
                checkbox.disabled = true;
                showToast(`You have been opted out of ${type.toUpperCase()} (test mode)`, 'success');
                closeDialog(confirmModal);
                pendingAction = null;
                return;
            }
            const targetChannel = currentChannel || pendingChannel;
            if (!targetChannel) { showToast('Please specify a channel', 'error'); return; }
            await fetchWithAuth(`${API_BASE_URL}/api/viewer/ignore/${type}/${encodeURIComponent(targetChannel)}`, { method: 'POST' });
            checkbox.disabled = true;
            showToast(`You have been opted out of ${type.toUpperCase()}`, 'success');
        } catch (error) {
            console.error(`Failed to opt out of ${type}:`, error);
            checkbox.checked = false;
            showToast(`Failed to opt out of ${type.toUpperCase()}`, 'error');
        }
        closeDialog(confirmModal);
        pendingAction = null;
        pendingChannel = null;
    }

    function cancelIgnoreAction() {
        if (pendingAction) {
            pendingAction.checkbox.checked = false;
            pendingAction = null;
        }
        if (confirmModal && confirmModal.close) confirmModal.close();
    }

    // Event Listeners

    voiceSelect.addEventListener('change', () => { savePreference('voiceId', voiceSelect.value || null); });
    pitchSlider.addEventListener('input', () => { pitchOutput.textContent = pitchSlider.value; });
    pitchSlider.addEventListener('change', () => {
        const v = Number(pitchSlider.value);
        // Always persist explicit 0 as a user override (do not clear)
        savePreference('pitch', v);
    });
    speedSlider.addEventListener('input', () => { speedOutput.textContent = Number(speedSlider.value).toFixed(2); });
    speedSlider.addEventListener('change', () => {
        const v = Number(speedSlider.value);
        // Always persist explicit 1.0 as a user override (do not clear)
        savePreference('speed', v);
    });
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


    if (ignoreTtsCheckbox) ignoreTtsCheckbox.addEventListener('change', () => { if (ignoreTtsCheckbox.checked) handleIgnoreAction('tts'); });
    if (ignoreMusicCheckbox) ignoreMusicCheckbox.addEventListener('change', () => { if (ignoreMusicCheckbox.checked) handleIgnoreAction('music'); });
    // Removed standalone danger buttons; toggles only when channel context is present
    if (openChannelContextModalBtn) openChannelContextModalBtn.addEventListener('click', () => {
        // Always show the channel input modal (even in test mode) so you can preview it
        pendingAction = null; // clear any danger flow
        channelInputModalText.value = '';
        if (channelInputTitle) channelInputTitle.textContent = 'Load Channel Context';
        if (channelInputDesc) channelInputDesc.textContent = 'Enter the channel name to view its defaults and manage opt-outs:';
        const confirmBtn = document.getElementById('channel-input-confirm');
        if (confirmBtn) {
            confirmBtn.textContent = 'Load';
            confirmBtn.classList.remove('btn-danger');
            confirmBtn.classList.add('btn-primary');
        }
        openDialog(channelInputModal);
    });
    if (channelInputConfirm) channelInputConfirm.addEventListener('click', () => {
        const entered = (channelInputModalText.value || '').trim().toLowerCase();
        if (!entered) { showToast('Please enter a channel name', 'warning'); return; }
        if (TEST_MODE) {
        if (pendingAction && pendingAction.type === 'tts') {
                pendingChannel = entered;
                closeDialog(channelInputModal);
            confirmText.textContent = `Are you absolutely sure you want to opt out of TTS in #${entered}? Only a moderator can undo this action.`;
                openDialog(confirmModal);
            } else if (pendingAction && pendingAction.type === 'music') {
                pendingChannel = entered;
                closeDialog(channelInputModal);
                confirmText.textContent = `Are you absolutely sure you want to opt out of MUSIC in #${entered}? Only a moderator can undo this action.`;
                openDialog(confirmModal);
            } else {
                // Load channel context only
                currentChannel = entered;
                closeDialog(channelInputModal);
                if (channelContextCard) channelContextCard.classList.remove('d-none');
                if (channelContextNameEl) channelContextNameEl.textContent = currentChannel;
                if (dangerTtsToggle) dangerTtsToggle.style.display = '';
                if (dangerMusicToggle) dangerMusicToggle.style.display = '';
            if (dangerZoneSection) dangerZoneSection.classList.remove('d-none');
                if (channelHint) { 
                    channelHint.textContent = 'Channel found ✓ (test mode)'; 
                    channelHint.className = 'form-text text-success'; 
                }
                showToast('Channel context loaded (test mode)', 'success');
            }
            return;
        }
        if (pendingAction && pendingAction.type === 'tts') {
            pendingChannel = entered;
            closeDialog(channelInputModal);
            confirmText.textContent = `Are you absolutely sure you want to opt out of TTS in #${entered}? Only a moderator can undo this action.`;
            openDialog(confirmModal);
        } else {
            // Load channel context only
            currentChannel = entered;
            closeDialog(channelInputModal);
            if (channelContextCard) channelContextCard.classList.remove('d-none');
            if (channelContextNameEl) channelContextNameEl.textContent = currentChannel;
            loadPreferences();
        }
    });
    if (channelInputCancel) channelInputCancel.addEventListener('click', () => {
        if (TEST_MODE) {
            pendingAction = null; 
            pendingChannel = null; 
            closeDialog(channelInputModal);
            showToast('Modal cancelled (test mode)', 'info');
            return;
        }
        pendingAction = null; pendingChannel = null; closeDialog(channelInputModal);
    });
    if (clearChannelContextBtn) clearChannelContextBtn.addEventListener('click', () => {
        if (TEST_MODE) {
            currentChannel = null;
            if (channelContextCard) channelContextCard.classList.add('d-none');
            if (dangerTtsToggle) dangerTtsToggle.style.display = 'none';
            if (dangerMusicToggle) dangerMusicToggle.style.display = 'none';
            if (dangerTtsButton) dangerTtsButton.style.display = '';
            if (dangerMusicButton) dangerMusicButton.style.display = '';
            showToast('Channel context cleared (test mode)', 'success');
            return;
        }
        currentChannel = null;
        if (channelContextCard) channelContextCard.classList.add('d-none');
        if (dangerZoneSection) dangerZoneSection.classList.add('d-none');
        loadPreferences();
    });

    confirmYes.addEventListener('click', confirmIgnoreAction);
    confirmNo.addEventListener('click', cancelIgnoreAction);

    if (logoutLink) {
        logoutLink.addEventListener('click', (e) => {
            e.preventDefault();
            logout();
        });
    }

    // Initialize the application
    const authenticated = await initializeAuth();
    if (authenticated) {
        await loadVoices();
        await loadPreferences();
    }
});
