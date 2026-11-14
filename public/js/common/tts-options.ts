/**
 * The TTS option tables that both pages need.
 *
 * Source: `functions/src/services/tts-config.json`, which is synced from the
 * bot by `npm run sync-constants` there. The browser does not load that file,
 * so the values are mirrored here by hand. When the JSON changes, change this
 * module in the same commit.
 */
import { t } from './i18n.js';

/** `VALID_EMOTIONS`. Each one needs a `msg.emotion.<name>` label. */
export const VALID_EMOTIONS = [
  'neutral', 'happy', 'sad', 'angry', 'fearful', 'disgusted', 'surprised', 'calm', 'fluent',
] as const;

/** `STYLE.MAX_LENGTH`. */
export const STYLE_MAX_LENGTH = 120;

/** The `<select>` value that stands for "the style text applies", never stored. */
export const CUSTOM_EMOTION = '__custom__';

export interface Step {
  key: string;
  /** The number stored when the step is chosen. */
  value: number;
  /** A stored number up to and including this bound reads as this step. */
  upTo: number | null;
}

/** `SPEED_STEPS`. */
export const SPEED_STEPS: readonly Step[] = [
  { key: 'very_slow', value: 0.5, upTo: 0.65 },
  { key: 'slow', value: 0.75, upTo: 0.9 },
  { key: 'normal', value: 1.0, upTo: 1.15 },
  { key: 'fast', value: 1.5, upTo: 1.7 },
  { key: 'very_fast', value: 2.0, upTo: null },
];

/** `PITCH_STEPS`. */
export const PITCH_STEPS: readonly Step[] = [
  { key: 'very_low', value: -12, upTo: -7 },
  { key: 'low', value: -5, upTo: -2 },
  { key: 'normal', value: 0, upTo: 1 },
  { key: 'high', value: 5, upTo: 6 },
  { key: 'very_high', value: 12, upTo: null },
];

/** The canonical names in `SOUND_TAGS`. Tag names are not translated. */
export const SOUND_TAGS: readonly string[] = [
  'argh', 'breath', 'heavy breath', 'exhales', 'cackle', 'cheer', 'chuckle', 'cough', 'cry',
  'gasp', 'giggle', 'groan', 'growl', 'grunt', 'grr', 'hiss', 'laugh', 'moan', 'pant', 'pff',
  'phew', 'scream', 'shout', 'shriek', 'sigh', 'sneeze', 'snicker', 'snort', 'sob',
  'throat-clearing', 'tsk', 'whimper', 'whisper', 'yawn', 'short pause', 'long pause',
];

/** The step a stored number belongs to. Not a number reads as the middle step. */
export function stepForValue(steps: readonly Step[], value: unknown): Step {
  const n = typeof value === 'number' ? value : Number(value);
  const normal = steps.find(s => s.key === 'normal') ?? steps[0];
  if (value === null || value === undefined || value === '' || !Number.isFinite(n)) return normal;
  return steps.find(s => s.upTo === null || n <= s.upTo) ?? steps[steps.length - 1];
}

export type StepKind = 'speed' | 'pitch';

const STEPS: Record<StepKind, readonly Step[]> = { speed: SPEED_STEPS, pitch: PITCH_STEPS };

// One literal `t()` call per label, so `scripts/validate-i18n.js` can see every key.
const STEP_LABELS: Record<StepKind, Record<string, () => string>> = {
  speed: {
    very_slow: () => t('msg.step.speed.very_slow'),
    slow: () => t('msg.step.speed.slow'),
    normal: () => t('msg.step.speed.normal'),
    fast: () => t('msg.step.speed.fast'),
    very_fast: () => t('msg.step.speed.very_fast'),
  },
  pitch: {
    very_low: () => t('msg.step.pitch.very_low'),
    low: () => t('msg.step.pitch.low'),
    normal: () => t('msg.step.pitch.normal'),
    high: () => t('msg.step.pitch.high'),
    very_high: () => t('msg.step.pitch.very_high'),
  },
};

/** The translated label of the step a stored number belongs to. */
export function stepLabel(kind: StepKind, value: unknown): string {
  return STEP_LABELS[kind][stepForValue(STEPS[kind], value).key]();
}

export interface StepControl {
  /** The stored number of the chosen step, or null when no step is chosen. */
  getValue: () => number | null;
  /** Null clears the choice. Any other number selects the step that it belongs to. */
  setValue: (value: number | null | undefined) => void;
  setDisabled: (disabled: boolean) => void;
}

/**
 * Fill a `role="radiogroup"` container with one radio button for each step.
 *
 * Native radio buttons give the arrow keys and the checked state without
 * script. The container supplies the accessible name (`aria-labelledby`).
 */
export function createStepControl(
  container: HTMLElement | null,
  kind: StepKind,
  onChange: (value: number) => void,
): StepControl {
  const inputs: HTMLInputElement[] = [];
  if (container) {
    container.replaceChildren();
    for (const step of STEPS[kind]) {
      const label = document.createElement('label');
      label.className = 'step-control-option';
      const input = document.createElement('input');
      input.type = 'radio';
      input.name = container.id;
      input.value = String(step.value);
      input.addEventListener('change', () => { if (input.checked) onChange(step.value); });
      const text = document.createElement('span');
      text.textContent = STEP_LABELS[kind][step.key]();
      label.append(input, text);
      container.appendChild(label);
      inputs.push(input);
    }
  }
  return {
    getValue: () => {
      const checked = inputs.find(i => i.checked);
      return checked ? Number(checked.value) : null;
    },
    setValue: (value) => {
      const target = (value === null || value === undefined) ? null : String(stepForValue(STEPS[kind], value).value);
      inputs.forEach(i => { i.checked = i.value === target; });
    },
    setDisabled: (disabled) => { inputs.forEach(i => { i.disabled = disabled; }); },
  };
}

/** The label of an emotion preset, or of the custom choice. */
export function emotionLabel(emotion: string | null | undefined, style?: string | null): string {
  if (style) return t('msg.emotion.custom');
  switch (emotion) {
    case 'happy': return t('msg.emotion.happy');
    case 'sad': return t('msg.emotion.sad');
    case 'angry': return t('msg.emotion.angry');
    case 'fearful': return t('msg.emotion.fearful');
    case 'disgusted': return t('msg.emotion.disgusted');
    case 'surprised': return t('msg.emotion.surprised');
    case 'calm': return t('msg.emotion.calm');
    case 'fluent': return t('msg.emotion.fluent');
    // "auto" is the value that old channel records hold. The server reads it as neutral.
    default: return t('msg.emotion.neutral');
  }
}
