/**
 * Tests for OAuth state binding on the Twitch auth routes.
 *
 * These cover the security property the flow depends on: a callback is only
 * honoured when its `state` matches a one-use cookie set when the flow began,
 * and nothing is exchanged or minted before that check passes.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import express from 'express';
import request from 'supertest';
import axios from 'axios';
import authRoutes from '../routes';
import { STATE_COOKIE_NAME } from '../state';

jest.mock('axios');

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/auth', authRoutes);
  return app;
}

/**
 * Runs a real initiation request and returns the nonce Twitch would echo back
 * along with the state cookie the browser would hold.
 * @param app - Express app under test
 * @param endpoint - Which route to start the flow from
 * @return The `state` nonce and the matching Cookie header value
 */
async function startFlow(app: express.Express, endpoint: string) {
  const res = await request(app).get(endpoint);

  const authUrl = new URL(res.headers.location);
  const nonce = authUrl.searchParams.get('state') as string;

  const setCookie = res.headers['set-cookie'] as unknown as string[];
  const stateCookie = setCookie.find((c) => c.startsWith(`${STATE_COOKIE_NAME}=`)) as string;

  return {
    nonce,
    cookie: stateCookie.split(';')[0],
    setCookie: stateCookie,
  };
}

describe('OAuth state binding', () => {
  beforeEach(() => {
    (axios.post as jest.Mock).mockReset();
    (axios.get as jest.Mock).mockReset();
  });

  describe('GET /auth/twitch', () => {
    it('redirects straight to Twitch, with no round trip for the page to make', async () => {
      const res = await request(createApp()).get('/auth/twitch');

      expect(res.status).toBe(302);
      expect(res.headers.location).toContain('id.twitch.tv/oauth2/authorize');
    });

    it('sends only an opaque nonce as state', async () => {
      const { nonce } = await startFlow(createApp(), '/auth/twitch');

      expect(nonce).toMatch(/^[0-9a-f]{64}$/);
    });

    it('sets a host-only HttpOnly SameSite=Lax cookie named __session', async () => {
      const { setCookie } = await startFlow(createApp(), '/auth/twitch');

      expect(setCookie.startsWith('__session=')).toBe(true);
      expect(setCookie).toContain('HttpOnly');
      expect(setCookie).toContain('SameSite=Lax');
      expect(setCookie).toContain('Path=/');
      expect(setCookie).not.toContain('Domain=');
    });

    it('requests the broadcaster scopes', async () => {
      const res = await request(createApp()).get('/auth/twitch');
      const scope = new URL(res.headers.location).searchParams.get('scope') as string;

      expect(scope).toContain('channel:manage:redemptions');
      expect(scope).toContain('moderator:read:followers');
    });

    it('marks the flow as broadcaster in the cookie', async () => {
      const { setCookie } = await startFlow(createApp(), '/auth/twitch');

      expect(decodeURIComponent(setCookie)).toContain('broadcaster');
    });

    it('completes a callback started from it', async () => {
      const app = createApp();
      const { nonce, cookie } = await startFlow(app, '/auth/twitch');

      const res = await request(app)
        .get('/auth/twitch/callback')
        .set('Cookie', cookie)
        .query({ code: 'test-code', state: nonce });

      expect(axios.post).toHaveBeenCalled();
      expect(res.headers.location).not.toContain('error=invalid_state');
    });
  });

  describe('GET /auth/twitch/viewer', () => {
    it('redirects the browser rather than answering with JSON', async () => {
      const app = createApp();
      const res = await request(app).get('/auth/twitch/viewer').query({ channel: 'somechannel' });

      expect(res.status).toBe(302);
      expect(res.headers.location).toContain('id.twitch.tv/oauth2/authorize');
    });

    it('keeps the viewer marker and channel out of state', async () => {
      const { nonce } = await startFlow(createApp(), '/auth/twitch/viewer?channel=somechannel');

      expect(nonce).toMatch(/^[0-9a-f]{64}$/);
      expect(nonce).not.toContain('viewer');
      expect(nonce).not.toContain('somechannel');
    });

    it('carries the channel context through in the cookie instead', async () => {
      const app = createApp();
      const res = await request(app).get('/auth/twitch/viewer').query({ channel: 'somechannel' });

      const setCookie = res.headers['set-cookie'] as unknown as string[];
      const stateCookie = setCookie.find((c) => c.startsWith(`${STATE_COOKIE_NAME}=`)) as string;

      expect(decodeURIComponent(stateCookie)).toContain('somechannel');
      expect(decodeURIComponent(stateCookie)).toContain('viewer');
    });
  });

  describe('GET /auth/twitch/callback', () => {
    it('rejects a callback whose state does not match the cookie', async () => {
      const app = createApp();
      const { cookie } = await startFlow(app, '/auth/twitch');

      const res = await request(app)
        .get('/auth/twitch/callback')
        .set('Cookie', cookie)
        .query({ code: 'test-code', state: 'a'.repeat(64) });

      expect(res.status).toBe(302);
      expect(res.headers.location).toContain('auth-error.html');
      expect(res.headers.location).toContain('error=invalid_state');
    });

    it('exchanges no authorization code on a state mismatch', async () => {
      const app = createApp();
      const { cookie } = await startFlow(app, '/auth/twitch');

      await request(app)
        .get('/auth/twitch/callback')
        .set('Cookie', cookie)
        .query({ code: 'test-code', state: 'a'.repeat(64) });

      expect(axios.post).not.toHaveBeenCalled();
    });

    it('rejects a callback with a valid state but no cookie', async () => {
      const app = createApp();
      const { nonce } = await startFlow(app, '/auth/twitch');

      const res = await request(app)
        .get('/auth/twitch/callback')
        .query({ code: 'test-code', state: nonce });

      expect(res.headers.location).toContain('error=invalid_state');
      expect(axios.post).not.toHaveBeenCalled();
    });

    it('rejects a viewer callback that has no cookie, rather than issuing a viewer token', async () => {
      const app = createApp();
      const { nonce } = await startFlow(app, '/auth/twitch/viewer?channel=somechannel');

      const callback = await request(app)
        .get('/auth/twitch/callback')
        .query({ code: 'test-code', state: nonce });

      expect(callback.headers.location).toContain('error=invalid_state');
      expect(axios.post).not.toHaveBeenCalled();
    });

    it('clears the state cookie so it cannot be replayed', async () => {
      const app = createApp();
      const { nonce, cookie } = await startFlow(app, '/auth/twitch');

      const res = await request(app)
        .get('/auth/twitch/callback')
        .set('Cookie', cookie)
        .query({ code: 'test-code', state: nonce });

      const cleared = (res.headers['set-cookie'] as unknown as string[])
        .find((c) => c.startsWith(`${STATE_COOKIE_NAME}=`)) as string;

      expect(cleared).toContain(`${STATE_COOKIE_NAME}=;`);
      expect(cleared).toContain('Expires=Thu, 01 Jan 1970');
    });

    it('clears the state cookie even when the state did not match', async () => {
      const app = createApp();
      const { cookie } = await startFlow(app, '/auth/twitch');

      const res = await request(app)
        .get('/auth/twitch/callback')
        .set('Cookie', cookie)
        .query({ code: 'test-code', state: 'a'.repeat(64) });

      const cleared = (res.headers['set-cookie'] as unknown as string[])
        .find((c) => c.startsWith(`${STATE_COOKIE_NAME}=`)) as string;

      expect(cleared).toContain(`${STATE_COOKIE_NAME}=;`);
    });

    it('gets past state binding and on to the code exchange on a match', async () => {
      const app = createApp();
      const { nonce, cookie } = await startFlow(app, '/auth/twitch');

      const res = await request(app)
        .get('/auth/twitch/callback')
        .set('Cookie', cookie)
        .query({ code: 'test-code', state: nonce });

      // The mocked axios makes the exchange itself fail, but reaching it at all
      // proves the state check passed rather than short-circuiting.
      expect(axios.post).toHaveBeenCalled();
      expect(res.headers.location).not.toContain('error=invalid_state');
    });

    it('routes to the viewer handler based on the cookie, not on state', async () => {
      const app = createApp();
      const { nonce, cookie } = await startFlow(app, '/auth/twitch/viewer?channel=somechannel');

      (axios.post as jest.Mock).mockRejectedValue(new Error('exchange failed') as never);

      const callback = await request(app)
        .get('/auth/twitch/callback')
        .set('Cookie', cookie)
        .query({ code: 'test-code', state: nonce });

      // Both flows share auth-error.html on failure, so the proof that routing
      // came from the cookie lives in the success-path tests below, which land
      // on viewer-settings.html rather than auth-complete.html.
      const redirect = new URL(callback.headers.location);
      expect(redirect.pathname).toBe('/auth-error.html');
      expect(redirect.searchParams.get('error')).toBe('auth_failed');
    });

    it('carries the channel context from the cookie into the viewer-settings redirect', async () => {
      const app = createApp();
      const { nonce, cookie } = await startFlow(app, '/auth/twitch/viewer?channel=somechannel');

      (axios.post as jest.Mock).mockResolvedValue({
        data: { access_token: 'test-access-token' },
      } as never);
      // validateTwitchToken calls axios.get under the hood.
      (axios.get as jest.Mock).mockResolvedValue({
        data: { login: 'SomeViewer', user_id: '12345' },
      } as never);

      const callback = await request(app)
        .get('/auth/twitch/callback')
        .set('Cookie', cookie)
        .query({ code: 'test-code', state: nonce });

      // `channel` used to ride in `state`; it now comes back out of the cookie.
      const redirect = new URL(callback.headers.location);
      expect(redirect.pathname).toBe('/viewer-settings.html');
      expect(redirect.searchParams.get('channel')).toBe('somechannel');
      expect(redirect.searchParams.get('validated')).toBe('1');
      // A single-use code stands in for the token, which never enters the URL.
      expect(redirect.searchParams.get('code')).toMatch(/^[0-9a-f]{64}$/);
      expect(redirect.searchParams.get('session_token')).toBeNull();
    });

    it('omits channel from the redirect when the flow started without one', async () => {
      const app = createApp();
      const { nonce, cookie } = await startFlow(app, '/auth/twitch/viewer');

      (axios.post as jest.Mock).mockResolvedValue({
        data: { access_token: 'test-access-token' },
      } as never);
      (axios.get as jest.Mock).mockResolvedValue({
        data: { login: 'SomeViewer', user_id: '12345' },
      } as never);

      const callback = await request(app)
        .get('/auth/twitch/callback')
        .set('Cookie', cookie)
        .query({ code: 'test-code', state: nonce });

      const redirect = new URL(callback.headers.location);
      expect(redirect.pathname).toBe('/viewer-settings.html');
      expect(redirect.searchParams.has('channel')).toBe(false);
    });

    it('sends a denied viewer to the error page, not a raw JSON body', async () => {
      const app = createApp();
      const { nonce, cookie } = await startFlow(app, '/auth/twitch/viewer?channel=somechannel');

      const callback = await request(app)
        .get('/auth/twitch/callback')
        .set('Cookie', cookie)
        .query({ error: 'access_denied', error_description: 'The user denied you access', state: nonce });

      expect(callback.status).toBe(302);
      const redirect = new URL(callback.headers.location);
      expect(redirect.pathname).toBe('/auth-error.html');
      expect(redirect.searchParams.get('error')).toBe('access_denied');
    });

    it('encodes the viewer error message exactly once', async () => {
      const app = createApp();
      const { nonce, cookie } = await startFlow(app, '/auth/twitch/viewer');

      const callback = await request(app)
        .get('/auth/twitch/callback')
        .set('Cookie', cookie)
        .query({ error: 'server_error', error_description: '100% broken', state: nonce });

      // auth-error.html reads this with URLSearchParams, which decodes once.
      // Encoding twice here would surface %2520 in the address bar, and a
      // literal "%" would throw URIError if the page decoded again.
      const location = callback.headers.location as string;
      expect(location).not.toContain('%2520');
      expect(new URL(location).searchParams.get('error_description')).toBe('100% broken');
    });

    it('still reports a genuine Twitch error rather than masking it as bad state', async () => {
      const app = createApp();
      const { cookie } = await startFlow(app, '/auth/twitch');

      const res = await request(app)
        .get('/auth/twitch/callback')
        .set('Cookie', cookie)
        .query({ error: 'access_denied', error_description: 'User denied', state: 'mismatched' });

      expect(res.headers.location).toContain('error=access_denied');
    });
  });
});
