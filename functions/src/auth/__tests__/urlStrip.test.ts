/**
 * Tests for the credential-stripping scripts in the heads of the two OAuth
 * landing pages.
 *
 * They exist so that third-party tags further down those pages never run with
 * a credential still in the URL. That only holds if each script strips what
 * the callback actually sends, so these run the real scripts out of the real
 * files rather than copies — the two drifted apart once already, when the
 * callback moved from `session_token` to `code` and the strip was not updated.
 */

import { describe, it, expect } from '@jest/globals';
import fs from 'fs';
import path from 'path';

const PAGES = {
  'auth-complete.html': path.join(__dirname, '../../../../public/auth-complete.html'),
  'viewer-settings.html': path.join(__dirname, '../../../../public/viewer-settings.html'),
};

interface StripResult {
  url: string | null;
  sessionToken?: string;
  exchangeCode?: string;
}

/**
 * Pulls the credential-stripping script out of a page and runs it.
 * @param page - Which landing page to exercise
 * @param search - The query string the callback would land with
 * @return The rewritten URL and anything handed over in memory
 */
function runStrip(page: keyof typeof PAGES, search: string): StripResult {
  const html = fs.readFileSync(PAGES[page], 'utf8');

  const inline = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)]
    .map((m) => m[1]);
  const strip = inline.find((s) => s.includes('history.replaceState') && s.includes('params.delete'));

  if (!strip) throw new Error(`No credential-stripping script found in ${page}`);

  let rewritten: string | null = null;
  const win: Record<string, unknown> = {
    location: { search, pathname: `/${page}`, hash: '' },
    history: { replaceState: (_s: unknown, _t: unknown, url: string) => { rewritten = url; } },
  };

  new Function('window', 'URLSearchParams', strip)(win, URLSearchParams);

  return {
    url: rewritten,
    sessionToken: win.__sessionToken as string | undefined,
    exchangeCode: win.__exchangeCode as string | undefined,
  };
}

describe.each(Object.keys(PAGES) as (keyof typeof PAGES)[])('%s credential stripping', (page) => {
  const code = 'a'.repeat(64);

  it('takes the exchange code out of the URL and hands it over in memory', () => {
    const result = runStrip(page, `?validated=1&code=${code}`);

    expect(result.exchangeCode).toBe(code);
    expect(result.url).not.toContain('code=');
  });

  it('still handles the legacy session_token shape', () => {
    const result = runStrip(page, '?validated=1&session_token=SECRET.JWT');

    expect(result.sessionToken).toBe('SECRET.JWT');
    expect(result.url).not.toContain('SECRET');
  });

  it('keeps the non-secret parameters', () => {
    const result = runStrip(page, `?channel=somechannel&validated=1&code=${code}`);

    expect(result.url).toContain('channel=somechannel');
    expect(result.url).toContain('validated=1');
  });

  it('leaves the URL alone when there is no credential to strip', () => {
    const result = runStrip(page, '?channel=somechannel');

    expect(result.url).toBeNull();
  });

  it('runs before any third-party script on the page', () => {
    const html = fs.readFileSync(PAGES[page], 'utf8');

    const stripAt = html.indexOf('history.replaceState');
    const thirdParty = [...html.matchAll(/<script[^>]*\bsrc="https?:\/\/[^"]+"/g)]
      .map((m) => m.index as number);

    expect(stripAt).toBeGreaterThan(-1);
    // Anything loaded from another origin runs with full access to
    // location.href, so the strip has to come first in document order.
    thirdParty.forEach((at) => expect(stripAt).toBeLessThan(at));
  });
});
