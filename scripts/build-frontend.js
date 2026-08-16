#!/usr/bin/env node
/**
 * Frontend TypeScript & CSS build script using esbuild
 * Compiles all .ts files in public/js to minified modern JS files
 * and bundles/minifies CSS in public/css
 */

import * as esbuild from 'esbuild';
import { fileURLToPath } from 'url';
import { dirname, join, relative } from 'path';
import { readdir, readFile, writeFile } from 'fs/promises';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..');
const publicDir = join(rootDir, 'public');
const jsDir = join(publicDir, 'js');
const cssDir = join(publicDir, 'css');

const watchMode = process.argv.includes('--watch');

/**
 * Recursively find all TypeScript files
 * @param {string} dir
 * @returns {Promise<string[]>}
 */
async function findTypeScriptFiles(dir) {
  const files = [];
  const entries = await readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      const subFiles = await findTypeScriptFiles(fullPath);
      files.push(...subFiles);
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      files.push(fullPath);
    }
  }

  return files;
}

/**
 * Build CSS bundle
 */
async function buildCss() {
  try {
    const cssFiles = ['vendor/bootstrap.min.css', 'reset.css', 'custom.css', 'design-system.css'];
    let combined = '';
    for (const f of cssFiles) {
      const content = await readFile(join(cssDir, f), 'utf8');
      combined += `\n/* --- ${f} --- */\n` + content;
    }

    const result = await esbuild.transform(combined, {
      loader: 'css',
      minify: true,
      sourcemap: true,
    });

    await writeFile(join(cssDir, 'app.min.css'), result.code);
    if (result.map) {
      await writeFile(join(cssDir, 'app.min.css.map'), result.map);
    }
    console.log(`  ✓ Built public/css/app.min.css (${(result.code.length / 1024).toFixed(1)} KB)`);
  } catch (error) {
    console.error('❌ CSS build failed:', error);
  }
}

/**
 * Build Lucide minimal icon bundle
 */
async function buildLucide() {
  try {
    const tempFile = join(rootDir, 'scripts/temp-lucide-entry.js');
    const outFile = join(publicDir, 'js/vendor/lucide.min.js');
    const entryCode = `
import {
  createIcons,
  Radio,
  SlidersHorizontal,
  Sun,
  Moon,
  Play,
  Square,
  Plus,
  Trash2,
  Volume2,
  Mic,
  Headphones,
  AlertTriangle,
  TriangleAlert,
  CircleHelp,
  HelpCircle,
  Book,
  Settings,
  ExternalLink,
  ArrowLeft,
  Globe,
  Sparkles,
  ArrowRight,
  LogIn
} from 'lucide';

const Youtube = [
  ['path', { d: 'M2.5 17a24.12 24.12 0 0 1 0-10 2 2 0 0 1 1.4-1.4 49.56 49.56 0 0 1 16.2 0A2 2 0 0 1 21.5 7a24.12 24.12 0 0 1 0 10 2 2 0 0 1-1.4 1.4 49.55 49.55 0 0 1-16.2 0A2 2 0 0 1 2.5 17' }],
  ['path', { d: 'm10 15 5-3-5-3z' }]
];

window.lucide = {
  createIcons: (options = {}) => {
    return createIcons({
      icons: {
        Radio,
        SlidersHorizontal,
        Sun,
        Moon,
        Play,
        Square,
        Plus,
        Trash2,
        Volume2,
        Mic,
        Headphones,
        AlertTriangle,
        TriangleAlert,
        CircleHelp,
        HelpCircle,
        Book,
        Settings,
        ExternalLink,
        ArrowLeft,
        Globe,
        Sparkles,
        ArrowRight,
        LogIn,
        Youtube
      },
      ...options
    });
  }
};
`;
    await writeFile(tempFile, entryCode, 'utf8');
    await esbuild.build({
      entryPoints: [tempFile],
      outfile: outFile,
      bundle: true,
      minify: true,
      target: 'es2022',
      platform: 'browser',
    });
    const { unlink } = await import('fs/promises');
    await unlink(tempFile);
    console.log('  ✓ Built public/js/vendor/lucide.min.js');
  } catch (error) {
    console.error('❌ Lucide build failed:', error);
  }
}

/**
 * Build all TypeScript files and CSS
 */
async function build() {
  try {
    console.log('🎨 Building CSS bundle...');
    await buildCss();

    console.log('✨ Building Lucide icons bundle...');
    await buildLucide();

    console.log('🔍 Finding TypeScript files in public/js...');
    const tsFiles = await findTypeScriptFiles(jsDir);

    if (tsFiles.length === 0) {
      console.log('✅ No TypeScript files found.');
      return;
    }

    console.log(`📦 Building ${tsFiles.length} TypeScript files with modern ES2022 target...`);

    // Build each file individually to maintain directory structure
    for (const tsFile of tsFiles) {
      const relativePath = relative(jsDir, tsFile);
      const outfile = tsFile.replace(/\.ts$/, '.js');

      await esbuild.build({
        entryPoints: [tsFile],
        outfile: outfile,
        format: 'esm',
        target: 'es2022',
        sourcemap: true,
        bundle: false,
        minify: true,
        platform: 'browser',
      });

      console.log(`  ✓ ${relativePath} → ${relative(jsDir, outfile)}`);
    }

    console.log('✅ Frontend build complete!');
  } catch (error) {
    console.error('❌ Build failed:', error);
    process.exit(1);
  }
}

/**
 * Start watch mode
 */
async function watch() {
  console.log('👀 Watching for TypeScript and CSS changes...');

  // Initial build
  await build();

  // Set up esbuild context for watching
  const tsFiles = await findTypeScriptFiles(jsDir);

  if (tsFiles.length === 0) {
    console.log('⚠️  No TypeScript files to watch. Exiting.');
    return;
  }

  const contexts = await Promise.all(
    tsFiles.map(async (tsFile) => {
      const outfile = tsFile.replace(/\.ts$/, '.js');

      return esbuild.context({
        entryPoints: [tsFile],
        outfile: outfile,
        format: 'esm',
        target: 'es2022',
        sourcemap: true,
        bundle: false,
        minify: true,
        platform: 'browser',
      });
    })
  );

  // Watch all contexts
  await Promise.all(contexts.map((ctx) => ctx.watch()));

  console.log('✅ Watching for changes (press Ctrl+C to stop)...');

  // Keep process alive
  process.on('SIGINT', async () => {
    console.log('\n👋 Stopping watch mode...');
    await Promise.all(contexts.map((ctx) => ctx.dispose()));
    process.exit(0);
  });
}

// Run build or watch
if (watchMode) {
  watch();
} else {
  build();
}
