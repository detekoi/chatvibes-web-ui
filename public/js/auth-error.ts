/**
 * The sign-in error page.
 *
 * Lifted out of an inline `<script>` in auth-error.html so it can reach the
 * catalogs: an inline classic script cannot import, and every string here is
 * copy a person reads — often the only explanation they get for why they cannot
 * sign in.
 */

import { initI18n, t } from './common/i18n.js';

document.addEventListener('DOMContentLoaded', async () => {
  await initI18n();

  const params = new URLSearchParams(window.location.search);
  const error = params.get('error');
  const errorDescription = params.get('error_description');
  const errorMessageEl = document.getElementById('error-message-details');
  const errorTitleEl = document.getElementById('error-title');
  const errorCodeEl = document.getElementById('error-code');

  if (errorCodeEl) {
    errorCodeEl.textContent = error || t('msg.authError.unspecifiedCode');
  }

  // Cancelling is a choice, not a failure. Twitch reports it as access_denied
  // with "The user denied you access" — machine wording from our side of the
  // transaction — so this page drops the failure framing entirely rather than
  // accusing someone of denying us.
  const wasCanceled = error === 'access_denied';

  if (wasCanceled) {
    document.title = t('msg.authError.canceledTitle');

    const readoutEl = document.getElementById('error-readout');
    if (readoutEl) {
      readoutEl.textContent = t('msg.authError.canceledReadout');
      readoutEl.classList.remove('wc-readout--danger');
    }

    // The error code is noise when nothing went wrong.
    document.getElementById('error-code-block')?.remove();

    const actionEl = document.getElementById('error-action');
    if (actionEl) actionEl.textContent = t('msg.authError.backToSignIn');
  }

  // URLSearchParams has already decoded these. Decoding a second time throws
  // URIError on any literal "%" in the text, which would halt this script and
  // leave the page blank.
  if (errorMessageEl) {
    let message: string;
    if (wasCanceled) {
      message = t('msg.authError.canceledBody');
    } else if (errorDescription) {
      // Twitch's own wording, in whatever language Twitch chose. Passed through
      // rather than translated: we have no key for an arbitrary provider string.
      message = errorDescription;
    } else if (error) {
      message = t('msg.authError.twitchError');
    } else {
      message = t('msg.authError.unspecified');
    }
    errorMessageEl.textContent = message;

    if (error === 'not_authorized') {
      errorMessageEl.appendChild(document.createTextNode(' '));
      const link = document.createElement('a');
      link.href = 'https://parfaitfair.com/#contact';
      link.target = '_blank';
      link.rel = 'noopener';
      link.textContent = t('msg.authError.requestAccess');
      link.style.textDecoration = 'underline';
      errorMessageEl.appendChild(link);
    }
  }

  if (errorTitleEl && error === 'access_denied') {
    errorTitleEl.textContent = t('msg.authError.canceledTitleShort');
  } else if (errorTitleEl && error === 'not_allowed') {
    errorTitleEl.textContent = t('msg.authError.notPermitted');
  }
});
