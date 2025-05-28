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

    // Initialize the dashboard
    initializeDashboard();
});