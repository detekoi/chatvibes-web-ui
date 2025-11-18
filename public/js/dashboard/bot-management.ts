import { fetchWithAuth } from '../common/api.js';
import { showToast } from '../common/ui.js';

/**
 * Bot management module parameters
 */
interface BotManagementElements {
  botStatusEl: HTMLElement | null;
  oauthTierStatusEl: HTMLElement | null;
  addBotBtn: HTMLButtonElement | null;
  removeBotBtn: HTMLButtonElement | null;
  switchModeBtn: HTMLButtonElement | null;
}

/**
 * Bot management context
 */
interface BotManagementContext {
  apiBaseUrl: string;
  testMode: boolean;
}

/**
 * Bot management services
 */
interface BotManagementServices {
  getSessionToken: () => string | null;
}

/**
 * Bot status API response
 */
interface BotStatusResponse {
  success: boolean;
  isActive: boolean;
  oauthTier?: 'anonymous' | 'full';
  message?: string;
}

/**
 * Bot add/remove API response
 */
interface BotActionResponse {
  success: boolean;
  message?: string;
  code?: string;
  details?: string;
}

/**
 * Auth initiate API response
 */
interface AuthInitiateResponse {
  success: boolean;
  twitchAuthUrl?: string;
  state?: string;
  tier?: string;
  error?: string;
}

/**
 * Bot management module return type
 */
export interface BotManagementModule {
  refreshStatus: () => Promise<void>;
  updateBotStatusUI: (isActive: boolean) => void;
}

/**
 * Bot management card bindings.
 */
export function initBotManagement(
  { botStatusEl, oauthTierStatusEl, addBotBtn, removeBotBtn, switchModeBtn }: BotManagementElements,
  context: BotManagementContext,
  services: BotManagementServices
): BotManagementModule {
  const { apiBaseUrl, testMode } = context;
  const { getSessionToken } = services;

  let currentTier: 'anonymous' | 'full' | null = null;
  let currentIsActive: boolean = false;

  function updateOAuthTierUI(tier: 'anonymous' | 'full' | null, isActive: boolean): void {
    currentTier = tier;
    currentIsActive = isActive;
    if (oauthTierStatusEl) {
      if (tier === 'anonymous') {
        // Bot-Free Mode: bot is not in chat, regardless of active status
        oauthTierStatusEl.textContent = '🎤 Bot-Free Mode';
        oauthTierStatusEl.className = 'fw-semibold text-primary';
      } else if (tier === 'full') {
        // Chatbot Mode: bot can be in chat, regardless of active status
        oauthTierStatusEl.textContent = '🤖 Chatbot Mode';
        oauthTierStatusEl.className = 'fw-semibold text-success';
      } else {
        oauthTierStatusEl.textContent = 'Unknown';
        oauthTierStatusEl.className = 'fw-semibold text-muted';
      }
    }
    if (switchModeBtn && tier) {
      switchModeBtn.style.display = 'inline-block';
      switchModeBtn.textContent = tier === 'anonymous' ? 'Switch to Chatbot Mode' : 'Switch to Bot-Free Mode';
    }
  }

  function updateBotStatusUI(isActive: boolean): void {
    if (isActive) {
      if (botStatusEl) {
        botStatusEl.textContent = 'Active';
        botStatusEl.className = 'fw-semibold text-success';
      }
      if (addBotBtn) addBotBtn.style.display = 'none';
      if (removeBotBtn) removeBotBtn.style.display = 'inline-block';
    } else {
      if (botStatusEl) {
        botStatusEl.textContent = 'Inactive';
        botStatusEl.className = 'fw-semibold text-secondary';
      }
      if (addBotBtn) addBotBtn.style.display = 'inline-block';
      if (removeBotBtn) removeBotBtn.style.display = 'none';
    }
  }

  async function refreshStatus(): Promise<void> {
    if (testMode) {
      updateBotStatusUI(false);
      updateOAuthTierUI('anonymous', false);
      return;
    }

    if (!getSessionToken()) {
      if (botStatusEl) botStatusEl.textContent = 'Not authenticated';
      return;
    }

    try {
      const statusRes = await fetchWithAuth(`${apiBaseUrl}/api/bot/status`, { method: 'GET' });
      const statusData = await statusRes.json() as BotStatusResponse;
      if (statusData.success) {
        const isActive = statusData.isActive;
        const tier = statusData.oauthTier || 'full'; // Default to 'full' for backward compatibility
        updateBotStatusUI(isActive);
        updateOAuthTierUI(tier, isActive);
      } else {
        showToast(`Error: ${statusData.message}`, 'error');
        if (botStatusEl) botStatusEl.textContent = 'Error';
      }
    } catch (error) {
      console.error('Error fetching bot status:', error);
      const err = error as Error;
      showToast(`Failed to load bot status. ${err.message}`, 'error');
      if (botStatusEl) botStatusEl.textContent = 'Error';
    }
  }

  if (addBotBtn) {
    addBotBtn.addEventListener('click', async () => {
      if (testMode) {
        showToast('TTS Service activated! (test mode)', 'success');
        updateBotStatusUI(true);
        return;
      }
      if (!getSessionToken()) {
        showToast('Authentication token missing. Please log in again.', 'error');
        return;
      }
      showToast('Activating TTS Service...', 'info');
      try {
        const res = await fetchWithAuth(`${apiBaseUrl}/api/bot/add`, { method: 'POST' });
        const data = await res.json() as BotActionResponse;
        if (data.success) {
          showToast(data.message || 'TTS Service activated!', 'success');
          updateBotStatusUI(true);
        } else if (data.code === 'not_allowed') {
          const errorText = data.details || data.message || 'Channel not authorized.';
          const html = errorText.includes('https://detekoi.github.io/#contact-me')
            ? errorText.replace('https://detekoi.github.io/#contact-me', '<a href="https://detekoi.github.io/#contact-me" target="_blank" class="link-light">this link</a>')
            : `${errorText} <a href="https://detekoi.github.io/#contact-me" target="_blank" class="link-light">Request access here</a>.`;
          showToast(html, 'error');
        } else {
          showToast(data.message || 'Failed to activate TTS Service.', 'error');
        }
      } catch (error) {
        console.error('Error activating TTS Service:', error);
        showToast('Failed to activate TTS Service.', 'error');
      }
    });
  }

  if (removeBotBtn) {
    removeBotBtn.addEventListener('click', async () => {
      if (testMode) {
        showToast('TTS Service deactivated. (test mode)', 'success');
        updateBotStatusUI(false);
        return;
      }
      if (!getSessionToken()) {
        showToast('Authentication token missing. Please log in again.', 'error');
        return;
      }
      showToast('Deactivating TTS Service...', 'info');
      try {
        const res = await fetchWithAuth(`${apiBaseUrl}/api/bot/remove`, { method: 'POST' });
        const data = await res.json() as BotActionResponse;
        showToast(data.message || 'TTS Service deactivated.', data.success ? 'success' : 'error');
        if (data.success) updateBotStatusUI(false);
      } catch (error) {
        console.error('Error deactivating TTS Service:', error);
        showToast('Failed to deactivate TTS Service.', 'error');
      }
    });
  }

  if (switchModeBtn) {
    switchModeBtn.addEventListener('click', async () => {
      const targetTier = currentTier === 'anonymous' ? 'full' : 'anonymous';
      const targetModeName = targetTier === 'anonymous' ? 'Bot-Free Mode' : 'Chatbot Mode';

      if (targetTier === 'full') {
        // Upgrading to full mode requires re-authentication with more scopes
        if (confirm(`Switching to Chatbot Mode requires re-authenticating with additional permissions. You'll be redirected to Twitch. Continue?`)) {
          try {
            showToast('Redirecting to Twitch for authentication...', 'info');
            const response = await fetch(`${apiBaseUrl}/auth/twitch/initiate?tier=full`);
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
            const err = error as Error;
            showToast(`Failed to start authentication: ${err.message}`, 'error');
          }
        }
      } else {
        // Downgrading to anonymous mode just updates preference (no re-auth needed)
        if (confirm(`Switch to ${targetModeName}? This will update your authentication preference.`)) {
          try {
            const res = await fetchWithAuth(`${apiBaseUrl}/api/auth/update-tier`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ tier: targetTier }),
            });
            const data = await res.json() as BotActionResponse;
            if (data.success) {
              showToast(`Switched to ${targetModeName}!`, 'success');
              // Refresh status to get updated tier and active status
              await refreshStatus();
            } else {
              showToast(data.message || 'Failed to switch mode.', 'error');
            }
          } catch (error) {
            console.error('Error switching mode:', error);
            showToast('Failed to switch mode.', 'error');
          }
        }
      }
    });
  }

  return { refreshStatus, updateBotStatusUI };
}
