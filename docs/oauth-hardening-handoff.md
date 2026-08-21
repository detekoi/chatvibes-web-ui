# Handoff: standardize and harden the Twitch OAuth flow

**Repos in scope (both required):**
- `/Users/henry/Dev/chatvibes-web-ui` — WildcatTTS, frontend `tts.wildcat.chat`
- `/Users/henry/Dev/chatsage-web-ui` — WildcatSage. Hosts: `app.wildcat.chat`
  (frontend + API) and `api.wildcat.chat` (API). See the trap section — the
  split between them is the thing that breaks login.

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
| Client starts flow | `fetch('/auth/twitch/initiate')` → `{twitchAuthUrl, state}` → client saves `state` to `sessionStorage` → redirects | `location.href = 'https://api.wildcat.chat/auth/twitch'` — server does everything (but the callback lands on `app.wildcat.chat`; see the trap section) |
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

### Finding 3 — the documented intent was never implemented, and is imprecise

`chatvibes-web-ui/CLAUDE.md` says *"Use signed cookies for OAuth state
security."* Neither backend calls `res.cookie` for state at all. Sage mounts
`cookie-parser` (`functions/src/config/middleware.ts:169`) but passes it no
secret, so signed cookies do not work there either.

Two separate problems, and the second is the interesting one: **no state cookie
exists**, and **"signed" is the wrong requirement anyway**. There is no cookie
signing key in either repo, and the design in this document does not need one.
See "Do not sign the cookie" below before treating that CLAUDE.md line as a
spec.

---

## ⚠️ The trap that will break a naive implementation

**The two apps do not share an origin topology. A single copy-pasted cookie
config will not work for both — and for TTS, a state cookie cannot work at all
until a config change is made first.**

**TTS: the two endpoints are on different registrable domains.** This is the
single most important fact in this document. From `chatvibes-web-ui/functions/.env`:

```
CALLBACK_URL=https://us-central1-chatvibestts.cloudfunctions.net/webUi/auth/twitch/callback
FRONTEND_URL=https://chatvibestts.web.app
```

- `/auth/twitch/initiate` is reached through the Firebase Hosting rewrite, so
  it runs on the **Hosting** origin (`chatvibestts.web.app` / `tts.wildcat.chat`).
- Twitch redirects to `/auth/twitch/callback` on
  **`us-central1-chatvibestts.cloudfunctions.net`** — a different registrable
  domain entirely.

A cookie set by `/initiate` will **never** be sent to the callback. Setting a
state cookie and comparing it on the callback is a no-op for TTS as currently
deployed. See Phase 0 below.

**Sage has the same split, in the other direction.** Verified from
`chatsage-web-ui/firebase.json`, which defines **two Hosting targets in one
repo, both rewriting to the same `webUi` function**:

| target | serves | rewrites |
|---|---|---|
| `app` (`app.wildcat.chat`) | `public/` static **and** the API | `/auth/**`, `/api/**` → `webUi` |
| `api` (`api.wildcat.chat`) | API only | `/**` → `webUi` |

The client hardcodes `https://api.wildcat.chat` (`public/index.html`,
`public/js/api.js`) so the flow *starts* on `api`, but the deployed
`CALLBACK_URL` is on `app.wildcat.chat` — so a host-only state cookie set at
the start is never sent back to the callback, and login breaks on deploy.

**Fix: point the client at `app.wildcat.chat`.** One line in `public/js/api.js`.
Because `app` already rewrites `/api/**` to the same function, no API call
changes backend, and because `app` also serves the frontend, the whole flow
collapses onto a single origin. No Twitch console change, no Secret Manager
change, nothing deploy-coupled.

Do **not** reach for `Domain=.wildcat.chat` instead. That sends the state cookie
to every sibling subdomain including `tts.wildcat.chat`, which is a different
application, and permanently forecloses `__Host-`.

`bot.wildcat.chat` is also a live origin (`ALLOWED_ORIGINS` in
`config/constants.ts:44`), so users may arrive there. The flow still works from
it — the whole OAuth round trip happens on `app` as a top-level navigation —
but include it in the live verification.

⚠️ **Both Sage hosts are Firebase Hosting**, so the `__session`-only cookie
stripping described under Phase 0 applies to Sage too, not just TTS.

**How to check this for yourself:** host topology in these repos lives in
`firebase.json` targets and `functions/.env` — *not* in client code, and not in
UI copy. The `bot.wildcat.chat` in the page footers came from a design spec and
is not evidence of anything. Read the config, not the strings.

`SameSite=Lax` is correct for both — the Twitch → callback hop is a top-level
GET navigation, so a Lax cookie is sent. **`SameSite=Strict` will break the
flow**; do not use it. Verify this rather than assuming.

Sage already sets `Access-Control-Allow-Credentials: true` against an origin
allowlist (`functions/src/config/middleware.ts:54-65`,
`ALLOWED_ORIGINS` in `config/constants.ts:44`) and has a
`csrfProtectionMiddleware` mounted at line 172. Read both before adding
anything new.

⚠️ Note that `cookieParser()` at line 169 is mounted **without a secret**, so
signed cookies are not actually available in Sage — see "Do not sign the
cookie" below. Do not read the bare presence of `cookie-parser` as the work
being half done.

---

## Target shape (the end state — NOT all of Phase 1)

The destination is **Sage's client shape** (plain redirect; the server owns the
whole flow) with **real server-side state binding**. TTS's extra round-trip and
client-side state juggling exists only to support a check that should not be
happening in the browser.

⚠️ **Converging the client shape is Phase 2, not Phase 1.** Phase 1 is the
server-side binding only, and it needs no frontend change in either repo — TTS
can set and compare the cookie inside its existing `/initiate` + `/callback`
pair, leaving `public/index.html` untouched. Read the phasing section before
starting.

The server-side handler shape, both repos:

1. `GET /auth/twitch` — generate a high-entropy random nonce, set it in an
   **HttpOnly, Secure, SameSite=Lax, Path=/, host-only** cookie (short max-age,
   ~10 min), redirect to Twitch with that nonce as `state`.
2. `GET /auth/twitch/callback` — compare `req.query.state` to the cookie with a
   **timing-safe** comparison (`crypto.timingSafeEqual`, which requires equal
   buffer lengths — check length first and bail rather than letting it throw),
   **clear the cookie**, and reject on mismatch **before** exchanging the code.
   Preserve today's structured error redirects (`redirectToFrontendWithError`)
   so the existing `auth-error.html` pages keep working — they render `?error=`
   and `?error_description=`.
3. Put the routing payload in the **cookie**, not in `state`. TTS today carries
   a viewer-vs-broadcaster marker `t` and optional channel `c` in `state`;
   Sage carries `frontendRedirect`. Move them into the cookie value alongside
   the nonce and send **only the opaque nonce** as `state`. The cookie is
   server-set and HttpOnly, so its contents can be trusted; `state` round-trips
   through Twitch and the browser and cannot be.

   This matters more than it looks: `t` selects which callback handler runs,
   and therefore which token scope is issued. Reading that from an
   attacker-supplied `state` is a decision you do not want to make.

### Do not sign the cookie — and you do not need a key

`chatvibes-web-ui/functions/src/config.ts` exposes exactly five secrets
(`TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET`, `JWT_SECRET`, `WAVESPEED_API_KEY`,
`302_KEY`) and `firebase.json` binds only those. Sage mounts `cookieParser()`
**with no secret**, so `req.signedCookies` is permanently empty there and
`res.cookie(..., { signed: true })` would throw. There is no cookie signing key
in either repo.

**You do not need one.** A signature proves our server minted the value. It
does not help here, because an attacker can simply run their own legitimate
flow, obtain a *validly signed* cookie and its matching `state`, and then try
to plant that pair on a victim. The signature is genuine, so it blocks nothing.
Signing matters when a cookie carries semantic data you will trust without
further checking — it does not add anything to an opaque nonce compared for
equality, and step 3 above keeps the semantic payload in the same server-set
cookie rather than in attacker-reachable `state`.

What actually defends this cookie: high entropy, `HttpOnly`, `Secure`,
`SameSite=Lax`, `Path=/`, **no `Domain` attribute** (host-only — do not scope
the state cookie to `.wildcat.chat`), a short max-age, clearing it after one
use, and a timing-safe comparison.

Use the **`__Host-` prefix** where you can. Browsers reject a `__Host-` cookie
that sets `Domain`, or that is not `Secure` with `Path=/`, which is what stops
a sibling subdomain planting one (cookie tossing) — the residual risk a
signature would not have covered either.

- **Sage** can use it: `__Host-oauth-state`.
- **TTS cannot**, because Firebase Hosting forwards only `__session` (Phase 0).
  Use `__session`, host-only, and note the residual cookie-tossing exposure
  when you report back rather than papering over it.

`chatvibes-web-ui/CLAUDE.md` says *"Use signed cookies for OAuth state
security."* That line is the origin of the word "signed" in earlier drafts of
this document. Treat it as imprecise rather than as a requirement: update it to
describe what you actually built.

**If you nonetheless conclude a new secret is genuinely required, stop and ask
the human.** Do not derive a key from `JWT_SECRET`, and do not invent one. Key
separation by ad-hoc derivation is exactly the kind of decision that should not
be made silently inside a handoff.

---

## Phasing — do NOT do this all at once

### Phase 0 — TTS only: make a state cookie possible at all (blocking)

Phase 1 cannot work for TTS until `/initiate` and `/callback` share an origin.
Today they do not (see the trap section above).

Repoint TTS's `CALLBACK_URL` from the raw Cloud Functions host to the Hosting
origin, so the callback arrives through the same `/auth/**` rewrite the rest of
the flow uses:

```
CALLBACK_URL=https://tts.wildcat.chat/auth/twitch/callback
```

Two consequences you must handle:

1. **The redirect URI must also be updated in the Twitch developer console** to
   the exact same string, or Twitch rejects the authorization request. That is
   a human action outside both repos — you cannot do it. Surface it explicitly
   when you hand back.
2. ⚠️ **Firebase Hosting strips every cookie except `__session`** before
   forwarding a request to a Function. Once the callback comes through Hosting,
   a state cookie named anything else will silently not arrive. Name it
   `__session` (or namespace inside a `__session` payload). **Verify this
   against current Firebase Hosting docs before building on it** — it is
   long-standing documented behaviour, but confirm rather than trust this note.

Confirm which host TTS actually serves in production (`chatvibestts.web.app`
and `tts.wildcat.chat` both appear in config) and use the one the redirect URI
will name.

If Phase 0 turns out to be unacceptable — for example, the human does not want to touch
the Twitch console — **stop and report back** rather than reaching for a
stateless signed-state scheme as a substitute. HMAC-signing the state proves
integrity but not browser binding, so it does not stop an attacker replaying
their own validly-signed state. That is a different, weaker guarantee and it
should be an explicit human decision, not a silent downgrade.

**Sage needs a Phase 0 too**, but a cheaper one: repoint the client's
`API_BASE_URL` from `api.wildcat.chat` to `app.wildcat.chat` so the flow starts
on the host the callback already lands on. See the trap section. This is a
frontend one-liner and is the one frontend change Phase 1 legitimately needs —
it is config, not behaviour.

### Phase 1 — state binding, server-side only (the assignment)

The handler shape described under "Target shape". **No frontend changes in
either repo.** TTS keeps its `/initiate` + `sessionStorage` round-trip exactly
as-is; the cookie is set in the existing `/initiate` JSON response and compared
in `/callback`. The client-side `sessionStorage` comparison stays where it is
and simply becomes redundant belt-and-braces — leave it.

Session delivery stays exactly as it is today.

**Phase 0 + Phase 1 are the whole assignment unless the human says otherwise.**

### Phase 2 (separate change, only if asked) — converge the client shape

Collapse TTS's `/initiate` round-trip into a plain redirect matching Sage, and
delete the then-redundant client-side `sessionStorage` check from
`public/index.html` / `auth-complete.html`. This is a consistency change, not a
security one — once Phase 1 lands, the server-side cookie is authoritative and
TTS's extra hop is merely surplus, not unsafe.

### Phase 3 (separate change, only if asked) — get the token out of the URL

Deliver the session JWT as an HttpOnly cookie or a one-time exchange code.

This is much larger than it looks. It touches **every authenticated call site**
in both frontends:
- TTS: `public/js/common/api.ts` → `fetchWithAuth()` reads
  `localStorage.app_session_token` and sends `Authorization: Bearer`.
- Sage: `public/js/api.js` does the equivalent.

It is also a **breaking change for already-signed-in users**, and other
consumers may read `app_session_token`. Audit before starting. Do not begin
Phase 3 in the same commit as Phase 1.

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

- [ ] TTS's `CALLBACK_URL` and the Twitch console redirect URI match, and the
      callback now arrives through the Hosting rewrite (Phase 0).
- [ ] The TTS state cookie survives Firebase Hosting — that is, it is named
      `__session`, confirmed by an actual round trip through the emulator or a
      deployed preview, not by reading the code.
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
- [ ] `chatvibes-web-ui/CLAUDE.md`'s cookie line describes what was actually
      built (it currently says "signed cookies"; the design here is not signed).
- [ ] The state cookie sets no `Domain` attribute in either repo, and the
      `state` query parameter carries **only** the opaque nonce.
- [ ] Comparison is timing-safe and length-checked before `timingSafeEqual`.
- [ ] Phase 1 changed no frontend **behaviour** in either repo. TTS keeps its
      `/initiate` round-trip and its `sessionStorage` comparison; Sage keeps its
      plain redirect. Comment and doc corrections in frontend files are fine and
      expected — the item above requires one. If you changed what a page *does*,
      you have drifted into Phase 2: stop and say so.

## Out of scope — do not do these

- Do not change UI, styling, or `design-system.css`. A design-system pass was
  just completed; leave it alone.
- Do not change Twitch scopes, JWT claims, expiry, or `JWT_SECRET`.
- Do not refactor unrelated auth code, rename routes, or "tidy" adjacent files.
- Do not deploy. Do not run `firebase deploy`.
- Do not commit secrets. Do not add new ones or derive keys from existing
  secrets — the design below needs neither. If you become convinced a new
  secret is unavoidable, stop and ask rather than improvising one.

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
