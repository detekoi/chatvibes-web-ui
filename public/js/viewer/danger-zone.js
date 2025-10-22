import { fetchWithAuth } from '../common/api.js';
import { showToast, openDialog, closeDialog } from '../common/ui.js';

/**
 * Handles viewer opt-out toggles for TTS and music.
 */
export function initDangerZoneModule(context, services, deps = {}) {
    const { apiBaseUrl, testMode } = context;
    const { getCurrentChannel } = services;
    const { requestChannel } = deps;

    const elements = {
        dangerZoneSection: document.getElementById('danger-zone-section'),
        dangerTtsToggle: document.getElementById('danger-tts-toggle'),
        dangerMusicToggle: document.getElementById('danger-music-toggle'),
        ignoreTtsCheckbox: document.getElementById('ignore-tts'),
        ignoreMusicCheckbox: document.getElementById('ignore-music'),
        confirmModal: document.getElementById('confirm-modal'),
        confirmText: document.getElementById('confirm-text'),
        confirmYes: document.getElementById('confirm-yes'),
        confirmNo: document.getElementById('confirm-no'),
    };

    let pendingAction = null;
    let pendingChannel = null;

    attachListeners();

    return {
        updateChannel(channelName, ignoreStatus = {}) {
            const hasChannel = Boolean(channelName);
            toggleVisibility(hasChannel);
            updateIgnoreCheckboxes(ignoreStatus);
        },
        clear() {
            toggleVisibility(false);
            updateIgnoreCheckboxes({});
        },
    };

    function attachListeners() {
        if (elements.ignoreTtsCheckbox) {
            elements.ignoreTtsCheckbox.addEventListener('change', () => {
                if (elements.ignoreTtsCheckbox.checked) handleIgnoreAction('tts');
            });
        }
        if (elements.ignoreMusicCheckbox) {
            elements.ignoreMusicCheckbox.addEventListener('change', () => {
                if (elements.ignoreMusicCheckbox.checked) handleIgnoreAction('music');
            });
        }
        if (elements.confirmYes) {
            elements.confirmYes.addEventListener('click', confirmIgnoreAction);
        }
        if (elements.confirmNo) {
            elements.confirmNo.addEventListener('click', cancelIgnoreAction);
        }
    }

    function toggleVisibility(visible) {
        if (elements.dangerZoneSection) {
            elements.dangerZoneSection.classList.toggle('d-none', !visible);
        }
        if (elements.dangerTtsToggle) {
            elements.dangerTtsToggle.style.display = visible ? '' : 'none';
        }
        if (elements.dangerMusicToggle) {
            elements.dangerMusicToggle.style.display = visible ? '' : 'none';
        }
    }

    function updateIgnoreCheckboxes(ignoreStatus) {
        const { ignoreTtsCheckbox, ignoreMusicCheckbox } = elements;
        if (ignoreTtsCheckbox) {
            const disabled = ignoreStatus.tts === true;
            ignoreTtsCheckbox.checked = disabled;
            ignoreTtsCheckbox.disabled = disabled;
        }
        if (ignoreMusicCheckbox) {
            const disabled = ignoreStatus.music === true;
            ignoreMusicCheckbox.checked = disabled;
            ignoreMusicCheckbox.disabled = disabled;
        }
    }

    function handleIgnoreAction(type) {
        const checkbox = type === 'tts' ? elements.ignoreTtsCheckbox : elements.ignoreMusicCheckbox;
        if (!checkbox) return;

        if (testMode) {
            checkbox.disabled = true;
            showToast(`You have been opted out of ${type.toUpperCase()} (test mode)`, 'success');
            return;
        }

        const currentChannel = getCurrentChannel();
        if (currentChannel) {
            pendingAction = { type, checkbox };
            pendingChannel = currentChannel;
            showConfirmModal(type, currentChannel);
        } else if (typeof requestChannel === 'function') {
            requestChannel({
                title: `Confirm channel for ${type.toUpperCase()} opt-out`,
                description: 'Enter the channel name to continue:',
                confirmLabel: 'Continue',
                confirmClass: 'btn-danger',
                onConfirm: (channelName) => {
                    pendingAction = { type, checkbox };
                    pendingChannel = channelName;
                    showConfirmModal(type, channelName);
                },
            });
        } else {
            showToast('Please select a channel first.', 'warning');
            checkbox.checked = false;
        }
    }

    function showConfirmModal(type, channelName) {
        if (!elements.confirmModal) return;
        if (elements.confirmText) {
            elements.confirmText.textContent = `Are you absolutely sure you want to opt out of ${type.toUpperCase()} in #${channelName}? Only a moderator can undo this action.`;
        }
        openDialog(elements.confirmModal);
    }

    async function confirmIgnoreAction() {
        if (!pendingAction) return;
        const { type, checkbox } = pendingAction;
        try {
            if (testMode) {
                checkbox.disabled = true;
                showToast(`You have been opted out of ${type.toUpperCase()} (test mode)`, 'success');
                closeDialog(elements.confirmModal);
                pendingAction = null;
                pendingChannel = null;
                return;
            }
            const targetChannel = pendingChannel || getCurrentChannel();
            if (!targetChannel) {
                showToast('Please specify a channel', 'error');
                checkbox.checked = false;
                closeDialog(elements.confirmModal);
                pendingAction = null;
                pendingChannel = null;
                return;
            }
            await fetchWithAuth(`${apiBaseUrl}/api/viewer/ignore/${type}/${encodeURIComponent(targetChannel)}`, { method: 'POST' });
            checkbox.disabled = true;
            showToast(`You have been opted out of ${type.toUpperCase()}`, 'success');
        } catch (error) {
            console.error(`Failed to opt out of ${type}:`, error);
            checkbox.checked = false;
            showToast(`Failed to opt out of ${type.toUpperCase()}`, 'error');
        }
        closeDialog(elements.confirmModal);
        pendingAction = null;
        pendingChannel = null;
    }

    function cancelIgnoreAction() {
        if (pendingAction?.checkbox) {
            pendingAction.checkbox.checked = false;
        }
        pendingAction = null;
        pendingChannel = null;
        if (elements.confirmModal) closeDialog(elements.confirmModal);
    }
}
