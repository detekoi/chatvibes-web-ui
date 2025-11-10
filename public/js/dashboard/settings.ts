import { showToast, syncTextareas } from '../common/ui.js';
import { debounce, formatVoiceName } from '../common/utils.js';
import { performVoiceTest, TTSPayload, PlayerElements, HintElements } from '../common/voice-preview.js';
import { getLanguageExample } from '../common/language-examples.js';
import type { DashboardServices } from './types.js';

/**
 * TTS settings stored in database
 */
export interface TtsSettings {
  engineEnabled?: boolean;
  mode?: string;
  ttsPermissionLevel?: string;
  speakEvents?: boolean;
  allowViewerPreferences?: boolean;
  readFullUrls?: boolean;
  bitsModeEnabled?: boolean;
  bitsMinimumAmount?: number;
  voiceId?: string;
  emotion?: string;
  pitch?: number;
  speed?: number;
  languageBoost?: string;
  englishNormalization?: boolean;
  ignoredUsers?: string[];
}

/**
 * Music settings stored in database
 */
export interface MusicSettings {
  enabled?: boolean;
  allowedRoles?: string[];
  bitsModeEnabled?: boolean;
  bitsMinimumAmount?: number;
  ignoredUsers?: string[];
}

/**
 * API response for settings endpoints
 */
interface SettingsResponse {
  settings: TtsSettings | MusicSettings;
}

/**
 * API response for voices endpoint
 */
interface VoicesResponse {
  voices?: string[];
}

/**
 * Error response from API
 */
interface ErrorResponse {
  error?: string;
  message?: string;
  details?: string;
}

/**
 * Context for settings module (extends base dashboard context)
 */
export interface SettingsModuleContext {
  botApiBaseUrl: string;
  testMode: boolean;
}

/**
 * Dependencies for settings module
 */
export interface SettingsModuleDependencies {
  displayIgnoreList: (type: 'tts' | 'music', users: string[]) => void;
}

/**
 * Settings module interface
 */
export interface SettingsModule {
  initialize: () => Promise<void>;
  loadSettings: () => Promise<void>;
}

/**
 * Original settings cached for comparison
 */
interface OriginalSettings {
  tts: TtsSettings;
  music: MusicSettings;
}

/**
 * Handles dashboard settings (TTS defaults, music, voice preview, etc.).
 */
export function initSettingsModule(
  context: SettingsModuleContext,
  services: DashboardServices,
  dependencies: SettingsModuleDependencies
): SettingsModule {
  const { botApiBaseUrl, testMode } = context;
  const { getLoggedInUser, getSessionToken } = services;
  const { displayIgnoreList } = dependencies;

  // Settings Panel Elements
  const defaultVoiceSelect = document.getElementById('default-voice') as HTMLInputElement | null;
  const defaultEmotionSelect = document.getElementById('default-emotion') as HTMLSelectElement | null;
  const defaultPitchSlider = document.getElementById('default-pitch') as HTMLInputElement | null;
  const pitchValueSpan = document.getElementById('pitch-value') as HTMLSpanElement | null;
  const defaultSpeedSlider = document.getElementById('default-speed') as HTMLInputElement | null;
  const speedValueSpan = document.getElementById('speed-value') as HTMLSpanElement | null;
  const resetPitchBtn = document.getElementById('reset-pitch-btn') as HTMLButtonElement | null;
  const resetSpeedBtn = document.getElementById('reset-speed-btn') as HTMLButtonElement | null;
  const defaultLanguageSelect = document.getElementById('default-language') as HTMLSelectElement | null;
  const englishNormalizationCheckbox = document.getElementById('english-normalization') as HTMLInputElement | null;

  const ttsEnabledCheckbox = document.getElementById('tts-enabled') as HTMLInputElement | null;
  const ttsModeSelect = document.getElementById('tts-mode') as HTMLSelectElement | null;
  const ttsPermissionSelect = document.getElementById('tts-permission') as HTMLSelectElement | null;
  const eventsEnabledCheckbox = document.getElementById('events-enabled') as HTMLInputElement | null;
  const allowViewerPreferencesCheckbox = document.getElementById('allow-viewer-preferences') as HTMLInputElement | null;
  const readFullUrlsCheckbox = document.getElementById('read-full-urls') as HTMLInputElement | null;
  const bitsEnabledCheckbox = document.getElementById('bits-enabled') as HTMLInputElement | null;
  const bitsAmountInput = document.getElementById('bits-amount') as HTMLInputElement | null;
  const musicEnabledCheckbox = document.getElementById('music-enabled') as HTMLInputElement | null;
  const musicModeSelect = document.getElementById('music-mode') as HTMLSelectElement | null;
  const musicBitsEnabledCheckbox = document.getElementById('music-bits-enabled') as HTMLInputElement | null;
  const musicBitsAmountInput = document.getElementById('music-bits-amount') as HTMLInputElement | null;

  const saveSettingsBtn = document.getElementById('save-settings-btn') as HTMLButtonElement | null;

  const voiceTestTextInput = document.getElementById('voice-test-text') as HTMLTextAreaElement | null;
  const voiceTestBtn = document.getElementById('voice-test-btn') as HTMLButtonElement | null;
  const voiceTestTextInputMobile = document.getElementById('voice-test-text-mobile') as HTMLTextAreaElement | null;
  const voiceTestBtnMobile = document.getElementById('voice-test-btn-mobile') as HTMLButtonElement | null;

  if (voiceTestBtn) voiceTestBtn.disabled = true;
  if (voiceTestBtnMobile) voiceTestBtnMobile.disabled = true;
  syncTextareas(voiceTestTextInput, voiceTestTextInputMobile);

  let originalSettings: OriginalSettings = { tts: {}, music: {} };
  void originalSettings; // Intentionally unused - for future debugging/state tracking
  let isInitializing = true;
  let lastSuccessToastAt = 0;

  let settingsInitialized = false;
  void settingsInitialized; // Intentionally unused - for future state tracking
  let settingsInitializedPromiseResolve: (() => void) | undefined;
  const settingsInitializedPromise = new Promise<void>((resolve) => {
    settingsInitializedPromiseResolve = resolve;
  });

  let allVoices: string[] = [];
  void allVoices; // Intentionally unused - for future reference
  let currentlyPlayingAudio: HTMLAudioElement | null = null;
  let currentlyPlayingVoiceId: string | null = null;

  let cachedAudioUrl: string | null = null;
  let cachedAudioUrlMobile: string | null = null;
  let cachedSettings: TTSPayload | null = null;
  void cachedSettings; // Intentionally unused - for future caching optimization
  let cachedSettingsMobile: TTSPayload | null = null;
  void cachedSettingsMobile; // Intentionally unused - for future caching optimization
  let isDirty = false;
  void isDirty; // Intentionally unused - for future dirty state tracking
  let isDirtyMobile = false;
  void isDirtyMobile; // Intentionally unused - for future dirty state tracking

  return {
    async initialize(): Promise<void> {
      await initializeSettingsPanel();
    },
    loadSettings: () => loadBotSettings(),
  };

  function maybeSuccessToast(message: string): void {
    const now = Date.now();
    if (now - lastSuccessToastAt > 5000) {
      showToast(message, 'success');
      lastSuccessToastAt = now;
    }
  }

  async function playVoiceSample(buttonElement: HTMLButtonElement, voiceId: string): Promise<void> {
    if (!voiceId) return;

    if (currentlyPlayingVoiceId === voiceId && currentlyPlayingAudio) {
      currentlyPlayingAudio.pause();
      currentlyPlayingAudio = null;
      currentlyPlayingVoiceId = null;
      updatePlayButton(buttonElement, false);
      return;
    }

    if (currentlyPlayingAudio) {
      const previousBtn = document.querySelector('.voice-dropdown-item .voice-play-btn.playing') as HTMLButtonElement | null;
      if (previousBtn) {
        updatePlayButton(previousBtn, false);
      }
      currentlyPlayingAudio.pause();
      currentlyPlayingAudio = null;
    }

    const preMadeUrl = `/assets/voices/${voiceId}-welcome-everyone-to-the-stream.mp3`;

    try {
      const response = await fetch(preMadeUrl);
      if (!response.ok) {
        showToast('No preview available for this voice yet', 'info');
        return;
      }

      const blob = await response.blob();
      const audioUrl = URL.createObjectURL(blob);

      currentlyPlayingAudio = new Audio(audioUrl);
      currentlyPlayingVoiceId = voiceId;
      updatePlayButton(buttonElement, true);

      const stopPlayback = (): void => {
        URL.revokeObjectURL(audioUrl);
        if (buttonElement) updatePlayButton(buttonElement, false);
        currentlyPlayingAudio = null;
        currentlyPlayingVoiceId = null;
      };

      currentlyPlayingAudio.onended = stopPlayback;
      currentlyPlayingAudio.onerror = stopPlayback;

      await currentlyPlayingAudio.play();
    } catch (error) {
      console.error('Error playing voice preview:', error);
      updatePlayButton(buttonElement, false);
      currentlyPlayingAudio = null;
      currentlyPlayingVoiceId = null;
    }
  }

  function updatePlayButton(buttonElement: HTMLButtonElement, isPlaying: boolean): void {
    if (!buttonElement) return;

    const icon = isPlaying
      ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z"/></svg>`
      : `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>`;

    buttonElement.innerHTML = icon;
    if (isPlaying) {
      buttonElement.classList.add('playing');
    } else {
      buttonElement.classList.remove('playing');
    }
  }

  function setupAutoSaveListeners(): void {
    if (ttsEnabledCheckbox) ttsEnabledCheckbox.addEventListener('change', () => saveTtsSetting('engineEnabled', !!ttsEnabledCheckbox.checked, 'TTS Engine'));
    if (ttsModeSelect) ttsModeSelect.addEventListener('change', () => saveTtsSetting('mode', ttsModeSelect.value || 'command', 'TTS Mode'));
    if (ttsPermissionSelect) ttsPermissionSelect.addEventListener('change', () => saveTtsSetting('ttsPermissionLevel', ttsPermissionSelect.value || 'everyone', 'TTS Permission'));
    if (eventsEnabledCheckbox) eventsEnabledCheckbox.addEventListener('change', () => saveTtsSetting('speakEvents', eventsEnabledCheckbox.checked !== false, 'Event Announcements'));
    if (allowViewerPreferencesCheckbox) allowViewerPreferencesCheckbox.addEventListener('change', () => saveTtsSetting('allowViewerPreferences', !!allowViewerPreferencesCheckbox.checked, 'Allow Viewer Voice Preferences'));
    if (readFullUrlsCheckbox) readFullUrlsCheckbox.addEventListener('change', () => saveTtsSetting('readFullUrls', !!readFullUrlsCheckbox.checked, 'Read Full URLs'));
    if (bitsEnabledCheckbox) bitsEnabledCheckbox.addEventListener('change', () => saveTtsSetting('bitsModeEnabled', !!bitsEnabledCheckbox.checked, 'Bits for TTS'));
    if (bitsAmountInput) {
      const debouncedBitsAmountSave = debounce(
        () => saveTtsSetting('bitsMinimumAmount', parseInt(bitsAmountInput.value || '100', 10), 'Minimum Bits'),
        600
      );
      bitsAmountInput.addEventListener('input', () => { if (!isInitializing) debouncedBitsAmountSave(); });
      bitsAmountInput.addEventListener('change', () => saveTtsSetting('bitsMinimumAmount', parseInt(bitsAmountInput.value || '100', 10), 'Minimum Bits'));
    }

    if (defaultVoiceSelect) defaultVoiceSelect.addEventListener('change', () => saveTtsSetting('voiceId', defaultVoiceSelect.value || 'Friendly_Person', 'Default Voice'));
    if (defaultEmotionSelect) defaultEmotionSelect.addEventListener('change', () => saveTtsSetting('emotion', defaultEmotionSelect.value || 'auto', 'Default Emotion'));

    if (defaultPitchSlider) {
      const debouncedPitchSave = debounce(
        () => saveTtsSetting('pitch', parseInt(defaultPitchSlider.value || '0', 10), 'Default Pitch'),
        400
      );
      defaultPitchSlider.addEventListener('input', () => { if (!isInitializing) debouncedPitchSave(); });
      defaultPitchSlider.addEventListener('change', () => saveTtsSetting('pitch', parseInt(defaultPitchSlider.value || '0', 10), 'Default Pitch'));
    }

    if (defaultSpeedSlider) {
      const debouncedSpeedSave = debounce(
        () => saveTtsSetting('speed', parseFloat(defaultSpeedSlider.value || '1.0'), 'Default Speed'),
        400
      );
      defaultSpeedSlider.addEventListener('input', () => { if (!isInitializing) debouncedSpeedSave(); });
      defaultSpeedSlider.addEventListener('change', () => saveTtsSetting('speed', parseFloat(defaultSpeedSlider.value || '1.0'), 'Default Speed'));
    }

    if (defaultLanguageSelect) {
      defaultLanguageSelect.addEventListener('change', () => {
        saveTtsSetting('languageBoost', defaultLanguageSelect.value || 'Automatic', 'Default Language');
        updatePreviewTextForLanguage();
      });
    }
    if (englishNormalizationCheckbox) englishNormalizationCheckbox.addEventListener('change', () => saveTtsSetting('englishNormalization', !!englishNormalizationCheckbox.checked, 'English Normalization'));

    if (musicEnabledCheckbox) musicEnabledCheckbox.addEventListener('change', () => void saveMusicEnabled(!!musicEnabledCheckbox.checked));
    if (musicModeSelect) musicModeSelect.addEventListener('change', () => void saveMusicAllowedRoles(musicModeSelect.value || 'everyone'));
    if (musicBitsEnabledCheckbox || musicBitsAmountInput) {
      const saveBits = (): Promise<void> => saveMusicBitsConfig(
        !!musicBitsEnabledCheckbox?.checked,
        parseInt(musicBitsAmountInput?.value || '100', 10)
      );
      const debouncedSaveBits = debounce(() => { if (!isInitializing) void saveBits(); }, 600);
      if (musicBitsEnabledCheckbox) musicBitsEnabledCheckbox.addEventListener('change', () => void saveBits());
      if (musicBitsAmountInput) {
        musicBitsAmountInput.addEventListener('input', () => debouncedSaveBits());
        musicBitsAmountInput.addEventListener('change', () => void saveBits());
      }
    }
  }

  function updatePreviewTextForLanguage(): void {
    const selectedLanguage = defaultLanguageSelect?.value || 'Automatic';

    // Map "Automatic" to "English" for the examples
    const languageKey = selectedLanguage === 'Automatic' ? 'English' : selectedLanguage;
    const exampleText = getLanguageExample(languageKey, 'dashboard');

    // Update both desktop and mobile preview text fields
    if (voiceTestTextInput) {
      voiceTestTextInput.value = exampleText;
    }
    if (voiceTestTextInputMobile) {
      voiceTestTextInputMobile.value = exampleText;
    }
  }

  function attachVoicePreview(): void {
    const playerEl = document.getElementById('voice-preview-player') as HTMLElement | null;
    const playerElMobile = document.getElementById('voice-preview-player-mobile') as HTMLElement | null;
    const sourceEl = document.getElementById('voice-preview-source') as HTMLSourceElement | null;
    const sourceElMobile = document.getElementById('voice-preview-source-mobile') as HTMLSourceElement | null;
    const hintEl = document.getElementById('voice-preview-hint') as HTMLElement | null;
    const hintElMobile = document.getElementById('voice-preview-hint-mobile') as HTMLElement | null;

    const clearAudioCache = (isMobile = false): void => {
      if (isMobile) {
        if (cachedAudioUrlMobile) {
          URL.revokeObjectURL(cachedAudioUrlMobile);
          cachedAudioUrlMobile = null;
        }
        cachedSettingsMobile = null;
        if (playerElMobile) playerElMobile.style.display = 'none';
        if (voiceTestBtnMobile) voiceTestBtnMobile.textContent = 'Send Preview';
        isDirtyMobile = false;
      } else {
        if (cachedAudioUrl) {
          URL.revokeObjectURL(cachedAudioUrl);
          cachedAudioUrl = null;
        }
        cachedSettings = null;
        if (playerEl) playerEl.style.display = 'none';
        if (voiceTestBtn) voiceTestBtn.textContent = 'Send Preview';
        isDirty = false;
      }
    };

    const markSettingsAsDirty = (): void => {
      isDirty = true;
      isDirtyMobile = true;
      if (hintEl && cachedAudioUrl) hintEl.style.display = 'block';
      if (hintElMobile && cachedAudioUrlMobile) hintElMobile.style.display = 'block';
    };

    const testVoice = async (isMobile = false): Promise<void> => {
      await settingsInitializedPromise;

      const textInput = isMobile ? voiceTestTextInputMobile : voiceTestTextInput;
      const text = textInput?.value?.trim() || '';

      if (!text) {
        showToast('Please enter some text to test', 'warning');
        return;
      }
      if (text.length > 500) {
        showToast('Text must be 500 characters or less', 'error');
        return;
      }

      if (testMode) {
        showToast('Playing preview… (test mode)', 'success');
        return;
      }

      const payload: TTSPayload = {
        text,
        ...getEffectiveTtsSettings()
      };

      const playerElements: PlayerElements = {
        playerEl,
        playerElMobile,
        sourceEl,
        sourceElMobile
      };

      const hintElements: HintElements = {
        hintEl,
        hintElMobile
      };

      const onAudioGenerated = (audioUrl: string, settings: TTSPayload): void => {
        if (isMobile) {
          if (cachedAudioUrlMobile) URL.revokeObjectURL(cachedAudioUrlMobile);
          cachedAudioUrlMobile = audioUrl;
          cachedSettingsMobile = settings;
          isDirtyMobile = false;
          if (hintElMobile) hintElMobile.style.display = 'none';
        } else {
          if (cachedAudioUrl) URL.revokeObjectURL(cachedAudioUrl);
          cachedAudioUrl = audioUrl;
          cachedSettings = settings;
          isDirty = false;
          if (hintEl) hintEl.style.display = 'none';
        }
      };

      const buttons = [voiceTestBtn, voiceTestBtnMobile].filter((btn): btn is HTMLButtonElement => btn !== null);

      // Get the appropriate default text for the selected language
      const selectedLanguage = defaultLanguageSelect?.value || 'Automatic';
      const languageKey = selectedLanguage === 'Automatic' ? 'English' : selectedLanguage;
      const defaultText = getLanguageExample(languageKey, 'dashboard');

      await performVoiceTest(payload, buttons, {
        defaultText,
        playerElements,
        hintElements,
        onAudioGenerated
      });
    };

    if (voiceTestBtn) voiceTestBtn.addEventListener('click', () => void testVoice(false));
    if (voiceTestBtnMobile) voiceTestBtnMobile.addEventListener('click', () => void testVoice(true));

    const watchDirtyElements = [
      defaultVoiceSelect, defaultEmotionSelect, defaultPitchSlider,
      defaultSpeedSlider, defaultLanguageSelect, englishNormalizationCheckbox
    ];
    watchDirtyElements.forEach(el => {
      if (!el) return;
      el.addEventListener('change', () => {
        markSettingsAsDirty();
        if (el === defaultVoiceSelect || el === defaultEmotionSelect) {
          clearAudioCache(false);
          clearAudioCache(true);
        }
      });
    });

    window.addEventListener('beforeunload', () => {
      if (cachedAudioUrl) URL.revokeObjectURL(cachedAudioUrl);
      if (cachedAudioUrlMobile) URL.revokeObjectURL(cachedAudioUrlMobile);
    });
  }


  function getChannelName(): string | undefined {
    return getLoggedInUser()?.login?.toLowerCase();
  }

  function authHeaders(): Record<string, string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const token = getSessionToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;
    return headers;
  }

  function getEffectiveTtsSettings(): Omit<TTSPayload, 'text'> {
    const voiceId = defaultVoiceSelect?.value || 'Friendly_Person';
    const emotion = defaultEmotionSelect?.value || 'auto';
    const pitch = parseInt(defaultPitchSlider?.value || '0', 10);
    const speed = parseFloat(defaultSpeedSlider?.value || '1.0');
    const languageBoost = defaultLanguageSelect?.value || 'Automatic';
    return { voiceId, emotion, pitch, speed, languageBoost };
  }

  async function saveTtsSetting(key: string, value: string | number | boolean, label: string): Promise<void> {
    if (isInitializing) return;
    const channelName = getChannelName();
    if (testMode) {
      maybeSuccessToast('Saved');
      return;
    }
    if (!channelName) {
      showToast('Not logged in', 'error');
      return;
    }
    try {
      const response = await fetch(`${botApiBaseUrl}/tts/settings/channel/${channelName}`, {
        method: 'PUT',
        headers: authHeaders(),
        body: JSON.stringify({ key, value })
      });
      if (response.ok) {
        maybeSuccessToast('Saved');
      } else if (response.status === 403) {
        const errorData = await response.json().catch(() => ({})) as ErrorResponse;
        const errorText = errorData.details || errorData.message || 'Channel is not allowed to use this service';
        const html = errorText.includes('https://detekoi.github.io/#contact-me')
          ? errorText.replace('https://detekoi.github.io/#contact-me', '<a href="https://detekoi.github.io/#contact-me" target="_blank" class="link-light">this link</a>')
          : `${errorText} <a href="https://detekoi.github.io/#contact-me" target="_blank" class="link-light">Request access here</a>.`;
        showToast(html, 'error');
      } else if (response.status === 500 || response.status === 404) {
        showToast('Settings management not available yet - bot needs API update', 'warning');
      } else {
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' })) as ErrorResponse;
        showToast(`${label || 'Setting'}: ${errorData.error}`, 'error');
      }
    } catch (error) {
      console.error('Failed to save setting:', error);
      showToast(`Failed to save ${label || 'setting'}. Please try again.`, 'error');
    }
  }

  async function saveMusicEnabled(enabled: boolean): Promise<void> {
    if (isInitializing) return;
    const channelName = getChannelName();
    if (testMode) {
      maybeSuccessToast('Saved');
      return;
    }
    if (!channelName) {
      showToast('Not logged in', 'error');
      return;
    }
    try {
      const response = await fetch(`${botApiBaseUrl}/music/settings/channel/${channelName}`, {
        method: 'PUT',
        headers: authHeaders(),
        body: JSON.stringify({ key: 'enabled', value: enabled })
      });
      if (response.ok) {
        maybeSuccessToast('Saved');
      } else if (response.status === 403) {
        const errorData = await response.json().catch(() => ({})) as ErrorResponse;
        const errorText = errorData.details || errorData.message || 'Channel is not allowed to use this service';
        showToast(`Forbidden: ${errorText}`, 'error');
      } else if (response.status !== 500 && response.status !== 404) {
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' })) as ErrorResponse;
        showToast(`Music Generation: ${errorData.error}`, 'error');
      } else {
        showToast('Settings management not available yet - bot needs API update', 'warning');
      }
    } catch (e) {
      showToast('Failed to save Music Generation', 'error');
    }
  }

  async function saveMusicAllowedRoles(modeValue: string): Promise<void> {
    if (isInitializing) return;
    const channelName = getChannelName();
    if (testMode) {
      maybeSuccessToast('Saved');
      return;
    }
    if (!channelName) {
      showToast('Not logged in', 'error');
      return;
    }
    const roles = modeValue === 'everyone' ? ['everyone'] : ['moderator'];
    try {
      const response = await fetch(`${botApiBaseUrl}/music/settings/channel/${channelName}`, {
        method: 'PUT',
        headers: authHeaders(),
        body: JSON.stringify({ key: 'allowedRoles', value: roles })
      });
      if (response.ok) {
        maybeSuccessToast('Saved');
      } else if (response.status === 403) {
        const errorData = await response.json().catch(() => ({})) as ErrorResponse;
        const errorText = errorData.details || errorData.message || 'Channel is not allowed to use this service';
        showToast(`Forbidden: ${errorText}`, 'error');
      } else if (response.status !== 500 && response.status !== 404) {
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' })) as ErrorResponse;
        showToast(`Music Access: ${errorData.error}`, 'error');
      } else {
        showToast('Settings management not available yet - such features require the latest bot update.', 'warning');
      }
    } catch (e) {
      showToast('Failed to save Music Access', 'error');
    }
  }

  async function saveMusicBitsConfig(enabled: boolean, minimumAmount: number): Promise<void> {
    if (isInitializing) return;
    const channelName = getChannelName();
    if (testMode) {
      maybeSuccessToast('Saved');
      return;
    }
    if (!channelName) {
      showToast('Not logged in', 'error');
      return;
    }
    try {
      const response = await fetch(`${botApiBaseUrl}/music/settings/channel/${channelName}`, {
        method: 'PUT',
        headers: authHeaders(),
        body: JSON.stringify({ key: 'bitsConfig', value: { enabled, minimumAmount } })
      });
      if (response.ok) {
        maybeSuccessToast('Saved');
      } else if (response.status === 403) {
        const errorData = await response.json().catch(() => ({})) as ErrorResponse;
        const errorText = errorData.details || errorData.message || 'Channel is not allowed to use this service';
        showToast(`Forbidden: ${errorText}`, 'error');
      } else if (response.status !== 500 && response.status !== 404) {
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' })) as ErrorResponse;
        showToast(`Music Bits: ${errorData.error}`, 'error');
      } else {
        showToast('Settings management not available yet - bot needs API update', 'warning');
      }
    } catch (e) {
      showToast('Failed to save Music Bits', 'error');
    }
  }

  async function initializeSettingsPanel(): Promise<void> {
    if (defaultPitchSlider && pitchValueSpan) {
      defaultPitchSlider.addEventListener('input', () => {
        pitchValueSpan.textContent = defaultPitchSlider.value;
      });
    }
    if (defaultSpeedSlider && speedValueSpan) {
      defaultSpeedSlider.addEventListener('input', () => {
        speedValueSpan.textContent = defaultSpeedSlider.value;
      });
    }

    if (resetPitchBtn) {
      resetPitchBtn.addEventListener('click', () => {
        if (!defaultPitchSlider || !pitchValueSpan) return;
        defaultPitchSlider.value = '0';
        pitchValueSpan.textContent = '0';
        saveTtsSetting('pitch', 0, 'Default Pitch');
      });
    }
    if (resetSpeedBtn) {
      resetSpeedBtn.addEventListener('click', () => {
        if (!defaultSpeedSlider || !speedValueSpan) return;
        defaultSpeedSlider.value = '1.0';
        speedValueSpan.textContent = '1.0';
        saveTtsSetting('speed', 1.0, 'Default Speed');
      });
    }

    await loadAvailableVoices();
    attachVoicePreview();
    setupAutoSaveListeners();

    if (saveSettingsBtn) {
      saveSettingsBtn.style.display = 'none';
      saveSettingsBtn.disabled = true;
    }

    await loadBotSettings();
    isInitializing = false;
    if (voiceTestBtn) voiceTestBtn.disabled = false;
    if (voiceTestBtnMobile) voiceTestBtnMobile.disabled = false;

    settingsInitialized = true;
    settingsInitializedPromiseResolve?.();
  }

  async function loadAvailableVoices(): Promise<void> {
    const fallbackVoices = [
      'Friendly_Person', 'Professional_Woman', 'Casual_Male', 'Energetic_Youth',
      'Warm_Grandmother', 'Confident_Leader', 'Soothing_Narrator', 'Cheerful_Assistant',
      'Deep_Narrator', 'Bright_Assistant', 'Calm_Guide', 'Energetic_Host'
    ];

    if (!defaultVoiceSelect) {
      return;
    }

    if (testMode) {
      populateVoices(fallbackVoices);
      return;
    }

    try {
      const response = await fetch(`${botApiBaseUrl}/voices`);
      if (response.ok) {
        const voicesData = await response.json() as VoicesResponse;
        const voices = voicesData.voices || fallbackVoices;
        populateVoices(voices);
        return;
      }
    } catch (error) {
      console.warn('Failed to load voices from bot API, using fallback:', error);
    }

    populateVoices(fallbackVoices);
  }

  function populateVoices(voices: string[]): void {
    allVoices = voices;
    const searchInput = document.getElementById('default-voice-search') as HTMLInputElement | null;
    const hiddenInput = document.getElementById('default-voice') as HTMLInputElement | null;
    const dropdown = document.getElementById('default-voice-dropdown') as HTMLElement | null;
    const menu = document.getElementById('default-voice-menu') as HTMLElement | null;
    const list = menu?.querySelector('.voice-dropdown-list') as HTMLElement | null;

    if (!searchInput || !hiddenInput || !menu || !list || !dropdown) {
      console.error('Custom dropdown elements not found');
      return;
    }

    hiddenInput.value = hiddenInput.value || 'Friendly_Person';
    searchInput.value = formatVoiceName(hiddenInput.value);

    renderVoiceList(voices, list);

    searchInput.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = menu.classList.contains('show');
      if (isOpen) {
        closeDropdown();
      } else {
        openDropdown();
      }
    });

    searchInput.addEventListener('input', () => {
      const query = searchInput.value.toLowerCase();
      const filtered = voices.filter(voice =>
        formatVoiceName(voice).toLowerCase().includes(query)
      );
      renderVoiceList(filtered, list);
    });

    document.addEventListener('click', (e) => {
      if (!dropdown.contains(e.target as Node)) {
        closeDropdown();
      }
    });

    function openDropdown(): void {
      if (!menu || !searchInput) return;
      menu.classList.add('show');
      searchInput.removeAttribute('readonly');
      searchInput.focus();
      searchInput.select();
    }

    function closeDropdown(): void {
      if (!menu || !searchInput) return;
      menu.classList.remove('show');
      searchInput.setAttribute('readonly', 'readonly');
    }

    function renderVoiceList(voicesToRender: string[], container: HTMLElement): void {
      container.innerHTML = '';
      if (!voicesToRender.length) {
        const empty = document.createElement('div');
        empty.className = 'voice-dropdown-empty';
        empty.textContent = 'No voices found';
        container.appendChild(empty);
        return;
      }

      voicesToRender.forEach(voice => {
        const item = document.createElement('div');
        item.className = 'voice-dropdown-item d-flex justify-content-between align-items-center';

        const label = document.createElement('span');
        label.textContent = formatVoiceName(voice);

        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'btn btn-sm btn-outline-primary voice-play-btn';
        button.dataset.voiceId = voice;
        button.innerHTML = `
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <path d="M8 5v14l11-7z"/>
          </svg>
        `;

        button.addEventListener('click', async (event) => {
          event.stopPropagation();
          await playVoiceSample(button, voice);
        });

        item.addEventListener('click', () => {
          if (!hiddenInput || !searchInput) return;
          hiddenInput.value = voice;
          searchInput.value = formatVoiceName(voice);
          closeDropdown();
          saveTtsSetting('voiceId', hiddenInput.value || 'Friendly_Person', 'Default Voice');
        });

        item.appendChild(label);
        item.appendChild(button);
        container.appendChild(item);
      });
    }

  }

  async function loadBotSettings(): Promise<void> {
    const user = getLoggedInUser();
    if (!user?.login) {
      console.warn('No logged in user, cannot load bot settings');
      return;
    }

    if (testMode) {
      const demoTts: TtsSettings = {
        engineEnabled: true,
        mode: 'command',
        ttsPermissionLevel: 'everyone',
        speakEvents: true,
        readFullUrls: false,
        bitsModeEnabled: true,
        bitsMinimumAmount: 100,
        voiceId: 'Friendly_Person',
        emotion: 'auto',
        pitch: 0,
        speed: 1.0,
        languageBoost: 'Automatic',
        englishNormalization: false,
        ignoredUsers: ['spammer1', 'troll2']
      };
      const demoMusic: MusicSettings = {
        enabled: false,
        allowedRoles: ['everyone'],
        bitsModeEnabled: false,
        bitsMinimumAmount: 100,
        ignoredUsers: ['loudguy']
      };
      applyTtsSettings(demoTts);
      applyMusicSettings(demoMusic);
      displayIgnoreList('tts', demoTts.ignoredUsers || []);
      displayIgnoreList('music', demoMusic.ignoredUsers || []);
      originalSettings = { tts: demoTts, music: demoMusic };
      return;
    }

    try {
      const channelName = user.login.toLowerCase();
      const headers = authHeaders();

      let ttsData: SettingsResponse = { settings: {} };
      const ttsResponse = await fetch(`${botApiBaseUrl}/tts/settings/channel/${channelName}`, { headers });
      if (ttsResponse.status === 403) {
        const errorData = await ttsResponse.json().catch(() => ({})) as ErrorResponse;
        const errorText = errorData.details || errorData.message || 'This channel is not permitted to use this service.';
        const html = errorText.includes('https://detekoi.github.io/#contact-me')
          ? errorText.replace('https://detekoi.github.io/#contact-me', '<a href="https://detekoi.github.io/#contact-me" target="_blank" class="link-light">this link</a>')
          : `${errorText} <a href="https://detekoi.github.io/#contact-me" target="_blank" class="link-light">Request access here</a>.`;
        showToast(html, 'error');
        return;
      } else if (ttsResponse.ok) {
        ttsData = await ttsResponse.json() as SettingsResponse;
        applyTtsSettings(ttsData.settings as TtsSettings || {});
      }

      let musicData: SettingsResponse = { settings: {} };
      const musicResponse = await fetch(`${botApiBaseUrl}/music/settings/channel/${channelName}`, { headers });
      if (musicResponse.status === 403) {
        // Music settings not available; skip silently
      } else if (musicResponse.ok) {
        musicData = await musicResponse.json() as SettingsResponse;
        applyMusicSettings(musicData.settings as MusicSettings || {});
      }

      displayIgnoreList('tts', (ttsData.settings as TtsSettings)?.ignoredUsers || []);
      displayIgnoreList('music', (musicData.settings as MusicSettings)?.ignoredUsers || []);

      originalSettings = {
        tts: ttsData.settings as TtsSettings || {},
        music: musicData.settings as MusicSettings || {}
      };
    } catch (error) {
      console.error('Failed to load bot settings:', error);
      showToast('Failed to load settings. Please refresh.', 'error');
    }
  }

  function applyTtsSettings(settings: TtsSettings): void {
    if (ttsEnabledCheckbox) ttsEnabledCheckbox.checked = settings.engineEnabled || false;
    if (ttsModeSelect) ttsModeSelect.value = settings.mode || 'command';
    if (ttsPermissionSelect) ttsPermissionSelect.value = settings.ttsPermissionLevel || 'everyone';
    if (eventsEnabledCheckbox) eventsEnabledCheckbox.checked = settings.speakEvents !== false;
    if (allowViewerPreferencesCheckbox) allowViewerPreferencesCheckbox.checked = settings.allowViewerPreferences !== false;
    if (readFullUrlsCheckbox) readFullUrlsCheckbox.checked = settings.readFullUrls || false;
    if (bitsEnabledCheckbox) bitsEnabledCheckbox.checked = settings.bitsModeEnabled || false;
    if (bitsAmountInput) bitsAmountInput.value = String(settings.bitsMinimumAmount ?? 100);
    if (defaultVoiceSelect) {
      defaultVoiceSelect.value = settings.voiceId || 'Friendly_Person';
      const searchInput = document.getElementById('default-voice-search') as HTMLInputElement | null;
      if (searchInput) {
        searchInput.value = formatVoiceName(defaultVoiceSelect.value);
      }
    }
    if (defaultEmotionSelect) defaultEmotionSelect.value = settings.emotion || 'auto';
    if (defaultPitchSlider) {
      defaultPitchSlider.value = String(settings.pitch ?? 0);
      if (pitchValueSpan) pitchValueSpan.textContent = String(settings.pitch ?? 0);
    }
    if (defaultSpeedSlider) {
      defaultSpeedSlider.value = String(settings.speed ?? 1.0);
      if (speedValueSpan) speedValueSpan.textContent = String(settings.speed ?? 1.0);
    }
    if (defaultLanguageSelect) {
      defaultLanguageSelect.value = settings.languageBoost || 'Automatic';
      // Update preview text to match the loaded language
      if (!isInitializing) {
        updatePreviewTextForLanguage();
      }
    }
    if (englishNormalizationCheckbox) englishNormalizationCheckbox.checked = settings.englishNormalization || false;
  }

  function applyMusicSettings(settings: MusicSettings): void {
    if (musicEnabledCheckbox) musicEnabledCheckbox.checked = settings.enabled || false;
    if (musicModeSelect) {
      const mode = settings.allowedRoles?.includes('everyone') ? 'everyone' : 'moderator';
      musicModeSelect.value = mode || 'everyone';
    }
    if (musicBitsEnabledCheckbox) musicBitsEnabledCheckbox.checked = settings.bitsModeEnabled || false;
    if (musicBitsAmountInput) musicBitsAmountInput.value = String(settings.bitsMinimumAmount ?? 100);
  }
}
