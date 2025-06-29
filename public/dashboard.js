document.addEventListener('DOMContentLoaded', () => {
    // Dashboard UI Elements
    const twitchUsernameEl = document.getElementById('twitch-username');
    const channelNameStatusEl = document.getElementById('channel-name-status');
    const botStatusEl = document.getElementById('bot-status');
    const addBotBtn = document.getElementById('add-bot-btn');
    const removeBotBtn = document.getElementById('remove-bot-btn');
    const actionMessageEl = document.getElementById('action-message');
    const logoutLink = document.getElementById('logout-link');

    // TTS URL Elements (from dashboard.html)
    const ttsUrlField = document.getElementById('tts-url-field');
    const copyTtsUrlBtn = document.getElementById('copy-tts-url-btn');
    const copyStatusEl = document.getElementById('copy-status-message');

    // IMPORTANT: Configure this to your deployed Cloud Function URL for ChatVibes
    const API_BASE_URL = 'https://us-central1-chatvibestts.cloudfunctions.net/webUi'; // Make sure 'chatvibestts' is your project ID
    let appSessionToken = null;
    let loggedInUser = null;

    /**
     * Updates the TTS URL field with the user's specific URL.
     * @param {string} userLoginName - The Twitch login name of the user.
     */
    function updateTtsUrl(userLoginName) {
        if (ttsUrlField && userLoginName && userLoginName.trim() !== '' && userLoginName !== 'loading...') {
            // CRITICAL: Replace this placeholder with your actual ChatVibes TTS handler URL structure
            const ttsHandlerBaseUrl = 'https://chatvibes-tts-service-h7kj56ct4q-uc.a.run.app'; 
            // Example: const ttsHandlerBaseUrl = 'https://us-central1-chatvibestts.cloudfunctions.net/handleTtsRequest';
            
            ttsUrlField.value = `${ttsHandlerBaseUrl}?channel=${userLoginName.toLowerCase()}`;
        } else if (ttsUrlField) {
            ttsUrlField.value = ''; // Clear if username is not available or invalid
            ttsUrlField.placeholder = 'Could not determine TTS URL.';
        }
    }

    async function initializeDashboard() {
        appSessionToken = localStorage.getItem('app_session_token');
        console.log("Dashboard: Loaded app_session_token from localStorage:", appSessionToken);

        const userLoginFromStorage = localStorage.getItem('twitch_user_login');
        const userIdFromStorage = localStorage.getItem('twitch_user_id');

        if (userLoginFromStorage && userIdFromStorage) {
            // Assume displayName from storage is login initially, it might be updated by backend if different
            loggedInUser = { login: userLoginFromStorage, id: userIdFromStorage, displayName: userLoginFromStorage };
            
            if (twitchUsernameEl) twitchUsernameEl.textContent = loggedInUser.displayName;
            if (channelNameStatusEl) channelNameStatusEl.textContent = loggedInUser.login;
            if (actionMessageEl) actionMessageEl.textContent = '';

            // *** KEY CHANGE: Call updateTtsUrl with the user's LOGIN name ***
            updateTtsUrl(loggedInUser.login);

            if (!appSessionToken) {
                console.warn("No session token found, API calls might fail authentication.");
                if (actionMessageEl) actionMessageEl.textContent = "Authentication token missing. Please log in again.";
                // Optionally redirect or disable features
                return;
            }

            try {
                const headers = { 'Authorization': `Bearer ${appSessionToken}` };
                console.log("Dashboard: Sending headers to /api/bot/status:", JSON.stringify(headers));

                const statusRes = await fetch(`${API_BASE_URL}/api/bot/status`, {
                    method: 'GET',
                    headers: headers
                });

                if (!statusRes.ok) {
                    if (statusRes.status === 401) {
                       if (actionMessageEl) actionMessageEl.textContent = "Session potentially expired. Please log in again.";
                    } else {
                        const errorData = await statusRes.json().catch(() => ({ message: statusRes.statusText }));
                        if (actionMessageEl) actionMessageEl.textContent = `Failed to fetch status: ${errorData.message || statusRes.statusText}`;
                    }
                    if (botStatusEl) botStatusEl.textContent = "Error";
                    return;
                }
                const statusData = await statusRes.json();

                if (statusData.success) {
                    updateBotStatusUI(statusData.isActive);
                    // Optionally update displayName if backend provides a canonical one
                    // if (twitchUsernameEl && statusData.displayName) twitchUsernameEl.textContent = statusData.displayName;
                } else {
                    if (actionMessageEl) actionMessageEl.textContent = `Error: ${statusData.message}`;
                    if (botStatusEl) botStatusEl.textContent = "Error";
                }
            } catch (error) {
                console.error('Error fetching bot status:', error);
                if (actionMessageEl) actionMessageEl.textContent = 'Failed to load bot status. ' + error.message;
                if (botStatusEl) botStatusEl.textContent = 'Error';
            }
        } else {
            // Not logged in or info missing, redirect to index.html
            window.location.href = 'index.html';
        }
    }

    function updateBotStatusUI(isActive) {
        if (isActive) {
            if (botStatusEl) {
                botStatusEl.textContent = 'Active';
                botStatusEl.className = 'status-active';
            }
            if (addBotBtn) addBotBtn.style.display = 'none';
            if (removeBotBtn) removeBotBtn.style.display = 'inline-block';
        } else {
            if (botStatusEl) {
                botStatusEl.textContent = 'Inactive / Not Joined';
                botStatusEl.className = 'status-inactive';
            }
            if (addBotBtn) addBotBtn.style.display = 'inline-block';
            if (removeBotBtn) removeBotBtn.style.display = 'none';
        }
        if (actionMessageEl) actionMessageEl.textContent = '';
    }

    if (addBotBtn) {
        addBotBtn.addEventListener('click', async () => {
            if (!appSessionToken) {
                if (actionMessageEl) actionMessageEl.textContent = "Authentication token missing. Please log in again.";
                return;
            }
            if (actionMessageEl) actionMessageEl.textContent = 'Requesting bot to join...';
            try {
                const res = await fetch(`${API_BASE_URL}/api/bot/add`, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${appSessionToken}`,
                        'Content-Type': 'application/json'
                    }
                });
                const data = await res.json();
                if (actionMessageEl) actionMessageEl.textContent = data.message;
                if (data.success) {
                    updateBotStatusUI(true);
                }
            } catch (error) {
                console.error('Error adding bot:', error);
                if (actionMessageEl) actionMessageEl.textContent = 'Failed to send request to add bot.';
            }
        });
    }

    if (removeBotBtn) {
        removeBotBtn.addEventListener('click', async () => {
            if (!appSessionToken) {
                if (actionMessageEl) actionMessageEl.textContent = "Authentication token missing. Please log in again.";
                return;
            }
            if (actionMessageEl) actionMessageEl.textContent = 'Requesting bot to leave...';
            try {
                const res = await fetch(`${API_BASE_URL}/api/bot/remove`, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${appSessionToken}`,
                        'Content-Type': 'application/json'
                    }
                });
                const data = await res.json();
                if (actionMessageEl) actionMessageEl.textContent = data.message;
                if (data.success) {
                    updateBotStatusUI(false);
                }
            } catch (error) {
                console.error('Error removing bot:', error);
                if (actionMessageEl) actionMessageEl.textContent = 'Failed to send request to remove bot.';
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

    // Event listener for TTS URL copy button
    if (copyTtsUrlBtn && ttsUrlField) {
        copyTtsUrlBtn.addEventListener('click', () => {
            if (!ttsUrlField.value) {
                if (copyStatusEl) copyStatusEl.textContent = 'URL not available yet.';
                setTimeout(() => { if (copyStatusEl) copyStatusEl.textContent = ''; }, 3000);
                return;
            }
            ttsUrlField.select();
            ttsUrlField.setSelectionRange(0, 99999); // For mobile devices

            try {
                navigator.clipboard.writeText(ttsUrlField.value).then(() => {
                    if (copyStatusEl) copyStatusEl.textContent = 'Copied to clipboard!';
                    copyTtsUrlBtn.textContent = 'Copied!';
                    setTimeout(() => {
                        if (copyStatusEl) copyStatusEl.textContent = '';
                        copyTtsUrlBtn.textContent = 'Copy URL';
                    }, 2000);
                }, (err) => { // Handle promise rejection for writeText
                    console.warn('navigator.clipboard.writeText failed, trying execCommand fallback:', err);
                    // Fallback for older browsers or if navigator.clipboard is not available/fails
                    if (document.execCommand('copy')) {
                        if (copyStatusEl) copyStatusEl.textContent = 'Copied (fallback)!';
                        copyTtsUrlBtn.textContent = 'Copied!';
                    } else {
                        if (copyStatusEl) copyStatusEl.textContent = 'Copy failed using fallback.';
                    }
                    setTimeout(() => {
                        if (copyStatusEl) copyStatusEl.textContent = '';
                        copyTtsUrlBtn.textContent = 'Copy URL';
                    }, 2000);
                });
            } catch (err) { // Catch synchronous errors with execCommand or setup
                console.error('Error during copy attempt:', err);
                if (copyStatusEl) copyStatusEl.textContent = 'Failed to copy.';
                setTimeout(() => { if (copyStatusEl) copyStatusEl.textContent = ''; }, 3000);
            }
        });
    }

    // Settings Panel Elements
    const settingsTabBtn = document.getElementById('settings-tab-btn');
    const obsTabBtn = document.getElementById('obs-tab-btn');
    const settingsPanel = document.getElementById('settings-panel');
    const obsSetupInstructions = document.getElementById('obs-setup-instructions');
    const settingsStatusMessage = document.getElementById('settings-status-message');
    const saveConfirmationMessage = document.getElementById('save-confirmation-message');
    
    // Bot settings API URL - configurable for dev/production
    const BOT_API_BASE_URL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' 
        ? 'http://localhost:8080/api'  // Local development
        : 'https://chatvibes-tts-service-h7kj56ct4q-uc.a.run.app/api';  // Production
    
    // Settings form elements
    const ttsEnabledCheckbox = document.getElementById('tts-enabled');
    const ttsModeSelect = document.getElementById('tts-mode');
    const ttsPermissionSelect = document.getElementById('tts-permission');
    const eventsEnabledCheckbox = document.getElementById('events-enabled');
    const bitsEnabledCheckbox = document.getElementById('bits-enabled');
    const bitsAmountInput = document.getElementById('bits-amount');
    const defaultVoiceSelect = document.getElementById('default-voice');
    const defaultEmotionSelect = document.getElementById('default-emotion');
    const defaultPitchSlider = document.getElementById('default-pitch');
    const pitchValueSpan = document.getElementById('pitch-value');
    const defaultSpeedSlider = document.getElementById('default-speed');
    const speedValueSpan = document.getElementById('speed-value');
    const defaultLanguageSelect = document.getElementById('default-language');
    const musicEnabledCheckbox = document.getElementById('music-enabled');
    const musicModeSelect = document.getElementById('music-mode');
    const musicBitsEnabledCheckbox = document.getElementById('music-bits-enabled');
    const musicBitsAmountInput = document.getElementById('music-bits-amount');
    const englishNormalizationCheckbox = document.getElementById('english-normalization');
    const saveSettingsBtn = document.getElementById('save-settings-btn');
    
    // Voice test elements
    const voiceTestTextInput = document.getElementById('voice-test-text');
    const voiceTestBtn = document.getElementById('voice-test-btn');
    const voiceTestStatus = document.getElementById('voice-test-status');
    
    // Reset buttons
    const resetPitchBtn = document.getElementById('reset-pitch-btn');
    const resetSpeedBtn = document.getElementById('reset-speed-btn');

    // Track original settings to detect changes
    let originalSettings = {};

    // Tab switching functionality
    function switchTab(activeTabBtn, activePanel, inactiveTabBtn, inactivePanel) {
        activeTabBtn.classList.add('active');
        activePanel.classList.add('active');
        inactiveTabBtn.classList.remove('active');
        inactivePanel.classList.remove('active');
    }

    if (settingsTabBtn && obsTabBtn) {
        settingsTabBtn.addEventListener('click', () => {
            switchTab(settingsTabBtn, settingsPanel, obsTabBtn, obsSetupInstructions);
        });

        obsTabBtn.addEventListener('click', () => {
            switchTab(obsTabBtn, obsSetupInstructions, settingsTabBtn, settingsPanel);
        });
    }

    // Slider value updates
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

    // Reset button functionality
    if (resetPitchBtn && defaultPitchSlider && pitchValueSpan) {
        resetPitchBtn.addEventListener('click', () => {
            defaultPitchSlider.value = '0';
            pitchValueSpan.textContent = '0';
        });
    }

    if (resetSpeedBtn && defaultSpeedSlider && speedValueSpan) {
        resetSpeedBtn.addEventListener('click', () => {
            defaultSpeedSlider.value = '1.0';
            speedValueSpan.textContent = '1.0';
        });
    }

    // Load available voices via bot API (avoids CORS issues)
    async function loadAvailableVoices() {
        if (!defaultVoiceSelect) return;
        
        // Fallback voice list in case API fails
        const fallbackVoices = [
            'Friendly_Person', 'Professional_Woman', 'Casual_Male', 'Energetic_Youth',
            'Warm_Grandmother', 'Confident_Leader', 'Soothing_Narrator', 'Cheerful_Assistant',
            'Deep_Narrator', 'Bright_Assistant', 'Calm_Guide', 'Energetic_Host'
        ];
        
        try {
            // Try to fetch from bot's API first (no CORS issues)
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
        
        // Use fallback voices if all else fails
        populateVoices(fallbackVoices);
    }
    
    // Parse voices from Replicate text (same logic as bot)
    function parseVoicesFromText(rawText) {
        const lines = rawText.split('\n');
        const allFoundVoiceIds = new Set();
        
        // Parse system voice IDs from input line
        const voiceIdInputHeader = '- voice_id:';
        const voiceIdInputLineIndex = lines.findIndex(line => line.trim().startsWith(voiceIdInputHeader));
        
        if (voiceIdInputLineIndex !== -1) {
            const lineContent = lines[voiceIdInputLineIndex];
            const systemVoicesMatch = lineContent.match(/system voice IDs:\s*([^)]+)\s*\(/i);
            if (systemVoicesMatch && systemVoicesMatch[1]) {
                const systemVoiceChunk = systemVoicesMatch[1];
                systemVoiceChunk.split(',')
                    .map(v => v.trim())
                    .filter(v => v)
                    .forEach(vId => allFoundVoiceIds.add(vId));
            }
        }
        
        // Parse main voice list
        const mainListHeaderString = '> ## MiniMax TTS Voice List';
        const mainListStartIndex = lines.findIndex(line => line.trim() === mainListHeaderString);
        
        if (mainListStartIndex !== -1) {
            for (let i = mainListStartIndex + 1; i < lines.length; i++) {
                const trimmed = lines[i].trim();
                if (trimmed.startsWith('> - ')) {
                    allFoundVoiceIds.add(trimmed.substring(4).trim());
                } else if (trimmed.startsWith('- ')) {
                    allFoundVoiceIds.add(trimmed.substring(2).trim());
                } else if (trimmed === '' || trimmed === '>') {
                    continue;
                } else if (trimmed.startsWith('#') || trimmed.startsWith('> #')) {
                    break;
                }
            }
        }
        
        return Array.from(allFoundVoiceIds);
    }
    
    function populateVoices(voices) {
        // Clear existing options
        defaultVoiceSelect.innerHTML = '';
        
        // Add voice options
        voices.forEach(voice => {
            const option = document.createElement('option');
            option.value = voice;
            option.textContent = voice.replace(/[_-]/g, ' ').replace(/\b\w/g, chr => chr.toUpperCase());
            defaultVoiceSelect.appendChild(option);
        });
        
        // Set default selection
        defaultVoiceSelect.value = 'Friendly_Person';
    }

    // Load current settings from bot API
    async function loadBotSettings() {
        if (!loggedInUser?.login) {
            console.warn('No logged in user, cannot load bot settings');
            return;
        }

        try {
            const channelName = loggedInUser.login.toLowerCase();
            
            // Prepare headers with auth token
            const headers = {
                'Content-Type': 'application/json'
            };
            if (appSessionToken) {
                headers['Authorization'] = `Bearer ${appSessionToken}`;
            }
            
            // Load TTS settings
            let ttsData = { settings: {} };
            const ttsResponse = await fetch(`${BOT_API_BASE_URL}/tts/settings/channel/${channelName}`, { headers });
            if (ttsResponse.ok) {
                ttsData = await ttsResponse.json();
                const settings = ttsData.settings || {};
                
                if (ttsEnabledCheckbox) ttsEnabledCheckbox.checked = settings.engineEnabled || false;
                if (ttsModeSelect) ttsModeSelect.value = settings.mode || 'command';
                if (ttsPermissionSelect) ttsPermissionSelect.value = settings.ttsPermissionLevel || 'everyone';
                if (eventsEnabledCheckbox) eventsEnabledCheckbox.checked = settings.speakEvents !== false;
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
            
            // Load Music settings
            let musicData = { settings: {} };
            const musicResponse = await fetch(`${BOT_API_BASE_URL}/music/settings/channel/${channelName}`, { headers });
            if (musicResponse.ok) {
                musicData = await musicResponse.json();
                const settings = musicData.settings || {};
                
                if (musicEnabledCheckbox) musicEnabledCheckbox.checked = settings.enabled || false;
                if (musicModeSelect) {
                    // Convert from allowedRoles array to simple mode
                    const mode = settings.allowedRoles?.includes('everyone') ? 'everyone' : 'moderator';
                    musicModeSelect.value = mode;
                }
                if (musicBitsEnabledCheckbox) musicBitsEnabledCheckbox.checked = settings.bitsModeEnabled || false;
                if (musicBitsAmountInput) musicBitsAmountInput.value = settings.bitsMinimumAmount || 100;
            }
            
            // Display ignore lists
            displayIgnoreList('tts', ttsData.settings?.ignoredUsers || []);
            displayIgnoreList('music', musicData.settings?.ignoredUsers || []);
            
            // Store original settings for change detection
            originalSettings = {
                tts: ttsData.settings || {},
                music: musicData.settings || {}
            };
            
        } catch (error) {
            console.error('Failed to load bot settings:', error);
            if (settingsStatusMessage) {
                if (error.message?.includes('Failed to fetch') || error.name === 'TypeError') {
                    settingsStatusMessage.textContent = '⚠️ Settings management not available - bot needs to be updated with REST API endpoints. Using defaults for now.';
                    settingsStatusMessage.style.color = 'orange';
                } else {
                    settingsStatusMessage.textContent = 'Failed to load current settings. Using defaults.';
                    settingsStatusMessage.style.color = 'orange';
                }
            }
        }
    }

    // Save settings to bot API
    async function saveBotSettings() {
        if (!loggedInUser?.login) {
            console.warn('No logged in user, cannot save bot settings');
            return;
        }

        if (saveConfirmationMessage) {
            saveConfirmationMessage.textContent = 'Saving settings...';
            saveConfirmationMessage.style.color = 'blue';
        }

        try {
            const channelName = loggedInUser.login.toLowerCase();
            const errors = [];
            const changedSettings = [];

            // Prepare headers with auth token
            const headers = {
                'Content-Type': 'application/json'
            };
            if (appSessionToken) {
                headers['Authorization'] = `Bearer ${appSessionToken}`;
            }

            // Get current values and check for changes
            const currentTtsSettings = [
                { key: 'engineEnabled', value: ttsEnabledCheckbox?.checked || false, label: 'TTS Engine' },
                { key: 'mode', value: ttsModeSelect?.value || 'command', label: 'TTS Mode' },
                { key: 'ttsPermissionLevel', value: ttsPermissionSelect?.value || 'everyone', label: 'TTS Permission' },
                { key: 'speakEvents', value: eventsEnabledCheckbox?.checked !== false, label: 'Event Announcements' },
                { key: 'bitsModeEnabled', value: bitsEnabledCheckbox?.checked || false, label: 'Bits-for-TTS' },
                { key: 'bitsMinimumAmount', value: parseInt(bitsAmountInput?.value || '100'), label: 'Minimum Bits' },
                { key: 'voiceId', value: defaultVoiceSelect?.value || 'Friendly_Person', label: 'Default Voice' },
                { key: 'emotion', value: defaultEmotionSelect?.value || 'auto', label: 'Default Emotion' },
                { key: 'pitch', value: parseInt(defaultPitchSlider?.value || '0'), label: 'Default Pitch' },
                { key: 'speed', value: parseFloat(defaultSpeedSlider?.value || '1.0'), label: 'Default Speed' },
                { key: 'languageBoost', value: defaultLanguageSelect?.value || 'Automatic', label: 'Default Language' },
                { key: 'englishNormalization', value: englishNormalizationCheckbox.checked || false, label: 'English Normalization' }
            ];

            // Only save settings that have changed
            for (const setting of currentTtsSettings) {
                const originalValue = originalSettings.tts?.[setting.key];
                if (originalValue !== setting.value) {
                    const response = await fetch(`${BOT_API_BASE_URL}/tts/settings/channel/${channelName}`, {
                        method: 'PUT',
                        headers,
                        body: JSON.stringify(setting)
                    });
                    
                    if (response.ok) {
                        changedSettings.push(`${setting.label}: ${setting.value}`);
                    } else if (response.status === 400) {
                        const errorData = await response.json().catch(() => ({ error: 'Validation error' }));
                        console.warn(`TTS setting ${setting.key} validation failed:`, errorData.error);
                    } else if (response.status === 500 || response.status === 404) {
                        errors.push(`Settings management not available yet - bot needs API update`);
                        break;
                    } else {
                        const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
                        errors.push(`TTS ${setting.label}: ${errorData.error}`);
                    }
                }
            }

            // Check music settings for changes
            const currentMusicEnabled = musicEnabledCheckbox?.checked || false;
            const currentMusicMode = musicModeSelect?.value === 'everyone' ? ['everyone'] : ['moderator'];
            const currentMusicBitsEnabled = musicBitsEnabledCheckbox?.checked || false;
            const currentMusicBitsAmount = parseInt(musicBitsAmountInput?.value || '100');

            if (originalSettings.music?.enabled !== currentMusicEnabled) {
                const response = await fetch(`${BOT_API_BASE_URL}/music/settings/channel/${channelName}`, {
                    method: 'PUT',
                    headers,
                    body: JSON.stringify({ key: 'enabled', value: currentMusicEnabled })
                });
                
                if (response.ok) {
                    changedSettings.push(`Music Generation: ${currentMusicEnabled ? 'Enabled' : 'Disabled'}`);
                } else if (response.status !== 500 && response.status !== 404) {
                    const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
                    errors.push(`Music Generation: ${errorData.error}`);
                }
            }

            if (JSON.stringify(originalSettings.music?.allowedRoles) !== JSON.stringify(currentMusicMode)) {
                const response = await fetch(`${BOT_API_BASE_URL}/music/settings/channel/${channelName}`, {
                    method: 'PUT',
                    headers,
                    body: JSON.stringify({ key: 'allowedRoles', value: currentMusicMode })
                });
                
                if (response.ok) {
                    changedSettings.push(`Music Access: ${currentMusicMode.includes('everyone') ? 'Everyone' : 'Moderators Only'}`);
                } else if (response.status !== 500 && response.status !== 404) {
                    const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
                    errors.push(`Music Access: ${errorData.error}`);
                }
            }

            if (originalSettings.music?.bitsModeEnabled !== currentMusicBitsEnabled || 
                originalSettings.music?.bitsMinimumAmount !== currentMusicBitsAmount) {
                const response = await fetch(`${BOT_API_BASE_URL}/music/settings/channel/${channelName}`, {
                    method: 'PUT',
                    headers,
                    body: JSON.stringify({ 
                        key: 'bitsConfig', 
                        value: { 
                            enabled: currentMusicBitsEnabled,
                            minimumAmount: currentMusicBitsAmount
                        }
                    })
                });
                
                if (response.ok) {
                    changedSettings.push(`Music Bits: ${currentMusicBitsEnabled ? 'Enabled' : 'Disabled'} (${currentMusicBitsAmount} bits)`);
                } else if (response.status !== 500 && response.status !== 404) {
                    const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
                    errors.push(`Music Bits: ${errorData.error}`);
                }
            }

            if (errors.length > 0) {
                if (saveConfirmationMessage) {
                    saveConfirmationMessage.textContent = `Some settings failed to save: ${errors.join(', ')}`;
                    saveConfirmationMessage.style.color = 'red';
                }
            } else if (changedSettings.length > 0) {
                if (saveConfirmationMessage) {
                    const changedCount = changedSettings.length;
                    saveConfirmationMessage.innerHTML = `
                        <strong>✅ Settings saved successfully!</strong><br>
                        <small style="opacity: 0.8;">Updated ${changedCount} setting${changedCount > 1 ? 's' : ''}: ${changedSettings.slice(0, 2).join(', ')}${changedCount > 2 ? ` and ${changedCount - 2} more...` : ''}</small>
                    `;
                    saveConfirmationMessage.style.color = 'green';
                }
                // Update original settings to reflect the changes
                await loadBotSettings();
            } else {
                if (saveConfirmationMessage) {
                    saveConfirmationMessage.innerHTML = `<span style="opacity: 0.8;">No changes to save</span>`;
                    saveConfirmationMessage.style.color = '#666';
                }
            }
            
        } catch (error) {
            console.error('Failed to save bot settings:', error);
            if (saveConfirmationMessage) {
                saveConfirmationMessage.textContent = 'Failed to save settings. Please try again.';
                saveConfirmationMessage.style.color = 'red';
            }
        }

        // Clear confirmation message after 5 seconds
        setTimeout(() => {
            if (saveConfirmationMessage) saveConfirmationMessage.textContent = '';
        }, 5000);
    }

    // Save settings button handler
    if (saveSettingsBtn) {
        saveSettingsBtn.addEventListener('click', saveBotSettings);
    }

    // Display ignore list
    function displayIgnoreList(type, users) {
        const listEl = document.getElementById(`${type}-ignore-list`);
        if (!listEl) return;
        
        listEl.innerHTML = '';
        users.forEach(username => {
            const li = document.createElement('li');
            li.innerHTML = `
                <span>${username}</span>
                <button class="remove-btn" onclick="removeFromIgnoreList('${type}', '${username}')">Remove</button>
            `;
            listEl.appendChild(li);
        });
        
        if (users.length === 0) {
            const li = document.createElement('li');
            li.innerHTML = '<span style="color: #999; font-style: italic;">No ignored users</span>';
            listEl.appendChild(li);
        }
    }
    
    // Add to ignore list
    async function addToIgnoreList(type) {
        const inputEl = document.getElementById(`${type}-ignore-username`);
        const username = inputEl?.value?.trim();
        
        if (!username) {
            alert('Please enter a username');
            return;
        }
        
        if (!loggedInUser?.login) {
            alert('Not logged in');
            return;
        }
        
        try {
            const channelName = loggedInUser.login.toLowerCase();
            const headers = {
                'Content-Type': 'application/json'
            };
            if (appSessionToken) {
                headers['Authorization'] = `Bearer ${appSessionToken}`;
            }
            
            const response = await fetch(`${BOT_API_BASE_URL}/${type}/ignore/channel/${channelName}`, {
                method: 'POST',
                headers,
                body: JSON.stringify({ username })
            });
            
            if (response.ok) {
                inputEl.value = '';
                loadBotSettings(); // Refresh the lists
            } else {
                if (response.status === 500 || response.status === 404) {
                    alert('Settings management is not available yet. The bot needs to be updated with the new REST API endpoints.');
                } else {
                    const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
                    alert(`Failed to add user: ${errorData.error}`);
                }
            }
        } catch (error) {
            console.error(`Failed to add user to ${type} ignore list:`, error);
            alert('Failed to add user to ignore list');
        }
    }
    
    // Remove from ignore list  
    async function removeFromIgnoreList(type, username) {
        if (!loggedInUser?.login) {
            alert('Not logged in');
            return;
        }
        
        try {
            const channelName = loggedInUser.login.toLowerCase();
            const headers = {
                'Content-Type': 'application/json'
            };
            if (appSessionToken) {
                headers['Authorization'] = `Bearer ${appSessionToken}`;
            }
            
            const response = await fetch(`${BOT_API_BASE_URL}/${type}/ignore/channel/${channelName}`, {
                method: 'DELETE',
                headers,
                body: JSON.stringify({ username })
            });
            
            if (response.ok) {
                loadBotSettings(); // Refresh the lists
            } else {
                if (response.status === 500 || response.status === 404) {
                    alert('Settings management is not available yet. The bot needs to be updated with the new REST API endpoints.');
                } else {
                    const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
                    alert(`Failed to remove user: ${errorData.error}`);
                }
            }
        } catch (error) {
            console.error(`Failed to remove user from ${type} ignore list:`, error);
            alert('Failed to remove user from ignore list');
        }
    }
    
    // Voice test functionality
    async function testVoice() {
        if (!voiceTestTextInput || !voiceTestBtn || !voiceTestStatus) {
            console.error('Voice test elements not found');
            return;
        }

        const text = voiceTestTextInput.value.trim();
        if (!text) {
            voiceTestStatus.textContent = 'Please enter some text to test';
            voiceTestStatus.style.color = 'orange';
            return;
        }

        if (text.length > 500) {
            voiceTestStatus.textContent = 'Text must be 500 characters or less';
            voiceTestStatus.style.color = 'red';
            return;
        }

        if (!appSessionToken) {
            voiceTestStatus.textContent = 'Authentication required';
            voiceTestStatus.style.color = 'red';
            return;
        }

        // Disable button and show loading state
        voiceTestBtn.disabled = true;
        voiceTestBtn.textContent = 'Generating...';
        voiceTestStatus.textContent = 'Generating voice sample...';
        voiceTestStatus.style.color = 'blue';

        try {
            // Get current voice settings from the form
            const voiceSettings = {
                text: text,
                voiceId: defaultVoiceSelect?.value || 'Friendly_Person',
                emotion: defaultEmotionSelect?.value || 'auto',
                pitch: parseInt(defaultPitchSlider?.value || '0'),
                speed: parseFloat(defaultSpeedSlider?.value || '1.0'),
                languageBoost: defaultLanguageSelect?.value || 'Automatic'
            };

            console.log('Testing voice with settings:', voiceSettings);

            const response = await fetch(`${API_BASE_URL}/api/tts/test`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${appSessionToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(voiceSettings)
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({ message: response.statusText }));
                throw new Error(errorData.message || `Request failed with status ${response.status}`);
            }

            const data = await response.json();

            if (data.success && data.audioUrl) {
                voiceTestStatus.textContent = 'Playing voice sample...';
                voiceTestStatus.style.color = 'green';

                // Create and play audio element
                const audio = new Audio(data.audioUrl);
                audio.onloadstart = () => {
                    voiceTestStatus.textContent = 'Loading audio...';
                };
                audio.oncanplaythrough = () => {
                    voiceTestStatus.textContent = 'Playing voice sample...';
                };
                audio.onended = () => {
                    voiceTestStatus.textContent = 'Voice test completed!';
                    setTimeout(() => {
                        if (voiceTestStatus) voiceTestStatus.textContent = '';
                    }, 3000);
                };
                audio.onerror = () => {
                    voiceTestStatus.textContent = 'Error playing audio sample';
                    voiceTestStatus.style.color = 'red';
                    setTimeout(() => {
                        if (voiceTestStatus) voiceTestStatus.textContent = '';
                    }, 5000);
                };
                
                await audio.play();
            } else {
                throw new Error(data.message || 'Failed to generate voice sample');
            }

        } catch (error) {
            console.error('Voice test error:', error);
            voiceTestStatus.textContent = `Voice test failed: ${error.message}`;
            voiceTestStatus.style.color = 'red';
            setTimeout(() => {
                if (voiceTestStatus) voiceTestStatus.textContent = '';
            }, 5000);
        } finally {
            // Re-enable button
            voiceTestBtn.disabled = false;
            voiceTestBtn.textContent = 'Test Voice';
        }
    }

    // Voice test button event listener
    if (voiceTestBtn) {
        voiceTestBtn.addEventListener('click', testVoice);
    }

    // Make functions global for onclick handlers
    window.removeFromIgnoreList = removeFromIgnoreList;
    
    // Add event listeners for ignore list buttons
    const addTtsIgnoreBtn = document.getElementById('add-tts-ignore-btn');
    const addMusicIgnoreBtn = document.getElementById('add-music-ignore-btn');
    
    if (addTtsIgnoreBtn) {
        addTtsIgnoreBtn.addEventListener('click', () => addToIgnoreList('tts'));
    }
    
    if (addMusicIgnoreBtn) {
        addMusicIgnoreBtn.addEventListener('click', () => addToIgnoreList('music'));
    }

    // Initialize settings panel
    async function initializeSettingsPanel() {
        await loadAvailableVoices();
        await loadBotSettings();
    }

    // Initialize the dashboard
    initializeDashboard().then(() => {
        // Initialize settings panel after dashboard is loaded
        initializeSettingsPanel();
    });
});