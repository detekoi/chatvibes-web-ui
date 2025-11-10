import { fetchWithAuth } from '../common/api.js';
import { showToast, syncTextareas } from '../common/ui.js';
import { formatNumberCompact, formatVoiceName } from '../common/utils.js';
import { performVoiceTest, TTSPayload, PlayerElements, HintElements } from '../common/voice-preview.js';
import { getLanguageExample } from '../common/language-examples.js';

/**
 * Viewer voice preferences module.
 * Handles voice dropdown, preference controls, and preview playback.
 */

/**
 * Viewer preference values
 */
export interface ViewerPreferences {
  voiceId?: string | null;
  pitch?: number | null;
  speed?: number | null;
  emotion?: string | null;
  language?: string | null;
  englishNormalization?: boolean | null;
}

/**
 * Channel default settings
 */
export interface ChannelDefaults {
  voiceId?: string;
  pitch?: number;
  speed?: number;
  emotion?: string;
  language?: string;
  englishNormalization?: boolean;
}

/**
 * Channel policy settings
 */
export interface ChannelPolicy {
  allowViewerPreferences: boolean;
}

/**
 * Ignore status for TTS and music
 */
export interface IgnoreStatus {
  tts?: boolean;
  music?: boolean;
}

/**
 * Full preferences data structure from API
 */
export interface PreferencesData {
  voiceId?: string | null;
  pitch?: number | null;
  speed?: number | null;
  emotion?: string | null;
  language?: string | null;
  englishNormalization?: boolean | null;
  channelDefaults?: ChannelDefaults;
  channelPolicy?: ChannelPolicy;
  ignoreStatus?: IgnoreStatus;
  [key: string]: string | number | boolean | null | undefined | ChannelDefaults | ChannelPolicy | IgnoreStatus;
}

/**
 * Information returned from loadPreferences
 */
export interface PreferencesInfo {
  allowViewerPreferences: boolean;
  ignoreStatus: IgnoreStatus;
  channelDefaults: ChannelDefaults;
}

/**
 * DOM elements used by the preferences module
 */
interface PreferencesElements {
  voiceSelect: HTMLSelectElement | null;
  voiceSearch: HTMLInputElement | null;
  voiceDropdown: HTMLElement | null;
  voiceMenu: HTMLElement | null;
  pitchSlider: HTMLInputElement | null;
  pitchValue: HTMLElement | null;
  speedSlider: HTMLInputElement | null;
  speedValue: HTMLElement | null;
  emotionSelect: HTMLSelectElement | null;
  languageSelect: HTMLSelectElement | null;
  voiceReset: HTMLButtonElement | null;
  pitchReset: HTMLButtonElement | null;
  speedReset: HTMLButtonElement | null;
  emotionReset: HTMLButtonElement | null;
  languageReset: HTMLButtonElement | null;
  englishNormalizationCheckbox: HTMLInputElement | null;
  englishNormalizationReset: HTMLButtonElement | null;
  hintVoice: HTMLElement | null;
  hintPitch: HTMLElement | null;
  hintSpeed: HTMLElement | null;
  hintEmotion: HTMLElement | null;
  hintLanguage: HTMLElement | null;
  hintEnglishNorm: HTMLElement | null;
  previewText: HTMLTextAreaElement | null;
  previewBtn: HTMLButtonElement | null;
  previewTextMobile: HTMLTextAreaElement | null;
  previewBtnMobile: HTMLButtonElement | null;
  previewPlayer: HTMLElement | null;
  previewPlayerMobile: HTMLElement | null;
  previewSource: HTMLSourceElement | null;
  previewSourceMobile: HTMLSourceElement | null;
  previewHint: HTMLElement | null;
  previewHintMobile: HTMLElement | null;
  prefsDisabledNote: HTMLElement | null;
}

/**
 * State tracked by the preferences module
 */
interface PreferencesState {
  availableVoices: string[];
  currentPreferences: PreferencesData;
  cachedAudioUrl: string | null;
  cachedSettings: TTSPayload | null;
  isDirty: boolean;
  currentlyPlayingAudio: HTMLAudioElement | null;
  currentlyPlayingVoiceId: string | null;
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
  loadPreferences: () => Promise<PreferencesInfo>;
  clearCachedAudio: () => void;
  getCurrentPreferences: () => PreferencesData;
}

/**
 * Preference keys
 */
type PreferenceKey = 'voiceId' | 'pitch' | 'speed' | 'emotion' | 'language' | 'englishNormalization';

/**
 * Preference value types
 */
type PreferenceValue = string | number | boolean | null;

export function initPreferencesModule(
  context: PreferencesContext,
  services: PreferencesServices,
  deps: PreferencesDependencies = {}
): PreferencesModule {
  const { apiBaseUrl, testMode } = context;
  const { getCurrentChannel } = services;
  const { onPreferencesLoaded } = deps;

  const elements: PreferencesElements = {
    voiceSelect: document.getElementById('voice-select') as HTMLSelectElement | null,
    voiceSearch: document.getElementById('voice-search') as HTMLInputElement | null,
    voiceDropdown: document.getElementById('voice-dropdown'),
    voiceMenu: document.getElementById('voice-menu'),
    pitchSlider: document.getElementById('pitch-slider') as HTMLInputElement | null,
    pitchValue: document.getElementById('pitch-value'),
    speedSlider: document.getElementById('speed-slider') as HTMLInputElement | null,
    speedValue: document.getElementById('speed-value'),
    emotionSelect: document.getElementById('emotion-select') as HTMLSelectElement | null,
    languageSelect: document.getElementById('language-select') as HTMLSelectElement | null,
    voiceReset: document.getElementById('voice-reset') as HTMLButtonElement | null,
    pitchReset: document.getElementById('pitch-reset') as HTMLButtonElement | null,
    speedReset: document.getElementById('speed-reset') as HTMLButtonElement | null,
    emotionReset: document.getElementById('emotion-reset') as HTMLButtonElement | null,
    languageReset: document.getElementById('language-reset') as HTMLButtonElement | null,
    englishNormalizationCheckbox: document.getElementById('english-normalization-checkbox') as HTMLInputElement | null,
    englishNormalizationReset: document.getElementById('english-normalization-reset') as HTMLButtonElement | null,
    hintVoice: document.getElementById('hint-voice'),
    hintPitch: document.getElementById('hint-pitch'),
    hintSpeed: document.getElementById('hint-speed'),
    hintEmotion: document.getElementById('hint-emotion'),
    hintLanguage: document.getElementById('hint-language'),
    hintEnglishNorm: document.getElementById('hint-englishNormalization'),
    previewText: document.getElementById('preview-text') as HTMLTextAreaElement | null,
    previewBtn: document.getElementById('preview-btn') as HTMLButtonElement | null,
    previewTextMobile: document.getElementById('preview-text-mobile') as HTMLTextAreaElement | null,
    previewBtnMobile: document.getElementById('preview-btn-mobile') as HTMLButtonElement | null,
    previewPlayer: document.getElementById('voice-preview-player'),
    previewPlayerMobile: document.getElementById('voice-preview-player-mobile'),
    previewSource: document.getElementById('voice-preview-source') as HTMLSourceElement | null,
    previewSourceMobile: document.getElementById('voice-preview-source-mobile') as HTMLSourceElement | null,
    previewHint: document.getElementById('voice-preview-hint'),
    previewHintMobile: document.getElementById('voice-preview-hint-mobile'),
    prefsDisabledNote: document.getElementById('prefs-disabled-note'),
  };

  const state: PreferencesState = {
    availableVoices: [],
    currentPreferences: {},
    cachedAudioUrl: null,
    cachedSettings: null,
    isDirty: false,
    currentlyPlayingAudio: null,
    currentlyPlayingVoiceId: null,
  };

  syncTextareas(elements.previewText, elements.previewTextMobile);

  attachSliderOutputs();
  attachResetButtons();
  attachPreferenceSaves();
  attachPreviewHandlers();

  function updatePreviewTextForLanguage(): void {
    const selectedLanguage = languageSelect?.value || '';

    // If empty or automatic, use English
    const languageKey = (!selectedLanguage || selectedLanguage === 'Automatic') ? 'English' : selectedLanguage;
    const exampleText = getLanguageExample(languageKey, 'viewer');

    // Update both desktop and mobile preview text fields
    if (elements.previewText) {
      elements.previewText.value = exampleText;
    }
    if (elements.previewTextMobile) {
      elements.previewTextMobile.value = exampleText;
    }
  }

  return {
    async loadVoices(): Promise<void> {
      await loadVoices();
    },
    async loadPreferences(): Promise<PreferencesInfo> {
      const info = await loadPreferences();
      onPreferencesLoaded?.(info);
      return info;
    },
    clearCachedAudio,
    getCurrentPreferences: (): PreferencesData => state.currentPreferences,
  };

  function attachSliderOutputs(): void {
    if (elements.pitchSlider && elements.pitchValue) {
      elements.pitchSlider.addEventListener('input', () => {
        if (elements.pitchSlider && elements.pitchValue) {
          elements.pitchValue.textContent = elements.pitchSlider.value;
        }
      });
    }
    if (elements.speedSlider && elements.speedValue) {
      elements.speedSlider.addEventListener('input', () => {
        if (elements.speedSlider && elements.speedValue) {
          elements.speedValue.textContent = Number(elements.speedSlider.value).toFixed(2);
        }
      });
    }
  }

  function attachResetButtons(): void {
    const { voiceReset, pitchReset, speedReset, emotionReset, languageReset, englishNormalizationReset, englishNormalizationCheckbox } = elements;
    if (voiceReset) voiceReset.addEventListener('click', () => resetPreference('voiceId', elements.voiceSelect, ''));
    if (pitchReset) pitchReset.addEventListener('click', () => resetPreference('pitch', elements.pitchSlider, 0));
    if (speedReset) speedReset.addEventListener('click', () => resetPreference('speed', elements.speedSlider, 1));
    if (emotionReset) emotionReset.addEventListener('click', () => resetPreference('emotion', elements.emotionSelect, ''));
    if (languageReset) languageReset.addEventListener('click', () => resetPreference('language', elements.languageSelect, ''));
    if (englishNormalizationReset && englishNormalizationCheckbox) {
      englishNormalizationReset.addEventListener('click', () => resetPreference('englishNormalization', englishNormalizationCheckbox, false));
    }
  }

  function attachPreferenceSaves(): void {
    const {
      voiceSelect,
      pitchSlider,
      speedSlider,
      emotionSelect,
      languageSelect,
      englishNormalizationCheckbox,
    } = elements;

    if (voiceSelect) voiceSelect.addEventListener('change', () => savePreference('voiceId', voiceSelect.value || null));
    if (pitchSlider) {
      pitchSlider.addEventListener('change', () => {
        const v = Number(pitchSlider.value);
        savePreference('pitch', v);
      });
    }
    if (speedSlider) {
      speedSlider.addEventListener('change', () => {
        const v = Number(speedSlider.value);
        savePreference('speed', v);
      });
    }
    if (emotionSelect) emotionSelect.addEventListener('change', () => savePreference('emotion', emotionSelect.value || null));
    if (languageSelect) {
      languageSelect.addEventListener('change', () => {
        savePreference('language', languageSelect.value || null);
        updatePreviewTextForLanguage();
      });
    }
    if (englishNormalizationCheckbox) englishNormalizationCheckbox.addEventListener('change', () => {
      savePreference('englishNormalization', englishNormalizationCheckbox.checked || false);
    });
  }

  function attachPreviewHandlers(): void {
    const { previewBtn, previewBtnMobile, previewText, previewTextMobile, voiceSelect, pitchSlider, speedSlider, emotionSelect, languageSelect, englishNormalizationCheckbox } = elements;

    const changeElements = [voiceSelect, pitchSlider, speedSlider, emotionSelect, languageSelect, englishNormalizationCheckbox];
    changeElements.forEach(el => {
      if (el) el.addEventListener('change', markSettingsAsDirty);
    });

    if (previewBtn) previewBtn.addEventListener('click', () => testVoice());
    if (previewBtnMobile) previewBtnMobile.addEventListener('click', () => testVoice());

    window.addEventListener('beforeunload', () => {
      if (state.cachedAudioUrl) URL.revokeObjectURL(state.cachedAudioUrl);
    });

    function markSettingsAsDirty(): void {
      state.isDirty = true;
      if (elements.previewHint && state.cachedAudioUrl) elements.previewHint.style.display = 'block';
      if (elements.previewHintMobile && state.cachedAudioUrl) elements.previewHintMobile.style.display = 'block';
    }

    async function testVoice(): Promise<void> {
      const text = (previewText?.value || previewTextMobile?.value || '').trim();
      if (!text) {
        showToast('Please enter some text to test', 'warning');
        return;
      }

      if (testMode) {
        showToast('Test validated ✓ (test mode)', 'success');
        return;
      }

      const pitchHasOverride = state.currentPreferences?.pitch !== undefined && state.currentPreferences?.pitch !== null;
      const speedHasOverride = state.currentPreferences?.speed !== undefined && state.currentPreferences?.speed !== null;

      const payload: TTSPayload = {
        text,
        voiceId: voiceSelect?.value || undefined,
        pitch: pitchHasOverride ? Number(pitchSlider?.value ?? 0) : undefined,
        speed: speedHasOverride ? Number(speedSlider?.value ?? 1) : undefined,
        emotion: emotionSelect?.value || undefined,
        languageBoost: languageSelect?.value || undefined,
      };

      const playerElements: PlayerElements = {
        playerEl: elements.previewPlayer,
        playerElMobile: elements.previewPlayerMobile,
        sourceEl: elements.previewSource,
        sourceElMobile: elements.previewSourceMobile,
      };

      const hintElements: HintElements = {
        hintEl: elements.previewHint,
        hintElMobile: elements.previewHintMobile,
      };

      const buttons = [previewBtn, previewBtnMobile].filter((btn): btn is HTMLButtonElement => btn !== null);

      const onAudioGenerated = (audioUrl: string, settings: TTSPayload): void => {
        if (state.cachedAudioUrl) URL.revokeObjectURL(state.cachedAudioUrl);
        state.cachedAudioUrl = audioUrl;
        state.cachedSettings = settings;
        state.isDirty = false;
        if (elements.previewHint) elements.previewHint.style.display = 'none';
        if (elements.previewHintMobile) elements.previewHintMobile.style.display = 'none';
      };

      // Get the appropriate default text for the selected language
      const selectedLanguage = languageSelect?.value || '';
      const languageKey = (!selectedLanguage || selectedLanguage === 'Automatic') ? 'English' : selectedLanguage;
      const defaultText = getLanguageExample(languageKey, 'viewer');

      await performVoiceTest(payload, buttons, {
        defaultText,
        playerElements,
        hintElements,
        onAudioGenerated,
      });
    }
  }

  async function loadVoices(): Promise<void> {
    const fallback = [
      'Friendly_Person', 'Professional_Woman', 'Casual_Male', 'Energetic_Youth',
      'Warm_Grandmother', 'Confident_Leader', 'Soothing_Narrator', 'Cheerful_Assistant',
      'Deep_Narrator', 'Bright_Assistant', 'Calm_Guide', 'Energetic_Host'
    ];

    let voices = fallback;

    if (!testMode) {
      try {
        const response = await fetch('https://chatvibes-tts-service-h7kj56ct4q-uc.a.run.app/api/voices');
        if (response.ok) {
          const data = await response.json() as { voices?: string[] };
          voices = data.voices || fallback;
        }
      } catch (error) {
        console.error('Failed to load voices, using fallback:', error);
      }
    }

    state.availableVoices = voices;
    setupVoiceDropdown(voices);
  }

  function setupVoiceDropdown(voices: string[]): void {
    const { voiceSearch, voiceSelect, voiceMenu, voiceDropdown } = elements;
    if (!voiceSearch || !voiceSelect || !voiceMenu || !voiceDropdown) return;

    const list = voiceMenu.querySelector('.voice-dropdown-list');
    if (!list) return;

    voiceSelect.value = '';
    voiceSearch.value = 'Use channel default';

    renderVoiceList(voices);

    voiceSearch.addEventListener('click', (e: MouseEvent) => {
      e.stopPropagation();
      const isOpen = voiceMenu.classList.contains('show');
      if (isOpen) {
        closeDropdown();
      } else {
        openDropdown();
      }
    });

    voiceSearch.addEventListener('input', () => {
      const query = voiceSearch.value.toLowerCase();
      if (query === '' || query === 'use channel default') {
        renderVoiceList(voices);
        return;
      }
      const filtered = voices.filter(voice =>
        formatVoiceName(voice).toLowerCase().includes(query)
      );
      renderVoiceList(filtered, false);
    });

    document.addEventListener('click', (e: MouseEvent) => {
      if (!voiceDropdown.contains(e.target as Node)) {
        closeDropdown();
      }
    });

    function openDropdown(): void {
      if (!voiceMenu || !voiceSearch) return;
      voiceMenu.classList.add('show');
      voiceSearch.removeAttribute('readonly');
      voiceSearch.focus();
      voiceSearch.select();
    }

    function closeDropdown(): void {
      if (!voiceMenu || !voiceSearch || !voiceSelect) return;
      voiceMenu.classList.remove('show');
      voiceSearch.setAttribute('readonly', 'readonly');
      const currentValue = voiceSelect.value;
      voiceSearch.value = currentValue ? formatVoiceName(currentValue) : 'Use channel default';
    }

    function renderVoiceList(listVoices: string[], showDefault = true): void {
      if (!list) return;
      list.innerHTML = '';

      if (showDefault) {
        const defaultItem = document.createElement('div');
        defaultItem.className = 'voice-dropdown-item';
        const label = document.createElement('span');
        label.className = 'voice-label';
        label.textContent = 'Use channel default';
        label.addEventListener('click', () => {
          selectVoice('');
        });
        defaultItem.appendChild(label);
        list.appendChild(defaultItem);
      }

      if (!listVoices.length) {
        const empty = document.createElement('div');
        empty.className = 'voice-dropdown-item no-results';
        empty.textContent = 'No voices found';
        list.appendChild(empty);
        return;
      }

      listVoices.forEach(voiceId => {
        const item = document.createElement('div');
        item.className = 'voice-dropdown-item d-flex justify-content-between align-items-center';

        const label = document.createElement('span');
        label.className = 'voice-label';
        label.textContent = formatVoiceName(voiceId);
        label.addEventListener('click', () => selectVoice(voiceId));

        const playBtn = document.createElement('button');
        playBtn.type = 'button';
        playBtn.className = 'voice-play-btn';
        playBtn.setAttribute('aria-label', `Preview ${voiceId}`);
        playBtn.innerHTML = `
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M8 5v14l11-7z"/>
                    </svg>
                `;
        playBtn.addEventListener('click', async (e: MouseEvent) => {
          e.stopPropagation();
          await playVoiceSample(voiceId, playBtn);
        });

        item.appendChild(label);
        item.appendChild(playBtn);
        list.appendChild(item);
      });
    }

    function selectVoice(voiceId: string): void {
      if (!voiceSelect || !voiceSearch || !voiceMenu) return;
      voiceSelect.value = voiceId;
      voiceSearch.value = voiceId ? formatVoiceName(voiceId) : 'Use channel default';
      voiceMenu.classList.remove('show');
      voiceSearch.setAttribute('readonly', 'readonly');
      savePreference('voiceId', voiceId || null);
    }
  }

  async function playVoiceSample(voiceId: string, button: HTMLButtonElement): Promise<void> {
    if (!voiceId) return;

    if (state.currentlyPlayingVoiceId === voiceId && state.currentlyPlayingAudio) {
      state.currentlyPlayingAudio.pause();
      state.currentlyPlayingAudio = null;
      state.currentlyPlayingVoiceId = null;
      updatePlayButton(button, false);
      return;
    }

    if (state.currentlyPlayingAudio) {
      state.currentlyPlayingAudio.pause();
      const prevBtn = document.querySelector('.voice-play-btn.playing') as HTMLButtonElement | null;
      if (prevBtn) updatePlayButton(prevBtn, false);
    }

    const preMadeUrl = `/assets/voices/${voiceId}-chat-is-this-real.mp3`;

    try {
      const response = await fetch(preMadeUrl);
      if (!response.ok) {
        showToast('No preview available for this voice yet', 'info');
        return;
      }
      const blob = await response.blob();
      const audioUrl = URL.createObjectURL(blob);
      const audio = new Audio(audioUrl);
      state.currentlyPlayingAudio = audio;
      state.currentlyPlayingVoiceId = voiceId;
      updatePlayButton(button, true);

      const cleanup = (): void => {
        URL.revokeObjectURL(audioUrl);
        updatePlayButton(button, false);
        state.currentlyPlayingAudio = null;
        state.currentlyPlayingVoiceId = null;
      };

      audio.addEventListener('ended', cleanup, { once: true });
      audio.addEventListener('error', cleanup, { once: true });

      await audio.play();
    } catch (error) {
      console.error('Error playing voice preview:', error);
      updatePlayButton(button, false);
      state.currentlyPlayingAudio = null;
      state.currentlyPlayingVoiceId = null;
    }
  }

  function updatePlayButton(button: HTMLButtonElement | null, isPlaying: boolean): void {
    if (!button) return;
    if (isPlaying) {
      button.classList.add('playing');
      button.innerHTML = `
                <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z"/>
                </svg>
            `;
    } else {
      button.classList.remove('playing');
      button.innerHTML = `
                <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M8 5v14l11-7z"/>
                </svg>
            `;
    }
  }

  async function loadPreferences(): Promise<PreferencesInfo> {
    const currentChannel = getCurrentChannel();

    if (testMode) {
      const demo: PreferencesData = {
        voiceId: '',
        pitch: null,
        speed: null,
        emotion: '',
        language: '',
        englishNormalization: false,
        channelDefaults: {
          voiceId: 'Friendly_Person',
          pitch: 0,
          speed: 1.0,
          emotion: 'neutral',
          language: 'auto',
          englishNormalization: false,
        },
        channelPolicy: { allowViewerPreferences: true },
        ignoreStatus: { tts: false, music: false },
      };
      applyPreferences(demo);
      return {
        allowViewerPreferences: true,
        ignoreStatus: demo.ignoreStatus || {},
        channelDefaults: demo.channelDefaults || {},
      };
    }

    try {
      const endpoint = currentChannel
        ? `${apiBaseUrl}/api/viewer/preferences/${encodeURIComponent(currentChannel)}`
        : `${apiBaseUrl}/api/viewer/preferences`;
      const response = await fetchWithAuth(endpoint, { method: 'GET' });
      const data = await response.json() as PreferencesData;
      applyPreferences(data);
      return {
        allowViewerPreferences: data?.channelPolicy?.allowViewerPreferences !== false,
        ignoreStatus: data?.ignoreStatus || {},
        channelDefaults: data?.channelDefaults || {},
      };
    } catch (error) {
      console.error('Failed to load preferences:', error);
      showToast('Failed to load preferences', 'error');
      throw error;
    }
  }

  function applyPreferences(data: PreferencesData): void {
    state.currentPreferences = data || {};
    const prefs = state.currentPreferences;

    const {
      voiceSelect,
      pitchSlider,
      pitchValue,
      speedSlider,
      speedValue,
      emotionSelect,
      languageSelect,
      englishNormalizationCheckbox,
      voiceReset,
      pitchReset,
      speedReset,
      emotionReset,
      languageReset,
      prefsDisabledNote,
    } = elements;

    if (voiceSelect) {
      voiceSelect.value = prefs.voiceId || '';
      if (elements.voiceSearch) {
        elements.voiceSearch.value = voiceSelect.value ? formatVoiceName(voiceSelect.value) : 'Use channel default';
      }
    }
    if (pitchSlider && pitchValue) {
      pitchSlider.value = String(prefs.pitch ?? 0);
      pitchValue.textContent = String(prefs.pitch ?? 0);
    }
    if (speedSlider && speedValue) {
      const val = prefs.speed ?? 1.0;
      speedSlider.value = String(val);
      speedValue.textContent = Number(val).toFixed(2);
    }
    if (emotionSelect) emotionSelect.value = prefs.emotion || '';
    if (languageSelect) {
      languageSelect.value = prefs.language || '';
      // Update preview text to match the loaded language
      updatePreviewTextForLanguage();
    }
    if (englishNormalizationCheckbox) englishNormalizationCheckbox.checked = prefs.englishNormalization || false;

    updateHints();

    const allowViewerPrefs = prefs?.channelPolicy?.allowViewerPreferences !== false;
    const inputs: (HTMLElement | null)[] = [
      voiceSelect, pitchSlider, speedSlider, emotionSelect,
      languageSelect, englishNormalizationCheckbox,
      voiceReset, pitchReset, speedReset, emotionReset, languageReset,
    ];
    inputs.forEach(el => {
      if (!el) return;
      (el as HTMLInputElement | HTMLSelectElement | HTMLButtonElement).disabled = !allowViewerPrefs;
    });
    if (prefsDisabledNote) {
      prefsDisabledNote.classList.toggle('d-none', allowViewerPrefs);
    }
  }

  function updateHints(keys?: PreferenceKey[]): void {
    const map: Record<PreferenceKey, HTMLElement | null> = {
      voiceId: elements.hintVoice,
      pitch: elements.hintPitch,
      speed: elements.hintSpeed,
      emotion: elements.hintEmotion,
      language: elements.hintLanguage,
      englishNormalization: elements.hintEnglishNorm,
    };
    const toUpdate = Array.isArray(keys) ? keys : (Object.keys(map) as PreferenceKey[]);
    toUpdate.forEach(key => {
      const el = map[key];
      if (!el) return;
      el.textContent = describePreferenceHint(key);
      el.style.display = '';
      void el.offsetHeight; // force reflow for immediate update
    });
  }

  function describePreferenceHint(key: PreferenceKey): string {
    const prefs = state.currentPreferences || {};
    const cd = prefs.channelDefaults || {};
    const userVal = prefs[key];
    const defVal = cd[key];
    const hasUser = userVal !== null && userVal !== undefined && userVal !== '';
    const hasDef = defVal !== null && defVal !== undefined && defVal !== '';
    if (hasUser) return `Using your global preference: ${formatValueForHint(key, userVal)}`;
    if (hasDef) return `Using channel default: ${formatValueForHint(key, defVal)}`;
    return 'Using system default';
  }

  function formatValueForHint(key: PreferenceKey, value: PreferenceValue): string {
    if (value === '' || value === undefined || value === null) return String(value);
    if (key === 'speed') return formatNumberCompact(Number(value));
    return String(value);
  }

  async function savePreference(key: PreferenceKey, value: PreferenceValue): Promise<void> {
    const previous = state.currentPreferences ? state.currentPreferences[key] : undefined;
    if (state.currentPreferences) {
      (state.currentPreferences as Record<string, PreferenceValue>)[key] = value;
      updateHints([key]);
    }
    if (testMode) {
      showToast('Preference updated (test mode)', 'success');
      return;
    }
    try {
      const currentChannel = getCurrentChannel();
      const body = { [key]: value };
      const url = currentChannel
        ? `${apiBaseUrl}/api/viewer/preferences/${encodeURIComponent(currentChannel)}`
        : `${apiBaseUrl}/api/viewer/preferences`;
      await fetchWithAuth(url, { method: 'PUT', body: JSON.stringify(body) });
      showToast('Preference updated', 'success');
    } catch (error) {
      if (state.currentPreferences) {
        (state.currentPreferences as Record<string, PreferenceValue>)[key] = previous as PreferenceValue;
        updateHints([key]);
      }
      console.error(`Failed to save ${key}:`, error);
      const err = error as Error;
      showToast(`Failed to save ${key}: ${err.message}`, 'error');
    }
  }

  async function resetPreference(
    key: PreferenceKey,
    element: HTMLInputElement | HTMLSelectElement | null,
    fallbackValue: PreferenceValue
  ): Promise<void> {
    const cd = (state.currentPreferences && state.currentPreferences.channelDefaults) ? state.currentPreferences.channelDefaults : {};
    const defaultValue = (cd[key] !== undefined && cd[key] !== null) ? cd[key] : fallbackValue;
    if (!element) return;
    if (element instanceof HTMLInputElement && element.type === 'checkbox') {
      element.checked = Boolean(defaultValue);
    } else {
      element.value = (defaultValue === undefined || defaultValue === null) ? '' : String(defaultValue);
    }
    if (element instanceof HTMLInputElement && element.type === 'range') {
      const output = document.getElementById(element.id.replace('-slider', '-value'));
      if (output) {
        const outVal = element.id === 'speed-slider' ? Number(defaultValue ?? 1).toFixed(2) : String(defaultValue ?? 0);
        output.textContent = outVal;
      }
    }
    await savePreference(key, null);
  }

  function clearCachedAudio(): void {
    if (state.cachedAudioUrl) {
      URL.revokeObjectURL(state.cachedAudioUrl);
      state.cachedAudioUrl = null;
    }
    state.cachedSettings = null;
    if (elements.previewPlayer) elements.previewPlayer.style.display = 'none';
    if (elements.previewPlayerMobile) elements.previewPlayerMobile.style.display = 'none';
    if (elements.previewBtn) elements.previewBtn.textContent = 'Send Preview';
    if (elements.previewBtnMobile) elements.previewBtnMobile.textContent = 'Send Preview';
    state.isDirty = false;
  }
}
