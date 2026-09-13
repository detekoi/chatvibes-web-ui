import { t } from './i18n.js';

/**
 * Section headers carry a mono row count on the right. Derived from the DOM so
 * it cannot drift as settings are added or removed. Only the section's own row
 * stack counts: lists inside nested cards or dialogs are not settings rows.
 */
export function decorateCardHeaders(): void {
  document.querySelectorAll<HTMLElement>('.wc-card > .card-header').forEach((header) => {
    if (header.querySelector('.wc-card-meta')) return;
    const card = header.parentElement;
    if (!card) return;
    const count = card.querySelectorAll(':scope > .card-body > .list-group > .list-group-item').length;
    if (!count) return;
    const meta = document.createElement('span');
    meta.className = 'wc-card-meta';
    meta.textContent = t('msg.cardMeta.settings', { count });
    header.appendChild(meta);
  });
}
