/**
 * ChatVibes Theme Manager
 * Handles theme switching functionality (light/dark mode)
 */

// Make this file a module to allow global augmentation
export {};

// Type definitions
type Theme = 'dark' | 'light';

// Constants
const THEME_KEY = 'chatvibes-theme';
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
        // Set initial theme on page load
        this.applyStoredTheme();

        // Initialize toggle if present
        this.initToggle();

        // Listen for system theme changes
        this.listenForSystemThemeChanges();
    }

    getStoredTheme(): Theme | null {
        const stored = localStorage.getItem(THEME_KEY);
        if (stored === DARK_THEME || stored === LIGHT_THEME) {
            return stored;
        }
        return null;
    }

    getSystemTheme(): Theme {
        return window.matchMedia('(prefers-color-scheme: dark)').matches ? DARK_THEME : LIGHT_THEME;
    }

    getCurrentTheme(): Theme {
        return this.getStoredTheme() || this.getSystemTheme();
    }

    setTheme(theme: Theme): void {
        if (theme === DARK_THEME) {
            document.documentElement.setAttribute('data-theme', DARK_THEME);
        } else {
            document.documentElement.removeAttribute('data-theme');
        }

        localStorage.setItem(THEME_KEY, theme);
        this.updateToggleState();
    }

    toggleTheme(): void {
        const currentTheme = this.getCurrentTheme();
        const newTheme: Theme = currentTheme === DARK_THEME ? LIGHT_THEME : DARK_THEME;
        this.setTheme(newTheme);
    }

    applyStoredTheme(): void {
        const theme = this.getCurrentTheme();
        if (theme === DARK_THEME) {
            document.documentElement.setAttribute('data-theme', DARK_THEME);
        }
        this.updateToggleState();
    }

    initToggle(): void {
        const toggle = document.getElementById('darkModeToggle') as HTMLInputElement | null;
        if (toggle) {
            toggle.addEventListener('change', () => {
                this.toggleTheme();
            });
            this.updateToggleState();
        }
    }

    updateToggleState(): void {
        const toggle = document.getElementById('darkModeToggle') as HTMLInputElement | null;
        if (toggle) {
            toggle.checked = this.getCurrentTheme() === DARK_THEME;
        }
    }

    listenForSystemThemeChanges(): void {
        const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
        mediaQuery.addEventListener('change', (e: MediaQueryListEvent) => {
            // Only apply system theme if user hasn't explicitly chosen a theme
            if (!this.getStoredTheme()) {
                const systemTheme: Theme = e.matches ? DARK_THEME : LIGHT_THEME;
                this.setTheme(systemTheme);
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
