/**
 * The landing page: the Ko-fi support dialog, plus i18n.
 *
 * Lifted out of an inline `<script>` so the iframe's accessible name comes from
 * the catalog — an inline classic script cannot import, and a screen reader
 * announcing an English name inside an otherwise translated page is exactly the
 * kind of gap that survives a visual check.
 */

import { initI18n, t } from './common/i18n.js';

void initI18n();

const dialog = document.getElementById('kofi-modal') as HTMLDialogElement | null;
const openBtn = document.getElementById('kofi-open');
const closeBtn = document.getElementById('kofi-close');
const embedContainer = document.getElementById('kofi-embed-container');

if (dialog) {
  const open = (): void => {
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
    // Built on first open rather than at load, so the third-party frame is not
    // fetched for the many visitors who never open it.
    if (embedContainer && !embedContainer.querySelector('iframe')) {
      const iframe = document.createElement('iframe');
      iframe.src = 'https://ko-fi.com/parfaitfair/?hidefeed=true&widget=true&embed=true';
      iframe.title = t('msg.kofi.iframeTitle');
      iframe.className = 'kofi-iframe';
      embedContainer.appendChild(iframe);
    }
  };

  const close = (): void => {
    if (typeof dialog.close === 'function') {
      if (dialog.open) dialog.close();
    } else {
      dialog.removeAttribute('open');
    }
  };

  openBtn?.addEventListener('click', (e) => { e.preventDefault(); open(); });
  closeBtn?.addEventListener('click', (e) => { e.preventDefault(); close(); });

  dialog.addEventListener('click', (e) => {
    if (e.target !== dialog) return;
    const rect = dialog.getBoundingClientRect();
    const isInside =
      e.clientX >= rect.left && e.clientX <= rect.right &&
      e.clientY >= rect.top && e.clientY <= rect.bottom;
    if (!isInside) close();
  });
}
