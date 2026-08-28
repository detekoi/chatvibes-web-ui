/**
 * Client-side internationalization for the dashboard.
 *
 * Ported from `wildcat-docs/src/scripts/i18n.js`, which proved the shape:
 * runtime JSON catalogs, no framework, no build step beyond copying files. The
 * docs-specific passes (command tables, permission badges, Lucide re-render)
 * are gone; three things it lacks are added -- ICU interpolation, `dir="rtl"`,
 * and translatable `placeholder`/`value` attributes.
 *
 * The catalog fetch starts at module evaluation rather than on DOMContentLoaded,
 * so it overlaps with parsing and with the page's own API calls. Entry points
 * await `i18nReady` before rendering anything; `t()` before then returns the
 * key, which is a visible bug rather than a silent English string.
 */

import { formatMessage, type MessageParams } from './i18n-format.js';

declare global {
  interface Window {
    /** Loaded from `js/vendor/lucide.min.js` as a classic script, so untyped. */
    lucide?: { createIcons: () => void };
  }
}

const DEFAULT_LANGUAGE = 'en';

/**
 * Locales written right-to-left, of the 40 the bot supports.
 *
 * `Intl.Locale.prototype.getTextInfo` would derive this, but it is too recent
 * to rely on across the browsers this dashboard supports, and the set is three
 * entries that are not going to change.
 */
const RTL_LANGUAGES = new Set(['ar', 'he', 'fa']);

interface LocaleEntry {
  bcp47: string;
  endonym: string;
}

export interface LanguageOption {
  /** The `languageBoost` value the API expects. */
  value: string;
  /** The language's own name for itself. */
  label: string;
  /** BCP-47, so the option can be marked up in its own language. */
  bcp47: string;
}

interface LocalesFile {
  LANGUAGE_BOOSTS: Record<string, LocaleEntry>;
  DEFAULT_LOCALE: string;
}

type Catalog = Record<string, unknown>;

let currentLanguage = DEFAULT_LANGUAGE;
let translations: Catalog = {};
/**
 * The English catalogs, kept as a separate layer under the active locale.
 *
 * Separate rather than merged so a lookup can tell which layer answered, and
 * warn the first time the locale had no entry. A silently-substituted English
 * string is the failure this whole design exists to avoid: it looks right to
 * whoever is testing in English and is wrong in the other thirty-nine.
 */
let fallbackTranslations: Catalog = {};
let warnedAboutFallback = false;

/** bcp47 -> endonym, for the switcher. Empty until locales.json resolves. */
let availableLanguages: Record<string, string> = {};
/** MiniMax `languageBoost` value -> endonym, for the two language pickers. */
let languageBoosts: LanguageOption[] = [];

// ---------------------------------------------------------------------------
// Sanitizer (defence in depth -- catalogs are ours, but they are fetched)
// ---------------------------------------------------------------------------

const SAFE_TAGS = new Set(['a', 'br', 'code', 'em', 'i', 'span', 'strong', 'b', 'kbd']);
// `data-lucide` and `aria-hidden` are here because several buttons wrap an icon
// and its label in one element, so the icon is part of the string a translator
// sees. Stripping either would drop the icon or announce it as content.
const SAFE_ATTRS = new Set(['href', 'class', 'target', 'rel', 'data-lucide', 'aria-hidden']);

/** Control characters a browser strips from an href before resolving its scheme. */
const HREF_CONTROL_CHARS = /[\u0000-\u0020\u007F-\u009F]/g;

function sanitizeNode(node: ParentNode): void {
  const toRemove: Element[] = [];
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType !== Node.ELEMENT_NODE) continue;
    const el = child as Element;
    if (!SAFE_TAGS.has(el.tagName.toLowerCase())) {
      toRemove.push(el);
      continue;
    }
    for (const attr of Array.from(el.attributes)) {
      if (!SAFE_ATTRS.has(attr.name.toLowerCase())) el.removeAttribute(attr.name);
    }
    if (el.hasAttribute('href')) {
      // Entities are decoded by the time the value is read back, so a payload
      // like `java&#x09;script:` arrives carrying a literal control character.
      // Browsers strip those before resolving the scheme, so strip them here
      // too and match on the scheme rather than on the raw prefix.
      const href = (el.getAttribute('href') ?? '').replace(HREF_CONTROL_CHARS, '').toLowerCase();
      if (/^(?:javascript|data|vbscript):/.test(href)) el.removeAttribute('href');
    }
    sanitizeNode(el);
  }
  for (const el of toRemove) el.replaceWith(document.createTextNode(el.textContent ?? ''));
}

function sanitizeHTML(html: string): string {
  const template = document.createElement('template');
  template.innerHTML = html;
  sanitizeNode(template.content);
  return template.innerHTML;
}

// ---------------------------------------------------------------------------
// Catalog access
// ---------------------------------------------------------------------------

function lookupIn(source: Catalog, key: string): string | null {
  let result: unknown = source;
  for (const part of key.split('.')) {
    if (typeof result !== 'object' || result === null || !(part in result)) return null;
    result = (result as Record<string, unknown>)[part];
  }
  return typeof result === 'string' ? result : null;
}

/**
 * Look up a dotted key in the active locale, then in English.
 *
 * The validator makes a committed catalog with a missing key impossible, so the
 * English layer only answers in the window between adding a key and running the
 * translation script — which is exactly when someone needs to be told.
 */
function lookup(key: string): string | null {
  const own = lookupIn(translations, key);
  if (own !== null) return own;

  const english = lookupIn(fallbackTranslations, key);
  if (english === null) return null;
  if (!warnedAboutFallback) {
    warnedAboutFallback = true;
    console.warn(
      `i18n: "${key}" is missing from ${currentLanguage}; showing English. ` +
      'Run the translation script.',
    );
  }
  return english;
}

/**
 * Translate `key`, interpolating `params` through the ICU subset.
 *
 * A key absent from both layers returns the key itself, which is deliberately
 * conspicuous. The alternative -- an English literal held at the call site --
 * makes a key that never reached the catalog look correct in English and stay
 * untranslated everywhere else, with nothing to notice.
 *
 * An English pattern reached through the fallback is still formatted with the
 * *active* locale's plural rules. That is harmless: a category the English
 * `one`/`other` shape does not define falls through to `other`.
 */
export function t(key: string, params?: MessageParams): string {
  const pattern = lookup(key);
  if (pattern === null) return key;
  if (!params && pattern.indexOf('{') === -1 && pattern.indexOf('#') === -1) return pattern;
  try {
    return formatMessage(pattern, params ?? {}, currentLanguage);
  } catch (error) {
    console.error(`i18n: cannot format "${key}"`, error);
    return pattern;
  }
}

/**
 * Render an API failure in the reader's language.
 *
 * The backend sends a stable `code` (plus any `params` the message
 * interpolates) alongside its English `error` prose, so a client that knows the
 * code can say it in any language while an older one keeps working. The prose
 * is the fallback for the endpoints still to be migrated -- roughly a third of
 * them -- so those toasts stay English rather than turning into bare keys.
 */
export function apiErrorMessage(data: unknown, fallbackKey: string): string {
  const body = data as
    { code?: string; params?: MessageParams; error?: string; message?: string } | null;
  if (body?.code) {
    const key = `err.${body.code}`;
    const translated = t(key, body.params);
    if (translated !== key) return translated;
  }
  // Some endpoints put their prose in `message` rather than `error`; both are
  // English fallbacks for a code that has no message yet.
  return body?.error || body?.message || t(fallbackKey);
}

/**
 * The part of a thrown API error a person should read.
 *
 * `fetchWithAuth` prefixes its errors with `API Error: <status> ` because two
 * callers key on that — `danger-zone.ts` tests for `API Error: 403` to tell a
 * moderator mute from a network blip. That prefix is machine signalling and has
 * no business in a toast, so it is stripped here rather than at each call site,
 * where one of the two that needed it had it and the other did not.
 */
export function displayError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.match(/^API Error: \d+ (.+)$/s)?.[1] ?? message;
}

/** The active BCP-47 tag. */
export function getLocale(): string {
  return currentLanguage;
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

/**
 * Which page catalog to load. Derived from the filename so a page added later
 * needs no entry here, with `index` for the site root.
 */
function getCurrentPageId(): string {
  const file = window.location.pathname.split('/').pop() ?? '';
  if (!file || file === 'index.html') return 'index';
  return file.replace(/\.html$/, '');
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * Merge two catalogs, page winning.
 *
 * Deep, not `Object.assign`: `common` and the page file both carry top-level
 * namespaces (`ui`, `nav`), so a shallow merge would drop whole branches.
 */
function mergeCatalogs(base: Catalog, override: Catalog): Catalog {
  const out: Catalog = { ...base };
  for (const [key, value] of Object.entries(override)) {
    const existing = out[key];
    out[key] = isPlainObject(value) && isPlainObject(existing)
      ? mergeCatalogs(existing, value)
      : value;
  }
  return out;
}

async function fetchJson(url: string): Promise<Catalog | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return await res.json() as Catalog;
  } catch {
    return null;
  }
}

function detectLanguage(): string {
  const fromUrl = new URLSearchParams(window.location.search).get('lang');
  let stored: string | null = null;
  try {
    stored = localStorage.getItem('preferredLanguage');
  } catch {
    // Private-mode Safari throws on access rather than returning null.
  }
  const fromBrowser = navigator.language ? navigator.language.split('-')[0]! : null;
  return fromUrl || stored || fromBrowser || DEFAULT_LANGUAGE;
}

function applyDocumentLocale(lang: string): void {
  document.documentElement.lang = lang;
  // Set on <html> rather than <body> so form controls, scrollbars and the
  // Bootstrap toast container (appended to <body> at runtime) all inherit it.
  document.documentElement.dir = RTL_LANGUAGES.has(lang) ? 'rtl' : 'ltr';
  if (['ja', 'zh', 'yue', 'ko'].includes(lang)) {
    document.body?.classList.add('cjk-language');
  } else {
    document.body?.classList.remove('cjk-language');
  }
}

async function loadCatalogs(lang: string): Promise<void> {
  const pageId = getCurrentPageId();
  const wantsFallback = lang !== DEFAULT_LANGUAGE;

  // All four in one batch, not two. The English layer was fetched in a second
  // `Promise.all` after the first resolved, which put an extra serial round trip
  // in front of first paint for every non-English reader — and the two requests
  // have no dependency on each other, only on `lang`.
  const [common, page, commonEn, pageEn] = await Promise.all([
    fetchJson(`i18n/common-${lang}.json`),
    fetchJson(`i18n/${pageId}-${lang}.json`),
    wantsFallback ? fetchJson(`i18n/common-${DEFAULT_LANGUAGE}.json`) : Promise.resolve(null),
    wantsFallback ? fetchJson(`i18n/${pageId}-${DEFAULT_LANGUAGE}.json`) : Promise.resolve(null),
  ]);

  if (!common && !page && lang !== DEFAULT_LANGUAGE) {
    // Nothing for this language at all -- an unknown `?lang=` or a locale we do
    // not ship. Fall back rather than rendering a page of bare keys.
    console.warn(`i18n: no catalogs for "${lang}", falling back to ${DEFAULT_LANGUAGE}`);
    await loadCatalogs(DEFAULT_LANGUAGE);
    return;
  }

  // English always sits underneath, per key, so anything the locale is missing
  // reads as an English sentence instead of a bare `msg.auth.testUser`.
  //
  // Loaded up front rather than repaired on the first miss: a later repair would
  // have to re-run `applyTranslations`, and that overwrites whatever the page's
  // own modules have rendered in the meantime -- on the sign-in error page it
  // put the generic "Authentication failed" back over the "Login canceled" the
  // module had just written. Two small extra fetches, in parallel, once.
  //
  // The validator makes a committed catalog with a missing key impossible, so
  // this is a backstop for the window between adding a key and translating it.
  if (wantsFallback) {
    if (!page) console.error(`i18n: no ${pageId}-${lang}.json, using ${DEFAULT_LANGUAGE}`);
    if (!common) console.error(`i18n: no common-${lang}.json, using ${DEFAULT_LANGUAGE}`);
    fallbackTranslations = mergeCatalogs(commonEn ?? {}, pageEn ?? {});
  } else {
    fallbackTranslations = {};
  }

  translations = mergeCatalogs(common ?? {}, page ?? {});
  currentLanguage = lang;

  try {
    localStorage.setItem('preferredLanguage', lang);
  } catch {
    // Nothing to do -- the URL parameter still carries the choice.
  }

  applyDocumentLocale(lang);
}

/**
 * Load `locales.json`, synced from the bot by `npm run sync-constants`, and
 * keep the BCP-47 -> endonym map for the switcher.
 *
 * Fetched alongside the catalogs rather than generated into a TS constant so
 * the 40-language list has exactly one source of truth across the three repos.
 */
async function loadLocaleList(): Promise<void> {
  const data = await fetchJson('i18n/locales.json') as unknown as LocalesFile | null;
  if (!data?.LANGUAGE_BOOSTS) return;
  const map: Record<string, string> = {};
  const boosts: LanguageOption[] = [];
  for (const [value, entry] of Object.entries(data.LANGUAGE_BOOSTS)) {
    if (!entry?.bcp47) continue;
    map[entry.bcp47] = entry.endonym || entry.bcp47;
    boosts.push({ value, label: entry.endonym || value, bcp47: entry.bcp47 });
  }
  languageBoosts = boosts;
  availableLanguages = map;
}

/**
 * The MiniMax `languageBoost` values, labelled with each language's endonym.
 *
 * The two pickers used to hold the same 40 English names inline, which meant a
 * Japanese streamer picking their own language read "Japanese" rather than
 * 日本語 -- and the list had to be edited in two files whenever it changed.
 * Empty until `locales.json` has loaded, so callers keep their markup as the
 * fallback.
 */
export function languageBoostOptions(): LanguageOption[] {
  return languageBoosts;
}

/**
 * Fill a `languageBoost` picker with endonym labels.
 *
 * `emptyLabel`, when given, adds a leading empty-valued option -- the viewer
 * page's "use the channel's setting" choice, which the dashboard has no
 * equivalent of. The current value is restored afterwards so calling this after
 * settings have loaded does not silently reset the control.
 *
 * Returns without touching the element when `locales.json` has not loaded, so
 * whatever the markup holds stays as the fallback rather than being replaced
 * with an empty list.
 */
export function fillLanguageSelect(select: HTMLSelectElement | null, emptyLabel?: string): void {
  if (!select) return;
  const options = languageBoostOptions();
  if (options.length === 0) return;

  const previous = select.value;
  const build = (value: string, label: string, lang?: string): HTMLOptionElement => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    // Each label is written in the language it names, so it has to be tagged as
    // such or a screen reader pronounces all forty with the page voice.
    if (lang) option.lang = lang;
    return option;
  };

  select.replaceChildren();
  if (emptyLabel !== undefined) select.appendChild(build('', emptyLabel));
  // "auto" is the value MiniMax's language_boost enum actually takes; the label
  // is ours, so it is translated rather than being the literal enum name.
  select.appendChild(build('auto', t('msg.lang.automatic')));
  for (const { value, label, bcp47 } of options) select.appendChild(build(value, label, bcp47));
  select.value = previous;
}

// ---------------------------------------------------------------------------
// Applying to the DOM
// ---------------------------------------------------------------------------

/**
 * Attributes carrying user-visible text. `aria-label` is the pointed one: a
 * hardcoded English `aria-label` outranks translated visible text for the
 * accessible name, so leaving these behind would have every labelled control
 * announce in English no matter the locale.
 */
const TRANSLATED_ATTRIBUTES: Record<string, string> = {
  'data-i18n-aria-label': 'aria-label',
  'data-i18n-title': 'title',
  'data-i18n-placeholder': 'placeholder',
  'data-i18n-alt': 'alt',
  'data-i18n-value': 'value',
  'data-i18n-content': 'content',
  // Drawn by CSS via `content: attr(data-tooltip)`, so it never passes through
  // any of the textContent passes above.
  'data-i18n-tooltip': 'data-tooltip',
};

/** Write a translation into an element, allowing the sanitized inline subset. */
function setTranslated(el: Element, value: string): void {
  if (value.includes('<') && value.includes('>')) {
    el.innerHTML = sanitizeHTML(value);
  } else {
    el.textContent = value;
  }
}

/**
 * Translate every annotated node under `root`.
 *
 * Safe to call repeatedly -- every pass writes from the catalog rather than from
 * what is on the page, so re-running after a language switch or after a module
 * injects markup produces the same result.
 */
export function applyTranslations(root: ParentNode = document): void {
  for (const el of Array.from(root.querySelectorAll('[data-i18n]'))) {
    const key = el.getAttribute('data-i18n');
    if (!key) continue;
    const value = lookup(key);
    if (value === null) continue;
    setTranslated(el, value);
  }

  for (const [sourceAttr, targetAttr] of Object.entries(TRANSLATED_ATTRIBUTES)) {
    for (const el of Array.from(root.querySelectorAll(`[${sourceAttr}]`))) {
      const value = lookup(el.getAttribute(sourceAttr) ?? '');
      // setAttribute with the raw string: never route a translation into an
      // attribute through innerHTML.
      if (value !== null) el.setAttribute(targetAttr, value);
    }
  }

  if (root === document) {
    const title = lookup('meta.title');
    if (title !== null) document.title = title;
  }

  // Lucide swaps every `[data-lucide]` placeholder for an inline `<svg>` at
  // load. Any string carrying an icon has just had that svg overwritten by the
  // placeholder from the catalog, so the icons have to be rebuilt on every
  // pass, not only on the first.
  window.lucide?.createIcons();
}

// ---------------------------------------------------------------------------
// Switcher
// ---------------------------------------------------------------------------

/**
 * Switch language by reloading the page.
 *
 * Re-applying the catalogs in place would only fix the markup. Everything the
 * modules render from TypeScript -- the voice list, the ignore rows, the
 * sidebar readout, the pronunciation table -- is already on the page and would
 * keep the old language until something happened to redraw it, which for most
 * of it is never. Chasing that with a re-render hook per module is a lot of
 * surface to keep correct for an action a user takes approximately once; a
 * reload is complete by construction.
 *
 * The choice survives the reload in localStorage, and in `?lang=` when the URL
 * was already carrying it.
 */
function switchLanguage(lang: string): void {
  try {
    localStorage.setItem('preferredLanguage', lang);
  } catch {
    // Falls back to the URL parameter below.
  }

  const params = new URLSearchParams(window.location.search);
  if (params.get('lang')) {
    params.set('lang', lang);
    window.location.search = params.toString();
    return;
  }
  window.location.reload();
}

/**
 * Populate a `<select>` with the shipped languages and wire it to switch.
 *
 * A native select rather than the docs' custom grid: the dashboard already
 * styles selects, and a 40-item popup grid is a worse control than the one the
 * platform provides -- including for keyboard and screen reader users, who get
 * type-ahead for free.
 */
export function initLanguageSwitcher(select: HTMLSelectElement | null): void {
  if (!select) return;
  const entries = Object.entries(availableLanguages);
  if (entries.length === 0) return;

  // Sorted by endonym in the *reader's* locale, so the list reads in a sensible
  // order rather than in whatever order locales.json happens to hold.
  entries.sort((a, b) => a[1].localeCompare(b[1], currentLanguage));

  select.replaceChildren();
  for (const [code, endonym] of entries) {
    const option = document.createElement('option');
    option.value = code;
    option.textContent = endonym;
    // The label is in its own language; without this it is announced with the
    // page voice, which mangles every non-Latin entry.
    option.lang = code;
    if (code === currentLanguage) option.selected = true;
    select.appendChild(option);
  }

  select.addEventListener('change', () => switchLanguage(select.value));
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

/**
 * Resolves once the catalogs are in memory. Entry points await this before
 * rendering; it is started here, at module evaluation, so the request overlaps
 * with the rest of the page's startup instead of queueing behind it.
 */
export const i18nReady: Promise<void> = (async () => {
  const lang = detectLanguage();
  await Promise.all([loadCatalogs(lang), loadLocaleList()]);
})().catch((error) => {
  console.error('i18n: initialization failed', error);
});

/**
 * Wait for the catalogs, translate the page, and wire the picker.
 *
 * Every entry point awaits this *before* rendering its own content, so a module
 * that builds markup from `t()` never runs against an empty catalog. Module
 * scripts are deferred, so the document is already parsed by the time this is
 * called.
 */
export async function initI18n(): Promise<void> {
  await i18nReady;
  applyTranslations();
  initLanguageSwitcher(document.getElementById('page-language-select') as HTMLSelectElement | null);
}
