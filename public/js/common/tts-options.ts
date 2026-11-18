/**
 * The TTS option tables that both pages need.
 *
 * Source: `functions/src/services/tts-config.json`, which is synced from the
 * bot by `npm run sync-constants` there. The browser does not load that file,
 * so the values are mirrored here by hand. When the JSON changes, change this
 * module in the same commit.
 */
import { t } from './i18n.js';

/** `VALID_EMOTIONS`. The pages do not offer them, but an old record can hold one. */
export const VALID_EMOTIONS = [
  'neutral', 'happy', 'sad', 'angry', 'fearful', 'disgusted', 'surprised', 'calm', 'fluent',
] as const;

/** `STYLE.MAX_LENGTH`. */
export const STYLE_MAX_LENGTH = 120;

/** `SPOTLIGHT.GUIDANCE_MAX`: the longest guidance for Spotlight mode. */
export const SPOTLIGHT_GUIDANCE_MAX = 300;

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

export interface StylePreset {
  key: string;
  /** The words on the chip. */
  label: () => string;
  /** The words that the chip writes into the style box. */
  text: () => string;
}

/**
 * The chips under the style box. A chip is a shortcut for text: it writes its
 * words into the box, and the person can change them. The page stores the
 * words as the `style`, so a new chip needs no change on the server or the bot.
 *
 * One literal `t()` call per string, so `scripts/validate-i18n.js` can see every key.
 */
export const STYLE_PRESETS: readonly StylePreset[] = [
  { key: 'neutral', label: () => t('msg.stylePreset.label.neutral'), text: () => t('msg.stylePreset.text.neutral') },
  { key: 'happy', label: () => t('msg.stylePreset.label.happy'), text: () => t('msg.stylePreset.text.happy') },
  { key: 'excited', label: () => t('msg.stylePreset.label.excited'), text: () => t('msg.stylePreset.text.excited') },
  { key: 'calm', label: () => t('msg.stylePreset.label.calm'), text: () => t('msg.stylePreset.text.calm') },
  { key: 'sad', label: () => t('msg.stylePreset.label.sad'), text: () => t('msg.stylePreset.text.sad') },
  { key: 'angry', label: () => t('msg.stylePreset.label.angry'), text: () => t('msg.stylePreset.text.angry') },
  { key: 'fearful', label: () => t('msg.stylePreset.label.fearful'), text: () => t('msg.stylePreset.text.fearful') },
  { key: 'surprised', label: () => t('msg.stylePreset.label.surprised'), text: () => t('msg.stylePreset.text.surprised') },
  { key: 'sarcastic', label: () => t('msg.stylePreset.label.sarcastic'), text: () => t('msg.stylePreset.text.sarcastic') },
  { key: 'whisper', label: () => t('msg.stylePreset.label.whisper'), text: () => t('msg.stylePreset.text.whisper') },
  { key: 'dramatic', label: () => t('msg.stylePreset.label.dramatic'), text: () => t('msg.stylePreset.text.dramatic') },
  { key: 'announcer', label: () => t('msg.stylePreset.label.announcer'), text: () => t('msg.stylePreset.text.announcer') },
];

/** Two styles are the same choice when only the case or the spaces differ. */
function sameStyle(a: string, b: string): boolean {
  const fold = (s: string): string => s.trim().replace(/\s+/g, ' ').toLocaleLowerCase();
  return fold(a) === fold(b);
}

/**
 * The words that the style box shows for an emotion that an old record holds.
 * The emotion is a setting of the old provider, and the server removes it at
 * the next save of the style. "" for a value that is not an emotion.
 *
 * `neutral` has no words for a channel. For a viewer it has, because a viewer
 * with no style gets the style of the channel.
 */
export function emotionStyleText(emotion: string | null | undefined, { viewer = false } = {}): string {
  switch (emotion) {
    case 'neutral': return viewer ? t('msg.stylePreset.text.neutral') : '';
    case 'happy': return t('msg.stylePreset.text.happy');
    case 'sad': return t('msg.stylePreset.text.sad');
    case 'angry': return t('msg.stylePreset.text.angry');
    case 'fearful': return t('msg.stylePreset.text.fearful');
    case 'surprised': return t('msg.stylePreset.text.surprised');
    case 'calm': return t('msg.stylePreset.text.calm');
    case 'disgusted': return t('msg.stylePreset.text.disgusted');
    case 'fluent': return t('msg.stylePreset.text.fluent');
    default: return '';
  }
}

/** The style in a few words: the label of a preset, else the text itself. */
export function styleSummary(emotion: string | null | undefined, style?: string | null, { viewer = false } = {}): string {
  const text = (style || '').trim() || emotionStyleText(emotion, { viewer });
  if (!text) return t('msg.style.none');
  return STYLE_PRESETS.find(preset => sameStyle(preset.text(), text))?.label() ?? text;
}

export interface StylePresetOptions {
  /** A click on a chip. "" means that the person turned off the chip that was on. */
  onPick: (text: string) => void;
}

export interface StylePresetControl {
  /** Set the pressed state of each chip from the text in the box. */
  refresh: () => void;
  setDisabled: (disabled: boolean) => void;
}

/**
 * Fill a `role="group"` container with one toggle button for each preset.
 * A chip is pressed while the box holds its words.
 */
export function createStylePresets(
  container: HTMLElement | null,
  input: HTMLInputElement | null,
  options: StylePresetOptions,
): StylePresetControl {
  const chips: { button: HTMLButtonElement; isOn: () => boolean }[] = [];
  const refresh = (): void => {
    chips.forEach(({ button, isOn }) => button.setAttribute('aria-pressed', String(isOn())));
  };
  const addChip = (label: string, isOn: () => boolean, onClick: (wasOn: boolean) => void): void => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'style-preset';
    button.textContent = label;
    button.addEventListener('click', () => {
      onClick(isOn());
      refresh();
    });
    container?.appendChild(button);
    chips.push({ button, isOn });
  };

  if (container && input) {
    container.replaceChildren();
    for (const preset of STYLE_PRESETS) {
      addChip(preset.label(), () => sameStyle(input.value, preset.text()), (wasOn) => {
        input.value = wasOn ? '' : preset.text();
        options.onPick(input.value);
      });
    }
    input.addEventListener('input', refresh);
    refresh();
  }
  return {
    refresh,
    setDisabled: (disabled) => { chips.forEach(({ button }) => { button.disabled = disabled; }); },
  };
}
