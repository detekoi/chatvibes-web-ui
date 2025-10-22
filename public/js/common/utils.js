/**
 * Generic utility helpers shared across pages.
 */

/**
 * Creates a debounced function.
 * @param {Function} func
 * @param {number} wait
 * @returns {Function}
 */
export function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func.apply(this, args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

/**
 * Format a number compactly for display.
 * @param {number} n
 * @returns {string}
 */
export function formatNumberCompact(n) {
    const s = Number(n).toFixed(2);
    return s.replace(/\.0+$/, '').replace(/(\.\d*[1-9])0+$/, '$1');
}

/**
 * Format a voice identifier for display.
 * @param {string} voice
 * @returns {string}
 */
export function formatVoiceName(voice) {
    return voice.replace(/[_-]/g, ' ').replace(/\b\w/g, chr => chr.toUpperCase());
}
