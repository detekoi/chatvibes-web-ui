/**
 * Shared UI helpers for ChatVibes Web UI.
 */

// Extend window for Bootstrap types
declare global {
  interface Window {
    bootstrap: {
      Toast: new (element: HTMLElement, options?: { delay?: number }) => {
        show(): void;
        hide(): void;
        dispose(): void;
      };
    };
  }
}

function getToastContainer(): HTMLElement {
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
 * Toast notification types
 */
export type ToastType = 'success' | 'error' | 'danger' | 'warning' | 'info';

/**
 * Display a toast notification.
 */
export function showToast(message: string, type: ToastType = 'success'): void {
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

  const bsToast = new window.bootstrap.Toast(toastEl, { delay: 5000 });
  bsToast.show();
  toastEl.addEventListener('hidden.bs.toast', () => toastEl.remove());
}

/**
 * Copy text to the clipboard with fallbacks.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
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
 */
export function openDialog(dialogEl: HTMLDialogElement | null): void {
  if (!dialogEl) return;
  if (typeof dialogEl.showModal === 'function') {
    dialogEl.showModal();
  } else {
    dialogEl.setAttribute('open', '');
  }
}

/**
 * Close a dialog element with graceful fallback.
 */
export function closeDialog(dialogEl: HTMLDialogElement | null): void {
  if (!dialogEl) return;
  if (typeof dialogEl.close === 'function') {
    dialogEl.close();
  } else {
    dialogEl.removeAttribute('open');
  }
}

/**
 * Synchronise values between two textarea elements.
 */
export function syncTextareas(el1: HTMLTextAreaElement | null, el2: HTMLTextAreaElement | null): void {
  if (!el1 || !el2) return;
  el1.addEventListener('input', () => {
    el2.value = el1.value;
  });
  el2.addEventListener('input', () => {
    el1.value = el2.value;
  });
}
