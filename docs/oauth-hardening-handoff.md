# Handoff: standardize and harden the Twitch OAuth flow

**Repos in scope (both required):**
- `/Users/henry/Dev/chatvibes-web-ui` — WildcatTTS, frontend `tts.wildcat.chat`
- `/Users/henry/Dev/chatsage-web-ui` — WildcatSage, frontend `bot.wildcat.chat`

Read this whole document before touching code. It contains findings that are
not obvious from reading the source, and at least one comment in the codebase
actively asserts something untrue.

---

## The problem

The two apps start Twitch OAuth in different ways, and **neither binds the
OAuth `state` to the user's browser**. Nothing is stored server-side and no
cookie is set, in either app.

### What each one actually does today

| | TTS (`chatvibes`) | Sage |
|---|---|---|
| Client starts flow | `fetch('/auth/twitch/initiate')` → `{twitchAuthUrl, state}` → client saves `state` to `sessionStorage` → redirects | `location.href = 'https://api.wildcat.chat/auth/twitch'` — server does everything |
| `state` generated | `randomBytes(16)` (broadcaster); base64 JSON incl. `randomBytes(8)` (viewer) | `crypto.randomBytes(16)` nonce inside JSON |
| State bound to browser | ❌ none | ❌ none |
| Where state is checked | Client, in `auth-complete.html`, vs `sessionStorage` | Server — **presence check only** |
| Effective CSRF protection | ✅ yes (client-side) | ❌ **none** |

### Finding 1 — Sage's "validation" is a shape check, not CSRF protection

`chatsage-web-ui/functions/src/auth/oauth.router.ts`, around lines 99–127. The
block is commented `// Validate state parameter (CSRF protection)` and does:

```ts
parsedState = JSON.parse(twitchQueryState as string);
if (!parsedState.nonce || !parsedState.frontendRedirect) {
  throw new Error("Invalid state structure");
}
```

It only checks that the two keys exist. The nonce generated at line ~50 is never
stored and never compared. `{"nonce":"x","frontendRedirect":"/"}` passes.

`chatsage-web-ui/public/auth-complete.html` repeats the claim in a comment:
*"Server has already validated the OAuth state."* It has not.

**Do not trust comments in either auth path. Verify against the code.**

### Finding 2 — TTS is safer, but mints the session token before any check

`chatvibes-web-ui/functions/src/auth/routes.ts`:
- `/twitch/initiate` (~line 175) generates the state and returns it in JSON. No
  cookie is set.
- `/twitch/callback` (~line 207) only base64-decodes `state` to *route* between
  the viewer and broadcaster handlers. It performs no validation.
- A 7-day JWT is signed (~line 293) and appended to the redirect URL
  (~line 308) **before** anything checks the state.

The client-side comparison in `auth-complete.html` does block login-CSRF (an
attacker cannot write to the victim's `sessionStorage`), so TTS is genuinely
safer than Sage today. But the token exists in browser history and `Referer`
regardless of whether the page decides to store it.

### Finding 3 — the documented intent was never implemented

`chatvibes-web-ui/CLAUDE.md` says *"Use signed cookies for OAuth state
security."* Neither backend calls `res.cookie` for state. Sage already mounts
`cookie-parser` (`functions/src/config/middleware.ts:169`) and does not use it
for this.

---

## ⚠️ The trap that will break a naive implementation

**The two apps do not share an origin topology. A single copy-pasted cookie
config will not work for both.**

- **TTS is same-origin.** `firebase.json` rewrites `/auth/**` and `/api/**` to
  the `webUi` function, so the browser only ever talks to `tts.wildcat.chat`.
  A host-only cookie is fine.
- **Sage is cross-origin.** The frontend is `bot.wildcat.chat`; the API is
  `https://api.wildcat.chat` (hardcoded in `public/index.html` and
  `public/js/api.js`). They share the parent domain `wildcat.chat`, so a state
  cookie must be scoped `Domain=.wildcat.chat` to survive the round trip.

`SameSite=Lax` is correct for both — the Twitch → callback hop is a top-level
GET navigation, so a Lax cookie is sent. **`SameSite=Strict` will break the
flow**; do not use it. Verify this rather than assuming.

Sage already sets `Access-Control-Allow-Credentials: true` against an origin
allowlist (`functions/src/config/middleware.ts:54-65`,
`ALLOWED_ORIGINS` in `config/constants.ts:44`) and has a
`csrfProtectionMiddleware` mounted at line 172. Read both before adding
anything new — some of the work may already exist.

---

## Target shape

Standardize on **Sage's client shape** (plain redirect; the server owns the
whole flow) with **real server-side state binding**. TTS's extra round-trip and
client-side state juggling exists only to support a check that should not be
happening in the browser.

One handler shape, both repos:

1. `GET /auth/twitch` — generate a random nonce, set it in an **HttpOnly,
   Secure, SameSite=Lax, signed** cookie (short max-age, ~10 min), redirect to
   Twitch with that nonce as `state`.
2. `GET /auth/twitch/callback` — compare `req.query.state` to the signed
   cookie, **clear the cookie**, and reject on mismatch **before** exchanging
   the code. Preserve today's structured error redirects
   (`redirectToFrontendWithError`) so the existing `auth-error.html` pages keep
   working — they render `?error=` and `?error_description=`.
3. Keep the extra payloads TTS carries in `state` today (viewer-vs-broadcaster
   marker `t`, optional channel `c`) and Sage's `frontendRedirect`. **Do not
   move these into the cookie value blindly** — decide deliberately whether
   they belong in the signed cookie or stay in `state` alongside the nonce.
   Whichever you choose, the nonce comparison is what must be authoritative.

---

## Phasing — do NOT do this all at once

### Phase 1 (do this first, ship it alone)
State binding only, as described above. Small, contained, no frontend API
changes. Session delivery stays exactly as it is today.

**Phase 1 is the whole assignment unless the human says otherwise.**

### Phase 2 (separate change, only if asked)
Get the session JWT out of the URL — deliver it as an HttpOnly cookie or a
one-time exchange code.

This is much larger than it looks. It touches **every authenticated call site**
in both frontends:
- TTS: `public/js/common/api.ts` → `fetchWithAuth()` reads
  `localStorage.app_session_token` and sends `Authorization: Bearer`.
- Sage: `public/js/api.js` does the equivalent.

It is also a **breaking change for already-signed-in users**, and other
consumers may read `app_session_token`. Audit before starting. Do not begin
Phase 2 in the same commit as Phase 1.

---

## Repo-specific mechanics you must respect

**chatvibes-web-ui**
- ⚠️ **Never edit compiled JS.** Edit `public/js/**/*.ts` only; run
  `npm run build:frontend` from the repo root. `public/js/**/*.js` is
  gitignored and not tracked.
- Backend: `functions/src/**` (TypeScript, 2nd-gen Cloud Functions, Node 22).
- Tests: `npm test` in `functions/` (runs jest under the Firestore emulator).
  Existing coverage worth extending:
  `functions/src/api/__tests__/auth.integration.test.ts`,
  `functions/src/middleware/__tests__/auth.test.ts`.
- ⚠️ Do not disturb the `/s/**` hosting rewrite — that is the OBS browser-source
  route and has its own token scheme.
- There are 2 pre-existing `TS18047` errors in
  `public/js/dashboard/ignore-list.ts`. They are not yours; leave them.

**chatsage-web-ui**
- Frontend JS in `public/js/**` is **hand-written, not compiled**. Edit directly.
  (TypeScript in this repo is backend-only, under `functions/`.)
- Backend: `functions/src/auth/oauth.router.ts` is the file to change.
- Tests: `npm test` in `functions/`. Extend
  `functions/test/auth/oauth.router.test.ts`.

---

## Definition of done

- [ ] A callback with a `state` that does not match the cookie is **rejected**,
      and no session token is minted — assert this in a test, in both repos.
- [ ] A callback with a **missing** cookie is rejected.
- [ ] The state cookie is cleared after use (no replay).
- [ ] Happy path still works end to end in both apps, including the TTS
      **viewer** flow (`/auth/twitch/viewer`) and its channel-context param,
      and Sage's `frontendRedirect`.
- [ ] `auth-error.html` still renders the right message for a rejected state in
      both apps.
- [ ] `npm test` passes in both `functions/` dirs; `npm run lint` clean.
- [ ] TTS: `npm run build:frontend` run and `npx tsc --noEmit -p public/tsconfig.json`
      shows no *new* errors.
- [ ] The stale comment in `chatsage-web-ui/public/auth-complete.html` claiming
      the server already validated state is corrected or removed.
- [ ] `chatvibes-web-ui/CLAUDE.md`'s signed-cookie line is now true.

## Out of scope — do not do these

- Do not change UI, styling, or `design-system.css`. A design-system pass was
  just completed; leave it alone.
- Do not change Twitch scopes, JWT claims, expiry, or `JWT_SECRET`.
- Do not refactor unrelated auth code, rename routes, or "tidy" adjacent files.
- Do not deploy. Do not run `firebase deploy`.
- Do not commit secrets or add new ones.

## Verification the agent cannot do alone

An agent **cannot** complete a real Twitch OAuth round trip — it requires
interactive login with real credentials. Do not attempt it and do not fake it.
Cover the logic with tests and the Firebase emulator, then hand back with
explicit instructions for the human to verify the live round trip in both apps
(broadcaster, TTS viewer, and Sage), on a preview channel before production.

## Report back with

The exact diff per repo, which findings above you confirmed independently
(and any you found to be wrong), the cookie attributes you chose for each repo
and why they differ, and the precise manual steps for the human to verify the
live flow.
