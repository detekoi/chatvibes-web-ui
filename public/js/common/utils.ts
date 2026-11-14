/**
 * Generic utility helpers shared across pages.
 */

/** A debounced function. `cancel` drops a call that waits. */
export type Debounced<T extends (...args: unknown[]) => void> = ((...args: Parameters<T>) => void) & { cancel: () => void };

/**
 * Creates a debounced function.
 */
export function debounce<T extends (...args: unknown[]) => void>(
  func: T,
  wait: number
): Debounced<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const debounced = function executedFunction(this: any, ...args: Parameters<T>): void {
    const later = (): void => {
      clearTimeout(timeout);
      func.apply(this, args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  } as Debounced<T>;
  debounced.cancel = (): void => { clearTimeout(timeout); };
  return debounced;
}

/**
 * Format a number compactly for display.
 */
export function formatNumberCompact(n: number): string {
  const s = Number(n).toFixed(2);
  return s.replace(/\.0+$/, '').replace(/(\.\d*[1-9])0+$/, '$1');
}
