/**
 * Behaviour tests for the ICU subset, run with `node --test`.
 *
 * `public/js/common/i18n-format.ts` is a hand-port of the bot's
 * `src/i18n/format.js`. Nothing enforces that the two stay in step, so these
 * assertions are deliberately the same shape as the bot's -- if the port ever
 * drifts on plural selection, this is what says so.
 *
 * esbuild (already a dependency, for the frontend build) transpiles the module
 * in memory rather than requiring a TypeScript-aware test runner.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { transform } from 'esbuild';

const source = await readFile(new URL('../public/js/common/i18n-format.ts', import.meta.url), 'utf8');
const { code } = await transform(source, { loader: 'ts', format: 'esm' });
const { formatMessage } = await import(
  `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
);

test('interpolates named arguments', () => {
  assert.equal(formatMessage('Hello {name}!', { name: 'Bob' }), 'Hello Bob!');
});

test('a missing argument renders as nothing rather than "undefined"', () => {
  assert.equal(formatMessage('Hello {name}!', {}), 'Hello !');
});

test('numbers are grouped for the locale', () => {
  assert.equal(formatMessage('{n}', { n: 1234567 }, 'en'), '1,234,567');
  assert.equal(formatMessage('{n}', { n: 1234567 }, 'de'), '1.234.567');
});

test('English plural picks one/other', () => {
  const p = '{n, plural, one {# bit} other {# bits}}';
  assert.equal(formatMessage(p, { n: 1 }, 'en'), '1 bit');
  assert.equal(formatMessage(p, { n: 5 }, 'en'), '5 bits');
});

test('Russian uses four categories, which one/other cannot express', () => {
  const p = '{n, plural, one {# бит} few {# бита} many {# битов} other {# бита}}';
  assert.equal(formatMessage(p, { n: 1 }, 'ru'), '1 бит');
  assert.equal(formatMessage(p, { n: 3 }, 'ru'), '3 бита');
  assert.equal(formatMessage(p, { n: 11 }, 'ru'), '11 битов');
});

test('Arabic selects across all six categories', () => {
  const p = '{n, plural, zero {zero} one {one} two {two} few {few} many {many} other {other}}';
  const seen = new Set([0, 1, 2, 3, 11, 100].map((n) => formatMessage(p, { n }, 'ar')));
  assert.deepEqual(
    [...seen].sort(),
    ['few', 'many', 'one', 'other', 'two', 'zero'].sort(),
  );
});

test('a single-category language uses "other" for one as well as many', () => {
  const p = '{n, plural, other {#件}}';
  assert.equal(formatMessage(p, { n: 1 }, 'ja'), '1件');
  assert.equal(formatMessage(p, { n: 7 }, 'ja'), '7件');
});

test('an exact =N branch wins over the category', () => {
  const p = '{n, plural, =0 {none} one {one} other {#}}';
  assert.equal(formatMessage(p, { n: 0 }, 'en'), 'none');
  assert.equal(formatMessage(p, { n: 1 }, 'en'), 'one');
});

test('offset shifts what # prints and which branch is chosen', () => {
  const p = '{n, plural, offset:1 one {and # other} other {and # others}}';
  assert.equal(formatMessage(p, { n: 2 }, 'en'), 'and 1 other');
  assert.equal(formatMessage(p, { n: 4 }, 'en'), 'and 3 others');
});

test('select falls through to other for an unknown key', () => {
  const p = '{g, select, he {his} she {her} other {their}}';
  assert.equal(formatMessage(p, { g: 'he' }), 'his');
  assert.equal(formatMessage(p, { g: 'they' }), 'their');
  assert.equal(formatMessage(p, {}), 'their');
});

test('a select nested in a plural keeps the enclosing #', () => {
  const p = '{n, plural, other {{g, select, other {# gifts}}}}';
  assert.equal(formatMessage(p, { n: 3, g: 'x' }, 'en'), '3 gifts');
});

test('# outside a plural stays a literal hash', () => {
  assert.equal(formatMessage('issue #{id}', { id: 42 }), 'issue #42');
});

test('malformed patterns throw rather than rendering half a message', () => {
  assert.throws(() => formatMessage('{n, plural, one {x}}', { n: 1 }), /missing an "other"/);
  assert.throws(() => formatMessage('unbalanced {', {}), /unbalanced/);
  assert.throws(() => formatMessage('{n, selectordinal, other {x}}', {}), /unsupported/);
});
