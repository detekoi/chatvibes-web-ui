import * as esbuild from 'esbuild';
import { writeFile, stat, unlink } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..');
const tempFile = join(__dirname, 'temp-lucide-entry.js');
const outFile = join(rootDir, 'public/js/vendor/lucide.min.js');

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
  ArrowLeft,
  Globe,
  Sparkles,
  ArrowRight,
  LogIn
} from 'lucide';

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
        ArrowLeft,
        Globe,
        Sparkles,
        ArrowRight,
        LogIn
      },
      ...options
    });
  }
};
`;

async function build() {
  await writeFile(tempFile, entryCode, 'utf8');
  await esbuild.build({
    entryPoints: [tempFile],
    outfile: outFile,
    bundle: true,
    minify: true,
    target: 'es2022',
    platform: 'browser'
  });
  await unlink(tempFile);
  const info = await stat(outFile);
  console.log(`✓ Built lightweight lucide.min.js: ${(info.size / 1024).toFixed(1)} KB`);
}

build().catch(err => {
  console.error('Failed to build lucide:', err);
  process.exit(1);
});
