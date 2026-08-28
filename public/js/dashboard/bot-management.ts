import { ApiError, fetchWithAuth } from '../common/api.js';
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
        } else {
          showToast(apiErrorMessage(data, 'msg.bot.activateFailed'), 'error');
        }
      } catch (error) {
        console.error('Error activating TTS Service:', error);
        // An unapproved channel is the one failure with something to do about
        // it, and it arrives as a thrown 403 rather than a returned response —
        // `fetchWithAuth` never returns a non-2xx. This used to be an
        // `else if (res.status === 403)` beside the success branch, which could
        // not run, so the streamer who most needed the link never saw it.
        const body = error instanceof ApiError ? error.body : {};
        const contactUrl = body.params?.contactUrl;
        showToast(
          body.details || apiErrorMessage(body, 'msg.bot.activateFailed'),
          'error',
          contactUrl ? { href: contactUrl, text: t('msg.bot.requestAccess') } : undefined,
        );
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
