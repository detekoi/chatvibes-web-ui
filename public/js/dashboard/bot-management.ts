import { fetchWithAuth } from '../common/api.js';
import { showToast } from '../common/ui.js';
import { apiErrorMessage, t } from '../common/i18n.js';

/**
 * Bot management module parameters
 */
interface BotManagementElements {
  botStatusEl: HTMLElement | null;
  addBotBtn: HTMLButtonElement | null;
  removeBotBtn: HTMLButtonElement | null;
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
  message?: string;
  error?: string;
}

/**
 * Bot add/remove API response
 */
interface BotActionResponse {
  success: boolean;
  message?: string;
  error?: string;
  code?: string;
  details?: string;
  /** Values the message interpolates, so the client can render its own copy. */
  params?: Record<string, string>;
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
  { botStatusEl, addBotBtn, removeBotBtn }: BotManagementElements,
  context: BotManagementContext,
  services: BotManagementServices
): BotManagementModule {
  const { apiBaseUrl, testMode } = context;
  const { getSessionToken } = services;

  function updateBotStatusUI(isActive: boolean): void {
    if (isActive) {
      if (botStatusEl) {
        botStatusEl.textContent = t('msg.bot.active');
        botStatusEl.className = 'fw-semibold text-success';
      }
      if (addBotBtn) addBotBtn.style.display = 'none';
      // Empty string restores the stylesheet's display so button layout is
      // owned by CSS, not hardcoded here.
      if (removeBotBtn) removeBotBtn.style.display = '';
    } else {
      if (botStatusEl) {
        botStatusEl.textContent = t('msg.bot.inactive');
        botStatusEl.className = 'fw-semibold text-secondary';
      }
      if (addBotBtn) addBotBtn.style.display = '';
      if (removeBotBtn) removeBotBtn.style.display = 'none';
    }
  }

  async function refreshStatus(): Promise<void> {
    if (testMode) {
      updateBotStatusUI(false);
      return;
    }

    if (!getSessionToken()) {
      if (botStatusEl) botStatusEl.textContent = t('msg.bot.notAuthenticated');
      return;
    }

    try {
      const statusRes = await fetchWithAuth(`${apiBaseUrl}/api/bot/status`, { method: 'GET' });
      const statusData = await statusRes.json() as BotStatusResponse;
      if (statusData.success) {
        const isActive = statusData.isActive;
        updateBotStatusUI(isActive);
      } else {
        showToast(t('msg.bot.statusFailed', { reason: statusData.error || statusData.message || t('msg.bot.unknownError') }), 'error');
        if (botStatusEl) botStatusEl.textContent = t('msg.bot.statusError');
      }
    } catch (error) {
      console.error('Error fetching bot status:', error);
      const err = error as Error;
      showToast(t('msg.bot.statusLoadFailed', { reason: err.message }), 'error');
      if (botStatusEl) botStatusEl.textContent = t('msg.bot.statusError');
    }
  }

  if (addBotBtn) {
    addBotBtn.addEventListener('click', async () => {
      if (testMode) {
        showToast(t('msg.bot.activatedTestMode'), 'success');
        updateBotStatusUI(true);
        return;
      }
      if (!getSessionToken()) {
        showToast(t('msg.auth.tokenMissing'), 'error');
        return;
      }
      showToast(t('msg.bot.activating'), 'info');
      try {
        const res = await fetchWithAuth(`${apiBaseUrl}/api/bot/add`, { method: 'POST' });
        const data = await res.json() as BotActionResponse;
        if (data.success) {
          showToast(data.message || t('msg.bot.activated'), 'success');
          updateBotStatusUI(true);
        } else if (res.status === 403 || data.code === 'channel_not_authorized') {
          // Keyed on the error code, not on finding a URL inside the prose. The
          // link is appended as a real element rather than spliced into the
          // string: the toast body is set with textContent, so the markup this
          // used to build was displayed to the user as literal angle brackets.
          const errorText = data.details || apiErrorMessage(data, 'msg.bot.notAuthorized');
          const contactUrl = data.params?.contactUrl;
          showToast(errorText, 'error',
            contactUrl ? { href: contactUrl, text: t('msg.bot.requestAccess') } : undefined);
        } else {
          showToast(apiErrorMessage(data, 'msg.bot.activateFailed'), 'error');
        }
      } catch (error) {
        console.error('Error activating TTS Service:', error);
        showToast(t('msg.bot.activateFailed'), 'error');
      }
    });
  }

  if (removeBotBtn) {
    removeBotBtn.addEventListener('click', async () => {
      if (testMode) {
        showToast(t('msg.bot.deactivatedTestMode'), 'success');
        updateBotStatusUI(false);
        return;
      }
      if (!getSessionToken()) {
        showToast(t('msg.auth.tokenMissing'), 'error');
        return;
      }
      showToast(t('msg.bot.deactivating'), 'info');
      try {
        const res = await fetchWithAuth(`${apiBaseUrl}/api/bot/remove`, { method: 'POST' });
        const data = await res.json() as BotActionResponse;
        showToast(
          data.success
            ? (data.message || t('msg.bot.deactivated'))
            : apiErrorMessage(data, 'msg.bot.deactivateFailed'),
          data.success ? 'success' : 'error',
        );
        if (data.success) updateBotStatusUI(false);
      } catch (error) {
        console.error('Error deactivating TTS Service:', error);
        showToast(t('msg.bot.deactivateFailed'), 'error');
      }
    });
  }

  return { refreshStatus, updateBotStatusUI };
}
