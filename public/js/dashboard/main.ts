import { getApiBaseUrl } from '../common/api.js';
import { decodeJwtPayload, getStoredSessionToken, getStoredUser, logout, StoredUser } from '../common/auth.js';
import { showToast, trackProgress } from '../common/ui.js';
import { initBotManagement, BotManagementModule } from './bot-management.js';
import { initObsModule, ObsModule } from './obs.js';
import { initSettingsModule } from './settings.js';
import { initChannelPointsModule, ChannelPointsModule } from './channel-points.js';
import { initIgnoreListModule, IgnoreListModule } from './ignore-list.js';
import { initBannedWordsModule, BannedWordsModule } from './banned-words.js';
import { initPronunciationsModule, PronunciationsModule } from './pronunciations.js';

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

document.addEventListener('DOMContentLoaded', () => {
  const testMode = new URLSearchParams(window.location.search).has('test');
  const authStatus = document.getElementById('auth-status') as HTMLDivElement | null;
  const loadingOverlay = document.getElementById('loading-overlay') as HTMLDivElement | null;
  const loadingBar = document.getElementById('loading-bar');
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
  const obsToggleBtn = document.getElementById('obs-toggle-btn') as HTMLButtonElement | null;
  const obsPopover = document.getElementById('obs-popover') as HTMLDivElement | null;
  const obsCloseBtn = document.getElementById('obs-close-btn') as HTMLButtonElement | null;
  const apiBaseUrl = getApiBaseUrl();
  // Settings, ignore list and banned words are all served by the webUi function
  // behind the /api hosting rewrite — in local dev too, via the hosting emulator.
  const apiPrefix = `${apiBaseUrl}/api`;

  const state: DashboardState = {
    sessionToken: getStoredSessionToken(),
    loggedInUser: getStoredUser(),
  };

  const services: DashboardServices = {
    getSessionToken: () => state.sessionToken,
    getLoggedInUser: () => state.loggedInUser,
  };

  const ignoreModule: IgnoreListModule = initIgnoreListModule({ apiPrefix, testMode }, services);
  const bannedWordsModule: BannedWordsModule = initBannedWordsModule({ apiPrefix, testMode }, services);
  const pronunciationsModule: PronunciationsModule = initPronunciationsModule({ apiPrefix, testMode }, services);
  const settingsModule: SettingsModule = initSettingsModule({ apiPrefix, testMode }, services, {
    displayIgnoreList: ignoreModule.displayIgnoreList,
    displayBannedWords: bannedWordsModule.displayBannedWords,
    displayPronunciations: pronunciationsModule.displayPronunciations,
  });
  ignoreModule.setOnChange(() => settingsModule.loadSettings());
  bannedWordsModule.setOnChange(() => settingsModule.loadSettings());
  pronunciationsModule.setOnChange(() => settingsModule.loadSettings());

  const botModule: BotManagementModule = initBotManagement({ botStatusEl, addBotBtn, removeBotBtn }, { apiBaseUrl, testMode }, services);
  const obsModule: ObsModule = initObsModule({ ttsUrlField, copyTtsUrlBtn, regenerateTtsUrlBtn, obsToggleBtn, obsPopover, obsCloseBtn }, { apiBaseUrl, testMode }, services);
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
      botModule.updateBotStatusUI(false);
      await trackProgress(loadingBar, [
        () => obsModule.loadExistingTtsUrl(state.loggedInUser!.login),
        () => settingsModule.initialize(),
        () => channelPointsModule.load(),
      ]);
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
      await trackProgress(loadingBar, [
        () => obsModule.loadExistingTtsUrl(state.loggedInUser!.login),
        () => botModule.refreshStatus(),
        () => settingsModule.initialize(),
        () => channelPointsModule.load(),
      ]);
      hideLoading();
    } else {
      showLoginPrompt();
    }
  }

  function showLoading(): void {
    if (loadingOverlay) loadingOverlay.style.display = '';
    if (dashboardContent) dashboardContent.style.display = 'none';
  }

  function hideLoading(): void {
    if (loadingOverlay) loadingOverlay.style.display = 'none';
    if (dashboardContent) dashboardContent.style.display = 'flex';
  }

  function isViewerToken(token: string): boolean {
    return decodeJwtPayload<JwtPayload>(token)?.scope === 'viewer';
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

      const loginButton = document.createElement('button');
      loginButton.className = 'btn btn-primary';
      loginButton.textContent = 'Sign in with Twitch';
      loginButton.onclick = () => redirectToTwitch();
      authStatus.appendChild(loginButton);
    }
  }

  function showLoginPrompt(): void {
    if (dashboardContent) dashboardContent.style.display = 'none';
    if (authStatus) {
      authStatus.innerHTML = '';
      authStatus.className = 'alert alert-info text-center';
      authStatus.style.display = 'block';

      const message = document.createElement('p');
      message.textContent = 'Please sign in with your Twitch account to access the dashboard.';
      message.style.marginBottom = '1.5rem';
      authStatus.appendChild(message);

      const loginButton = document.createElement('button');
      loginButton.className = 'btn btn-primary';
      loginButton.textContent = 'Sign in with Twitch';
      loginButton.onclick = () => redirectToTwitch();
      authStatus.appendChild(loginButton);
    }
  }

  // The server mints the state cookie and issues the redirect, so this just
  // navigates. Nothing to fetch, no state for the browser to hold.
  function redirectToTwitch(): void {
    if (!authStatus) return;
    authStatus.innerHTML = '<p>Redirecting to Twitch for authentication...</p>';
    window.location.href = `${apiBaseUrl}/auth/twitch`;
  }
});
