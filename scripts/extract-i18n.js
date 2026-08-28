#!/usr/bin/env node
/**
 * Annotate the static pages with `data-i18n` attributes and emit the English
 * catalogs they refer to.
 *
 * Run by hand, re-runnably: it is idempotent, so a page that already carries
 * annotations keeps its keys and only newly-added markup gets new ones.
 *
 *   node scripts/extract-i18n.js --check   # report, write nothing
 *   node scripts/extract-i18n.js           # rewrite HTML + catalogs
 *
 * Why a script rather than hand-annotation: there are ~450 strings across six
 * pages, and hand-transcribing them into JSON is exactly the kind of work that
 * silently drops a sentence or mistypes one. The English catalog is generated
 * *from the markup*, so the two cannot disagree.
 *
 * Edits are spliced into the original source at parse5's reported offsets
 * rather than serialized from the tree. Re-serializing would reformat all six
 * files and bury the real change in a whole-file diff.
 */

import { readFile, writeFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { parse } from 'parse5';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');
const publicDir = join(rootDir, 'public');
const i18nDir = join(publicDir, 'i18n');

const PAGES = [
  'index.html',
  'dashboard.html',
  'viewer-settings.html',
  'auth-complete.html',
  'auth-error.html',
  '404.html',
];

/** Subtrees that never contain translatable prose. */
const SKIP_TAGS = new Set(['script', 'style', 'svg', 'path', 'noscript', 'template']);

/**
 * Inline elements that may appear *inside* a translated string. Their content
 * travels with the parent rather than getting a key of its own, so a translator
 * can move the emphasis where the target language wants it.
 */
const INLINE_TAGS = new Set(['a', 'b', 'br', 'code', 'em', 'i', 'kbd', 'small', 'span', 'strong', 'sup', 'sub']);

/** Attributes whose value is read by a person. */
const ATTRS = {
  'aria-label': 'data-i18n-aria-label',
  title: 'data-i18n-title',
  placeholder: 'data-i18n-placeholder',
  alt: 'data-i18n-alt',
  // Rendered by `content: attr(data-tooltip)` in custom.css, so it is visible
  // copy that happens to live in an attribute.
  'data-tooltip': 'data-i18n-tooltip',
};

/**
 * Strings that must stay in English wherever they appear.
 *
 * The sample phrases are the pointed ones: they name pre-rendered files in
 * `public/assets/voices/*.mp3`, so translating the caption desynchronizes it
 * from the audio a viewer actually hears.
 */
const DO_NOT_TRANSLATE = new Set([
  'WildcatTTS',
  'Wildcat.chat',
  'OBS',
  'Twitch',
  'TTS',
  'Welcome, everyone, to the stream!',
  'Chat is this real?',
  'tts.wildcat.chat',
  'docs.wildcat.chat',
]);

const hasLetter = (s) => /\p{L}/u.test(s);

/**
 * Is this string one the do-not-translate list holds?
 *
 * Takes the *text*, never the source, so the caller has to hand over something
 * parse5 already produced rather than markup: comparing `Wildcat<b>TTS</b>` to
 * `WildcatTTS` needs the tags gone, and stripping them with a regex here is both
 * wrong on real HTML (attribute values containing `>`, comments) and the shape
 * every scanner flags as a broken sanitizer. The document is already parsed;
 * use the parse.
 */
const isDnt = (text) => DO_NOT_TRANSLATE.has(text.replace(/\s+/g, ' ').trim());

/** camelCase identifier from arbitrary text, capped so keys stay readable. */
function slugify(text, maxWords = 5) {
  const words = text
    .replace(/<[^>]*>/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, maxWords);
  if (words.length === 0) return 'text';
  return words
    .map((w, i) => (i === 0 ? w.toLowerCase() : w[0].toUpperCase() + w.slice(1).toLowerCase()))
    .join('')
    .replace(/^(\d)/, '_$1');
}

/** `tts-settings-card` -> `ttsSettingsCard`, for use as a key namespace. */
function camel(id) {
  return id.replace(/[-_]+(.)/g, (_, c) => c.toUpperCase()).replace(/[^\p{L}\p{N}]/gu, '');
}

const attrOf = (node, name) => node.attrs?.find((a) => a.name === name)?.value;

function isElement(node) {
  return typeof node.tagName === 'string' && node.nodeName !== '#text';
}

/**
 * True when this element's children are all text and inline markup, i.e. the
 * whole element is one sentence a translator should see at once.
 */
function isTranslatableLeaf(node) {
  if (!node.childNodes?.length) return false;
  let sawText = false;
  for (const child of node.childNodes) {
    if (child.nodeName === '#text') {
      if (hasLetter(child.value)) sawText = true;
      continue;
    }
    if (child.nodeName === '#comment') continue;
    if (!isElement(child)) return false;
    if (!INLINE_TAGS.has(child.tagName)) return false;
    // An inline child carrying an id is a JS render target, not prose.
    if (attrOf(child, 'id')) return false;
    if (hasLetter(getText(child))) sawText = true;
    if (!isTranslatableLeaf(child) && child.childNodes?.length) return false;
  }
  return sawText;
}

function getText(node) {
  if (node.nodeName === '#text') return node.value;
  if (!node.childNodes) return '';
  return node.childNodes.map(getText).join('');
}

/**
 * Source text of everything between an element's start and end tag, taken from
 * the original file so entities, spacing and inline markup survive verbatim.
 */
function innerSource(node, source) {
  const loc = node.sourceCodeLocation;
  if (!loc?.startTag || !loc.endTag) return null;
  return source.slice(loc.startTag.endOffset, loc.endTag.startOffset);
}

/** Collapse the runs of whitespace that indentation puts inside a sentence. */
const normalize = (s) => s.replace(/\s+/g, ' ').trim();

function extract(fileName, source) {
  const doc = parse(source, { sourceCodeLocationInfo: true });
  /** @type {{offset: number, text: string}[]} */
  const inserts = [];
  /** @type {Map<string, string>} key -> English */
  const messages = new Map();
  const usedKeys = new Set();

  /**
   * Reuse the key already allocated for this exact text within this section.
   *
   * The case that matters is a control carrying both `title` and `aria-label`
   * with the same words, which is 46 of the dashboard's attributes: without
   * this they become two keys holding one sentence, so a translator is paid to
   * translate it twice and the two can drift apart.
   */
  function keyFor(section, text) {
    for (const [key, value] of messages) {
      if (value === text && key.startsWith(`${section}.`)) return key;
    }
    const base = `${section}.${slugify(text)}`;
    if (!usedKeys.has(base)) { usedKeys.add(base); return base; }
    for (let n = 2; ; n++) {
      const candidate = `${base}${n}`;
      if (!usedKeys.has(candidate)) { usedKeys.add(candidate); return candidate; }
    }
  }

  /** Record a key/value and schedule `attr="key"` onto the element's start tag. */
  function annotate(node, attrName, section, text) {
    const existing = attrOf(node, attrName);
    if (existing) { messages.set(existing, text); usedKeys.add(existing); return; }
    const key = keyFor(section, text);
    messages.set(key, text);
    const loc = node.sourceCodeLocation?.startTag;
    if (!loc) return;
    // Insert immediately after the tag name so the annotation reads first and
    // does not land between an attribute name and its value.
    const offset = loc.startOffset + 1 + node.tagName.length;
    inserts.push({ offset, text: ` ${attrName}="${key}"` });
  }

  function walk(node, section, inHead) {
    for (const child of node.childNodes ?? []) {
      if (!isElement(child)) continue;
      const tag = child.tagName;

      if (tag === 'head') { walk(child, section, true); continue; }
      if (SKIP_TAGS.has(tag)) continue;
      if (attrOf(child, 'data-i18n-skip') !== undefined) continue;

      if (inHead) {
        if (tag === 'title' && hasLetter(getText(child))) {
          annotate(child, 'data-i18n', 'meta', normalize(getText(child)));
        } else if (tag === 'meta' && attrOf(child, 'name') === 'description') {
          const content = attrOf(child, 'content');
          if (content && hasLetter(content)) {
            annotate(child, 'data-i18n-content', 'meta', normalize(content));
          }
        }
        continue;
      }

      // An element with an id names the section its subtree belongs to, which
      // keeps keys readable and stable when a card is moved in the markup.
      const id = attrOf(child, 'id');
      const childSection = id ? camel(id) : section;

      for (const [attr, dataAttr] of Object.entries(ATTRS)) {
        const value = attrOf(child, attr);
        if (value && hasLetter(value) && !isDnt(value)) {
          annotate(child, dataAttr, childSection, normalize(value));
        }
      }

      if (isTranslatableLeaf(child)) {
        // Text-only content comes from parse5, which has already decoded the
        // entities; the runtime writes those strings with textContent, so a raw
        // `&amp;` from the source would be shown to the user literally. Content
        // carrying inline markup has to come from the source instead, since the
        // markup is part of the message a translator sees.
        const hasMarkup = child.childNodes.some(isElement);
        const raw = hasMarkup ? innerSource(child, source) : getText(child);
        const text = raw === null ? null : normalize(raw);
        // The do-not-translate test gets parse5's text either way; `text` above
        // may still carry the inline markup that belongs in the message.
        if (text && hasLetter(text) && !isDnt(getText(child))) {
          annotate(child, 'data-i18n', childSection, text);
        }
        continue;
      }

      walk(child, childSection, false);
    }
  }

  walk(doc, 'page', false);

  inserts.sort((a, b) => b.offset - a.offset);
  let out = source;
  for (const { offset, text } of inserts) {
    out = out.slice(0, offset) + text + out.slice(offset);
  }
  return { html: out, messages, fileName };
}

/** Nest `a.b.c` keys into the object shape the runtime looks up. */
function nest(flat) {
  const out = {};
  for (const [key, value] of [...flat].sort(([a], [b]) => a.localeCompare(b))) {
    const parts = key.split('.');
    let node = out;
    for (const part of parts.slice(0, -1)) {
      if (typeof node[part] !== 'object' || node[part] === null) node[part] = {};
      node = node[part];
    }
    node[parts.at(-1)] = value;
  }
  return out;
}

/**
 * The namespaces this script does not own.
 *
 * Strings rendered from TypeScript rather than from markup -- toasts, empty
 * states, dynamically built options -- have no element to hang a `data-i18n` on,
 * so they are hand-authored and carried through untouched: `msg.*` for the
 * dashboard's own copy, `err.*` for the codes the API returns. Any other
 * top-level namespace is regenerated from the markup on every run.
 */
const HAND_AUTHORED = ['msg', 'err'];

async function writeCatalog(pageId, generated) {
  const path = join(i18nDir, `${pageId}-en.json`);
  let existing = {};
  try {
    existing = JSON.parse(await readFile(path, 'utf8'));
  } catch {
    // First run for this page.
  }
  const merged = nest(generated);
  for (const ns of HAND_AUTHORED) if (existing[ns]) merged[ns] = existing[ns];
  const ordered = Object.fromEntries(Object.keys(merged).sort().map((k) => [k, merged[k]]));
  await writeFile(path, `${JSON.stringify(ordered, null, 2)}\n`);
}

async function main() {
  const check = process.argv.includes('--check');
  const results = [];

  for (const page of PAGES) {
    const source = await readFile(join(publicDir, page), 'utf8');
    results.push(extract(page, source));
  }

  // A key defined identically on more than one page is site chrome. Hoisting it
  // into common-en.json is what stops the appbar and footer wording drifting
  // between pages, which is the exact failure the docs repo hit.
  const seen = new Map();
  for (const { messages } of results) {
    for (const [key, value] of messages) {
      const entry = seen.get(key) ?? { values: new Set(), pages: 0 };
      entry.values.add(value);
      entry.pages += 1;
      seen.set(key, entry);
    }
  }
  const shared = new Set(
    [...seen].filter(([, e]) => e.pages > 1 && e.values.size === 1).map(([key]) => key),
  );

  const common = new Map();
  const perPage = new Map();
  for (const { fileName, messages } of results) {
    const own = new Map();
    for (const [key, value] of messages) {
      if (shared.has(key)) common.set(key, value);
      else own.set(key, value);
    }
    perPage.set(fileName.replace(/\.html$/, ''), own);
  }

  let total = 0;
  for (const { fileName, messages } of results) total += messages.size;
  console.log(`Extracted ${total} strings: ${common.size} shared, ${total - [...results].reduce((n, r) => n + [...r.messages.keys()].filter((k) => shared.has(k)).length, 0)} page-specific`);
  for (const [pageId, own] of perPage) console.log(`  ${pageId}: ${own.size}`);

  if (check) return;

  await mkdir(i18nDir, { recursive: true });
  for (const { fileName, html } of results) {
    await writeFile(join(publicDir, fileName), html);
  }
  await writeCatalog('common', common);
  for (const [pageId, own] of perPage) await writeCatalog(pageId, own);
  console.log('Wrote annotated HTML and English catalogs.');
}

main().catch((error) => { console.error(error); process.exit(1); });
