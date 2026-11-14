/**
 * Generic utility helpers shared across pages.
 */

/**
 * Creates a debounced function.
 */
export function debounce<T extends (...args: unknown[]) => void>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  return function executedFunction(this: any, ...args: Parameters<T>): void {
    const later = (): void => {
      clearTimeout(timeout);
      func.apply(this, args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

/**
 * Format a number compactly for display.
 */
export function formatNumberCompact(n: number): string {
  const s = Number(n).toFixed(2);
  return s.replace(/\.0+$/, '').replace(/(\.\d*[1-9])0+$/, '$1');
}
