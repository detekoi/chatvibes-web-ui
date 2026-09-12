# CLAUDE.md

## ⚠️ CRITICAL: TypeScript Source Files

**NEVER edit compiled JavaScript files!**

- ✅ Edit TypeScript sources in `/public/js/**/*.ts`
- ❌ NEVER edit compiled files in `/public/js/**/*.js`
- ✅ Run `npm run build:frontend` after editing TypeScript
- ✅ Use `npm run watch:frontend` for auto-recompilation

## Common Commands

```bash
# Frontend (after editing .ts files)
npm run build:frontend      # Compile TypeScript
npm run watch:frontend      # Auto-compile on changes

# Backend (Firebase Functions)
cd functions && npm run serve    # Local emulator
firebase deploy --only functions # Deploy functions
firebase deploy                  # Deploy all

# Checks (esbuild does NOT typecheck; run these before you believe a change)
npm run check                    # typecheck + i18n validate + i18n tests
npm run typecheck:frontend       # tsc over public/tsconfig.json
npm run i18n:extract             # re-annotate the HTML, regenerate en catalogs
npm run i18n:validate            # every catalog, every referenced key
```

## Project Overview

WildcatTTS TTS bot management web application with:

- **Frontend**: Static site in `/public/` with TypeScript sources
  - Main pages: `index.html`, `dashboard.html`, `auth-complete.html`, `auth-error.html`
  - TypeScript compiles to JavaScript (edit `.ts` only!)

- **Backend**: `/functions/index.js` - Express.js app as Cloud Function (Node.js 22)
  - JWT sessions + Twitch OAuth with token refresh
  - Routes: `/auth/*`, `/api/bot/*`, `/api/auth/*`

- **Database**: Firestore collections
  - `managedChannels` - Bot status, OAuth tokens (managed by this app)
  - `ttsChannelConfigs` - TTS settings (managed by main TTS app)

## CSS Architecture (shared with chatsage-web-ui)

Sister project: **chatsage-web-ui** (WildcatSage) shares the same design system
and the same Post-Industrial theme. Stylesheets are bundled by
`scripts/build-frontend.js` into `public/css/app.min.css` in this order:

| Layer | File | Role |
|-------|------|------|
| 1 | `public/css/vendor/bootstrap.min.css` | trimmed Bootstrap 5.3.3, **CSS only** (the JS bundle is not loaded; toasts, tabs and dialogs are hand-rolled) |
| 2 | `public/css/reset.css` | normalize |
| 3 | `public/css/custom.css` | theme: tokens, Post-Industrial look, Bootstrap re-theming |
| 4 | `public/css/design-system.css` | **shared** Wildcat design system: `--wc-*` tokens, `wc-*` components |

Rules:

- **`design-system.css` should stay identical to the copy in
  `../chatsage-web-ui/public/styles/design-system.css`.** Do not add rules
  there for markup only this app has. Fixes to the design system are made in
  both repos. (ChatSage already runs without Bootstrap and carries a utility
  shim in its copy; dropping Bootstrap here is the step that lets the two
  files converge fully.)
- `custom.css` keeps `!important` only where it must beat a Bootstrap utility
  that is itself `!important` (`.text-muted`, `.rounded-*`, `.shadow`).
- Edit source CSS, then `npm run build:frontend`; `app.min.css` and its map are
  committed.
- Verifying a CSS change: snapshot `getComputedStyle` for every element on each
  page (`dashboard.html?test` and `viewer-settings.html?test` render without
  auth) before and after, and expect zero differences unless intended.

## Code Style

- Use 2nd gen Cloud Functions patterns
- Handle Twitch API rate limiting in token refresh
- Bind the OAuth `state` to the browser with the one-use `__session` cookie set
  in `functions/src/auth/state.ts`. The cookie is not signed and needs no key.
  It holds an opaque nonce compared in constant time, plus the routing payload
  (`t`, `c`) that previously traveled in `state`. It must stay host-only with no
  `Domain`. Keep `CALLBACK_URL` on the Hosting origin so that the cookie
  returns. Firebase Hosting drops every cookie except `__session`.

## Internationalization (`public/i18n/`, `public/js/common/i18n.ts`)

The dashboard ships in the 40 languages the TTS model supports. Catalogs are
generated at build time and committed; nothing is translated at runtime.

- **The English catalogs are generated from the markup, not hand-written.**
  `npm run i18n:extract` parses each page with parse5, splices `data-i18n`
  attributes into the *original source* at the reported offsets, and writes
  `public/i18n/<page>-en.json`. Splicing rather than re-serializing is what keeps
  the diff to the attributes actually added; a parse5 round-trip would reformat
  all six files. It is idempotent, so a page that already carries annotations
  keeps its keys.
- **`msg.*` and `err.*` are hand-authored and the extractor preserves them.**
  Everything else in a catalog is regenerated on every run, so do not hand-edit
  it — change the markup instead. `msg.*` is copy rendered from TypeScript, which
  has no element to hang an attribute on; `err.*` matches the API's error codes.
- **A key defined identically on more than one page is hoisted to `common`**, so
  the app bar and footer wording cannot drift between pages. The validator
  rejects a key that exists in both `common` and a page catalog: the page copy
  silently wins, so editing the common one would change nothing.
- **English is a layer under every locale, and a hit on it warns.** `t()` looks
  in the active locale, then in English, and logs the offending key the first
  time it has to. The layers are kept separate rather than merged precisely so
  that warning is possible: an English string substituted silently looks correct
  to whoever is testing in English and is wrong in the other thirty-nine. Both
  layers load up front — repairing on the first miss meant re-running
  `applyTranslations`, which overwrites whatever the page's modules have already
  rendered (on the sign-in error page it put the generic "Authentication failed"
  back over the "Login canceled" the module had just written).
- **A key missing from every layer renders as the key**, not as an English
  literal held at the call site — a call-site fallback makes a key that never
  reached the catalog look correct in English forever.
- **Structured API errors.** `apiError(res, status, code, prose, params?, extra?)`
  sends a stable `code` alongside the English `error`, and the client resolves it
  through `apiErrorMessage()` to `err.<code>`. The prose is the fallback, so an
  endpoint that has not been migrated degrades to English rather than to a bare
  key. `fetchWithAuth` resolves the code once, centrally, which is what gets the
  whole failure path out of English — but keep its `API Error: <status> ` prefix:
  `voice-preview.ts` strips it for display and `danger-zone.ts` tests for
  `API Error: 403` to tell a moderator mute from a network blip.
- **A validator whose message is composed returns a code, not prose.**
  `validateSay` in `services/pronunciation.ts` and
  `validateChannelPointsTestMessage` in `api/rewards.ts` both used to return
  sentence fragments that a caller spliced into a sentence it had already
  translated, producing output that switched language halfway. Apply the same
  rule to any new validator.
- **`i18n-format.ts` is a hand-port of the bot's `src/i18n/format.js`**, kept
  behaviourally identical so one translation script and one set of rules serve
  both repos. `tests/i18n-format.test.mjs` is what catches the port drifting;
  it transpiles the module with esbuild rather than adding a test runner.
- **RTL.** `i18n.ts` sets `dir` on `<html>` for `ar`, `he` and `fa`. The CSS uses
  logical properties (`padding-inline-start`, `inset-inline-end`,
  `border-inline-end`, `text-align: start`) so the layout mirrors. Physical
  `left`/`right` survives only where direction is genuinely irrelevant —
  full-viewport backgrounds, `left: 50%` centering, `left: 0; right: 0` pairs,
  and the spinner's rotating `border-right-color`.
- **Do not add a catch-all Hosting rewrite.** `firebase.json` rewrites only
  `/api/**`, `/auth/**` and `/s/**`, so a missing catalog returns a real 404 and
  `fetchJson` sees `res.ok === false`. Under a catch-all it would get `index.html`
  with a 200 instead, and the fallback would survive only by accident, on
  `response.json()` throwing. (That is exactly the shape wildcat-docs is in.)
- **The switcher reloads the page rather than re-applying in place.** Re-running
  the applier fixes the markup only; every string a module rendered from
  TypeScript would keep the old language until something redrew it, which for
  most of them is never. A reload is complete by construction and the choice
  survives it in `localStorage`.
- **The 40-language list has one source of truth**, `locales.json` in the bot
  repo, copied here by `npm run sync-constants` *there*. It is fetched at runtime
  rather than generated into a constant, and it is what fills both language
  pickers with endonyms — a Japanese streamer picks 日本語, not "Japanese".
- **Translation is a manual, paid, non-deterministic step and never runs in CI.**
  From the bot checkout:
  `node scripts/translate-catalogs.js --config ../chatvibes-web-ui/i18n.config.json`.
  It is incremental (a per-key hash of the English plus a global hash of the
  prompt), refuses to write a catalog that would fail validation, and flushes its
  bookkeeping after each catalog so a run killed partway through does not redo
  work already on disk. Expect to re-run it; Gemini returns sustained 503s under
  load. CI runs `npm run i18n:validate` over the committed result instead.
- **Markup that JavaScript overwrites needs translating twice.** `updateSidebarMeta`
  on both pages rewrote the sidebar readout with `'Auto'`, `'Automatic'`,
  `'On'`/`'Off'` and a capitalized raw enum value, putting English back over
  strings the applier had just translated. Anything written from TS into an
  element that also carries `data-i18n` has to go through `t()` — and a value
  rendered from an enum needs a key per member, not `charAt(0).toUpperCase()`.
- **Never branch on displayed text.** `readRenderedEntry` in `ignore-list.ts`
  decided provenance by comparing a badge's words to `'Opted out'`; translating
  the badge would have silently demoted every self opt-out to moderator in all
  39 other locales, making a viewer's own mute unremovable. It reads a data
  attribute now. The same rule killed the URL string-match in `bot.ts`.
- **The three auth/landing pages run from modules, not inline scripts.** An
  inline classic `<script>` cannot import, so its strings could not reach the
  catalogs — `auth-complete.ts`, `auth-error.ts` and `index-page.ts` exist for
  that reason, and the sign-in error copy a locked-out user reads is the most
  important text on the site to get right.
- **Do not translate:** voice IDs and names, brand names, and the two sample
  phrases `Welcome, everyone, to the stream!` / `Chat is this real?` — those name
  pre-rendered files in `public/assets/voices/*.mp3`, so translating the caption
  desynchronizes it from the audio. The reward title and prompt placeholders in
  `dashboard.html` carry `data-i18n-skip` for a related reason: they preview a
  default that is sent to Twitch in English, and Twitch shows it in its own UI.
