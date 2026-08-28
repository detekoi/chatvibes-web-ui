/**
 * The sign-in landing page.
 *
 * Lifted out of an inline `<script>` in auth-complete.html so it can reach the
 * catalogs: an inline classic script cannot import, and this page's copy is
 * shown to every viewer on every sign-in.
 *
 * This page does not inspect the JWT. Its only reason to was the token_user
 * guard, which is gone; the equivalent decoder still lives in common/auth.ts for
 * the pages that do need it.
 */

import { apiErrorMessage, initI18n, t } from './common/i18n.js';

declare global {
  interface Window {
    /** Handed over in memory by the head script, which took it out of the URL. */
    __exchangeCode?: string;
    /** The pre-exchange shape, still accepted for anyone mid-flow across a deploy. */
    __sessionToken?: string;
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  await initI18n();

  const messageEl = document.getElementById('auth-message');
  const titleEl = document.getElementById('auth-title');
  const readoutEl = document.getElementById('status-readout');
  const sessionStateEl = document.getElementById('session-state');
  const barEl = document.getElementById('auth-bar');

  // The three steps are real and discrete, so the bar reports actual completion
  // here instead of looping. It only ever advances on a step that genuinely
  // happened.
  function markStep(name: string): void {
    document.querySelector(`.wc-step[data-step="${name}"]`)?.classList.add('is-done');

    const steps = document.querySelectorAll('.wc-step');
    const done = document.querySelectorAll('.wc-step.is-done').length;
    const fill = barEl?.querySelector('span');
    if (!fill || !steps.length || !barEl) return;

    const pct = Math.round((done / steps.length) * 100);
    barEl.setAttribute('data-progress', String(pct));
    barEl.setAttribute('aria-valuemin', '0');
    barEl.setAttribute('aria-valuemax', '100');
    barEl.setAttribute('aria-valuenow', String(pct));
    (fill as HTMLElement).style.width = `${pct}%`;
  }

  function fail(message: string): void {
    if (titleEl) titleEl.textContent = t('msg.authComplete.failedTitle');
    if (messageEl) messageEl.textContent = message;
    if (readoutEl) {
      readoutEl.textContent = t('msg.authComplete.failedReadout');
      readoutEl.classList.remove('wc-readout--accent');
      readoutEl.classList.add('wc-readout--danger');
    }
    if (sessionStateEl) sessionStateEl.textContent = t('msg.authComplete.noSession');
    barEl?.remove();
  }

  const queryParams = new URLSearchParams(window.location.search);
  const userLogin = queryParams.get('user_login');
  const userId = queryParams.get('user_id');
  // The query reads only cover the head script not having run.
  const exchangeCode = window.__exchangeCode || queryParams.get('code');
  const legacyToken = window.__sessionToken || queryParams.get('session_token');

  // Nothing below needs them on the global object.
  delete window.__exchangeCode;
  delete window.__sessionToken;

  /** Trades the one-time code for the session token. */
  async function redeemCode(code: string): Promise<string> {
    // Relative on purpose: this page is served from the same host that rewrites
    // /auth/** to the function, so the exchange is same-origin and needs no CORS.
    const response = await fetch('/auth/exchange', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    });

    const data = await response.json().catch(() => ({})) as { success?: boolean; session_token?: string };
    if (!response.ok || !data.success || !data.session_token) {
      throw new Error(apiErrorMessage(data, 'msg.authComplete.cannotComplete'));
    }
    return data.session_token;
  }

  /** Stores the session and moves the user on to the dashboard. */
  function completeSignIn(sessionToken: string): void {
    localStorage.setItem('app_session_token', sessionToken);

    // Anything left over from the retired token_user guard is inert now that
    // nothing reads it, so clear it out of browsers that still carry it.
    localStorage.removeItem('token_user');
    localStorage.removeItem('token_channel');

    markStep('token');
    if (sessionStateEl) sessionStateEl.textContent = t('msg.authComplete.sessionEstablished');

    if (titleEl) titleEl.textContent = t('msg.authComplete.welcome', { user: userLogin ?? '' });
    markStep('redirect');

    if (messageEl) messageEl.textContent = t('msg.authComplete.redirecting');
    window.location.href = 'dashboard.html';
  }

  if (userLogin && userId && (exchangeCode || legacyToken)) {
    markStep('authorized');

    localStorage.setItem('twitch_user_login', userLogin);
    localStorage.setItem('twitch_user_id', userId);

    if (exchangeCode) {
      // A code is single-use, so a failure here cannot be retried by reloading —
      // send the user back to sign in again.
      redeemCode(exchangeCode)
        .then(completeSignIn)
        .catch((error: Error) => {
          console.error('Exchange failed:', error);
          fail(t('msg.authComplete.retrySignIn', { reason: error.message }));
          setTimeout(() => { window.location.href = 'index.html'; }, 4000);
        });
    } else {
      completeSignIn(legacyToken as string);
    }
  } else {
    console.error('Missing authentication information:', {
      userLogin, userId, code: exchangeCode ? 'present' : 'missing',
    });
    fail(t('msg.authComplete.missingInfo'));
    setTimeout(() => { window.location.href = 'index.html'; }, 5000);
  }
});
