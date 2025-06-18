// Viewer Settings JavaScript
document.addEventListener('DOMContentLoaded', async () => {
    // Get URL parameters
    const urlParams = new URLSearchParams(window.location.search);
    const channel = urlParams.get('channel');
    const token = urlParams.get('token');
    
    // API Configuration
    const API_BASE_URL = 'https://us-central1-chatvibestts.cloudfunctions.net/webUi';
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
    const previewStatus = document.getElementById('preview-status');
    const ignoreTtsCheckbox = document.getElementById('ignore-tts');
    const ignoreMusicCheckbox = document.getElementById('ignore-music');
    const confirmModal = document.getElementById('confirm-modal');
    const confirmText = document.getElementById('confirm-text');
    const confirmYes = document.getElementById('confirm-yes');
    const confirmNo = document.getElementById('confirm-no');
    const saveStatus = document.getElementById('save-status');
    
    // Reset buttons
    const voiceReset = document.getElementById('voice-reset');
    const pitchReset = document.getElementById('pitch-reset');
    const speedReset = document.getElementById('speed-reset');
    const emotionReset = document.getElementById('emotion-reset');
    const languageReset = document.getElementById('language-reset');
    const logoutLink = document.getElementById('logout-link');
    
    // State
    let availableVoices = [];
    let currentPreferences = {};
    let isAuthenticated = false;
    let pendingAction = null;
    
    /**
     * Display authentication status
     */
    function showAuthStatus(message, type = 'info') {
        authStatus.innerHTML = `<p>${message}</p>`;
        authStatus.className = `auth-message ${type}`;
    }
    
    /**
     * Show save status notification
     */
    function showSaveStatus(message, type = 'success') {
        saveStatus.textContent = message;
        saveStatus.className = `save-status ${type} show`;
        
        setTimeout(() => {
            saveStatus.classList.remove('show');
        }, 3000);
    }
    
    /**
     * Debounce function to limit API calls
     */
    function debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }
    
    /**
     * Make authenticated API request
     */
    async function fetchWithAuth(url, options = {}) {
        if (!appSessionToken) {
            throw new Error('Not authenticated');
        }
        
        const headers = {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${appSessionToken}`,
            ...options.headers
        };
        
        const response = await fetch(url, {
            ...options,
            headers
        });
        
        if (!response.ok) {
            if (response.status === 401) {
                throw new Error('Authentication failed. Please log in again.');
            }
            throw new Error(`API Error: ${response.status} ${response.statusText}`);
        }
        
        return response;
    }
    
    /**
     * Initialize authentication
     */
    async function initializeAuth() {
        const urlParams = new URLSearchParams(window.location.search);
        const sessionTokenParam = urlParams.get('session_token');
        const validatedParam = urlParams.get('validated');
        const errorParam = urlParams.get('error');
        const messageParam = urlParams.get('message');
        
        // Handle errors from OAuth callback
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
            setTimeout(() => {
                window.location.href = '/';
            }, 5000);
            return false;
        }
        
        // Handle successful OAuth callback with validated session token
        if (sessionTokenParam && validatedParam) {
            try {
                appSessionToken = sessionTokenParam;
                localStorage.setItem('app_session_token', appSessionToken);
                
                // Verify the session token by decoding it (client-side validation)
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
                
                // Set the channel from URL parameters
                if (channel) {
                    channelInput.value = channel;
                    currentChannel = channel;
                }
                
                // Clean URL
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
        
        // If we have a token in URL, try initial auth
        if (token) {
            try {
                // First attempt without Twitch auth
                const response = await fetch(`${API_BASE_URL}/api/viewer/auth`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ token, channel })
                });
                
                if (response.ok) {
                    const data = await response.json();
                    
                    // Check if Twitch authentication is required for security
                    if (data.requiresTwitchAuth) {
                        console.log('Twitch authentication required for security validation');
                        return await requireTwitchAuth();
                    }
                    
                    // Direct authentication successful
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
                    
                    if (channel) {
                        channelInput.value = channel;
                    }
                    
                    return true;
                } else if (response.status === 403) {
                    // Security violation detected
                    const data = await response.json();
                    showAuthStatus(data.error || 'Access denied', 'error');
                    setTimeout(() => {
                        window.location.href = '/';
                    }, 5000);
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
    
    /**
     * Require Twitch authentication for security validation
     */
    async function requireTwitchAuth() {
        showAuthStatus('For security, please verify your Twitch identity to access these preferences.', 'info');
        
        // Add a login button
        const loginButton = document.createElement('button');
        loginButton.textContent = 'Verify with Twitch';
        loginButton.className = 'button';
        loginButton.onclick = async () => {
            try {
                showAuthStatus('Redirecting to Twitch for verification...', 'info');
                
                // Initiate Twitch OAuth flow
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
    
    /**
     * Check for existing authentication session
     */
    async function checkExistingSession() {
        appSessionToken = localStorage.getItem('app_session_token');
        const tokenUser = localStorage.getItem('token_user');
        const currentUser = localStorage.getItem('twitch_user_login');
        
        if (!appSessionToken) {
            showAuthStatus('Please log in with Twitch to access your preferences.', 'error');
            setTimeout(() => {
                window.location.href = '/';
            }, 3000);
            return false;
        }
        
        // Check if current user matches the token user (security check)
        if (tokenUser && currentUser && tokenUser !== currentUser) {
            showAuthStatus('Access denied: You can only access your own preferences.', 'error');
            localStorage.clear();
            setTimeout(() => {
                window.location.href = '/';
            }, 3000);
            return false;
        }
        
        try {
            const response = await fetchWithAuth(`${API_BASE_URL}/api/auth/status`);
            const data = await response.json();
            
            if (data.isAuthenticated) {
                isAuthenticated = true;
                // Handle case where user object might not be present
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
            setTimeout(() => {
                window.location.href = '/';
            }, 3000);
            return false;
        }
    }
    
    /**
     * Load available voices from the TTS bot API (same as dashboard)
     */
    async function loadVoices() {
        // Fallback voice list in case API fails
        const fallbackVoices = [
            'Friendly_Person', 'Professional_Woman', 'Casual_Male', 'Energetic_Youth',
            'Warm_Grandmother', 'Confident_Leader', 'Soothing_Narrator', 'Cheerful_Assistant',
            'Deep_Narrator', 'Bright_Assistant', 'Calm_Guide', 'Energetic_Host'
        ];
        
        try {
            // Use same source as dashboard - TTS bot API
            const BOT_API_BASE_URL = 'https://chatvibes-tts-service-h7kj56ct4q-uc.a.run.app/api';
            console.log('Loading voices from TTS bot API:', `${BOT_API_BASE_URL}/voices`);
            const response = await fetch(`${BOT_API_BASE_URL}/voices`);
            
            let voices = fallbackVoices;
            if (response.ok) {
                const voicesData = await response.json();
                voices = voicesData.voices || fallbackVoices;
            }
            
            availableVoices = voices;
            
            // Clear existing options (except default)
            voiceSelect.innerHTML = '<option value="">Use channel default</option>';
            
            // Add voice options
            voices.forEach(voice => {
                const option = document.createElement('option');
                option.value = voice;
                option.textContent = voice.replace(/_/g, ' '); // Convert underscores to spaces
                voiceSelect.appendChild(option);
            });
            
        } catch (error) {
            console.error('Failed to load voices, using fallback:', error);
            
            // Use fallback voices
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
    
    /**
     * Load user preferences for current channel
     */
    async function loadPreferences() {
        if (!currentChannel) return;
        
        try {
            const response = await fetchWithAuth(`${API_BASE_URL}/api/viewer/preferences/${encodeURIComponent(currentChannel)}`);
            const data = await response.json();
            
            currentPreferences = data;
            
            // Update UI with preferences
            voiceSelect.value = data.voiceId || '';
            pitchSlider.value = data.pitch !== undefined ? data.pitch : 0;
            pitchOutput.textContent = pitchSlider.value;
            speedSlider.value = data.speed !== undefined ? data.speed : 1;
            speedOutput.textContent = Number(speedSlider.value).toFixed(2);
            emotionSelect.value = data.emotion || '';
            languageSelect.value = data.language || '';
            
            // Update ignore checkboxes
            ignoreTtsCheckbox.checked = data.ttsIgnored || false;
            ignoreTtsCheckbox.disabled = data.ttsIgnored || false;
            ignoreMusicCheckbox.checked = data.musicIgnored || false;
            ignoreMusicCheckbox.disabled = data.musicIgnored || false;
            
            // Update channel hint
            if (data.channelExists) {
                channelHint.textContent = 'Channel found ✓';
                channelHint.className = 'hint success';
            } else {
                channelHint.textContent = 'ChatVibes is not enabled for this channel';
                channelHint.className = 'hint error';
            }
            
        } catch (error) {
            console.error('Failed to load preferences:', error);
            if (error.message.includes('404')) {
                channelHint.textContent = 'Channel not found or ChatVibes not enabled';
                channelHint.className = 'hint error';
            } else {
                showSaveStatus('Failed to load preferences', 'error');
            }
        }
    }
    
    /**
     * Save a preference setting
     */
    async function savePreference(key, value) {
        if (!currentChannel) return;
        
        try {
            const body = { [key]: value };
            await fetchWithAuth(`${API_BASE_URL}/api/viewer/preferences/${encodeURIComponent(currentChannel)}`, {
                method: 'PUT',
                body: JSON.stringify(body)
            });
            
            showSaveStatus(`${key} updated`, 'success');
            
        } catch (error) {
            console.error(`Failed to save ${key}:`, error);
            showSaveStatus(`Failed to save ${key}`, 'error');
        }
    }
    
    /**
     * Reset a preference to default (use channel default if available, otherwise fallback)
     */
    async function resetPreference(key, element, fallbackValue) {
        // Get channel default value if available
        let defaultValue = fallbackValue;
        if (currentPreferences && currentPreferences.channelDefaults) {
            const channelDefault = currentPreferences.channelDefaults[key];
            if (channelDefault !== null && channelDefault !== undefined) {
                defaultValue = channelDefault;
            }
        }
        
        element.value = defaultValue;
        if (element.type === 'range') {
            const output = document.getElementById(element.id.replace('-slider', '-value'));
            if (output) {
                output.textContent = element.id === 'speed-slider' ? 
                    Number(defaultValue).toFixed(2) : defaultValue;
            }
        }
        await savePreference(key, null); // null removes the preference
    }
    
    /**
     * Test voice with current settings
     */
    async function testVoice() {
        if (!currentChannel) {
            showSaveStatus('Please select a channel first', 'error');
            return;
        }
        
        const text = previewText.value.trim();
        if (!text) {
            showSaveStatus('Please enter some text to test', 'error');
            return;
        }
        
        previewBtn.disabled = true;
        previewBtn.textContent = 'Testing...';
        previewStatus.textContent = 'Generating audio...';
        previewStatus.className = 'status-message info';
        
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
                previewStatus.textContent = 'Playing audio...';
                const audio = new Audio(data.audioUrl);
                
                audio.onended = () => {
                    previewStatus.textContent = 'Audio completed';
                    previewStatus.className = 'status-message success';
                    setTimeout(() => {
                        previewStatus.textContent = '';
                        previewStatus.className = 'status-message';
                    }, 3000);
                };
                
                audio.onerror = () => {
                    throw new Error('Failed to play audio');
                };
                
                await audio.play();
            } else {
                throw new Error(data.message || 'No audio URL received');
            }
            
        } catch (error) {
            console.error('Voice test failed:', error);
            previewStatus.textContent = `Test failed: ${error.message}`;
            previewStatus.className = 'status-message error';
            setTimeout(() => {
                previewStatus.textContent = '';
                previewStatus.className = 'status-message';
            }, 5000);
        } finally {
            previewBtn.disabled = false;
            previewBtn.textContent = '▶ Preview Voice';
        }
    }
    
    /**
     * Handle ignore action with confirmation
     */
    function handleIgnoreAction(type) {
        const checkbox = type === 'tts' ? ignoreTtsCheckbox : ignoreMusicCheckbox;
        
        if (!checkbox.checked) return;
        
        pendingAction = { type, checkbox };
        confirmText.textContent = `Are you absolutely sure you want to opt out of ${type.toUpperCase()} in this channel? Only a moderator can undo this action.`;
        confirmModal.showModal();
    }
    
    /**
     * Confirm ignore action
     */
    async function confirmIgnoreAction() {
        if (!pendingAction || !currentChannel) return;
        
        const { type, checkbox } = pendingAction;
        
        try {
            await fetchWithAuth(`${API_BASE_URL}/api/viewer/ignore/${type}/${encodeURIComponent(currentChannel)}`, {
                method: 'POST'
            });
            
            checkbox.disabled = true;
            showSaveStatus(`You have been opted out of ${type.toUpperCase()}`, 'success');
            
        } catch (error) {
            console.error(`Failed to opt out of ${type}:`, error);
            checkbox.checked = false;
            showSaveStatus(`Failed to opt out of ${type.toUpperCase()}`, 'error');
        }
        
        confirmModal.close();
        pendingAction = null;
    }
    
    /**
     * Cancel ignore action
     */
    function cancelIgnoreAction() {
        if (pendingAction) {
            pendingAction.checkbox.checked = false;
            pendingAction = null;
        }
        confirmModal.close();
    }
    
    // Event Listeners
    
    // Channel input change
    channelInput.addEventListener('input', debounce((e) => {
        currentChannel = e.target.value.trim().toLowerCase();
        if (currentChannel) {
            loadPreferences();
        } else {
            channelHint.textContent = '';
            channelHint.className = 'hint';
        }
    }, 600));
    
    // Preference controls
    voiceSelect.addEventListener('change', () => {
        savePreference('voiceId', voiceSelect.value || null);
    });
    
    pitchSlider.addEventListener('input', () => {
        pitchOutput.textContent = pitchSlider.value;
    });
    
    pitchSlider.addEventListener('change', () => {
        const value = Number(pitchSlider.value);
        savePreference('pitch', value !== 0 ? value : null);
    });
    
    speedSlider.addEventListener('input', () => {
        speedOutput.textContent = Number(speedSlider.value).toFixed(2);
    });
    
    speedSlider.addEventListener('change', () => {
        const value = Number(speedSlider.value);
        savePreference('speed', Math.abs(value - 1) > 0.01 ? value : null);
    });
    
    emotionSelect.addEventListener('change', () => {
        savePreference('emotion', emotionSelect.value || null);
    });
    
    languageSelect.addEventListener('change', () => {
        savePreference('language', languageSelect.value || null);
    });
    
    // Reset buttons
    voiceReset.addEventListener('click', () => resetPreference('voiceId', voiceSelect, ''));
    pitchReset.addEventListener('click', () => resetPreference('pitch', pitchSlider, 0));
    speedReset.addEventListener('click', () => resetPreference('speed', speedSlider, 1));
    emotionReset.addEventListener('click', () => resetPreference('emotion', emotionSelect, ''));
    languageReset.addEventListener('click', () => resetPreference('language', languageSelect, ''));
    
    // Preview button
    previewBtn.addEventListener('click', testVoice);
    
    // Ignore checkboxes
    ignoreTtsCheckbox.addEventListener('change', () => {
        if (ignoreTtsCheckbox.checked) {
            handleIgnoreAction('tts');
        }
    });
    
    ignoreMusicCheckbox.addEventListener('change', () => {
        if (ignoreMusicCheckbox.checked) {
            handleIgnoreAction('music');
        }
    });
    
    // Confirmation modal
    confirmYes.addEventListener('click', confirmIgnoreAction);
    confirmNo.addEventListener('click', cancelIgnoreAction);
    
    // Logout button
    if (logoutLink) {
        logoutLink.addEventListener('click', (e) => {
            e.preventDefault();
            localStorage.removeItem('twitch_user_login');
            localStorage.removeItem('twitch_user_id');
            localStorage.removeItem('app_session_token');
            localStorage.removeItem('token_user');
            localStorage.removeItem('token_channel');
            appSessionToken = null;
            window.location.href = 'index.html';
        });
    }
    
    // Initialize the application
    const authenticated = await initializeAuth();
    
    if (authenticated) {
        await loadVoices();
        
        if (currentChannel) {
            await loadPreferences();
        }
    }
});