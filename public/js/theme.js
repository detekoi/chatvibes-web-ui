const THEME_KEY = "chatvibes-theme";
const DARK_THEME = "dark";
const LIGHT_THEME = "light";
class ThemeManager {
  constructor() {
    this.init();
  }
  init() {
    this.applyStoredTheme();
    this.initToggle();
    this.listenForSystemThemeChanges();
  }
  getStoredTheme() {
    const stored = localStorage.getItem(THEME_KEY);
    if (stored === DARK_THEME || stored === LIGHT_THEME) {
      return stored;
    }
    if (stored !== null) {
      localStorage.removeItem(THEME_KEY);
    }
    return null;
  }
  getSystemTheme() {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? DARK_THEME : LIGHT_THEME;
  }
  getCurrentTheme() {
    return this.getStoredTheme() || this.getSystemTheme();
  }
  setTheme(theme) {
    if (theme === DARK_THEME) {
      document.documentElement.setAttribute("data-theme", DARK_THEME);
    } else {
      document.documentElement.removeAttribute("data-theme");
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
      document.documentElement.setAttribute("data-theme", DARK_THEME);
    }
    this.updateToggleState();
  }
  initToggle() {
    const toggle = document.getElementById("darkModeToggle");
    if (toggle) {
      toggle.addEventListener("change", () => {
        this.toggleTheme();
      });
      this.updateToggleState();
    }
  }
  updateToggleState() {
    const toggle = document.getElementById("darkModeToggle");
    if (toggle) {
      toggle.checked = this.getCurrentTheme() === DARK_THEME;
    }
  }
  listenForSystemThemeChanges() {
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    mediaQuery.addEventListener("change", (e) => {
      if (!this.getStoredTheme()) {
        const systemTheme = e.matches ? DARK_THEME : LIGHT_THEME;
        this.setTheme(systemTheme);
      }
    });
  }
}
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    window.themeManager = new ThemeManager();
  });
} else {
  window.themeManager = new ThemeManager();
}
//# sourceMappingURL=theme.js.map
