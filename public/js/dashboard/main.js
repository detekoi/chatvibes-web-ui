import { getApiBaseUrl } from '../common/api.js';
import { getStoredSessionToken, getStoredUser, logout } from '../common/auth.js';
import { showToast } from '../common/ui.js';
import { initBotManagement } from './bot-management.js';
import { initObsModule } from './obs.js';
import { initSettingsModule } from './settings.js';
import { initChannelPointsModule } from './channel-points.js';
import { initIgnoreListModule } from './ignore-list.js';

document.addEventListener('DOMContentLoaded', () => {
    const testMode = new URLSearchParams(window.location.search).has('test');
    const authStatus = document.getElementById('auth-status');
    const dashboardContent = document.getElementById('dashboard-content');
    const twitchUsernameEl = document.getElementById('twitch-username');
    const channelNameStatusEl = document.getElementById('channel-name-status');
    const botStatusEl = document.getElementById('bot-status');
    const addBotBtn = document.getElementById('add-bot-btn');
    const removeBotBtn = document.getElementById('remove-bot-btn');
    const logoutLink = document.getElementById('logout-link');
    const ttsUrlField = document.getElementById('tts-url-field');
    const copyTtsUrlBtn = document.getElementById('copy-tts-url-btn');
    const regenerateTtsUrlBtn = document.getElementById('regenerate-tts-url-btn');

    const apiBaseUrl = getApiBaseUrl();
    const botApiBaseUrl = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
        ? 'http://localhost:8080/api'
        : 'https://chatvibes-tts-service-h7kj56ct4q-uc.a.run.app/api';

    const state = {
        sessionToken: getStoredSessionToken(),
        loggedInUser: getStoredUser(),
    };

    const services = {
        getSessionToken: () => state.sessionToken,
        getLoggedInUser: () => state.loggedInUser,
    };

    const ignoreModule = initIgnoreListModule({ botApiBaseUrl, testMode }, services);
    const settingsModule = initSettingsModule({ botApiBaseUrl, testMode }, services, {
        displayIgnoreList: ignoreModule.displayIgnoreList,
    });
    ignoreModule.setOnChange(() => settingsModule.loadSettings());

    const botModule = initBotManagement({ botStatusEl, addBotBtn, removeBotBtn }, { apiBaseUrl, testMode }, services);
    const obsModule = initObsModule({ ttsUrlField, copyTtsUrlBtn, regenerateTtsUrlBtn }, { apiBaseUrl, testMode }, services);
    const channelPointsModule = initChannelPointsModule({ apiBaseUrl, testMode }, services, {
        onSettingsRefresh: () => settingsModule.loadSettings(),
    });

    if (logoutLink) {
        logoutLink.addEventListener('click', (e) => {
            e.preventDefault();
            logout();
        });
    }

    initializeDashboard();

    async function initializeDashboard() {
        if (state.sessionToken && isViewerToken(state.sessionToken)) {
            showViewerTokenMessage();
            return;
        }

        if (testMode) {
            state.sessionToken = 'TEST_SESSION_TOKEN';
            state.loggedInUser = { login: 'demostreamer', id: '123456', displayName: 'Demo Streamer' };
            showDashboard();
            await obsModule.loadExistingTtsUrl(state.loggedInUser.login);
            botModule.updateBotStatusUI(false);
            await settingsModule.initialize();
            await channelPointsModule.load();
            return;
        }

        if (state.loggedInUser?.login) {
            showDashboard();
            if (!state.sessionToken) {
                showToast('Authentication token missing. Please log in again.', 'error');
                return;
            }
            await Promise.all([
                obsModule.loadExistingTtsUrl(state.loggedInUser.login),
                botModule.refreshStatus(),
                settingsModule.initialize(),
                channelPointsModule.load(),
            ]);
        } else {
            showLoginPrompt();
        }
    }

    function isViewerToken(token) {
        try {
            const payload = JSON.parse(atob(token.split('.')[1]));
            return payload.scope === 'viewer';
        } catch (error) {
            console.error('Error decoding token:', error);
            return false;
        }
    }

    function showDashboard() {
        if (authStatus) {
            authStatus.innerHTML = '';
            authStatus.className = '';
            authStatus.style.display = 'none';
        }
        if (dashboardContent) dashboardContent.style.display = 'flex';
        if (twitchUsernameEl) twitchUsernameEl.textContent = state.loggedInUser?.displayName || state.loggedInUser?.login || 'loading…';
        if (channelNameStatusEl) channelNameStatusEl.textContent = state.loggedInUser?.login || '';
    }

    function showViewerTokenMessage() {
        if (dashboardContent) dashboardContent.style.display = 'none';
        if (authStatus) {
            authStatus.innerHTML = '';
            authStatus.className = 'alert alert-info text-center';
            authStatus.style.display = 'block';

            const message = document.createElement('p');
            message.textContent = 'Please sign in with your broadcaster account to access streamer settings.';
            authStatus.appendChild(message);

            const loginButton = document.createElement('button');
            loginButton.textContent = 'Sign in with Twitch';
            loginButton.className = 'btn btn-primary mt-2';
            loginButton.onclick = () => redirectToTwitch();
            authStatus.appendChild(loginButton);
        }
    }

    function showLoginPrompt() {
        if (dashboardContent) dashboardContent.style.display = 'none';
        if (authStatus) {
            authStatus.innerHTML = '';
            authStatus.className = 'alert alert-info text-center';
            authStatus.style.display = 'block';

            const message = document.createElement('p');
            message.textContent = 'Please verify your Twitch identity to access streamer settings.';
            authStatus.appendChild(message);

            const loginButton = document.createElement('button');
            loginButton.textContent = 'Sign in with Twitch';
            loginButton.className = 'btn btn-primary mt-2';
            loginButton.onclick = () => redirectToTwitch();
            authStatus.appendChild(loginButton);
        }
    }

    async function redirectToTwitch() {
        if (!authStatus) return;
        authStatus.innerHTML = '<p>Redirecting to Twitch for authentication...</p>';
        try {
            const response = await fetch(`${apiBaseUrl}/auth/twitch/initiate`);
            if (!response.ok) {
                throw new Error(`Failed to initiate auth: ${response.statusText}`);
            }
            const data = await response.json();
            if (data.success && data.twitchAuthUrl && data.state) {
                sessionStorage.setItem('oauth_csrf_state', data.state);
                window.location.href = data.twitchAuthUrl;
            } else {
                throw new Error(data.error || 'Could not initiate login with Twitch');
            }
        } catch (error) {
            console.error('Error during login initiation:', error);
            authStatus.innerHTML = '<p class="text-danger">Failed to start authentication. Please try again.</p>';
        }
    }
});
