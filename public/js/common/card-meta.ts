import { t } from './i18n.js';

/**
 * Section headers carry a mono row count on the right. Derived from the DOM so
 * it cannot drift as settings are added or removed. Only the section's own row
 * stack counts: lists inside nested cards or dialogs are not settings rows, and
 * a row with the `hidden` attribute is not shown, so it is not counted either.
 *
 * Safe to call again after a row is shown or hidden: it rewrites the count
 * rather than adding a second one. Pass the card that changed as `root` to
 * recount only that one.
 */
export function decorateCardHeaders(root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>('.wc-card > .card-header').forEach((header) => {
    const card = header.parentElement;
    if (!card) return;
    const count = card.querySelectorAll(':scope > .card-body > .list-group > .list-group-item:not([hidden])').length;
    let meta = header.querySelector<HTMLElement>('.wc-card-meta');
    if (!count) {
      meta?.remove();
      return;
    }
    if (!meta) {
      meta = document.createElement('span');
      meta.className = 'wc-card-meta';
      header.appendChild(meta);
    }
    meta.textContent = t('msg.cardMeta.settings', { count });
  });
}
