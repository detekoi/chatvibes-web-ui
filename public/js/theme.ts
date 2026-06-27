/**
 * WildcatTTS Theme Manager
 * Handles theme switching functionality (light/dark mode)
 */

// Make this file a module to allow global augmentation
export { };

// Type definitions
type Theme = 'dark' | 'light';

// Constants
const THEME_KEY = 'wildcat-tts-theme';
const DARK_THEME: Theme = 'dark';
const LIGHT_THEME: Theme = 'light';

// Extend Window interface to include themeManager
declare global {
    interface Window {
        themeManager: ThemeManager;
    }
}

class ThemeManager {
    constructor() {
        this.init();
    }

    init(): void {
        this.applyStoredTheme();
        this.listenForSystemThemeChanges();
    }

    getStoredTheme(): Theme | null {
        const stored = localStorage.getItem(THEME_KEY);
        if (stored === DARK_THEME || stored === LIGHT_THEME) {
            return stored;
        }
        // Clean up invalid value to prevent checking it on every page load
        if (stored !== null) {
            localStorage.removeItem(THEME_KEY);
        }
        return null;
    }

    getSystemTheme(): Theme {
        return window.matchMedia('(prefers-color-scheme: dark)').matches ? DARK_THEME : LIGHT_THEME;
    }

    getCurrentTheme(): Theme {
        return this.getStoredTheme() || this.getSystemTheme();
    }

    applyTheme(theme: Theme): void {
        if (theme === DARK_THEME) {
            document.documentElement.setAttribute('data-theme', DARK_THEME);
        } else {
            document.documentElement.removeAttribute('data-theme');
        }
    }

    applyStoredTheme(): void {
        const theme = this.getCurrentTheme();
        this.applyTheme(theme);
    }

    listenForSystemThemeChanges(): void {
        const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
        mediaQuery.addEventListener('change', (e: MediaQueryListEvent) => {
            // Only apply system theme if user hasn't explicitly chosen a theme
            if (!this.getStoredTheme()) {
                const systemTheme: Theme = e.matches ? DARK_THEME : LIGHT_THEME;
                this.applyTheme(systemTheme);
            }
        });
    }
}

// Initialize theme manager when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        window.themeManager = new ThemeManager();
    });
} else {
    window.themeManager = new ThemeManager();
}
