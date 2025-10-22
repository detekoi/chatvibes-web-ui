import { getApiBaseUrl, fetchWithAuth } from '../common/api.js';
import { logout, getStoredSessionToken } from '../common/auth.js';
import { showToast } from '../common/ui.js';
import { initPreferencesModule } from './preferences.js';
import { initChannelContextModule } from './channel-context.js';
import { initDangerZoneModule } from './danger-zone.js';

document.addEventListener('DOMContentLoaded', () => {
    (async function bootstrap() {
        const TEST_MODE = new URLSearchParams(window.location.search).has('test');
        const urlParams = new URLSearchParams(window.location.search);
        const initialChannel = urlParams.get('channel');
        const token = urlParams.get('token');

        const apiBaseUrl = getApiBaseUrl();

        const elements = {
            authStatus: document.getElementById('auth-status'),
            loggedInStatus: document.getElementById('logged-in-status'),
            loggedInUsername: document.getElementById('logged-in-username'),
            preferencesPanel: document.getElementById('preferences-panel'),
            logoutLink: document.getElementById('logout-link'),
        };

        const state = {
            sessionToken: getStoredSessionToken(),
            currentChannel: initialChannel,
            isAuthenticated: false,
        };

        const services = {
            getSessionToken: () => state.sessionToken,
            setSessionToken: (tokenValue) => {
                state.sessionToken = tokenValue;
                if (tokenValue) {
                    localStorage.setItem('app_session_token', tokenValue);
                } else {
                    localStorage.removeItem('app_session_token');
                }
            },
            getCurrentChannel: () => state.currentChannel,
            setCurrentChannel: (channelName) => {
                state.currentChannel = channelName;
            },
        };

        const channelContextModule = initChannelContextModule(
            { testMode: TEST_MODE },
            {
                setCurrentChannel: (channel) => {
                    state.currentChannel = channel;
                },
                getCurrentChannel: services.getCurrentChannel,
            },
            {
                onChannelChange: handleChannelChange,
            }
        );

        const preferencesModule = initPreferencesModule(
            { apiBaseUrl, testMode: TEST_MODE },
            { getCurrentChannel: services.getCurrentChannel },
            {
                onPreferencesLoaded: ({ ignoreStatus }) => {
                    if (state.currentChannel) {
                        dangerZoneModule.updateChannel(state.currentChannel, ignoreStatus);
                    } else {
                        dangerZoneModule.clear();
                    }
                },
            }
        );

        const dangerZoneModule = initDangerZoneModule(
            { apiBaseUrl, testMode: TEST_MODE },
            { getCurrentChannel: services.getCurrentChannel },
            {
                requestChannel: channelContextModule.openChannelPrompt,
            }
        );

        if (elements.logoutLink) {
            elements.logoutLink.addEventListener('click', (e) => {
                e.preventDefault();
                logout();
            });
        }

        const authenticated = await initializeAuth(token);
        if (!authenticated) {
            return;
        }

        await preferencesModule.loadVoices();

        // Ensure initial channel context is reflected in UI
        if (state.currentChannel) {
            channelContextModule.setChannelUI(state.currentChannel);
        } else {
            channelContextModule.clearChannelUI();
        }

        await handleChannelChange(state.currentChannel);

        async function handleChannelChange(channelName) {
            if (channelName) {
                channelContextModule.setChannelUI(channelName);
            } else {
                channelContextModule.clearChannelUI();
            }

            try {
                const info = await preferencesModule.loadPreferences();
                if (channelName) {
                    dangerZoneModule.updateChannel(channelName, info?.ignoreStatus);
                } else {
                    dangerZoneModule.clear();
                }
            } catch (_) {
                if (!channelName) {
                    dangerZoneModule.clear();
                }
            }
        }

        async function initializeAuth(tokenParam) {
            if (TEST_MODE) {
                state.isAuthenticated = true;
                state.sessionToken = 'TEST_SESSION_TOKEN';
                showAuthStatus('', 'info');
                revealPreferencesPanel();
                if (elements.loggedInStatus) elements.loggedInStatus.style.display = 'block';
                if (elements.loggedInUsername) elements.loggedInUsername.textContent = 'Test User';
                if (state.currentChannel) {
                    channelContextModule.setChannelUI(state.currentChannel);
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
                    services.setSessionToken(sessionTokenParam);
                    const tokenParts = sessionTokenParam.split('.');
                    let userDisplayName = null;
                    if (tokenParts.length === 3) {
                        const payload = JSON.parse(atob(tokenParts[1]));
                        localStorage.setItem('twitch_user_login', payload.userLogin);
                        localStorage.setItem('token_user', payload.tokenUser);
                        localStorage.setItem('token_channel', payload.tokenChannel);
                        userDisplayName = payload.displayName || payload.userLogin;
                    }
                    state.isAuthenticated = true;
                    revealPreferencesPanel();
                    showAuthStatus('', 'info');
                    if (elements.loggedInStatus) elements.loggedInStatus.style.display = 'block';
                    if (elements.loggedInUsername) elements.loggedInUsername.textContent = userDisplayName || 'User';
                    if (state.currentChannel) {
                        channelContextModule.setChannelUI(state.currentChannel);
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

            if (tokenParam) {
                return await exchangeInviteToken(tokenParam);
            }

            return await checkExistingSession();
        }

        async function exchangeInviteToken(tokenParam) {
            try {
                const response = await fetch(`${apiBaseUrl}/api/viewer/auth`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ token: tokenParam, channel: state.currentChannel }),
                });
                if (response.ok) {
                    const data = await response.json();
                    if (data.requiresTwitchAuth) {
                        return await requireTwitchAuth(tokenParam);
                    }
                    services.setSessionToken(data.sessionToken);
                    localStorage.setItem('twitch_user_login', data.user.login);
                    if (data.tokenUser && data.tokenChannel) {
                        localStorage.setItem('token_user', data.tokenUser);
                        localStorage.setItem('token_channel', data.tokenChannel);
                    }
                    state.isAuthenticated = true;
                    revealPreferencesPanel();
                    showAuthStatus('', 'info');
                    if (elements.loggedInStatus) elements.loggedInStatus.style.display = 'block';
                    if (elements.loggedInUsername) elements.loggedInUsername.textContent = data.user.displayName || data.user.login;
                    if (state.currentChannel) {
                        channelContextModule.setChannelUI(state.currentChannel);
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
        }

        async function requireTwitchAuth(tokenParam) {
            showAuthStatus('Please verify your Twitch identity to access viewer preferences.', 'info');
            const loginButton = document.createElement('button');
            loginButton.textContent = 'Sign in with Twitch';
            loginButton.className = 'btn btn-primary mt-2';
            loginButton.onclick = async () => {
                try {
                    showAuthStatus('Redirecting to Twitch for authentication...', 'info');
                    const authUrl = tokenParam && state.currentChannel
                        ? `${apiBaseUrl}/auth/twitch/viewer?token=${encodeURIComponent(tokenParam)}&channel=${encodeURIComponent(state.currentChannel)}`
                        : `${apiBaseUrl}/auth/twitch/viewer`;
                    const response = await fetch(authUrl);
                    const data = await response.json();
                    if (data.success && data.twitchAuthUrl && data.state) {
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
            if (elements.authStatus) {
                elements.authStatus.appendChild(loginButton);
            }
            return false;
        }

        async function checkExistingSession() {
            const storedToken = services.getSessionToken();
            const tokenUser = localStorage.getItem('token_user');
            const currentUser = localStorage.getItem('twitch_user_login');

            if (!storedToken) {
                return requireTwitchAuth();
            }

            if (tokenUser && currentUser && tokenUser !== currentUser) {
                showAuthStatus('Access denied: You can only access your own preferences.', 'error');
                localStorage.clear();
                setTimeout(() => { window.location.href = '/'; }, 3000);
                return false;
            }

            try {
                const response = await fetchWithAuth(`${apiBaseUrl}/api/auth/status`);
                const data = await response.json();
                if (data.success === true && data.user) {
                    state.isAuthenticated = true;
                    revealPreferencesPanel();
                    showAuthStatus('', 'info');
                    if (elements.loggedInStatus) elements.loggedInStatus.style.display = 'block';
                    if (elements.loggedInUsername) elements.loggedInUsername.textContent = data.user.displayName || data.user.userLogin || data.user.login;
                    return true;
                }
                throw new Error('Not authenticated');
            } catch (error) {
                console.error('Session check failed:', error);
                services.setSessionToken(null);
                return requireTwitchAuth();
            }
        }

        function showAuthStatus(message, type = 'info') {
            if (!elements.authStatus) return;
            if (message) {
                elements.authStatus.innerHTML = message;
                elements.authStatus.style.display = 'block';
                const klass = type === 'success' ? 'alert-success' : type === 'error' ? 'alert-danger' : 'alert-info';
                elements.authStatus.className = `alert ${klass} text-center`;
            } else {
                elements.authStatus.innerHTML = '';
                elements.authStatus.className = '';
                elements.authStatus.style.display = 'none';
            }
        }

        function revealPreferencesPanel() {
            if (elements.preferencesPanel) {
                elements.preferencesPanel.style.display = 'block';
            }
        }
    })();
});
