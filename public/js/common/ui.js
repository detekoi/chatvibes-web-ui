/**
 * Shared UI helpers for ChatVibes Web UI.
 */

function getToastContainer() {
    let toastContainer = document.getElementById('toast-container');
    if (!toastContainer) {
        toastContainer = document.createElement('div');
        toastContainer.id = 'toast-container';
        toastContainer.className = 'toast-container position-fixed bottom-0 end-0 p-3';
        document.body.appendChild(toastContainer);
    }
    return toastContainer;
}

/**
 * Display a toast notification.
 * @param {string} message
 * @param {'success'|'error'|'warning'|'info'} [type='success']
 */
export function showToast(message, type = 'success') {
    const toastContainer = getToastContainer();

    const toastEl = document.createElement('div');
    toastEl.className = 'toast align-items-center border-0';
    toastEl.setAttribute('role', 'alert');
    toastEl.setAttribute('aria-live', 'assertive');
    toastEl.setAttribute('aria-atomic', 'true');

    const bgClass = type === 'error' || type === 'danger' ? 'text-bg-danger' :
        type === 'warning' ? 'text-bg-warning' :
        type === 'info' ? 'text-bg-info' : 'text-bg-success';
    toastEl.classList.add(bgClass);

    const inner = document.createElement('div');
    inner.className = 'd-flex';

    const body = document.createElement('div');
    body.className = 'toast-body';
    body.innerHTML = message;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn-close btn-close-white me-2 m-auto';
    btn.setAttribute('data-bs-dismiss', 'toast');
    btn.setAttribute('aria-label', 'Close');

    inner.appendChild(body);
    inner.appendChild(btn);
    toastEl.appendChild(inner);
    toastContainer.appendChild(toastEl);

    const bsToast = new bootstrap.Toast(toastEl, { delay: 5000 });
    bsToast.show();
    toastEl.addEventListener('hidden.bs.toast', () => toastEl.remove());
}

/**
 * Copy text to the clipboard with fallbacks.
 * @param {string} text
 * @returns {Promise<boolean>}
 */
export async function copyToClipboard(text) {
    try {
        if (navigator.clipboard && window.isSecureContext) {
            await navigator.clipboard.writeText(text);
            return true;
        }

        const textArea = document.createElement('textarea');
        textArea.value = text;
        textArea.style.position = 'fixed';
        textArea.style.left = '-999999px';
        textArea.style.top = '-999999px';
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        const result = document.execCommand('copy');
        document.body.removeChild(textArea);
        return result;
    } catch (err) {
        console.error('Failed to copy text: ', err);
        return false;
    }
}

/**
 * Open a dialog element with graceful fallback.
 * @param {HTMLDialogElement} dialogEl
 */
export function openDialog(dialogEl) {
    if (!dialogEl) return;
    if (typeof dialogEl.showModal === 'function') {
        dialogEl.showModal();
    } else {
        dialogEl.setAttribute('open', '');
    }
}

/**
 * Close a dialog element with graceful fallback.
 * @param {HTMLDialogElement} dialogEl
 */
export function closeDialog(dialogEl) {
    if (!dialogEl) return;
    if (typeof dialogEl.close === 'function') {
        dialogEl.close();
    } else {
        dialogEl.removeAttribute('open');
    }
}

/**
 * Synchronise values between two textarea elements.
 * @param {HTMLTextAreaElement|null} el1
 * @param {HTMLTextAreaElement|null} el2
 */
export function syncTextareas(el1, el2) {
    if (!el1 || !el2) return;
    el1.addEventListener('input', () => {
        el2.value = el1.value;
    });
    el2.addEventListener('input', () => {
        el1.value = el2.value;
    });
}
