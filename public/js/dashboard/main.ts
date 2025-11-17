import { getApiBaseUrl } from '../common/api.js';
import { getStoredSessionToken, getStoredUser, logout, StoredUser } from '../common/auth.js';
import { showToast } from '../common/ui.js';
import { initBotManagement, BotManagementModule } from './bot-management.js';
import { initObsModule, ObsModule } from './obs.js';
import { initSettingsModule } from './settings.js';
import { initChannelPointsModule, ChannelPointsModule } from './channel-points.js';
import { initIgnoreListModule, IgnoreListModule } from './ignore-list.js';

/**
 * Dashboard application state
 */
interface DashboardState {
  sessionToken: string | null;
  loggedInUser: StoredUser | null;
}

/**
 * Services provided to dashboard modules
 */
interface DashboardServices {
  getSessionToken: () => string | null;
  getLoggedInUser: () => StoredUser | null;
}

/**
 * Settings module interface
 */
interface SettingsModule {
  initialize: () => Promise<void>;
  loadSettings: () => Promise<void>;
}

/**
 * JWT token payload
 */
interface JwtPayload {
  scope?: string;
  [key: string]: unknown;
}

/**
 * Auth initiate API response
 */
interface AuthInitiateResponse {
  success: boolean;
  twitchAuthUrl?: string;
  state?: string;
  error?: string;
}

document.addEventListener('DOMContentLoaded', () => {
  const testMode = new URLSearchParams(window.location.search).has('test');
  const authStatus = document.getElementById('auth-status') as HTMLDivElement | null;
  const loadingOverlay = document.getElementById('loading-overlay') as HTMLDivElement | null;
  const dashboardContent = document.getElementById('dashboard-content') as HTMLDivElement | null;
  const twitchUsernameEl = document.getElementById('twitch-username') as HTMLElement | null;
  const channelNameStatusEl = document.getElementById('channel-name-status') as HTMLElement | null;
  const botStatusEl = document.getElementById('bot-status') as HTMLElement | null;
  const addBotBtn = document.getElementById('add-bot-btn') as HTMLButtonElement | null;
  const removeBotBtn = document.getElementById('remove-bot-btn') as HTMLButtonElement | null;
  const logoutLink = document.getElementById('logout-link') as HTMLAnchorElement | null;
  const ttsUrlField = document.getElementById('tts-url-field') as HTMLInputElement | null;
  const copyTtsUrlBtn = document.getElementById('copy-tts-url-btn') as HTMLButtonElement | null;
  const regenerateTtsUrlBtn = document.getElementById('regenerate-tts-url-btn') as HTMLButtonElement | null;

  const apiBaseUrl = getApiBaseUrl();
  const botApiBaseUrl = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? 'http://localhost:8080/api'
    : 'https://chatvibes-tts-service-h7kj56ct4q-uc.a.run.app/api';

  const state: DashboardState = {
    sessionToken: getStoredSessionToken(),
    loggedInUser: getStoredUser(),
  };

  const services: DashboardServices = {
    getSessionToken: () => state.sessionToken,
    getLoggedInUser: () => state.loggedInUser,
  };

  const ignoreModule: IgnoreListModule = initIgnoreListModule({ botApiBaseUrl, testMode }, services);
  const settingsModule: SettingsModule = initSettingsModule({ botApiBaseUrl, testMode }, services, {
    displayIgnoreList: ignoreModule.displayIgnoreList,
  });
  ignoreModule.setOnChange(() => settingsModule.loadSettings());

  const botModule: BotManagementModule = initBotManagement({ botStatusEl, addBotBtn, removeBotBtn }, { apiBaseUrl, testMode }, services);
  const obsModule: ObsModule = initObsModule({ ttsUrlField, copyTtsUrlBtn, regenerateTtsUrlBtn }, { apiBaseUrl, testMode }, services);
  const channelPointsModule: ChannelPointsModule = initChannelPointsModule({ apiBaseUrl, testMode }, services, {
    onSettingsRefresh: () => settingsModule.loadSettings(),
  });

  if (logoutLink) {
    logoutLink.addEventListener('click', (e: Event) => {
      e.preventDefault();
      logout();
    });
  }

  initializeDashboard();

  async function initializeDashboard(): Promise<void> {
    if (state.sessionToken && isViewerToken(state.sessionToken)) {
      showViewerTokenMessage();
      return;
    }

    if (testMode) {
      state.sessionToken = 'TEST_SESSION_TOKEN';
      state.loggedInUser = { login: 'demostreamer', id: '123456', displayName: 'Demo Streamer' };
      showDashboard();
      showLoading();
      await obsModule.loadExistingTtsUrl(state.loggedInUser.login);
      botModule.updateBotStatusUI(false);
      await settingsModule.initialize();
      await channelPointsModule.load();
      hideLoading();
      return;
    }

    if (state.loggedInUser?.login) {
      showDashboard();
      if (!state.sessionToken) {
        showToast('Authentication token missing. Please log in again.', 'error');
        return;
      }
      showLoading();
      await Promise.all([
        obsModule.loadExistingTtsUrl(state.loggedInUser.login),
        botModule.refreshStatus(),
        settingsModule.initialize(),
        channelPointsModule.load(),
      ]);
      hideLoading();
    } else {
      showLoginPrompt();
    }
  }

  function showLoading(): void {
    if (loadingOverlay) loadingOverlay.style.display = 'block';
    if (dashboardContent) dashboardContent.style.display = 'none';
  }

  function hideLoading(): void {
    if (loadingOverlay) loadingOverlay.style.display = 'none';
    if (dashboardContent) dashboardContent.style.display = 'flex';
  }

  function isViewerToken(token: string): boolean {
    try {
      const payload = JSON.parse(atob(token.split('.')[1])) as JwtPayload;
      return payload.scope === 'viewer';
    } catch (error) {
      console.error('Error decoding token:', error);
      return false;
    }
  }

  function showDashboard(): void {
    if (authStatus) {
      authStatus.innerHTML = '';
      authStatus.className = '';
      authStatus.style.display = 'none';
    }
    if (dashboardContent) dashboardContent.style.display = 'flex';
    if (twitchUsernameEl) twitchUsernameEl.textContent = state.loggedInUser?.displayName || state.loggedInUser?.login || 'loading…';
    if (channelNameStatusEl) channelNameStatusEl.textContent = state.loggedInUser?.login || '';
  }

  function showViewerTokenMessage(): void {
    if (dashboardContent) dashboardContent.style.display = 'none';
    if (authStatus) {
      authStatus.innerHTML = '';
      authStatus.className = 'alert alert-info text-center';
      authStatus.style.display = 'block';

      const message = document.createElement('p');
      message.textContent = 'Please sign in with your broadcaster account to access streamer settings.';
      message.style.marginBottom = '1.5rem';
      authStatus.appendChild(message);

      // Create tier selection container
      const tierContainer = document.createElement('div');
      tierContainer.style.display = 'flex';
      tierContainer.style.gap = '1rem';
      tierContainer.style.justifyContent = 'center';
      tierContainer.style.flexWrap = 'wrap';

      // Bot-Free mode option
      const anonymousCard = document.createElement('div');
      anonymousCard.style.cssText = 'border: 2px solid #6441a5; border-radius: 8px; padding: 1.5rem; max-width: 300px; cursor: pointer; transition: transform 0.2s;';
      anonymousCard.innerHTML = `
        <h5 style="margin-bottom: 0.75rem;">🎤 Bot-Free Mode</h5>
        <p style="font-size: 0.9rem; margin-bottom: 1rem;">No bot in chat • Channel points work</p>
        <ul style="text-align: left; font-size: 0.85rem; margin-bottom: 1rem;">
          <li>Bot hidden from viewer list</li>
          <li>Create custom TTS rewards</li>
          <li>OBS browser source</li>
        </ul>
        <button class="btn btn-primary">Sign in with Twitch</button>
      `;
      anonymousCard.onmouseover = () => anonymousCard.style.transform = 'scale(1.02)';
      anonymousCard.onmouseout = () => anonymousCard.style.transform = 'scale(1)';
      anonymousCard.onclick = () => redirectToTwitch('anonymous');

      // Chatbot mode option
      const fullCard = document.createElement('div');
      fullCard.style.cssText = 'border: 2px solid #6441a5; border-radius: 8px; padding: 1.5rem; max-width: 300px; cursor: pointer; transition: transform 0.2s;';
      fullCard.innerHTML = `
        <h5 style="margin-bottom: 0.75rem;">🤖 Chatbot Mode</h5>
        <p style="font-size: 0.9rem; margin-bottom: 1rem;">Bot responds to commands in chat</p>
        <ul style="text-align: left; font-size: 0.85rem; margin-bottom: 1rem;">
          <li>Everything in Bot-Free mode</li>
          <li>Chat command responses</li>
          <li>Interactive TTS control</li>
        </ul>
        <button class="btn btn-primary">Sign in with Twitch</button>
      `;
      fullCard.onmouseover = () => fullCard.style.transform = 'scale(1.02)';
      fullCard.onmouseout = () => fullCard.style.transform = 'scale(1)';
      fullCard.onclick = () => redirectToTwitch('full');

      tierContainer.appendChild(anonymousCard);
      tierContainer.appendChild(fullCard);
      authStatus.appendChild(tierContainer);
    }
  }

  function showLoginPrompt(): void {
    if (dashboardContent) dashboardContent.style.display = 'none';
    if (authStatus) {
      authStatus.innerHTML = '';
      authStatus.className = 'alert alert-info text-center';
      authStatus.style.display = 'block';

      const message = document.createElement('p');
      message.textContent = 'Choose your authentication mode:';
      message.style.marginBottom = '1.5rem';
      authStatus.appendChild(message);

      // Create tier selection container
      const tierContainer = document.createElement('div');
      tierContainer.style.display = 'flex';
      tierContainer.style.gap = '1rem';
      tierContainer.style.justifyContent = 'center';
      tierContainer.style.flexWrap = 'wrap';

      // Bot-Free mode option
      const anonymousCard = document.createElement('div');
      anonymousCard.style.cssText = 'border: 2px solid #6441a5; border-radius: 8px; padding: 1.5rem; max-width: 300px; cursor: pointer; transition: transform 0.2s;';
      anonymousCard.innerHTML = `
        <h5 style="margin-bottom: 0.75rem;">🎤 Bot-Free Mode</h5>
        <p style="font-size: 0.9rem; margin-bottom: 1rem;">No bot in chat • Channel points work</p>
        <ul style="text-align: left; font-size: 0.85rem; margin-bottom: 1rem;">
          <li>Bot hidden from viewer list</li>
          <li>Create custom TTS rewards</li>
          <li>OBS browser source</li>
        </ul>
        <button class="btn btn-primary">Sign in with Twitch</button>
      `;
      anonymousCard.onmouseover = () => anonymousCard.style.transform = 'scale(1.02)';
      anonymousCard.onmouseout = () => anonymousCard.style.transform = 'scale(1)';
      anonymousCard.onclick = () => redirectToTwitch('anonymous');

      // Chatbot mode option
      const fullCard = document.createElement('div');
      fullCard.style.cssText = 'border: 2px solid #6441a5; border-radius: 8px; padding: 1.5rem; max-width: 300px; cursor: pointer; transition: transform 0.2s;';
      fullCard.innerHTML = `
        <h5 style="margin-bottom: 0.75rem;">🤖 Chatbot Mode</h5>
        <p style="font-size: 0.9rem; margin-bottom: 1rem;">Bot responds to commands in chat</p>
        <ul style="text-align: left; font-size: 0.85rem; margin-bottom: 1rem;">
          <li>Everything in Bot-Free mode</li>
          <li>Chat command responses</li>
          <li>Interactive TTS control</li>
        </ul>
        <button class="btn btn-primary">Sign in with Twitch</button>
      `;
      fullCard.onmouseover = () => fullCard.style.transform = 'scale(1.02)';
      fullCard.onmouseout = () => fullCard.style.transform = 'scale(1)';
      fullCard.onclick = () => redirectToTwitch('full');

      tierContainer.appendChild(anonymousCard);
      tierContainer.appendChild(fullCard);
      authStatus.appendChild(tierContainer);
    }
  }

  async function redirectToTwitch(tier: 'anonymous' | 'full' = 'full'): Promise<void> {
    if (!authStatus) return;
    authStatus.innerHTML = '<p>Redirecting to Twitch for authentication...</p>';
    try {
      const response = await fetch(`${apiBaseUrl}/auth/twitch/initiate?tier=${tier}`);
      if (!response.ok) {
        throw new Error(`Failed to initiate auth: ${response.statusText}`);
      }
      const data = await response.json() as AuthInitiateResponse;
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
