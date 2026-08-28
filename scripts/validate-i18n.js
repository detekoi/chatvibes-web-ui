#!/usr/bin/env node
/**
 * Catalog validator. Runs in CI; failing it is what makes machine-translated
 * catalogs safe to commit.
 *
 *   node scripts/validate-i18n.js
 *
 * Checks, in order of how much they have caught:
 *   1. Every key the source locale defines exists in every other locale, and no
 *      locale carries a key the source does not.
 *   2. Placeholder sets match the source exactly, so a model cannot invent
 *      `{username}` where the code passes `{user}` -- which renders as nothing.
 *   3. Every pattern parses as ICU.
 *   4. Plural branches are exactly the categories `Intl.PluralRules` reports for
 *      that locale. This is the one that matters: asked to translate an English
 *      `one`/`other` message, a model returns `one`/`other` for Arabic, which
 *      needs six, and the result is the wrong grammatical form for most numbers.
 *   5. Every key the markup and the TypeScript reference actually resolves,
 *      against `common` plus that page's own catalog.
 */

import { readFile, readdir } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');
const publicDir = join(rootDir, 'public');
const i18nDir = join(publicDir, 'i18n');

const SOURCE_LOCALE = 'en';

/**
 * Which page catalog a module may draw on, beyond `common`.
 *
 * Keyed on the first path segment under `js/`, which is a directory for the two
 * multi-module pages and a filename for the three single-module ones. Anything
 * unlisted — `common/`, `theme.ts` — is loaded by every page and so may only use
 * `common`.
 */
const MODULE_PAGE = {
  dashboard: 'dashboard',
  viewer: 'viewer-settings',
  'auth-complete.ts': 'auth-complete',
  'auth-error.ts': 'auth-error',
  'index-page.ts': 'index',
};

const errors = [];
const fail = (msg) => errors.push(msg);

// --- a self-contained copy of the runtime's ICU parser ---------------------
// Small enough to inline, and inlining it means the validator cannot pass
// because it shares a bug with the formatter it is validating.

function matchBrace(str, open) {
  let depth = 0;
  for (let i = open; i < str.length; i++) {
    if (str[i] === '{') depth++;
    else if (str[i] === '}' && --depth === 0) return i;
  }
  return -1;
}

/** @returns {{placeholders: Set<string>, plurals: {name: string, categories: string[]}[]}} */
function analyze(pattern) {
  const placeholders = new Set();
  const plurals = [];

  (function walk(text) {
    let i = 0;
    while (i < text.length) {
      if (text[i] !== '{') { i++; continue; }
      const close = matchBrace(text, i);
      if (close === -1) throw new Error(`unbalanced { in ${JSON.stringify(pattern)}`);
      const inner = text.slice(i + 1, close);
      const comma = inner.indexOf(',');
      if (comma === -1) {
        const name = inner.trim();
        if (!name) throw new Error(`empty {} in ${JSON.stringify(pattern)}`);
        placeholders.add(name);
      } else {
        const name = inner.slice(0, comma).trim();
        const rest = inner.slice(comma + 1);
        const comma2 = rest.indexOf(',');
        if (comma2 === -1) throw new Error(`{${name}, ...} needs a body`);
        const kind = rest.slice(0, comma2).trim();
        if (kind !== 'plural' && kind !== 'select') {
          throw new Error(`unsupported argument type "${kind}"`);
        }
        placeholders.add(name);
        let body = rest.slice(comma2 + 1);
        const offset = body.match(/^\s*offset:\s*(-?\d+)/);
        if (offset) body = body.slice(offset[0].length);

        const categories = [];
        let j = 0;
        while (j < body.length) {
          while (j < body.length && /\s/.test(body[j])) j++;
          if (j >= body.length) break;
          const start = j;
          while (j < body.length && !/[\s{]/.test(body[j])) j++;
          const key = body.slice(start, j);
          if (!key) break;
          while (j < body.length && /\s/.test(body[j])) j++;
          if (body[j] !== '{') throw new Error(`${kind} branch "${key}" is missing its {body}`);
          const end = matchBrace(body, j);
          if (end === -1) throw new Error(`unbalanced braces in ${kind} branch "${key}"`);
          categories.push(key);
          walk(body.slice(j + 1, end));
          j = end + 1;
        }
        if (!categories.includes('other')) throw new Error(`${kind} is missing an "other" branch`);
        if (kind === 'plural') plurals.push({ name, categories });
      }
      i = close + 1;
    }
  })(pattern);

  return { placeholders, plurals };
}

const flatten = (obj, prefix = '') => Object.entries(obj).flatMap(([key, value]) => (
  typeof value === 'string'
    ? [[prefix + key, value]]
    : (value && typeof value === 'object' ? flatten(value, `${prefix}${key}.`) : [])
));

async function readCatalog(file) {
  return JSON.parse(await readFile(join(i18nDir, file), 'utf8'));
}

async function main() {
  const files = (await readdir(i18nDir)).filter((f) => f.endsWith('.json') && f !== 'locales.json');
  /** page -> locale -> Map(key, value) */
  const catalogs = new Map();
  for (const file of files) {
    const m = file.match(/^(.+)-([a-z]{2,3}(?:-[A-Za-z0-9]+)?)\.json$/);
    if (!m) { fail(`${file}: filename is not <page>-<locale>.json`); continue; }
    const [, page, locale] = m;
    if (!catalogs.has(page)) catalogs.set(page, new Map());
    catalogs.get(page).set(locale, new Map(flatten(await readCatalog(file))));
  }

  for (const [page, locales] of catalogs) {
    const source = locales.get(SOURCE_LOCALE);
    if (!source) { fail(`${page}: no ${SOURCE_LOCALE} catalog`); continue; }

    const sourceAnalysis = new Map();
    for (const [key, value] of source) {
      try {
        sourceAnalysis.set(key, analyze(value));
      } catch (error) {
        fail(`${page}-${SOURCE_LOCALE} "${key}": ${error.message}`);
      }
    }

    for (const [locale, catalog] of locales) {
      if (locale === SOURCE_LOCALE) continue;
      const categories = new Intl.PluralRules(locale).resolvedOptions().pluralCategories;

      for (const key of source.keys()) {
        if (!catalog.has(key)) fail(`${page}-${locale}: missing key "${key}"`);
      }
      for (const key of catalog.keys()) {
        if (!source.has(key)) fail(`${page}-${locale}: orphan key "${key}"`);
      }

      for (const [key, value] of catalog) {
        const expected = sourceAnalysis.get(key);
        if (!expected) continue;
        let actual;
        try {
          actual = analyze(value);
        } catch (error) {
          fail(`${page}-${locale} "${key}": ${error.message}`);
          continue;
        }
        for (const name of expected.placeholders) {
          if (!actual.placeholders.has(name)) fail(`${page}-${locale} "${key}": dropped {${name}}`);
        }
        for (const name of actual.placeholders) {
          if (!expected.placeholders.has(name)) fail(`${page}-${locale} "${key}": invented {${name}}`);
        }
        for (const plural of actual.plurals) {
          const named = plural.categories.filter((c) => !c.startsWith('='));
          const missing = categories.filter((c) => !named.includes(c));
          const extra = named.filter((c) => !categories.includes(c));
          if (missing.length) {
            fail(`${page}-${locale} "${key}": plural {${plural.name}} is missing ${missing.join(', ')}`);
          }
          if (extra.length) {
            fail(`${page}-${locale} "${key}": plural {${plural.name}} has ${extra.join(', ')}, which ${locale} does not use`);
          }
        }
      }
    }
  }

  // --- 5. every referenced key resolves ------------------------------------
  const commonKeys = new Set(catalogs.get('common')?.get(SOURCE_LOCALE)?.keys() ?? []);

  // A key defined in both catalogs is paid for twice by the translator and can
  // drift, and the page copy silently wins -- so editing the common one changes
  // nothing, which is a genuinely confusing way to lose an afternoon.
  for (const [page, locales] of catalogs) {
    if (page === 'common') continue;
    for (const key of locales.get(SOURCE_LOCALE)?.keys() ?? []) {
      if (commonKeys.has(key)) fail(`${page}: "${key}" is also in common; keep one`);
    }
  }
  const keysFor = (page) => new Set([
    ...commonKeys,
    ...(catalogs.get(page)?.get(SOURCE_LOCALE)?.keys() ?? []),
  ]);

  for (const file of (await readdir(publicDir)).filter((f) => f.endsWith('.html'))) {
    const page = file.replace(/\.html$/, '');
    const known = keysFor(page);
    const html = await readFile(join(publicDir, file), 'utf8');
    for (const [, key] of html.matchAll(/data-i18n(?:-[a-z-]+)?="([^"]+)"/g)) {
      if (!known.has(key)) fail(`${file}: markup references unknown key "${key}"`);
    }
  }

  const walkTs = async (dir) => {
    const out = [];
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) out.push(...await walkTs(full));
      else if (entry.name.endsWith('.ts')) out.push(full);
    }
    return out;
  };

  for (const file of await walkTs(join(publicDir, 'js'))) {
    const relative = file.slice(join(publicDir, 'js').length + 1);
    const topLevel = relative.split('/')[0];
    // A module under `common/` is loaded by every page, so its keys have to be
    // in the common catalog; a page module may also use its own page catalog.
    const known = MODULE_PAGE[topLevel] ? keysFor(MODULE_PAGE[topLevel]) : commonKeys;
    const source = await readFile(file, 'utf8');
    for (const [, key] of source.matchAll(/\bt\(\s*'((?:msg|err|ui|page|meta)\.[^']+)'/g)) {
      if (!known.has(key)) fail(`${relative}: references unknown key "${key}"`);
    }
  }

  // Every stable code the API can send needs a message here, or the client
  // silently falls back to the English prose the backend shipped with it. That
  // fallback is deliberate for endpoints not yet migrated, but a code that HAS
  // been migrated and has no message is just an untranslated string.
  const functionsDir = join(rootDir, 'functions', 'src');
  const walkFunctions = async (dir) => {
    const out = [];
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === '__tests__') continue;
        out.push(...await walkFunctions(full));
      } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
        out.push(full);
      }
    }
    return out;
  };
  for (const file of await walkFunctions(functionsDir)) {
    const source = await readFile(file, 'utf8');
    // The status is `[^,]+`, not `\d+`: one call passes `errorStatus || 500`, and
    // a literal-only pattern skipped it silently — the check looked complete
    // while covering 58 of 59 codes.
    for (const [, code] of source.matchAll(/apiError\(\s*\w+\s*,\s*[^,]+,\s*"([^"]+)"/g)) {
      if (!commonKeys.has(`err.${code}`)) {
        fail(`${file.slice(rootDir.length + 1)}: API code "${code}" has no err.${code} message`);
      }
    }
  }

  // Every emotion the API accepts needs a label, or the sidebar renders the bare
  // key. `VALID_EMOTIONS` is synced from the bot's tts-config.json and has grown
  // before — it gained `calm` and `fluent` after the labels were written, and
  // nothing noticed until someone set one.
  try {
    const ttsConfig = JSON.parse(
      await readFile(join(rootDir, 'functions', 'src', 'services', 'tts-config.json'), 'utf8'),
    );
    for (const emotion of ttsConfig.VALID_EMOTIONS ?? []) {
      if (!commonKeys.has(`msg.emotion.${emotion}`)) {
        fail(`VALID_EMOTIONS has "${emotion}" but there is no msg.emotion.${emotion} label`);
      }
    }
  } catch (error) {
    fail(`cannot read tts-config.json for the emotion check: ${error.message}`);
  }

  if (errors.length) {
    for (const error of errors) console.error(`  ✗ ${error}`);
    console.error(`\n${errors.length} i18n problem(s).`);
    process.exit(1);
  }
  const total = [...catalogs.values()].reduce((n, l) => n + (l.get(SOURCE_LOCALE)?.size ?? 0), 0);
  const locales = new Set([...catalogs.values()].flatMap((l) => [...l.keys()]));
  console.log(`✅ ${total} source strings across ${catalogs.size} catalogs, ${locales.size} locale(s), all valid.`);
}

main().catch((error) => { console.error(error); process.exit(1); });
