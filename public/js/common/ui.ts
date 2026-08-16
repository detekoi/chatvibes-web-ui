/**
 * Shared UI helpers for WildcatTTS Web UI.
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
 * Drive a .wc-bar from real completed work.
 *
 * Only call this where the total is genuinely known — a fixed set of load
 * tasks, or a fixed set of steps. Everywhere else leave the bar alone and let
 * it run its indeterminate loop; a bar advanced by a timer is a lie about
 * progress, which is worse than admitting the duration is unknown.
 *
 * Pass done >= total to finish. Setting total to 0 returns the bar to
 * indeterminate.
 */
export function setProgress(bar: HTMLElement | null, done: number, total: number): void {
  if (!bar) return;
  const fill = bar.querySelector('span');
  if (!fill) return;

  if (total <= 0) {
    bar.removeAttribute('data-progress');
    bar.removeAttribute('aria-valuenow');
    bar.removeAttribute('aria-valuemin');
    bar.removeAttribute('aria-valuemax');
    fill.style.width = '';
    return;
  }

  const pct = Math.round((Math.min(done, total) / total) * 100);
  bar.setAttribute('data-progress', String(pct));
  // A progressbar with no aria-valuenow reads as indeterminate, so these are
  // only set once there is a real number behind them.
  bar.setAttribute('aria-valuemin', '0');
  bar.setAttribute('aria-valuemax', '100');
  bar.setAttribute('aria-valuenow', String(pct));
  fill.style.width = `${pct}%`;
}

/**
 * Run tasks in parallel, advancing a .wc-bar as each settles.
 *
 * Mirrors Promise.allSettled semantics: one failing task still advances the
 * bar and does not reject the whole batch, so a partial failure cannot leave
 * the bar stuck at 60% forever.
 */
export async function trackProgress(
  bar: HTMLElement | null,
  tasks: Array<Promise<unknown> | (() => Promise<unknown>)>
): Promise<PromiseSettledResult<unknown>[]> {
  const total = tasks.length;
  let done = 0;
  setProgress(bar, 0, total);

  return Promise.allSettled(
    tasks.map(task => {
      // Two hazards to contain here, both of which would otherwise escape the
      // map before allSettled exists — aborting the remaining tasks and
      // rejecting the whole call, so the caller never reaches hideLoading():
      //   1. a thunk that throws synchronously rather than returning a promise
      //   2. a thunk that returns a non-promise, which has no .finally
      // Promise.resolve normalises (2); the try/catch turns (1) into a
      // rejection that allSettled can report. Tasks still start eagerly.
      let promise: Promise<unknown>;
      try {
        promise = Promise.resolve(typeof task === 'function' ? task() : task);
      } catch (error) {
        promise = Promise.reject(error);
      }
      return promise.finally(() => {
        done += 1;
        setProgress(bar, done, total);
      });
    })
  );
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
  body.textContent = message;

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
