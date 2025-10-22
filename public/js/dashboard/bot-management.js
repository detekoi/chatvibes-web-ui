import { fetchWithAuth } from '../common/api.js';
import { showToast } from '../common/ui.js';

/**
 * Bot management card bindings.
 * @param {object} params
 * @param {HTMLElement} params.botStatusEl
 * @param {HTMLButtonElement} params.addBotBtn
 * @param {HTMLButtonElement} params.removeBotBtn
 * @param {object} context
 * @param {string} context.apiBaseUrl
 * @param {boolean} context.testMode
 * @param {object} services
 * @param {() => string|null} services.getSessionToken
 * @returns {{refreshStatus: () => Promise<void>, updateBotStatusUI: (isActive: boolean) => void}}
 */
export function initBotManagement({ botStatusEl, addBotBtn, removeBotBtn }, context, services) {
    const { apiBaseUrl, testMode } = context;
    const { getSessionToken } = services;

    function updateBotStatusUI(isActive) {
        if (isActive) {
            if (botStatusEl) {
                botStatusEl.textContent = 'Active';
                botStatusEl.className = 'fw-semibold text-success';
            }
            if (addBotBtn) addBotBtn.style.display = 'none';
            if (removeBotBtn) removeBotBtn.style.display = 'inline-block';
        } else {
            if (botStatusEl) {
                botStatusEl.textContent = 'Inactive / Not Joined';
                botStatusEl.className = 'fw-semibold text-secondary';
            }
            if (addBotBtn) addBotBtn.style.display = 'inline-block';
            if (removeBotBtn) removeBotBtn.style.display = 'none';
        }
    }

    async function refreshStatus() {
        if (testMode) {
            updateBotStatusUI(false);
            return;
        }

        if (!getSessionToken()) {
            if (botStatusEl) botStatusEl.textContent = 'Not authenticated';
            return;
        }

        try {
            const statusRes = await fetchWithAuth(`${apiBaseUrl}/api/bot/status`, { method: 'GET' });
            const statusData = await statusRes.json();
            if (statusData.success) {
                updateBotStatusUI(statusData.isActive);
            } else {
                showToast(`Error: ${statusData.message}`, 'error');
                if (botStatusEl) botStatusEl.textContent = 'Error';
            }
        } catch (error) {
            console.error('Error fetching bot status:', error);
            showToast(`Failed to load bot status. ${error.message}`, 'error');
            if (botStatusEl) botStatusEl.textContent = 'Error';
        }
    }

    if (addBotBtn) {
        addBotBtn.addEventListener('click', async () => {
            if (testMode) {
                showToast('Bot added to channel! (test mode)', 'success');
                updateBotStatusUI(true);
                return;
            }
            if (!getSessionToken()) {
                showToast('Authentication token missing. Please log in again.', 'error');
                return;
            }
            showToast('Requesting bot to join...', 'info');
            try {
                const res = await fetchWithAuth(`${apiBaseUrl}/api/bot/add`, { method: 'POST' });
                const data = await res.json();
                if (data.success) {
                    showToast(data.message || 'Bot added to channel!', 'success');
                    updateBotStatusUI(true);
                } else if (data.code === 'not_allowed') {
                    const errorText = data.details || data.message || 'Channel not authorized.';
                    const html = errorText.includes('https://detekoi.github.io/#contact-me')
                        ? errorText.replace('https://detekoi.github.io/#contact-me', '<a href="https://detekoi.github.io/#contact-me" target="_blank" class="link-light">this link</a>')
                        : `${errorText} <a href="https://detekoi.github.io/#contact-me" target="_blank" class="link-light">Request access here</a>.`;
                    showToast(html, 'error');
                } else {
                    showToast(data.message || 'Failed to add bot.', 'error');
                }
            } catch (error) {
                console.error('Error adding bot:', error);
                showToast('Failed to send request to add bot.', 'error');
            }
        });
    }

    if (removeBotBtn) {
        removeBotBtn.addEventListener('click', async () => {
            if (testMode) {
                showToast('Bot removed from channel. (test mode)', 'success');
                updateBotStatusUI(false);
                return;
            }
            if (!getSessionToken()) {
                showToast('Authentication token missing. Please log in again.', 'error');
                return;
            }
            showToast('Requesting bot to leave...', 'info');
            try {
                const res = await fetchWithAuth(`${apiBaseUrl}/api/bot/remove`, { method: 'POST' });
                const data = await res.json();
                showToast(data.message || 'Request sent.', data.success ? 'success' : 'error');
                if (data.success) updateBotStatusUI(false);
            } catch (error) {
                console.error('Error removing bot:', error);
                showToast('Failed to send request to remove bot.', 'error');
            }
        });
    }

    return { refreshStatus, updateBotStatusUI };
}
