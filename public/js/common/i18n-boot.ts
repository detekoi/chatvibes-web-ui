/**
 * Entry point for the pages that carry no module of their own -- the landing
 * page, the two auth screens and 404. They only need the markup translated and
 * the picker wired, which is exactly what `initI18n` does.
 */

import { initI18n } from './i18n.js';

void initI18n();
