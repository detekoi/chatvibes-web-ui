document.addEventListener('DOMContentLoaded', () => {
    const twitchUsernameEl = document.getElementById('twitch-username');
    const channelNameStatusEl = document.getElementById('channel-name-status');
    const botStatusEl = document.getElementById('bot-status');
    const addBotBtn = document.getElementById('add-bot-btn');
    const removeBotBtn = document.getElementById('remove-bot-btn');
    const actionMessageEl = document.getElementById('action-message');
    const logoutLink = document.getElementById('logout-link');

    // IMPORTANT: Configure this to your deployed Cloud Function URL
    const API_BASE_URL = 'https://us-central1-chatvibestts.cloudfunctions.net/webUi';
    let appSessionToken = null; // Variable to hold the token
    let loggedInUser = null;

    async function initializeDashboard() {
        appSessionToken = localStorage.getItem('app_session_token');
        console.log("Dashboard: Loaded app_session_token from localStorage:", appSessionToken); // Log what's loaded

        const userLoginFromStorage = localStorage.getItem('twitch_user_login');
        const userIdFromStorage = localStorage.getItem('twitch_user_id');

        if (userLoginFromStorage && userIdFromStorage) {
            loggedInUser = { login: userLoginFromStorage, id: userIdFromStorage, displayName: userLoginFromStorage };
            twitchUsernameEl.textContent = loggedInUser.displayName;
            channelNameStatusEl.textContent = loggedInUser.login;
            actionMessageEl.textContent = '';

            if (!appSessionToken) {
                console.warn("No session token found, API calls might fail authentication.");
                actionMessageEl.textContent = "Authentication token missing. Please log in again.";
                // Optionally redirect to login if token is essential
                // window.location.href = 'index.html';
                return;
            }

            try {
                const headers = {};
                if (appSessionToken) {
                    headers['Authorization'] = `Bearer ${appSessionToken}`;
                }
                console.log("Dashboard: Sending headers to /api/bot/status:", JSON.stringify(headers));

                const statusRes = await fetch(`${API_BASE_URL}/api/bot/status`, {
                    method: 'GET',
                    headers: headers
                });

                if (!statusRes.ok) {
                    if (statusRes.status === 401) {
                        actionMessageEl.textContent = "Session potentially expired or not fully established. Try logging in again.";
                        return;
                    }
                    const errorData = await statusRes.json().catch(() => ({ message: statusRes.statusText }));
                    throw new Error(`Failed to fetch status: ${errorData.message || statusRes.statusText}`);
                }
                const statusData = await statusRes.json();

                if (statusData.success) {
                    updateBotStatusUI(statusData.isActive);
                } else {
                    actionMessageEl.textContent = `Error: ${statusData.message}`;
                    botStatusEl.textContent = "Error";
                }
            } catch (error) {
                console.error('Error fetching bot status:', error);
                actionMessageEl.textContent = 'Failed to load bot status. ' + error.message;
                botStatusEl.textContent = 'Error';
            }
        } else {
            // Not logged in or info missing, redirect to index.html
            window.location.href = 'index.html';
        }
    }

    function updateBotStatusUI(isActive) {
        if (isActive) {
            botStatusEl.textContent = 'Active';
            botStatusEl.className = 'status-active';
            addBotBtn.style.display = 'none';
            removeBotBtn.style.display = 'inline-block';
        } else {
            botStatusEl.textContent = 'Inactive / Not Joined';
            botStatusEl.className = 'status-inactive';
            addBotBtn.style.display = 'inline-block';
            removeBotBtn.style.display = 'none';
        }
        actionMessageEl.textContent = ''; // Clear previous messages
    }

    addBotBtn.addEventListener('click', async () => {
        if (!appSessionToken) {
            actionMessageEl.textContent = "Authentication token missing. Please log in again.";
            return;
        }
        actionMessageEl.textContent = 'Requesting bot to join...';
        try {
            const res = await fetch(`${API_BASE_URL}/api/bot/add`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${appSessionToken}`,
                    'Content-Type': 'application/json'
                }
            });
            const data = await res.json();
            actionMessageEl.textContent = data.message;
            if (data.success) {
                updateBotStatusUI(true);
            }
        } catch (error) {
            console.error('Error adding bot:', error);
            actionMessageEl.textContent = 'Failed to send request to add bot.';
        }
    });

    removeBotBtn.addEventListener('click', async () => {
        if (!appSessionToken) {
            actionMessageEl.textContent = "Authentication token missing. Please log in again.";
            return;
        }
        actionMessageEl.textContent = 'Requesting bot to leave...';
        try {
            const res = await fetch(`${API_BASE_URL}/api/bot/remove`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${appSessionToken}`,
                    'Content-Type': 'application/json'
                }
            });
            const data = await res.json();
            actionMessageEl.textContent = data.message;
            if (data.success) {
                updateBotStatusUI(false);
            }
        } catch (error) {
            console.error('Error removing bot:', error);
            actionMessageEl.textContent = 'Failed to send request to remove bot.';
        }
    });

    logoutLink.addEventListener('click', (e) => {
        e.preventDefault();
        localStorage.removeItem('twitch_user_login');
        localStorage.removeItem('twitch_user_id');
        localStorage.removeItem('app_session_token'); // Clear JWT
        appSessionToken = null; // Clear in-memory token
        // Optionally call a backend /auth/logout endpoint
        window.location.href = 'index.html';
    });

    initializeDashboard();
});

        // JavaScript for TTS URL field and copy button
        document.addEventListener('DOMContentLoaded', () => {
            const ttsUrlField = document.getElementById('tts-url-field');
            const copyTtsUrlBtn = document.getElementById('copy-tts-url-btn');
            const twitchUsernameEl = document.getElementById('twitch-username');
            const copyStatusEl = document.getElementById('copy-status-message');

            // Function to update the TTS URL. This should be called when the username is known.
            function updateTtsUrl(username) {
                if (username && username !== 'loading...') {
                    // IMPORTANT: Replace with your ACTUAL ChatVibes TTS URL structure
                    const baseUrl = 'https://your-chatvibes-project-id.cloudfunctions.net/ttsHandler'; // Example base URL
                    ttsUrlField.value = `${baseUrl}?channel=${username.toLowerCase()}`;
                } else {
                    ttsUrlField.value = ''; // Clear if username is not available
                }
            }

            // --- Integration with your existing dashboard.js logic ---
            // dashboard.js should already be fetching and displaying the Twitch username.
            // We need to tap into that to get the username.

            // Option 1: If dashboard.js sets the username text content reliably, use a MutationObserver.
            const observer = new MutationObserver(mutations => {
                mutations.forEach(mutation => {
                    if (mutation.target === twitchUsernameEl && twitchUsernameEl.textContent && twitchUsernameEl.textContent !== 'loading...') {
                        updateTtsUrl(twitchUsernameEl.textContent);
                        // observer.disconnect(); // Optional: disconnect if only needed once
                    }
                });
            });
            observer.observe(twitchUsernameEl, { childList: true, characterData: true, subtree: true });
            
            // Option 2 (Alternative, if you modify dashboard.js):
            // You could have dashboard.js directly call `updateTtsUrl(loggedInUser.login)` 
            // after `loggedInUser` is populated. This is cleaner.
            // Example: In dashboard.js, after:
            // twitchUsernameEl.textContent = loggedInUser.displayName;
            // Add:
            // if (typeof updateTtsUrl === 'function') { updateTtsUrl(loggedInUser.login); }


            if (copyTtsUrlBtn) {
                copyTtsUrlBtn.addEventListener('click', () => {
                    if (!ttsUrlField.value) {
                        copyStatusEl.textContent = 'URL not available yet.';
                        setTimeout(() => copyStatusEl.textContent = '', 3000);
                        return;
                    }
                    ttsUrlField.select();
                    ttsUrlField.setSelectionRange(0, 99999); // For mobile devices

                    try {
                        navigator.clipboard.writeText(ttsUrlField.value).then(() => {
                            copyStatusEl.textContent = 'Copied to clipboard!';
                            copyTtsUrlBtn.textContent = 'Copied!';
                            setTimeout(() => {
                                copyStatusEl.textContent = '';
                                copyTtsUrlBtn.textContent = 'Copy URL';
                            }, 2000);
                        }, (err) => {
                            console.error('Failed to copy using navigator.clipboard:', err);
                            // Fallback for older browsers
                            document.execCommand('copy');
                            copyStatusEl.textContent = 'Copied (fallback)!';
                             copyTtsUrlBtn.textContent = 'Copied!';
                            setTimeout(() => {
                                copyStatusEl.textContent = '';
                                copyTtsUrlBtn.textContent = 'Copy URL';
                            }, 2000);
                        });
                    } catch (err) {
                        console.error('Error during copy:', err);
                        copyStatusEl.textContent = 'Failed to copy.';
                        setTimeout(() => copyStatusEl.textContent = '', 3000);
                    }
                });
            }
        });
