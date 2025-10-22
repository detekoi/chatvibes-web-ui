import { fetchWithAuth } from '../common/api.js';
import { showToast } from '../common/ui.js';

/**
 * Channel Points reward management.
 * @param {object} context
 * @param {string} context.apiBaseUrl
 * @param {boolean} context.testMode
 * @param {object} services
 * @param {() => string|null} services.getSessionToken
 * @param {() => {login: string}|null} services.getLoggedInUser
 * @param {{onSettingsRefresh: () => Promise<void>}} [deps]
 * @returns {{load: () => Promise<void>}}
 */
export function initChannelPointsModule(context, services, deps = {}) {
    const { apiBaseUrl, testMode } = context;
    const { getSessionToken, getLoggedInUser } = services;
    const { onSettingsRefresh } = deps;

    const cpEnabled = document.getElementById('cp-enabled');
    const cpTitle = document.getElementById('cp-title');
    const cpCost = document.getElementById('cp-cost');
    const cpPrompt = document.getElementById('cp-prompt');
    const cpSkipQueue = document.getElementById('cp-skip-queue');
    const cpLimitsEnabled = document.getElementById('cp-limits-enabled');
    const cpCooldown = document.getElementById('cp-cooldown');
    const cpPerStream = document.getElementById('cp-per-stream');
    const cpPerUser = document.getElementById('cp-per-user');
    const cpMin = document.getElementById('cp-min');
    const cpMax = document.getElementById('cp-max');
    const cpBlockLinks = document.getElementById('cp-block-links');
    const cpBannedWords = document.getElementById('cp-banned-words');
    const cpSaveBtn = document.getElementById('cp-save');
    const cpTestBtn = document.getElementById('cp-test');
    const cpDeleteBtn = document.getElementById('cp-delete');
    const cpMsg = document.getElementById('cp-msg');
    const cpStatusLine = document.getElementById('cp-status-line');

    let lastSaveAt = 0;
    let timerId = null;
    const MIN_INTERVAL_MS = 1500;
    const DEBOUNCE_MS = 800;

    if (cpSaveBtn) cpSaveBtn.addEventListener('click', () => saveChannelPointsConfig(false));
    if (cpTestBtn) cpTestBtn.addEventListener('click', testChannelPointsRedeem);
    if (cpDeleteBtn) cpDeleteBtn.addEventListener('click', deleteChannelPointsReward);

    bindAutoSave();

    return {
        load: () => loadChannelPointsConfig(),
    };

    async function loadChannelPointsConfig() {
        if (testMode) {
            if (cpEnabled) cpEnabled.checked = false;
            if (cpStatusLine) cpStatusLine.textContent = 'No reward created (test mode)';
            return;
        }

        try {
            const res = await fetchWithAuth(`${apiBaseUrl}/api/rewards/tts`, {
                method: 'GET',
                credentials: 'include'
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                console.warn('Failed to load Channel Points config:', err);
                return;
            }

            const data = await res.json();
            const cp = data.channelPoints || {};
            if (cpEnabled) cpEnabled.checked = !!cp.enabled;
            if (cpTitle) cpTitle.value = cp.title ?? 'Text-to-Speech Message';
            if (cpCost) cpCost.value = cp.cost ?? 500;
            if (cpPrompt) cpPrompt.value = cp.prompt ?? 'Enter a message to be read aloud';
            if (cpSkipQueue) cpSkipQueue.checked = cp.skipQueue !== false;
            if (cpLimitsEnabled) cpLimitsEnabled.checked = cp.limitsEnabled ?? (cp.perStreamLimit > 0 || cp.perUserLimit > 0);
            if (cpCooldown) cpCooldown.value = cp.limitsEnabled ? Math.max(1, cp.cooldownSeconds ?? 1) : (cp.cooldownSeconds ?? 0);
            if (cpPerStream) cpPerStream.value = cp.perStreamLimit > 0 ? cp.perStreamLimit : '';
            if (cpPerUser) cpPerUser.value = cp.perUserLimit > 0 ? cp.perUserLimit : '';
            if (cpMin) cpMin.value = cp.minimumBitsRequirement ?? '';
            if (cpMax) cpMax.value = cp.maximumBitsRequirement ?? '';
            if (cpBlockLinks) cpBlockLinks.checked = cp.blockLinks ?? false;
            if (cpBannedWords) cpBannedWords.value = (cp.bannedWords || []).join(', ');
            if (cpMsg) cpMsg.className = 'text-muted';
            if (cpStatusLine) {
                const lastSynced = cp.updatedAt ? new Date(cp.updatedAt).toLocaleTimeString() : 'never';
                const rewardInfo = cp.rewardId ? `Reward ID: ${cp.rewardId}` : 'No reward created';
                cpStatusLine.textContent = `${rewardInfo} · Last synced: ${lastSynced}`;
            }
        } catch (error) {
            console.warn('Failed to load Channel Points config:', error);
        }
    }

    async function saveChannelPointsConfig(isAuto = false) {
        if (testMode) {
            showToast('Channel Points saved ✓ (test mode)', 'success');
            if (cpStatusLine) cpStatusLine.textContent = 'No reward created · Last synced: ' + new Date().toLocaleTimeString();
            return;
        }
        if (!getSessionToken()) {
            showToast('Authentication required', 'error');
            return;
        }

        const payload = {
            enabled: !!cpEnabled?.checked,
            title: cpTitle?.value || 'Text-to-Speech Message',
            cost: parseInt(cpCost?.value || '500', 10),
            prompt: cpPrompt?.value || 'Enter a message to be read aloud',
            skipQueue: !!cpSkipQueue?.checked,
            limitsEnabled: !!cpLimitsEnabled?.checked,
            cooldownSeconds: parseInt(cpCooldown?.value || '0', 10),
            perStreamLimit: parseInt((cpPerStream?.value || '').toString().trim() || '0', 10),
            perUserLimit: parseInt((cpPerUser?.value || '').toString().trim() || '0', 10),
            minimumBitsRequirement: parseInt((cpMin?.value || '').toString().trim() || '0', 10),
            maximumBitsRequirement: parseInt((cpMax?.value || '').toString().trim() || '0', 10),
            blockLinks: !!cpBlockLinks?.checked,
            bannedWords: (cpBannedWords?.value || '')
                .split(',')
                .map(word => word.trim())
                .filter(Boolean)
        };

        if (!isAuto) {
            showToast('Saving Channel Points settings…', 'info');
        }

        try {
            const res = await fetchWithAuth(`${apiBaseUrl}/api/rewards/tts`, {
                method: 'POST',
                credentials: 'include',
                body: JSON.stringify(payload)
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                showToast(data.error || 'Failed to save Channel Points config', 'error');
                return;
            }
            if (isAuto) {
                showToast('Channel Points saved ✓', 'success');
            } else {
                showToast('Channel Points saved ✓', 'success');
            }
            if (cpStatusLine) {
                const rewardId = data.channelPoints?.rewardId || data.rewardId;
                const idPart = rewardId ? `Reward ID: ${rewardId}` : 'No reward created';
                cpStatusLine.textContent = `${idPart} · Last synced: ${new Date().toLocaleTimeString()}`;
            }
            await loadChannelPointsConfig();
            await onSettingsRefresh?.();
        } catch (error) {
            console.error('Failed to save Channel Points config:', error);
            showToast('Failed to save Channel Points config', 'error');
        }
    }

    async function testChannelPointsRedeem() {
        if (testMode) {
            const text = prompt('Enter a test message to simulate a redemption:');
            if (text) showToast('Test validated ✓ (test mode)', 'success');
            return;
        }
        if (!getSessionToken()) {
            showToast('Authentication required', 'error');
            return;
        }
        const text = prompt('Enter a test message to simulate a redemption:');
        if (!text) return;
        try {
            showToast('Testing redeem…', 'info');
            const res = await fetchWithAuth(`${apiBaseUrl}/api/rewards/tts/test`, {
                method: 'POST',
                credentials: 'include',
                body: JSON.stringify({ text })
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                showToast(data.error || 'Test failed', 'error');
                return;
            }
            showToast(`Test validated ✓ (${data.status || 'ok'})`, 'success');
        } catch (e) {
            showToast('Test failed', 'error');
        }
    }

    async function deleteChannelPointsReward() {
        if (testMode) {
            if (cpEnabled) cpEnabled.checked = false;
            if (cpStatusLine) cpStatusLine.textContent = 'No reward created · Last synced: ' + new Date().toLocaleTimeString();
            showToast('Disabled & deleted ✓ (test mode)', 'success');
            return;
        }
        if (!getSessionToken()) {
            showToast('Authentication required', 'error');
            return;
        }
        if (!confirm('Disable & delete the Channel Points TTS reward?')) return;
        try {
            showToast('Deleting…', 'info');
            const res = await fetchWithAuth(`${apiBaseUrl}/api/rewards/tts`, {
                method: 'DELETE',
                credentials: 'include'
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                showToast(data.error || 'Delete failed', 'error');
                return;
            }
            if (cpEnabled) cpEnabled.checked = false;
            if (cpStatusLine) cpStatusLine.textContent = 'No reward created · Last synced: ' + new Date().toLocaleTimeString();
            showToast('Disabled & deleted ✓', 'success');
            await loadChannelPointsConfig();
            await onSettingsRefresh?.();
        } catch (e) {
            showToast('Delete failed', 'error');
        }
    }

    function bindAutoSave() {
        const bind = (el, events = ['input', 'change']) => {
            if (!el) return;
            events.forEach(evt => el.addEventListener(evt, scheduleAutoSave));
        };

        bind(cpEnabled, ['change']);
        bind(cpTitle);
        bind(cpCost);
        bind(cpPrompt);
        bind(cpSkipQueue, ['change']);
        bind(cpLimitsEnabled, ['change']);
        bind(cpCooldown);
        bind(cpPerStream);
        bind(cpPerUser);
        bind(cpMin);
        bind(cpMax);
        bind(cpBlockLinks, ['change']);
        bind(cpBannedWords);

        const normalizeZeroToBlank = (el) => {
            if (!el) return;
            el.addEventListener('change', () => {
                if ((el.value || '').trim() === '0') {
                    el.value = '';
                }
            });
        };
        normalizeZeroToBlank(cpPerStream);
        normalizeZeroToBlank(cpPerUser);

        if (cpCooldown) {
            cpCooldown.addEventListener('change', () => {
                const v = parseInt(cpCooldown.value || '0', 10);
                if (cpLimitsEnabled?.checked && v === 0) {
                    cpCooldown.value = '1';
                }
            });
        }
    }

    function scheduleAutoSave() {
        const now = Date.now();
        const wait = Math.max(DEBOUNCE_MS, MIN_INTERVAL_MS - (now - lastSaveAt));

        if (timerId) {
            clearTimeout(timerId);
        }

        timerId = setTimeout(async () => {
            timerId = null;
            lastSaveAt = Date.now();
            await saveChannelPointsConfig(true);
        }, wait);
    }
}
