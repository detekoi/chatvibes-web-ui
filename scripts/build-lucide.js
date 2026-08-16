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
