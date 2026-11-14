import { fetchWithAuth } from '../common/api.js';
import { showToast } from '../common/ui.js';
import { displayError, fillLanguageSelect, languageBoostOptions, t } from '../common/i18n.js';
import { performVoiceTest, TTSPayload, PlayerElements, HintElements } from '../common/voice-preview.js';
import { VoicePicker } from '../common/voice-picker.js';
import { buildVoiceCatalog, languageName, loadVoiceCatalog, type VoiceCatalog } from '../common/voice-catalog.js';
import {
  STYLE_MAX_LENGTH,
  createStepControl, createStylePresets, emotionStyleText, stepLabel, styleSummary,
  type StepControl, type StylePresetControl,
} from '../common/tts-options.js';
import type { IgnoreStatus } from './opt-out.js';

/**
 * Viewer voice preferences module.
 * Handles the voice picker, the preference controls, and preview playback.
 */

/**
 * Viewer preference values
 */
export interface ViewerPreferences {
  voiceId?: string | null;
  pitch?: number | null;
  speed?: number | null;
  emotion?: string | null;
  /** Free text that tells the voice model how to speak. Not empty means that it replaces the emotion. */
  style?: string | null;
  language?: string | null;
}

/**
 * Channel default settings
 */
// Nullable because the API sends null for a field the channel never set.
export interface ChannelDefaults {
  voiceId?: string | null;
  pitch?: number | null;
  speed?: number | null;
  emotion?: string | null;
  style?: string | null;
  language?: string | null;
  disabledSoundTags?: string[];
}

/**
 * Channel policy settings
 */
export interface ChannelPolicy {
  allowViewerPreferences: boolean;
}

// The ignore status carries who imposed the opt-out, not just whether one
// exists, because that is what decides whether the viewer can lift it. Defined
// alongside the toggle that consumes it so the two cannot drift apart.
export type { IgnoreStatus } from './opt-out.js';

/**
 * Full preferences data structure from API
 */
export interface PreferencesData {
  voiceId?: string | null;
  pitch?: number | null;
  speed?: number | null;
  emotion?: string | null;
  style?: string | null;
  language?: string | null;
  channelDefaults?: ChannelDefaults;
  channelPolicy?: ChannelPolicy;
  ignoreStatus?: IgnoreStatus;
  globalOptOut?: boolean | null;
  [key: string]: string | number | boolean | null | undefined | ChannelDefaults | ChannelPolicy | IgnoreStatus;
}

/**
 * Information returned from loadPreferences
 */
export interface PreferencesInfo {
  /** The channel this load asked about, or null for global preferences. */
  channel: string | null;
  allowViewerPreferences: boolean;
  ignoreStatus: IgnoreStatus;
  /** Null when the server could not read it. */
  globalOptOut: boolean | null;
  channelDefaults: ChannelDefaults;
}

/**
 * DOM elements used by the preferences module
 */
interface PreferencesElements {
  stylePresetList: HTMLElement | null;
  styleInput: HTMLInputElement | null;
  styleCount: HTMLElement | null;
  languageSelect: HTMLSelectElement | null;
  voiceReset: HTMLButtonElement | null;
  pitchReset: HTMLButtonElement | null;
  speedReset: HTMLButtonElement | null;
  emotionReset: HTMLButtonElement | null;
  languageReset: HTMLButtonElement | null;
  hintVoice: HTMLElement | null;
  hintPitch: HTMLElement | null;
  hintSpeed: HTMLElement | null;
  hintEmotion: HTMLElement | null;
  hintLanguage: HTMLElement | null;
  previewText: HTMLTextAreaElement | null;
  previewBtn: HTMLButtonElement | null;
  previewPlayer: HTMLElement | null;
  previewSource: HTMLSourceElement | null;
  previewHint: HTMLElement | null;
  prefsDisabledNote: HTMLElement | null;
}

/**
 * State tracked by the preferences module
 */
interface PreferencesState {
  catalog: VoiceCatalog;
  currentPreferences: PreferencesData;
  cachedAudioUrl: string | null;
}

/**
 * Context provided to the module
 */
export interface PreferencesContext {
  apiBaseUrl: string;
  testMode?: boolean;
}

/**
 * Services provided to the module
 */
export interface PreferencesServices {
  getCurrentChannel: () => string;
}

/**
 * Optional dependencies
 */
export interface PreferencesDependencies {
  onPreferencesLoaded?: (info: PreferencesInfo) => void;
}

/**
 * Return type of initPreferencesModule
 */
export interface PreferencesModule {
  loadVoices: () => Promise<void>;
  loadPreferences: (options?: { quiet?: boolean }) => Promise<PreferencesInfo>;
  clearCachedAudio: () => void;
  getCurrentPreferences: () => PreferencesData;
}

/**
 * Preference keys, as the viewer API names them. `language` is stored as `languageBoost`.
 */
type PreferenceKey = 'voiceId' | 'pitch' | 'speed' | 'emotion' | 'style' | 'language';

/**
 * Preference value types
 */
type PreferenceValue = string | number | null;

/** The rows that show a "Using …" hint. The emotion row also covers the style. */
type HintKey = 'voiceId' | 'pitch' | 'speed' | 'emotion' | 'language';

const hasValue = (value: unknown): boolean => value !== null && value !== undefined && value !== '';

export function initPreferencesModule(
  context: PreferencesContext,
  services: PreferencesServices,
  deps: PreferencesDependencies = {}
): PreferencesModule {
  const { apiBaseUrl, testMode } = context;
  const { getCurrentChannel } = services;
  const { onPreferencesLoaded } = deps;

  const elements: PreferencesElements = {
    stylePresetList: document.getElementById('style-presets'),
    styleInput: document.getElementById('style-input') as HTMLInputElement | null,
    styleCount: document.getElementById('style-count'),
    languageSelect: document.getElementById('language-select') as HTMLSelectElement | null,
    voiceReset: document.getElementById('voice-reset') as HTMLButtonElement | null,
    pitchReset: document.getElementById('pitch-reset') as HTMLButtonElement | null,
    speedReset: document.getElementById('speed-reset') as HTMLButtonElement | null,
    emotionReset: document.getElementById('emotion-reset') as HTMLButtonElement | null,
    languageReset: document.getElementById('language-reset') as HTMLButtonElement | null,
    hintVoice: document.getElementById('hint-voice'),
    hintPitch: document.getElementById('hint-pitch'),
    hintSpeed: document.getElementById('hint-speed'),
    hintEmotion: document.getElementById('hint-emotion'),
    hintLanguage: document.getElementById('hint-language'),
    previewText: document.getElementById('preview-text') as HTMLTextAreaElement | null,
    previewBtn: document.getElementById('preview-btn') as HTMLButtonElement | null,
    previewPlayer: document.getElementById('voice-preview-player'),
    previewSource: document.getElementById('voice-preview-source') as HTMLSourceElement | null,
    previewHint: document.getElementById('voice-preview-hint'),
    prefsDisabledNote: document.getElementById('prefs-disabled-note'),
  };

  if (elements.languageSelect) {
    fillLanguageSelect(elements.languageSelect, t('msg.prefs.useChannelDefault'));
  }

  const state: PreferencesState = {
    catalog: buildVoiceCatalog([]),
    currentPreferences: {},
    cachedAudioUrl: null,
  };

  // The same picker as the dashboard. The empty row means "use the channel default".
  const voicePicker = new VoicePicker({
    root: document.getElementById('voice-picker'),
    labelId: 'voice-label',
    emptyLabel: t('msg.prefs.useChannelDefault'),
    onSelect: (voiceId) => {
      markSettingsAsDirty();
      void savePreferences({ voiceId: voiceId || null });
    },
  });
  // Pitch and speed: five steps each, stored as the same numbers as before.
  // No step is checked while the viewer has no value of their own.
  let stylePresets: StylePresetControl | null = null;
  // The style of the newest save that still waits or runs. A save changes
  // state.currentPreferences only when its turn in the queue comes. Until then
  // this is the style that the viewer chose, and the next choice compares with it.
  // Declared above the `return`, because a `let` below it never gets its value.
  let pendingStyle: string | undefined;
  const pitchControl: StepControl = createStepControl(document.getElementById('pitch-steps'), 'pitch', (value) => {
    markSettingsAsDirty();
    void savePreferences({ pitch: value });
  });
  const speedControl: StepControl = createStepControl(document.getElementById('speed-steps'), 'speed', (value) => {
    markSettingsAsDirty();
    void savePreferences({ speed: value });
  });

  let saveQueue: Promise<void> = Promise.resolve();

  attachResetButtons();
  attachPreferenceSaves();
  attachPreviewHandlers();

  return {
    async loadVoices(): Promise<void> {
      // Same source the dashboard uses, so both pages offer the same voices.
      state.catalog = await loadVoiceCatalog(`${apiBaseUrl}/api/voices`, { demoFallback: testMode });
      voicePicker.setCatalog(state.catalog);
    },
    async loadPreferences(options: { quiet?: boolean } = {}): Promise<PreferencesInfo> {
      const info = await loadPreferences(options);
      onPreferencesLoaded?.(info);
      return info;
    },
    clearCachedAudio,
    getCurrentPreferences: (): PreferencesData => state.currentPreferences,
  };

  /** The preview that the page holds no longer matches the settings: say so. */
  function markSettingsAsDirty(): void {
    if (elements.previewHint && state.cachedAudioUrl) elements.previewHint.style.display = 'block';
  }

  function attachResetButtons(): void {
    const { voiceReset, pitchReset, speedReset, emotionReset, languageReset } = elements;
    const reset = (button: HTMLButtonElement | null, patch: Partial<Record<PreferenceKey, PreferenceValue>>): void => {
      button?.addEventListener('click', () => {
        markSettingsAsDirty();
        void savePreferences(patch);
      });
    };
    reset(voiceReset, { voiceId: null });
    reset(pitchReset, { pitch: null });
    reset(speedReset, { speed: null });
    // The emotion and the style are one choice, so Clear removes both.
    reset(emotionReset, { emotion: null, style: null });
    reset(languageReset, { language: null });
  }

  function updateStyleCount(): void {
    if (!elements.styleCount) return;
    elements.styleCount.textContent = t('msg.style.count', {
      count: (elements.styleInput?.value || '').length,
      max: STYLE_MAX_LENGTH,
    });
  }

  /**
   * The words that the box shows: the style of a save that still waits, else
   * the stored preferences. An emotion comes from an old record, and the box
   * shows it as words.
   */
  function shownStyle(): string {
    if (pendingStyle !== undefined) return pendingStyle;
    const prefs = state.currentPreferences || {};
    return prefs.style || emotionStyleText(prefs.emotion, { viewer: true });
  }

  /** Save the text in the box, if it differs from the stored preferences. */
  function saveTypedStyle(): boolean {
    const style = (elements.styleInput?.value || '').trim().slice(0, STYLE_MAX_LENGTH);
    if (style === shownStyle()) return false;
    pendingStyle = style;
    markSettingsAsDirty();
    // An empty box means "use the channel default". The emotion of an old
    // record goes away with each save, here and on the server.
    void savePreferences({ emotion: null, style: style || null }).finally(() => {
      // A newer choice owns the value now.
      if (pendingStyle !== style) return;
      pendingStyle = undefined;
      // After a failed save the box still shows the style that was not saved.
      // Not while the viewer types: that text is newer than this save.
      if (document.activeElement !== elements.styleInput) renderControls();
    });
    return true;
  }

  function attachPreferenceSaves(): void {
    const { stylePresetList, styleInput, languageSelect } = elements;

    if (styleInput) {
      styleInput.maxLength = STYLE_MAX_LENGTH;
      styleInput.addEventListener('input', updateStyleCount);
      styleInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') styleInput.blur(); });
      // Also when the focus goes to Clear: the Tab key takes it there with no
      // click. A click on Clear saves after this one, because the saves keep their order.
      styleInput.addEventListener('blur', () => { saveTypedStyle(); });
    }

    stylePresets = createStylePresets(stylePresetList, styleInput, {
      onPick: () => {
        updateStyleCount();
        if (!saveTypedStyle()) renderControls();
        else updateSidebarMeta();
      },
    });

    if (languageSelect) languageSelect.addEventListener('change', () => {
      markSettingsAsDirty();
      void savePreferences({ language: languageSelect.value || null });
    });
  }

  /**
   * The values that TTS uses for this viewer: the value of the viewer, else the
   * channel default. A style that is not empty replaces the emotion at its level.
   */
  function effectiveSettings(): Omit<TTSPayload, 'text'> {
    const prefs = state.currentPreferences || {};
    // The API sends null, not undefined, for a field the channel never set
    // (slymutt has no `speed`), so every channel fallback uses `??` or `||`.
    const cd = prefs.channelDefaults || {};

    let emotion: string | undefined;
    let style = '';
    // The style in the box counts while the viewer still types it. The words of
    // an old emotion are not a style: the bot reads the emotion.
    const boxStyle = (elements.styleInput?.value || '').trim().slice(0, STYLE_MAX_LENGTH);
    const emotionWords = prefs.style ? '' : emotionStyleText(prefs.emotion, { viewer: true });
    if (boxStyle && boxStyle !== emotionWords) {
      style = boxStyle;
      emotion = prefs.emotion || cd.emotion || undefined;
    } else if (boxStyle) {
      emotion = prefs.emotion || undefined;
    } else {
      // An empty box means "use the channel default", also before the save of
      // the empty box ran. The stored style is then older than the box.
      style = cd.style || '';
      emotion = cd.emotion || undefined;
    }

    let language = prefs.language || cd.language || undefined;
    if (language === 'Automatic' || language === 'None') language = 'auto'; // Old spellings in channel records

    return {
      voiceId: prefs.voiceId || cd.voiceId || state.catalog.defaultVoiceId || undefined,
      pitch: prefs.pitch ?? cd.pitch ?? undefined,
      speed: prefs.speed ?? cd.speed ?? undefined,
      emotion,
      style,
      languageBoost: language,
    };
  }

  function attachPreviewHandlers(): void {
    const { previewBtn, previewText } = elements;

    if (previewBtn) previewBtn.addEventListener('click', () => testVoice());

    window.addEventListener('beforeunload', () => {
      if (state.cachedAudioUrl) URL.revokeObjectURL(state.cachedAudioUrl);
    });

    async function testVoice(): Promise<void> {
      const text = (previewText?.value || '').trim();
      if (!text) {
        showToast(t('msg.preview.enterText'), 'warning');
        return;
      }

      if (testMode) {
        showToast(t('msg.prefs.testCompletedTestMode'), 'success');
        return;
      }

      const payload: TTSPayload = { text, ...effectiveSettings() };

      const playerElements: PlayerElements = {
        playerEl: elements.previewPlayer,
        sourceEl: elements.previewSource,
      };

      const hintElements: HintElements = {
        hintEl: elements.previewHint,
      };

      const onAudioGenerated = (audioUrl: string): void => {
        if (state.cachedAudioUrl) URL.revokeObjectURL(state.cachedAudioUrl);
        state.cachedAudioUrl = audioUrl;
        if (elements.previewHint) elements.previewHint.style.display = 'none';
      };

      await performVoiceTest(payload, [previewBtn], { playerElements, hintElements, onAudioGenerated });
    }
  }

  /**
   * @param options.quiet - Skip the error toast. For a retry after a failure
   * that already showed one, which would otherwise repeat it.
   */
  async function loadPreferences({ quiet = false }: { quiet?: boolean } = {}): Promise<PreferencesInfo> {
    const currentChannel = getCurrentChannel();

    if (testMode) {
      const demo: PreferencesData = {
        voiceId: '',
        pitch: null,
        speed: null,
        emotion: '',
        style: null,
        language: '',
        channelDefaults: {
          voiceId: state.catalog.defaultVoiceId,
          pitch: 0,
          speed: 1.0,
          emotion: 'neutral',
          style: null,
          language: 'auto',
        },
        channelPolicy: { allowViewerPreferences: true },
        ignoreStatus: { tts: false },
        globalOptOut: false,
      };
      applyPreferences(demo);
      return {
        channel: currentChannel || null,
        allowViewerPreferences: true,
        ignoreStatus: demo.ignoreStatus || {},
        globalOptOut: demo.globalOptOut === true,
        channelDefaults: demo.channelDefaults || {},
      };
    }

    let data: PreferencesData;
    try {
      const endpoint = currentChannel
        ? `${apiBaseUrl}/api/viewer/preferences/${encodeURIComponent(currentChannel)}`
        : `${apiBaseUrl}/api/viewer/preferences`;
      const response = await fetchWithAuth(endpoint, { method: 'GET' });
      data = await response.json() as PreferencesData;
    } catch (error) {
      // The reason itself, not a fixed "Cannot load preferences": a channel
      // without TTS, a dropped connection and a server error need different
      // things from the viewer.
      console.error('Failed to load preferences:', error);
      if (!quiet) showToast(displayError(error), 'error');
      throw error;
    }

    // The request succeeded, so a bug in drawing the voice controls is not a
    // failed load. Rethrowing it told the viewer "Cannot load preferences" and
    // stopped the caller from showing the opt-out toggles, which need only
    // `ignoreStatus` and `globalOptOut`.
    try {
      applyPreferences(data);
    } catch (error) {
      console.error('Failed to render preferences:', error);
    }
    return {
      channel: currentChannel || null,
      allowViewerPreferences: data?.channelPolicy?.allowViewerPreferences !== false,
      ignoreStatus: data?.ignoreStatus || {},
      // An older server sends no field; read that as "not opted out", as before.
      globalOptOut: data?.globalOptOut === undefined ? false : data.globalOptOut,
      channelDefaults: data?.channelDefaults || {},
    };
  }

  function applyPreferences(data: PreferencesData): void {
    state.currentPreferences = data || {};
    renderControls();

    const allowViewerPrefs = state.currentPreferences?.channelPolicy?.allowViewerPreferences !== false;
    const { styleInput, languageSelect, voiceReset, pitchReset, speedReset, emotionReset, languageReset, prefsDisabledNote } = elements;
    voicePicker.setDisabled(!allowViewerPrefs);
    pitchControl.setDisabled(!allowViewerPrefs);
    speedControl.setDisabled(!allowViewerPrefs);
    [styleInput, languageSelect, voiceReset, pitchReset, speedReset, emotionReset, languageReset].forEach(el => {
      if (el) el.disabled = !allowViewerPrefs;
    });
    stylePresets?.setDisabled(!allowViewerPrefs);
    if (prefsDisabledNote) {
      prefsDisabledNote.classList.toggle('d-none', allowViewerPrefs);
    }
  }

  /** Draw every control, hint and sidebar value from the current preferences. */
  function renderControls(): void {
    const prefs = state.currentPreferences || {};
    const { styleInput, languageSelect } = elements;

    // The stored ID can still be a MiniMax ID. The picker shows it as a legacy voice.
    voicePicker.setValue(prefs.voiceId || '');
    pitchControl.setValue(prefs.pitch ?? null);
    speedControl.setValue(prefs.speed ?? null);

    if (styleInput) styleInput.value = shownStyle();
    updateStyleCount();
    stylePresets?.refresh();
    if (languageSelect) {
      languageSelect.value = prefs.language || '';
      if (languageSelect.selectedIndex === -1) languageSelect.value = '';
    }

    updateHints();
    updateSidebarMeta();
  }

  function updateHints(): void {
    const map: Record<HintKey, HTMLElement | null> = {
      voiceId: elements.hintVoice,
      pitch: elements.hintPitch,
      speed: elements.hintSpeed,
      emotion: elements.hintEmotion,
      language: elements.hintLanguage,
    };
    (Object.keys(map) as HintKey[]).forEach(key => {
      const el = map[key];
      if (!el) return;
      el.textContent = describePreferenceHint(key);
      el.style.display = '';
    });
  }

  function describePreferenceHint(key: HintKey): string {
    const prefs = state.currentPreferences || {};
    const cd = prefs.channelDefaults || {};
    // The emotion row stands for the style too: either one is a value.
    const hasUser = hasValue(prefs[key]) || (key === 'emotion' && hasValue(prefs.style));
    const hasDef = hasValue(cd[key]) || (key === 'emotion' && hasValue(cd.style));
    if (hasUser) return t('msg.prefs.hintUser', { value: formatValueForHint(key, prefs, true) });
    if (hasDef) return t('msg.prefs.hintChannel', { value: formatValueForHint(key, cd, false) });
    return t('msg.prefs.hintSystem');
  }

  function describeVoice(voiceId: string): string {
    const voice = state.catalog.get(voiceId);
    // Names repeat across languages, so the language is part of the name here.
    return voice ? `${voice.name} (${languageName(voice.language)})` : state.catalog.displayName(voiceId);
  }

  function describeLanguage(language: string): string {
    if (language === 'auto' || language === 'Automatic' || language === 'None') return t('msg.lang.automatic');
    return languageBoostOptions().find(o => o.value === language)?.label ?? language;
  }

  /** A stored value as the reader sees it in the control, not as the API stores it. */
  function formatValueForHint(key: HintKey, source: ViewerPreferences | ChannelDefaults, viewer: boolean): string {
    switch (key) {
      case 'voiceId': return describeVoice(String(source.voiceId));
      case 'pitch': return stepLabel('pitch', source.pitch);
      case 'speed': return stepLabel('speed', source.speed);
      case 'emotion':
        return styleSummary(source.emotion, source.style, { viewer });
      case 'language': return describeLanguage(String(source.language));
      default: return '';
    }
  }

  /**
   * Save one or more preferences in one request. Null removes a preference.
   * On a failure the page goes back to the values that the server holds.
   */
  function savePreferences(patch: Partial<Record<PreferenceKey, PreferenceValue>>): Promise<void> {
    // One save at a time, in the order of the clicks. Two requests in flight
    // can arrive in the other order (the style box saves on blur, and the next
    // click saves too), and the later save needs the result of the earlier one
    // to know what to go back to.
    const run = saveQueue.then(() => saveOnePatch(patch));
    saveQueue = run;
    return run;
  }

  /** One save. It does not reject: a failure ends in a toast. */
  async function saveOnePatch(patch: Partial<Record<PreferenceKey, PreferenceValue>>): Promise<void> {
    const keys = Object.keys(patch) as PreferenceKey[];
    const current = state.currentPreferences as Record<string, unknown>;
    const previous = new Map(keys.map(key => [key, current[key]]));
    // The local update sits inside the try. Outside it, a bug in redrawing the
    // sidebar threw before the request went out, so Clear did nothing at all:
    // no save, no toast, and a page that no longer matched the server.
    try {
      keys.forEach(key => { current[key] = patch[key]; });
      renderControls();
      if (testMode) {
        showToast(t('msg.prefs.updatedTestMode'), 'success');
        return;
      }
      const currentChannel = getCurrentChannel();
      const url = currentChannel
        ? `${apiBaseUrl}/api/viewer/preferences/${encodeURIComponent(currentChannel)}`
        : `${apiBaseUrl}/api/viewer/preferences`;
      await fetchWithAuth(url, { method: 'PUT', body: JSON.stringify(patch) });
      showToast(t('msg.prefs.updated'), 'success');
    } catch (error) {
      previous.forEach((value, key) => { current[key] = value; });
      try {
        renderControls();
      } catch (renderError) {
        console.error('Failed to render preferences:', renderError);
      }
      // The reason alone. "Cannot save {key}: {reason}" put the internal field
      // name in front of a reason that already says what failed.
      console.error(`Failed to save ${keys.join(', ')}:`, error);
      showToast(displayError(error), 'error');
    }
  }

  function updateSidebarMeta(): void {
    const { voiceId, pitch, speed, emotion, style, languageBoost } = effectiveSettings();

    const voiceNameEl = document.getElementById('sidebar-voice-name');
    const pitchValEl = document.getElementById('sidebar-pitch-val');
    const speedValEl = document.getElementById('sidebar-speed-val');
    const styleValEl = document.getElementById('sidebar-style-val');
    const languageValEl = document.getElementById('sidebar-language-val');

    if (voiceNameEl) voiceNameEl.textContent = state.catalog.displayName(voiceId) || '—';
    // These overwrite markup that has already been translated, so they have to
    // be translated too -- capitalizing the raw enum value put an English word
    // back into every locale's sidebar.
    if (pitchValEl) pitchValEl.textContent = stepLabel('pitch', pitch);
    if (speedValEl) speedValEl.textContent = stepLabel('speed', speed);
    if (styleValEl) styleValEl.textContent = styleSummary(emotion, style, { viewer: !!(state.currentPreferences?.emotion) });
    if (languageValEl) languageValEl.textContent = describeLanguage(languageBoost || 'auto');
  }

  function clearCachedAudio(): void {
    if (state.cachedAudioUrl) {
      URL.revokeObjectURL(state.cachedAudioUrl);
      state.cachedAudioUrl = null;
    }
    if (elements.previewPlayer) elements.previewPlayer.style.display = 'none';
    if (elements.previewBtn) elements.previewBtn.textContent = t('msg.prefs.sendPreview');
  }
}
