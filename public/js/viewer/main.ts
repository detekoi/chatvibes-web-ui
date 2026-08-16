import { getApiBaseUrl, fetchWithAuth } from '../common/api.js';
import { logout, getStoredSessionToken, decodeJwtPayload } from '../common/auth.js';
import { setProgress } from '../common/ui.js';
import {
    initPreferencesModule,
    type PreferencesModule,
    type PreferencesInfo,
} from './preferences.js';
import {
    initChannelContextModule,
    type ChannelContextAPI,
} from './channel-context.js';
import {
    initDangerZoneModule,
    type DangerZoneModule,
} from './danger-zone.js';

// JWT payload structure
interface JWTPayload {
    userLogin: string;
    displayName?: string;
    tokenUser?: string;
    tokenChannel?: string;
}

// DOM elements interface
interface ViewerElements {
    authStatus: HTMLElement | null;
    loadingOverlay: HTMLElement | null;
    loadingBar: HTMLElement | null;
    loggedInStatus: HTMLElement | null;
    loggedInUsername: HTMLElement | null;
    preferencesPanel: HTMLElement | null;
    logoutLink: HTMLAnchorElement | null;
}

// Application state interface
interface ViewerState {
    sessionToken: string | null;
    currentChannel: string | null;
    isAuthenticated: boolean;
}

// Services interface
interface ViewerServices {
    getSessionToken: () => string | null;
    setSessionToken: (tokenValue: string | null) => void;
    getCurrentChannel: () => string | null;
    setCurrentChannel: (channelName: string | null) => void;
}

// API response types
interface AuthResponse {
    success?: boolean;
    requiresTwitchAuth?: boolean;
    sessionToken?: string;
    user?: {
        login: string;
        displayName?: string;
    };
    tokenUser?: string;
    tokenChannel?: string;
    error?: string;
}

interface AuthStatusResponse {
    success: boolean;
    user?: {
        displayName?: string;
        userLogin?: string;
        login?: string;
    };
}

type AuthStatusType = 'info' | 'success' | 'error';

document.addEventListener('DOMContentLoaded', () => {
    (async function bootstrap(): Promise<void> {
        const TEST_MODE = new URLSearchParams(window.location.search).has('test');
        const urlParams = new URLSearchParams(window.location.search);
        const initialChannel = urlParams.get('channel');
        const token = urlParams.get('token');

        const apiBaseUrl = getApiBaseUrl();

        const elements: ViewerElements = {
            authStatus: document.getElementById('auth-status'),
            loadingOverlay: document.getElementById('loading-overlay'),
            loadingBar: document.getElementById('loading-bar'),
            loggedInStatus: document.getElementById('logged-in-status'),
            loggedInUsername: document.getElementById('logged-in-username'),
            preferencesPanel: document.getElementById('preferences-panel'),
            logoutLink: document.getElementById('logout-link') as HTMLAnchorElement | null,
        };

        const state: ViewerState = {
            sessionToken: getStoredSessionToken(),
            currentChannel: initialChannel,
            isAuthenticated: false,
        };

        const services: ViewerServices = {
            getSessionToken: () => state.sessionToken,
            setSessionToken: (tokenValue: string | null) => {
                state.sessionToken = tokenValue;
                if (tokenValue) {
                    localStorage.setItem('app_session_token', tokenValue);
                } else {
                    localStorage.removeItem('app_session_token');
                }
            },
            getCurrentChannel: () => state.currentChannel,
            setCurrentChannel: (channelName: string | null) => {
                state.currentChannel = channelName;
            },
        };

        const channelContextModule: ChannelContextAPI = initChannelContextModule(
            { testMode: TEST_MODE },
            {
                setCurrentChannel: (channel: string | null) => {
                    state.currentChannel = channel;
                },
                getCurrentChannel: services.getCurrentChannel,
            },
            {
                onChannelChange: handleChannelChange,
            }
        );

        const preferencesModule: PreferencesModule = initPreferencesModule(
            { apiBaseUrl, testMode: TEST_MODE },
            { getCurrentChannel: (() => state.currentChannel || '') as () => string },
            {
                onPreferencesLoaded: ({ ignoreStatus }: PreferencesInfo) => {
                    if (state.currentChannel) {
                        dangerZoneModule.updateChannel(state.currentChannel, ignoreStatus);
                    } else {
                        dangerZoneModule.clear();
                    }
                },
            }
        );

        const dangerZoneModule: DangerZoneModule = initDangerZoneModule(
            { apiBaseUrl, testMode: TEST_MODE },
            { getCurrentChannel: services.getCurrentChannel },
            {
                requestChannel: channelContextModule.openChannelPrompt,
            }
        );

        if (elements.logoutLink) {
            elements.logoutLink.addEventListener('click', (e: Event) => {
                e.preventDefault();
                logout();
            });
        }

        const authenticated = await initializeAuth(token);
        if (!authenticated) {
            return;
        }

        showLoading();
        setProgress(elements.loadingBar, 0, 2);
        await preferencesModule.loadVoices();
        setProgress(elements.loadingBar, 1, 2);

        // Ensure initial channel context is reflected in UI
        if (state.currentChannel) {
            channelContextModule.setChannelUI(state.currentChannel);
        } else {
            channelContextModule.clearChannelUI();
        }

        await handleChannelChange(state.currentChannel);
        setProgress(elements.loadingBar, 2, 2);
        hideLoading();

        async function handleChannelChange(channelName: string | null): Promise<void> {
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

        async function initializeAuth(tokenParam: string | null): Promise<boolean> {
            if (TEST_MODE) {
                state.isAuthenticated = true;
                state.sessionToken = 'TEST_SESSION_TOKEN';
                showAuthStatus('', 'info');
                revealPreferencesPanel();
                if (elements.loggedInStatus) elements.loggedInStatus.style.display = '';
                if (elements.loggedInUsername) elements.loggedInUsername.textContent = 'Test User';
                if (state.currentChannel) {
                    channelContextModule.setChannelUI(state.currentChannel);
                }
                return true;
            }

            const urlParams = new URLSearchParams(window.location.search);
            const exchangeCodeParam = urlParams.get('code');
            const sessionTokenParam = urlParams.get('session_token');
            const validatedParam = urlParams.get('validated');
            // No `?error=` handling here on purpose: every OAuth failure now
            // redirects to auth-error.html, so nothing reaches this page with
            // an error to render.

            // The callback hands over a single-use code, not the token, so the
            // token never appears in the URL. Strip the code first: it is spent
            // by the exchange below, and should not survive in history either.
            if (exchangeCodeParam && validatedParam) {
                cleanAuthParamsFromUrl();
                return await redeemExchangeCode(exchangeCodeParam);
            }

            // The old shape, still accepted for anyone mid-flow across a deploy.
            if (sessionTokenParam && validatedParam) {
                try {
                    services.setSessionToken(sessionTokenParam);
                    let userDisplayName: string | null = null;
                    const payload = decodeJwtPayload<JWTPayload>(sessionTokenParam);
                    if (payload) {
                        localStorage.setItem('twitch_user_login', payload.userLogin);
                        localStorage.setItem('token_user', payload.tokenUser || '');
                        localStorage.setItem('token_channel', payload.tokenChannel || '');
                        userDisplayName = payload.displayName || payload.userLogin;
                    }
                    state.isAuthenticated = true;
                    revealPreferencesPanel();
                    showAuthStatus('', 'info');
                    if (elements.loggedInStatus) elements.loggedInStatus.style.display = '';
                    if (elements.loggedInUsername) elements.loggedInUsername.textContent = userDisplayName || 'User';
                    if (state.currentChannel) {
                        channelContextModule.setChannelUI(state.currentChannel);
                    }
                    cleanAuthParamsFromUrl();
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

        /**
         * Removes the sign-in parameters from the address bar, leaving the
         * channel context in place. Keeps a spent code out of history.
         */
        function cleanAuthParamsFromUrl(): void {
            const cleanUrl = new URL(window.location.href);
            cleanUrl.searchParams.delete('code');
            cleanUrl.searchParams.delete('session_token');
            cleanUrl.searchParams.delete('validated');
            window.history.replaceState({}, '', cleanUrl.toString());
        }

        /**
         * Trades the one-time code from the callback for the session token and
         * establishes the viewer session.
         * @param code - The single-use code from the callback redirect
         * @return Whether a session was established
         */
        async function redeemExchangeCode(code: string): Promise<boolean> {
            try {
                const response = await fetch(`${apiBaseUrl}/auth/exchange`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ code }),
                });

                const data = await response.json().catch(() => ({}));
                if (!response.ok || !data.success || !data.session_token) {
                    throw new Error(data.error || 'Could not complete sign-in.');
                }

                services.setSessionToken(data.session_token);

                let userDisplayName: string | null = null;
                const payload = decodeJwtPayload<JWTPayload>(data.session_token);
                if (payload) {
                    localStorage.setItem('twitch_user_login', payload.userLogin);
                    localStorage.setItem('token_user', payload.tokenUser || '');
                    localStorage.setItem('token_channel', payload.tokenChannel || '');
                    userDisplayName = payload.displayName || payload.userLogin;
                }

                state.isAuthenticated = true;
                revealPreferencesPanel();
                showAuthStatus('', 'info');
                if (elements.loggedInStatus) elements.loggedInStatus.style.display = '';
                if (elements.loggedInUsername) elements.loggedInUsername.textContent = userDisplayName || 'User';
                if (state.currentChannel) {
                    channelContextModule.setChannelUI(state.currentChannel);
                }
                return true;
            } catch (error) {
                // A code is single-use, so reloading cannot retry this.
                console.error('Failed to redeem exchange code:', error);
                showAuthStatus(
                    'Could not finish signing you in. Please try again from the main page.',
                    'error',
                );
                return false;
            }
        }

        async function exchangeInviteToken(tokenParam: string): Promise<boolean> {
            try {
                const response = await fetch(`${apiBaseUrl}/api/viewer/auth`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ token: tokenParam, channel: state.currentChannel }),
                });
                if (response.ok) {
                    const data: AuthResponse = await response.json();
                    if (data.requiresTwitchAuth) {
                        return await requireTwitchAuth(tokenParam);
                    }
                    if (data.sessionToken) {
                        services.setSessionToken(data.sessionToken);
                    }
                    if (data.user?.login) {
                        localStorage.setItem('twitch_user_login', data.user.login);
                    }
                    if (data.tokenUser && data.tokenChannel) {
                        localStorage.setItem('token_user', data.tokenUser);
                        localStorage.setItem('token_channel', data.tokenChannel);
                    }
                    state.isAuthenticated = true;
                    revealPreferencesPanel();
                    showAuthStatus('', 'info');
                    if (elements.loggedInStatus) elements.loggedInStatus.style.display = '';
                    if (elements.loggedInUsername && data.user) {
                        elements.loggedInUsername.textContent = data.user.displayName || data.user.login;
                    }
                    if (state.currentChannel) {
                        channelContextModule.setChannelUI(state.currentChannel);
                    }
                    return true;
                } else if (response.status === 403) {
                    const data: AuthResponse = await response.json();
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

        async function requireTwitchAuth(tokenParam?: string): Promise<boolean> {
            showAuthStatus('Please verify your Twitch identity to access viewer preferences.', 'info');
            const loginButton = document.createElement('button');
            loginButton.textContent = 'Sign in with Twitch';
            loginButton.className = 'btn btn-primary mt-2';
            // The server mints the state cookie and issues the redirect, so
            // this just navigates. The channel rides along as a query param
            // and the server stores it in the cookie for the callback.
            loginButton.onclick = () => {
                showAuthStatus('Redirecting to Twitch for authentication...', 'info');

                // Built independently: requiring a token before sending the
                // channel dropped the channel for anyone arriving at
                // viewer-settings.html?channel=... without an invite token,
                // so they came back from Twitch with no channel context.
                const params = new URLSearchParams();
                if (tokenParam) params.set('token', tokenParam);
                if (state.currentChannel) params.set('channel', state.currentChannel);

                const query = params.toString();
                window.location.href = query
                    ? `${apiBaseUrl}/auth/twitch/viewer?${query}`
                    : `${apiBaseUrl}/auth/twitch/viewer`;
            };
            if (elements.authStatus) {
                elements.authStatus.appendChild(loginButton);
            }
            return false;
        }

        async function checkExistingSession(): Promise<boolean> {
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
                const data: AuthStatusResponse = await response.json();
                if (data.success === true && data.user) {
                    state.isAuthenticated = true;
                    revealPreferencesPanel();
                    showAuthStatus('', 'info');
                    if (elements.loggedInStatus) elements.loggedInStatus.style.display = '';
                    if (elements.loggedInUsername) {
                        elements.loggedInUsername.textContent = data.user.displayName || data.user.userLogin || data.user.login || 'User';
                    }
                    return true;
                }
                throw new Error('Not authenticated');
            } catch (error) {
                console.error('Session check failed:', error);
                services.setSessionToken(null);
                return requireTwitchAuth();
            }
        }

        function showAuthStatus(message: string, type: AuthStatusType = 'info'): void {
            if (!elements.authStatus) return;
            if (message) {
                elements.authStatus.textContent = message;
                elements.authStatus.style.display = 'block';
                const klass = type === 'success' ? 'alert-success' : type === 'error' ? 'alert-danger' : 'alert-info';
                elements.authStatus.className = `alert ${klass} text-center`;
            } else {
                elements.authStatus.textContent = '';
                elements.authStatus.className = '';
                elements.authStatus.style.display = 'none';
            }
        }

        function showLoading(): void {
            if (elements.loadingOverlay) elements.loadingOverlay.style.display = '';
            if (elements.preferencesPanel) elements.preferencesPanel.style.display = 'none';
        }

        function hideLoading(): void {
            if (elements.loadingOverlay) elements.loadingOverlay.style.display = 'none';
            if (elements.preferencesPanel) elements.preferencesPanel.style.display = 'block';
        }

        function revealPreferencesPanel(): void {
            if (elements.preferencesPanel) {
                elements.preferencesPanel.style.display = 'block';
            }
        }
    })();
});
