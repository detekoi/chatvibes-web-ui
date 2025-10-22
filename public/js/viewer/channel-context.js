import { showToast, openDialog, closeDialog } from '../common/ui.js';

/**
 * Manages channel context selection and modal workflow.
 */
export function initChannelContextModule(context, services, deps = {}) {
    const { testMode } = context;
    const { setCurrentChannel, getCurrentChannel } = services;
    const { onChannelChange } = deps;

    const elements = {
        channelContextCard: document.getElementById('channel-context-card'),
        addChannelContextCard: document.getElementById('add-channel-context-card'),
        channelContextNameEl: document.getElementById('channel-context-name'),
        channelHint: document.getElementById('channel-hint'),
        openChannelContextModalBtn: document.getElementById('open-channel-context-modal-btn'),
        clearChannelContextBtn: document.getElementById('clear-channel-context-btn'),
        channelInputModal: document.getElementById('channel-input-modal'),
        channelInputModalText: document.getElementById('channel-input-modal-text'),
        channelInputConfirm: document.getElementById('channel-input-confirm'),
        channelInputCancel: document.getElementById('channel-input-cancel'),
        channelInputTitle: document.getElementById('channel-input-title'),
        channelInputDesc: document.getElementById('channel-input-desc'),
    };

    let confirmHandler = null;

    const api = {
        setChannelUI,
        clearChannelUI,
        openChannelPrompt,
    };

    attachBaseListeners();

    return api;

    function attachBaseListeners() {
        if (elements.openChannelContextModalBtn) {
            elements.openChannelContextModalBtn.addEventListener('click', () => {
                openChannelPrompt({
                    title: 'Load Channel Context',
                    description: 'Enter the channel name to view its defaults and manage opt-outs:',
                    confirmLabel: 'Load',
                    confirmClass: 'btn-primary',
                    onConfirm: (channelName) => {
                        applyChannel(channelName);
                        showToast(testMode ? 'Channel context loaded (test mode)' : 'Channel context loaded', 'success');
                    },
                });
            });
        }

        if (elements.clearChannelContextBtn) {
            elements.clearChannelContextBtn.addEventListener('click', () => {
                applyChannel(null);
                showToast(testMode ? 'Channel context cleared (test mode)' : 'Channel context cleared', 'success');
            });
        }

        if (elements.channelInputConfirm) {
            elements.channelInputConfirm.addEventListener('click', () => {
                const channelName = (elements.channelInputModalText?.value || '').trim().toLowerCase();
                if (!channelName) {
                    showToast('Please enter a channel name', 'warning');
                    return;
                }
                if (confirmHandler) {
                    confirmHandler(channelName);
                }
                closeChannelModal();
            });
        }

        if (elements.channelInputCancel) {
            elements.channelInputCancel.addEventListener('click', () => {
                closeChannelModal();
            });
        }
    }

    function applyChannel(channelName) {
        setCurrentChannel(channelName);
        if (channelName) {
            setChannelUI(channelName);
        } else {
            clearChannelUI();
        }
        onChannelChange?.(channelName);
    }

    function setChannelUI(channelName) {
        if (!channelName) {
            clearChannelUI();
            return;
        }

        if (elements.channelContextCard) elements.channelContextCard.classList.remove('d-none');
        if (elements.addChannelContextCard) elements.addChannelContextCard.classList.add('d-none');
        if (elements.channelContextNameEl) elements.channelContextNameEl.textContent = channelName;
        if (elements.channelHint) {
            elements.channelHint.textContent = testMode ? 'Channel found ✓ (test mode)' : 'Channel found ✓';
            elements.channelHint.className = 'form-text text-success';
        }
    }

    function clearChannelUI() {
        if (elements.channelContextCard) elements.channelContextCard.classList.add('d-none');
        if (elements.addChannelContextCard) elements.addChannelContextCard.classList.remove('d-none');
        if (elements.channelContextNameEl) elements.channelContextNameEl.textContent = '';
        if (elements.channelHint) {
            elements.channelHint.textContent = 'Load a channel to view its defaults';
            elements.channelHint.className = 'form-text';
        }
    }

    /**
     * Opens the channel prompt modal with optional custom messaging.
     * @param {object} options
     * @param {string} options.title
     * @param {string} options.description
     * @param {string} options.confirmLabel
     * @param {string} [options.confirmClass]
     * @param {(channelName: string) => void} options.onConfirm
     */
    function openChannelPrompt({ title, description, confirmLabel, confirmClass = 'btn-primary', onConfirm }) {
        if (!elements.channelInputModal) return;
        confirmHandler = onConfirm || null;
        if (elements.channelInputModalText) elements.channelInputModalText.value = '';
        if (elements.channelInputTitle) elements.channelInputTitle.textContent = title;
        if (elements.channelInputDesc) elements.channelInputDesc.textContent = description;
        if (elements.channelInputConfirm) {
            elements.channelInputConfirm.textContent = confirmLabel;
            elements.channelInputConfirm.className = `btn ${confirmClass}`;
        }
        openDialog(elements.channelInputModal);
    }

    function closeChannelModal() {
        if (elements.channelInputModal) closeDialog(elements.channelInputModal);
        confirmHandler = null;
    }
}
