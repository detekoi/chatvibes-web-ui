import { showToast, openDialog, closeDialog } from '../common/ui.js';

/**
 * Context configuration for the channel context module
 */
export interface ChannelContextConfig {
    testMode?: boolean;
}

/**
 * Services provided to the channel context module
 */
export interface ChannelContextServices {
    setCurrentChannel: (channelName: string | null) => void;
    getCurrentChannel: () => string | null;
}

/**
 * Optional dependencies for the channel context module
 */
export interface ChannelContextDeps {
    onChannelChange?: (channelName: string | null) => void;
}

/**
 * DOM elements used by the channel context module
 */
interface ChannelContextElements {
    channelContextCard: HTMLElement | null;
    addChannelContextCard: HTMLElement | null;
    channelContextNameEl: HTMLElement | null;
    channelHint: HTMLElement | null;
    openChannelContextModalBtn: HTMLElement | null;
    clearChannelContextBtn: HTMLElement | null;
    channelInputModal: HTMLDialogElement | null;
    channelInputModalText: HTMLInputElement | null;
    channelInputConfirm: HTMLButtonElement | null;
    channelInputCancel: HTMLButtonElement | null;
    channelInputTitle: HTMLElement | null;
    channelInputDesc: HTMLElement | null;
}

/**
 * Options for opening the channel prompt modal
 */
export interface OpenChannelPromptOptions {
    title: string;
    description: string;
    confirmLabel: string;
    confirmClass?: string;
    onConfirm: (channelName: string) => void;
}

/**
 * Public API returned by the channel context module
 */
export interface ChannelContextAPI {
    setChannelUI: (channelName: string) => void;
    clearChannelUI: () => void;
    openChannelPrompt: (options: OpenChannelPromptOptions) => void;
}

/**
 * Manages channel context selection and modal workflow.
 */
export function initChannelContextModule(
    context: ChannelContextConfig,
    services: ChannelContextServices,
    deps: ChannelContextDeps = {}
): ChannelContextAPI {
    const { testMode } = context;
    const { setCurrentChannel } = services;
    const { onChannelChange } = deps;

    const elements: ChannelContextElements = {
        channelContextCard: document.getElementById('channel-context-card'),
        addChannelContextCard: document.getElementById('add-channel-context-card'),
        channelContextNameEl: document.getElementById('channel-context-name'),
        channelHint: document.getElementById('channel-hint'),
        openChannelContextModalBtn: document.getElementById('open-channel-context-modal-btn'),
        clearChannelContextBtn: document.getElementById('clear-channel-context-btn'),
        channelInputModal: document.getElementById('channel-input-modal') as HTMLDialogElement | null,
        channelInputModalText: document.getElementById('channel-input-modal-text') as HTMLInputElement | null,
        channelInputConfirm: document.getElementById('channel-input-confirm') as HTMLButtonElement | null,
        channelInputCancel: document.getElementById('channel-input-cancel') as HTMLButtonElement | null,
        channelInputTitle: document.getElementById('channel-input-title'),
        channelInputDesc: document.getElementById('channel-input-desc'),
    };

    let confirmHandler: ((channelName: string) => void) | null = null;

    const api: ChannelContextAPI = {
        setChannelUI,
        clearChannelUI,
        openChannelPrompt,
    };

    attachBaseListeners();

    return api;

    function attachBaseListeners(): void {
        if (elements.openChannelContextModalBtn) {
            elements.openChannelContextModalBtn.addEventListener('click', () => {
                openChannelPrompt({
                    title: 'Load Channel Context',
                    description: 'Enter the channel name to view its defaults and manage opt-outs:',
                    confirmLabel: 'Load',
                    confirmClass: 'btn-primary',
                    onConfirm: (channelName: string) => {
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

    function applyChannel(channelName: string | null): void {
        setCurrentChannel(channelName);
        if (channelName) {
            setChannelUI(channelName);
        } else {
            clearChannelUI();
        }
        onChannelChange?.(channelName);
    }

    function setChannelUI(channelName: string): void {
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

    function clearChannelUI(): void {
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
     */
    function openChannelPrompt({ title, description, confirmLabel, confirmClass = 'btn-primary', onConfirm }: OpenChannelPromptOptions): void {
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

    function closeChannelModal(): void {
        if (elements.channelInputModal) closeDialog(elements.channelInputModal);
        confirmHandler = null;
    }
}
