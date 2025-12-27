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
  return function executedFunction(...args: Parameters<T>): void {
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

const VOICE_NAME_OVERRIDES: Record<string, string> = {
  "moss_audio_6dc281eb-713c-11f0-a447-9613c873494c": "Female Senior - Sweet Granny",
  "moss_audio_c12a59b9-7115-11f0-a447-9613c873494c": "Female Young - Expressive",
  "moss_audio_076697ad-7144-11f0-a447-9613c873494c": "Male Adult - Southern Drawl",
  "moss_audio_737a299c-734a-11f0-918f-4e0486034804": "Male Young - Science/Trustworthy",
  "moss_audio_19dbb103-7350-11f0-ad20-f2bc95e89150": "Female Young - Sassy",
  "moss_audio_7c7e7ae2-7356-11f0-9540-7ef9b4b62566": "Female Young - Magnetic",
  "moss_audio_570551b1-735c-11f0-b236-0adeeecad052": "Male Adult - German",
  "moss_audio_ad5baf92-735f-11f0-8263-fe5a2fe98ec8": "Female Young - Sweet/Thinking",
  "moss_audio_cedfd4d2-736d-11f0-99be-fe40dd2a5fe8": "Male Middle - Bored Husband",
  "moss_audio_a0d611da-737c-11f0-ad20-f2bc95e89150": "Male Middle - Warm Intro",
  "moss_audio_4f4172f4-737b-11f0-9540-7ef9b4b62566": "Male Middle - Quiet/Hobbyist",
  "moss_audio_62ca20b0-7380-11f0-99be-fe40dd2a5fe8": "Female Young - Energetic/Pretentious",
};

/**
 * Format a voice identifier for display.
 */
export function formatVoiceName(voice: string): string {
  if (VOICE_NAME_OVERRIDES[voice]) {
    return VOICE_NAME_OVERRIDES[voice];
  }
  return voice.replace(/[_-]/g, ' ').replace(/\b\w/g, chr => chr.toUpperCase());
}
