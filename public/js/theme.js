// ChatVibes Theme Manager
(function() {
    'use strict';

    const THEME_KEY = 'chatvibes-theme';
    const DARK_THEME = 'dark';
    const LIGHT_THEME = 'light';

    class ThemeManager {
        constructor() {
            this.init();
        }

        init() {
            // Set initial theme on page load
            this.applyStoredTheme();

            // Initialize toggle if present
            this.initToggle();

            // Listen for system theme changes
            this.listenForSystemThemeChanges();
        }

        getStoredTheme() {
            return localStorage.getItem(THEME_KEY);
        }

        getSystemTheme() {
            return window.matchMedia('(prefers-color-scheme: dark)').matches ? DARK_THEME : LIGHT_THEME;
        }

        getCurrentTheme() {
            return this.getStoredTheme() || this.getSystemTheme();
        }

        setTheme(theme) {
            if (theme === DARK_THEME) {
                document.documentElement.setAttribute('data-theme', DARK_THEME);
            } else {
                document.documentElement.removeAttribute('data-theme');
            }

            localStorage.setItem(THEME_KEY, theme);
            this.updateToggleState();
        }

        toggleTheme() {
            const currentTheme = this.getCurrentTheme();
            const newTheme = currentTheme === DARK_THEME ? LIGHT_THEME : DARK_THEME;
            this.setTheme(newTheme);
        }

        applyStoredTheme() {
            const theme = this.getCurrentTheme();
            if (theme === DARK_THEME) {
                document.documentElement.setAttribute('data-theme', DARK_THEME);
            }
            this.updateToggleState();
        }

        initToggle() {
            const toggle = document.getElementById('darkModeToggle');
            if (toggle) {
                toggle.addEventListener('change', () => {
                    this.toggleTheme();
                });
                this.updateToggleState();
            }
        }

        updateToggleState() {
            const toggle = document.getElementById('darkModeToggle');
            if (toggle) {
                toggle.checked = this.getCurrentTheme() === DARK_THEME;
            }
        }

        listenForSystemThemeChanges() {
            window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
                // Only apply system theme if user hasn't explicitly chosen a theme
                if (!this.getStoredTheme()) {
                    const systemTheme = e.matches ? DARK_THEME : LIGHT_THEME;
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
})();