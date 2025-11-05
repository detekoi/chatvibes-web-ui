#!/usr/bin/env node
/**
 * Frontend TypeScript build script using esbuild
 * Compiles all .ts files in public/js to .js files in the same location
 */

import * as esbuild from 'esbuild';
import { fileURLToPath } from 'url';
import { dirname, join, relative } from 'path';
import { readdir, stat } from 'fs/promises';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..');
const publicDir = join(rootDir, 'public');
const jsDir = join(publicDir, 'js');

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
 * Build all TypeScript files
 */
async function build() {
  try {
    console.log('🔍 Finding TypeScript files in public/js...');
    const tsFiles = await findTypeScriptFiles(jsDir);

    if (tsFiles.length === 0) {
      console.log('✅ No TypeScript files found yet.');
      return;
    }

    console.log(`📦 Building ${tsFiles.length} TypeScript files...`);

    // Build each file individually to maintain directory structure
    for (const tsFile of tsFiles) {
      const relativePath = relative(jsDir, tsFile);
      const outfile = tsFile.replace(/\.ts$/, '.js');

      await esbuild.build({
        entryPoints: [tsFile],
        outfile: outfile,
        format: 'esm',
        target: 'es2020',
        sourcemap: true,
        bundle: false,
        minify: false,
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
  console.log('👀 Watching for TypeScript file changes...');

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
        target: 'es2020',
        sourcemap: true,
        bundle: false,
        minify: false,
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
