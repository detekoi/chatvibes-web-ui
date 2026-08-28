import { showToast, syncTextareas } from '../common/ui.js';
import { apiErrorMessage, displayError, fillLanguageSelect, languageBoostOptions, t } from '../common/i18n.js';
import { debounce, formatVoiceName } from '../common/utils.js';
import { performVoiceTest, TTSPayload, PlayerElements, HintElements } from '../common/voice-preview.js';
import { DashboardServices, TtsSettings } from './types.js';
import { SettingsApi } from './services/settings-api.js';
import { VoiceDropdown } from './components/voice-dropdown.js';
import { VoiceCalibration } from './components/voice-calibration.js';
import type { StoredIgnoreValue } from '../common/ignoreEntries.js';

const previewState = {
  currentlyPlayingAudio: null as HTMLAudioElement | null,
  currentlyPlayingVoiceId: null as string | null,
  cachedAudioUrl: null as string | null,
  cachedAudioUrlMobile: null as string | null
};

export interface SettingsModuleContext {
  apiPrefix: string;
  testMode: boolean;
}

export interface SettingsModuleDependencies {
  displayIgnoreList: (type: 'tts', entries: Record<string, StoredIgnoreValue>) => void;
  displayBannedWords: (words: string[]) => void;
  displayPronunciations: (entries: Record<string, string>) => void;
}

export interface SettingsModule {
  initialize: () => Promise<void>;
  loadSettings: () => Promise<void>;
}

export function initSettingsModule(
  context: SettingsModuleContext,
  services: DashboardServices,
  dependencies: SettingsModuleDependencies
): SettingsModule {
  const { apiPrefix, testMode } = context;
  const { getLoggedInUser, getSessionToken } = services;
  const { displayIgnoreList } = dependencies;

  const api = new SettingsApi(apiPrefix, getSessionToken);

  // Settings Panel Elements
  const defaultEmotionSelect = document.getElementById('default-emotion') as HTMLSelectElement | null;
  const defaultPitchSlider = document.getElementById('default-pitch') as HTMLInputElement | null;
  const pitchValueSpan = document.getElementById('pitch-value') as HTMLSpanElement | null;
  const defaultSpeedSlider = document.getElementById('default-speed') as HTMLInputElement | null;
  const speedValueSpan = document.getElementById('speed-value') as HTMLSpanElement | null;
  const defaultVolumeSlider = document.getElementById('default-volume') as HTMLInputElement | null;
  const volumeValueSpan = document.getElementById('volume-value') as HTMLSpanElement | null;
  const resetPitchBtn = document.getElementById('reset-pitch-btn') as HTMLButtonElement | null;
  const resetSpeedBtn = document.getElementById('reset-speed-btn') as HTMLButtonElement | null;
  const resetVolumeBtn = document.getElementById('reset-volume-btn') as HTMLButtonElement | null;
  const defaultLanguageSelect = document.getElementById('default-language') as HTMLSelectElement | null;

  if (defaultLanguageSelect) {
    fillLanguageSelect(defaultLanguageSelect);
  }
  const englishNormalizationCheckbox = document.getElementById('english-normalization') as HTMLInputElement | null;
  const emoteModeSelect = document.getElementById('emote-mode') as HTMLSelectElement | null;

  const ttsEnabledCheckbox = document.getElementById('tts-enabled') as HTMLInputElement | null;
  const botRespondsInChatCheckbox = document.getElementById('bot-responds-in-chat') as HTMLInputElement | null;
  const ttsModeSelect = document.getElementById('tts-mode') as HTMLSelectElement | null;
  const ttsPermissionSelect = document.getElementById('tts-permission') as HTMLSelectElement | null;
  const eventsEnabledCheckbox = document.getElementById('events-enabled') as HTMLInputElement | null;
  const allowViewerPreferencesCheckbox = document.getElementById('allow-viewer-preferences') as HTMLInputElement | null;
  const readFullUrlsCheckbox = document.getElementById('read-full-urls') as HTMLInputElement | null;
  const pronunciationEnabledCheckbox = document.getElementById('pronunciation-enabled') as HTMLInputElement | null;
  const profanityFilterCheckbox = document.getElementById('profanity-filter-enabled') as HTMLInputElement | null;
  const bitsEnabledCheckbox = document.getElementById('bits-enabled') as HTMLInputElement | null;
  const bitsAmountInput = document.getElementById('bits-amount') as HTMLInputElement | null;
  const anonymizeFollowersCheckbox = document.getElementById('anonymize-followers') as HTMLInputElement | null;

  // YouTube integration elements
  const youtubeEnabledCheckbox = document.getElementById('youtube-enabled') as HTMLInputElement | null;
  const youtubeHandleInput = document.getElementById('youtube-handle') as HTMLInputElement | null;

  const saveSettingsBtn = document.getElementById('save-settings-btn') as HTMLButtonElement | null;

  const voiceTestTextInput = document.getElementById('voice-test-text') as HTMLTextAreaElement | null;
  const voiceTestBtn = document.getElementById('voice-test-btn') as HTMLButtonElement | null;
  const voiceTestTextInputMobile = document.getElementById('voice-test-text-mobile') as HTMLTextAreaElement | null;
  const voiceTestBtnMobile = document.getElementById('voice-test-btn-mobile') as HTMLButtonElement | null;

  if (voiceTestBtn) voiceTestBtn.disabled = true;
  if (voiceTestBtnMobile) voiceTestBtnMobile.disabled = true;
  syncTextareas(voiceTestTextInput, voiceTestTextInputMobile);

  let isInitializing = true;
  let lastSuccessToastAt = 0;
  let settingsInitializedPromiseResolve: (() => void) | undefined;
  const settingsInitializedPromise = new Promise<void>((resolve) => {
    settingsInitializedPromiseResolve = resolve;
  });

  let allVoices: string[] = [];
  let currentVoiceVolumes: Record<string, number> = {};

  // Components
  let defaultVoiceDropdown: VoiceDropdown | null = null;
  let calibrationVoiceDropdown: VoiceDropdown | null = null;
  let voiceCalibration: VoiceCalibration | null = null;

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

  function getChannelName(): string | undefined {
    return getLoggedInUser()?.login?.toLowerCase();
  }

  async function saveSettingWrapper(key: string, value: any, label: string): Promise<void> {
    if (isInitializing) return;
    const channelName = getChannelName();
    if (testMode) {
      maybeSuccessToast(t('msg.action.saved'));
      return;
    }
    if (!channelName) {
      showToast(t('msg.auth.signedOut'), 'error');
      return;
    }
    try {
      await api.saveTtsSetting(channelName, key, value);
      maybeSuccessToast(t('msg.action.saved'));
    } catch (e) {
      const err = e as Error;
      showToast(t('msg.settings.saveFailed', { label, reason: displayError(err) }), 'error');
    }
  }

  function updateVolumeSlider(voiceId: string): void {
    if (!defaultVolumeSlider || !volumeValueSpan) return;
    const vol = currentVoiceVolumes[voiceId] ?? 1.0;
    defaultVolumeSlider.value = String(vol);
    volumeValueSpan.textContent = String(vol);
  }

  function setupAutoSaveListeners(): void {
    if (ttsEnabledCheckbox) ttsEnabledCheckbox.addEventListener('change', () => saveSettingWrapper('engineEnabled', !!ttsEnabledCheckbox.checked, t('msg.setting.ttsEngine')));
    if (botRespondsInChatCheckbox) botRespondsInChatCheckbox.addEventListener('change', () => saveSettingWrapper('botRespondsInChat', !!botRespondsInChatCheckbox.checked, t('msg.setting.botRespondsInChat')));
    if (ttsModeSelect) ttsModeSelect.addEventListener('change', () => saveSettingWrapper('mode', ttsModeSelect.value || 'command', t('msg.setting.ttsMode')));
    if (ttsPermissionSelect) ttsPermissionSelect.addEventListener('change', () => saveSettingWrapper('ttsPermissionLevel', ttsPermissionSelect.value || 'everyone', t('msg.setting.ttsPermission')));
    if (eventsEnabledCheckbox) eventsEnabledCheckbox.addEventListener('change', () => saveSettingWrapper('speakEvents', eventsEnabledCheckbox.checked !== false, t('msg.setting.eventAnnouncements')));
    const cheerEventsEnabledCheckbox = document.getElementById('cheer-events-enabled') as HTMLInputElement | null;
    if (cheerEventsEnabledCheckbox) cheerEventsEnabledCheckbox.addEventListener('change', () => saveSettingWrapper('speakCheerEvents', cheerEventsEnabledCheckbox.checked !== false, t('msg.setting.cheerAnnouncements')));
    const redemptionEventsEnabledCheckbox = document.getElementById('redemption-events-enabled') as HTMLInputElement | null;
    if (redemptionEventsEnabledCheckbox) redemptionEventsEnabledCheckbox.addEventListener('change', () => saveSettingWrapper('speakRedemptionEvents', redemptionEventsEnabledCheckbox.checked !== false, t('msg.setting.redemptionAnnouncements')));
    const announceUnfulfilledCheckbox = document.getElementById('announce-unfulfilled-redemptions') as HTMLInputElement | null;
    if (announceUnfulfilledCheckbox) announceUnfulfilledCheckbox.addEventListener('change', () => saveSettingWrapper('announceUnfulfilledRedemptions', !!announceUnfulfilledCheckbox.checked, t('msg.setting.announceQueuedRedeems')));
    const watchStreakEventsEnabledCheckbox = document.getElementById('watch-streak-events-enabled') as HTMLInputElement | null;
    if (watchStreakEventsEnabledCheckbox) watchStreakEventsEnabledCheckbox.addEventListener('change', () => saveSettingWrapper('speakWatchStreakEvents', !!watchStreakEventsEnabledCheckbox.checked, t('msg.setting.watchStreakAnnouncements')));
    if (anonymizeFollowersCheckbox) anonymizeFollowersCheckbox.addEventListener('change', () => saveSettingWrapper('anonymizeFollowers', anonymizeFollowersCheckbox.checked !== false, t('msg.setting.anonymizeFollowers')));
    if (allowViewerPreferencesCheckbox) allowViewerPreferencesCheckbox.addEventListener('change', () => saveSettingWrapper('allowViewerPreferences', !!allowViewerPreferencesCheckbox.checked, t('msg.setting.allowViewerPreferences')));
    if (readFullUrlsCheckbox) readFullUrlsCheckbox.addEventListener('change', () => saveSettingWrapper('readFullUrls', !!readFullUrlsCheckbox.checked, t('msg.setting.readFullUrls')));
    if (pronunciationEnabledCheckbox) pronunciationEnabledCheckbox.addEventListener('change', () => saveSettingWrapper('pronunciationEnabled', !!pronunciationEnabledCheckbox.checked, t('msg.setting.expandAcronyms')));
    if (profanityFilterCheckbox) profanityFilterCheckbox.addEventListener('change', () => saveSettingWrapper('profanityFilterEnabled', !!profanityFilterCheckbox.checked, t('msg.setting.profanityFilter')));
    if (bitsEnabledCheckbox) bitsEnabledCheckbox.addEventListener('change', () => saveSettingWrapper('bitsModeEnabled', !!bitsEnabledCheckbox.checked, t('msg.setting.bitsForTts')));
    if (bitsAmountInput) {
      const debouncedBitsAmountSave = debounce(
        () => saveSettingWrapper('bitsMinimumAmount', parseInt(bitsAmountInput.value || '100', 10), t('msg.setting.minimumBits')),
        600
      );
      bitsAmountInput.addEventListener('input', () => { if (!isInitializing) debouncedBitsAmountSave(); });
      bitsAmountInput.addEventListener('change', () => saveSettingWrapper('bitsMinimumAmount', parseInt(bitsAmountInput.value || '100', 10), t('msg.setting.minimumBits')));
    }

    if (defaultEmotionSelect) defaultEmotionSelect.addEventListener('change', () => {
      saveSettingWrapper('emotion', defaultEmotionSelect.value || 'neutral', t('msg.setting.defaultEmotion'));
      updateSidebarPreview();
    });

    if (defaultPitchSlider) {
      const debouncedPitchSave = debounce(
        () => saveSettingWrapper('pitch', parseInt(defaultPitchSlider.value || '0', 10), t('msg.setting.defaultPitch')),
        400
      );
      defaultPitchSlider.addEventListener('input', () => { if (!isInitializing) debouncedPitchSave(); updateSidebarPreview(); });
      defaultPitchSlider.addEventListener('change', () => saveSettingWrapper('pitch', parseInt(defaultPitchSlider.value || '0', 10), t('msg.setting.defaultPitch')));
    }

    if (defaultSpeedSlider) {
      const debouncedSpeedSave = debounce(
        () => saveSettingWrapper('speed', parseFloat(defaultSpeedSlider.value || '1.0'), t('msg.setting.defaultSpeed')),
        400
      );
      defaultSpeedSlider.addEventListener('input', () => { if (!isInitializing) debouncedSpeedSave(); updateSidebarPreview(); });
      defaultSpeedSlider.addEventListener('change', () => saveSettingWrapper('speed', parseFloat(defaultSpeedSlider.value || '1.0'), t('msg.setting.defaultSpeed')));
    }

    if (defaultVolumeSlider) {
      const debouncedVolumeSave = debounce(
        () => {
          const voiceId = defaultVoiceDropdown?.getValue() || 'Friendly_Person';
          const vol = parseFloat(defaultVolumeSlider.value || '1.0');
          currentVoiceVolumes[voiceId] = vol;
          voiceCalibration?.updateVolumes(currentVoiceVolumes); // Sync calibration component
          saveSettingWrapper(`voiceVolumes.${voiceId}`, vol, t('msg.setting.voiceVolume'));
        },
        400
      );
      defaultVolumeSlider.addEventListener('input', () => { if (!isInitializing) debouncedVolumeSave(); updateSidebarPreview(); });
      defaultVolumeSlider.addEventListener('change', () => {
        const voiceId = defaultVoiceDropdown?.getValue() || 'Friendly_Person';
        const vol = parseFloat(defaultVolumeSlider.value || '1.0');
        currentVoiceVolumes[voiceId] = vol;
        voiceCalibration?.updateVolumes(currentVoiceVolumes);
        saveSettingWrapper(`voiceVolumes.${voiceId}`, vol, t('msg.setting.voiceVolume'));
      });
    }

    if (defaultLanguageSelect) defaultLanguageSelect.addEventListener('change', () => { saveSettingWrapper('languageBoost', defaultLanguageSelect.value || 'auto', t('msg.setting.defaultLanguage')); updateSidebarPreview(); });
    if (englishNormalizationCheckbox) englishNormalizationCheckbox.addEventListener('change', () => { saveSettingWrapper('englishNormalization', !!englishNormalizationCheckbox.checked, t('msg.setting.englishNormalization')); updateSidebarPreview(); });
    if (emoteModeSelect) emoteModeSelect.addEventListener('change', () => saveSettingWrapper('emoteMode', emoteModeSelect.value || 'describe', t('msg.setting.emoteMode')));

    // YouTube integration auto-save
    if (youtubeEnabledCheckbox) {
      youtubeEnabledCheckbox.addEventListener('change', () => {
        if (youtubeEnabledCheckbox?.checked && !youtubeHandleInput?.value?.trim()) {
          showToast(t('msg.settings.youtubeHandleRequired'), 'warning');
          youtubeEnabledCheckbox.checked = false;
          return;
        }
        saveSettingWrapper('youtubeEnabled', !!youtubeEnabledCheckbox.checked, t('msg.setting.youtubeTts'));
      });
    }
    if (youtubeHandleInput) {
      const debouncedHandleSave = debounce(
        () => {
          const handle = youtubeHandleInput.value.trim();
          youtubeHandleInput.value = handle; // reflect trimmed value in the input
          saveSettingWrapper('youtubeHandle', handle, t('msg.setting.youtubeHandle'));
        },
        800
      );
      youtubeHandleInput.addEventListener('input', () => { if (!isInitializing) debouncedHandleSave(); });
      youtubeHandleInput.addEventListener('change', () => {
        const handle = youtubeHandleInput.value.trim();
        youtubeHandleInput.value = handle; // reflect trimmed value in the input
        saveSettingWrapper('youtubeHandle', handle, t('msg.setting.youtubeHandle'));
      });
    }
  }

  function getEffectiveTtsSettings(): Omit<TTSPayload, 'text'> {
    const voiceId = defaultVoiceDropdown?.getValue() || 'Friendly_Person';
    const emotion = defaultEmotionSelect?.value || 'auto';
    const pitch = parseInt(defaultPitchSlider?.value || '0', 10);
    const speed = parseFloat(defaultSpeedSlider?.value || '1.0');
    const volume = parseFloat(defaultVolumeSlider?.value || '1.0');
    const languageBoost = defaultLanguageSelect?.value || 'auto';
    return { voiceId, emotion, pitch, speed, volume, languageBoost };
  }

  function updateSidebarPreview(): void {
    const voiceId = defaultVoiceDropdown?.getValue() || 'Friendly_Person';
    const emotion = defaultEmotionSelect?.value || 'auto';
    const pitch = parseInt(defaultPitchSlider?.value || '0', 10);
    const speed = parseFloat(defaultSpeedSlider?.value || '1.0');
    const volume = parseFloat(defaultVolumeSlider?.value || '1.0');

    const voiceNameEl = document.getElementById('sidebar-voice-name');
    const pitchValEl = document.getElementById('sidebar-pitch-val');
    const speedValEl = document.getElementById('sidebar-speed-val');
    const volumeValEl = document.getElementById('sidebar-volume-val');
    const emotionValEl = document.getElementById('sidebar-emotion-val');
    const languageValEl = document.getElementById('sidebar-language-val');
    const engNormValEl = document.getElementById('sidebar-eng-norm-val');

    const languageBoost = defaultLanguageSelect?.value || 'auto';

    if (voiceNameEl) voiceNameEl.textContent = formatVoiceName(voiceId);
    if (pitchValEl) pitchValEl.textContent = String(pitch);
    if (speedValEl) speedValEl.textContent = speed.toFixed(1) + '×';
    if (volumeValEl) volumeValEl.textContent = volume.toFixed(1);
    // These overwrite markup that has already been translated, so they have to
    // be translated too -- capitalizing the raw enum value put an English word
    // back into every locale's sidebar.
    if (emotionValEl) emotionValEl.textContent = t(`msg.emotion.${emotion}`);
    if (languageValEl) {
      // The endonym, matching both language pickers, rather than the English
      // name the `languageBoost` enum happens to use.
      const named = languageBoostOptions().find(o => o.value === languageBoost);
      languageValEl.textContent = languageBoost === 'auto'
        ? t('msg.lang.automatic')
        : (named?.label ?? languageBoost);
    }
    if (engNormValEl) {
      engNormValEl.textContent = t(englishNormalizationCheckbox?.checked ? 'msg.value.on' : 'msg.value.off');
    }
  }



  function attachVoicePreview(): void {
    const playerEl = document.getElementById('voice-preview-player') as HTMLElement | null;
    const playerElMobile = document.getElementById('voice-preview-player-mobile') as HTMLElement | null;
    const sourceEl = document.getElementById('voice-preview-source') as HTMLSourceElement | null;
    const sourceElMobile = document.getElementById('voice-preview-source-mobile') as HTMLSourceElement | null;
    const hintEl = document.getElementById('voice-preview-hint') as HTMLElement | null;
    const hintElMobile = document.getElementById('voice-preview-hint-mobile') as HTMLElement | null;

    const testVoice = async (isMobile = false): Promise<void> => {
      await settingsInitializedPromise;
      const textInput = isMobile ? voiceTestTextInputMobile : voiceTestTextInput;
      const text = textInput?.value?.trim() || '';

      if (!text) {
        showToast(t('msg.preview.enterText'), 'warning');
        return;
      }
      if (text.length > 500) {
        showToast(t('msg.preview.tooLong'), 'error');
        return;
      }
      if (testMode) {
        showToast(t('msg.preview.playingTestMode'), 'success');
        return;
      }

      const payload: TTSPayload = { text, ...getEffectiveTtsSettings() };
      const playerElements: PlayerElements = { playerEl, playerElMobile, sourceEl, sourceElMobile };
      const hintElements: HintElements = { hintEl, hintElMobile };

      const onAudioGenerated = (audioUrl: string): void => {
        if (isMobile) {
          if (previewState.cachedAudioUrlMobile) URL.revokeObjectURL(previewState.cachedAudioUrlMobile);
          previewState.cachedAudioUrlMobile = audioUrl;
        } else {
          if (previewState.cachedAudioUrl) URL.revokeObjectURL(previewState.cachedAudioUrl);
          previewState.cachedAudioUrl = audioUrl;
        }
      };

      const buttons = [voiceTestBtn, voiceTestBtnMobile].filter((btn): btn is HTMLButtonElement => btn !== null);
      await performVoiceTest(payload, buttons, {
        defaultText: 'Welcome, everyone, to the stream!',
        playerElements,
        hintElements,
        onAudioGenerated
      });
    };

    if (voiceTestBtn) voiceTestBtn.addEventListener('click', () => void testVoice(false));
    if (voiceTestBtnMobile) voiceTestBtnMobile.addEventListener('click', () => void testVoice(true));

    const markSettingsAsDirty = (): void => {
      if (hintEl && previewState.cachedAudioUrl) hintEl.style.display = 'block';
      if (hintElMobile && previewState.cachedAudioUrlMobile) hintElMobile.style.display = 'block';
    };

    // Watch for changes that invalidate preview
    defaultEmotionSelect?.addEventListener('change', markSettingsAsDirty);
    defaultPitchSlider?.addEventListener('change', markSettingsAsDirty);
    defaultSpeedSlider?.addEventListener('change', markSettingsAsDirty);
    defaultVolumeSlider?.addEventListener('change', markSettingsAsDirty);
    defaultLanguageSelect?.addEventListener('change', markSettingsAsDirty);
    englishNormalizationCheckbox?.addEventListener('change', markSettingsAsDirty);
    // Voice Dropdown handles its own listener if we want? But we can hook into onSelect.
    // We'll handle voice change in the VoiceDropdown instantiation.

    window.addEventListener('beforeunload', () => {
      if (previewState.cachedAudioUrl) URL.revokeObjectURL(previewState.cachedAudioUrl);
      if (previewState.cachedAudioUrlMobile) URL.revokeObjectURL(previewState.cachedAudioUrlMobile);
    });
  }

  async function playVoiceSample(voiceId: string, buttonElement: HTMLButtonElement): Promise<void> {
    if (!voiceId) return;

    if (previewState.currentlyPlayingVoiceId === voiceId && previewState.currentlyPlayingAudio) {
      previewState.currentlyPlayingAudio.pause();
      previewState.currentlyPlayingAudio = null;
      previewState.currentlyPlayingVoiceId = null;
      updatePlayButton(buttonElement, false);
      return;
    }

    if (previewState.currentlyPlayingAudio) {
      // Find the PREVIOUS button and reset it. 
      // This is tricky because we don't have a direct reference to the previous button element easily
      // unless we store it or query for it.
      const previousBtn = document.querySelector('.voice-play-btn.playing') as HTMLButtonElement | null;
      if (previousBtn) {
        updatePlayButton(previousBtn, false);
      }
      previewState.currentlyPlayingAudio.pause();
      previewState.currentlyPlayingAudio = null;
    }

    const preMadeUrl = `/assets/voices/${voiceId}-welcome-everyone-to-the-stream.mp3`;

    try {
      const response = await fetch(preMadeUrl);
      if (!response.ok) {
        showToast(t('msg.preview.unavailable'), 'info');
        return;
      }

      const blob = await response.blob();
      const audioUrl = URL.createObjectURL(blob);

      previewState.currentlyPlayingAudio = new Audio(audioUrl);
      previewState.currentlyPlayingVoiceId = voiceId;
      updatePlayButton(buttonElement, true);

      const stopPlayback = (): void => {
        URL.revokeObjectURL(audioUrl);
        updatePlayButton(buttonElement, false);
        previewState.currentlyPlayingAudio = null;
        previewState.currentlyPlayingVoiceId = null;
      };

      previewState.currentlyPlayingAudio.onended = stopPlayback;
      previewState.currentlyPlayingAudio.onerror = stopPlayback;

      await previewState.currentlyPlayingAudio.play();
    } catch (error) {
      console.error('Error playing voice preview:', error);
      updatePlayButton(buttonElement, false);
      previewState.currentlyPlayingAudio = null;
      previewState.currentlyPlayingVoiceId = null;
    }
  }

  function updatePlayButton(buttonElement: HTMLButtonElement, isPlaying: boolean): void {
    if (!buttonElement) return;
    const icon = isPlaying
      ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z"/></svg>`
      : `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>`;
    buttonElement.innerHTML = icon;
    if (isPlaying) buttonElement.classList.add('playing');
    else buttonElement.classList.remove('playing');
  }

  async function initializeSettingsPanel(): Promise<void> {
    // Default Sliders UI Logic (sync span)
    if (defaultPitchSlider && pitchValueSpan) {
      defaultPitchSlider.addEventListener('input', () => { pitchValueSpan.textContent = defaultPitchSlider.value; });
    }
    if (defaultSpeedSlider && speedValueSpan) {
      defaultSpeedSlider.addEventListener('input', () => { speedValueSpan.textContent = defaultSpeedSlider.value; });
    }
    if (defaultVolumeSlider && volumeValueSpan) {
      defaultVolumeSlider.addEventListener('input', () => { volumeValueSpan.textContent = defaultVolumeSlider.value; });
    }

    // Reset Buttons
    resetPitchBtn?.addEventListener('click', () => {
      if (!defaultPitchSlider || !pitchValueSpan) return;
      defaultPitchSlider.value = '0';
      pitchValueSpan.textContent = '0';
      saveSettingWrapper('pitch', 0, t('msg.setting.defaultPitch'));
      updateSidebarPreview();
    });
    resetSpeedBtn?.addEventListener('click', () => {
      if (!defaultSpeedSlider || !speedValueSpan) return;
      defaultSpeedSlider.value = '1.0';
      speedValueSpan.textContent = '1.0';
      saveSettingWrapper('speed', 1.0, t('msg.setting.defaultSpeed'));
      updateSidebarPreview();
    });
    resetVolumeBtn?.addEventListener('click', () => {
      if (!defaultVolumeSlider || !volumeValueSpan || !defaultVoiceDropdown) return;
      defaultVolumeSlider.value = '1.0';
      volumeValueSpan.textContent = '1.0';
      const voiceId = defaultVoiceDropdown.getValue() || 'Friendly_Person';
      currentVoiceVolumes[voiceId] = 1.0;
      voiceCalibration?.updateVolumes(currentVoiceVolumes);
      saveSettingWrapper(`voiceVolumes.${voiceId}`, 1.0, t('msg.setting.voiceVolume'));
      updateSidebarPreview();
    });

    // Load Voices
    const voicesResponse = await api.getVoices();
    allVoices = voicesResponse.voices || [];

    // Init Default Voice Dropdown
    defaultVoiceDropdown = new VoiceDropdown({
      containerId: 'default',
      onSelect: (voiceId) => {
        if (!isInitializing) updateVolumeSlider(voiceId);
        saveSettingWrapper('voiceId', voiceId, t('msg.setting.defaultVoice'));
        const hintEl = document.getElementById('voice-preview-hint');
        if (hintEl) hintEl.style.display = 'block';
        updateSidebarPreview();
      },
      onPlaySample: playVoiceSample
    });
    defaultVoiceDropdown.setVoices(allVoices);

    // Init Calibration Dropdown. VoiceCalibration only handles "Edit" clicks in
    // the list, which set the dropdown value programmatically — picking a voice
    // from the dropdown directly has to update the slider itself. voiceCalibration
    // is assigned just below and the callback only fires on user interaction.
    calibrationVoiceDropdown = new VoiceDropdown({
      containerId: 'calibration',
      onSelect: (voiceId) => voiceCalibration?.selectVoice(voiceId),
    });
    calibrationVoiceDropdown.setVoices(allVoices);

    // Init Voice Calibration
    voiceCalibration = new VoiceCalibration({
      voiceDropdown: calibrationVoiceDropdown,
      currentVoiceVolumes: currentVoiceVolumes,
      onSave: async (voiceId, volume) => {
        await api.saveTtsSetting(getChannelName() || '', `voiceVolumes.${voiceId}`, volume);
        maybeSuccessToast(t('msg.action.saved'));
        // If this is also the default voice, update the main slider too
        if (defaultVoiceDropdown?.getValue() === voiceId && defaultVolumeSlider) {
          defaultVolumeSlider.value = String(volume);
          if (volumeValueSpan) volumeValueSpan.textContent = String(volume);
        }
      },
      onReset: async (voiceId) => {
        await api.saveTtsSetting(getChannelName() || '', `voiceVolumes.${voiceId}`, 1.0);
        maybeSuccessToast('Reset');
      },
      sliderId: 'calibration-volume',
      valueSpanId: 'calibration-volume-value',
      saveBtnId: 'calibration-save-btn',
      listId: 'calibrated-voices-list'
    });

    attachVoicePreview();
    setupAutoSaveListeners();
    setupVoiceLookup();

    if (saveSettingsBtn) {
      saveSettingsBtn.style.display = 'none';
      saveSettingsBtn.disabled = true;
    }

    await loadBotSettings();
    isInitializing = false;
    if (voiceTestBtn) voiceTestBtn.disabled = false;
    if (voiceTestBtnMobile) voiceTestBtnMobile.disabled = false;

    settingsInitializedPromiseResolve?.();
  }

  function setupVoiceLookup(): void {
    const lookupInput = document.getElementById('lookup-username') as HTMLInputElement | null;
    const lookupBtn = document.getElementById('lookup-voice-btn') as HTMLButtonElement | null;
    const lookupResult = document.getElementById('lookup-result') as HTMLElement | null;
    if (!lookupInput || !lookupBtn || !lookupResult) return;

    const performLookup = async (): Promise<void> => {
      const username = lookupInput.value.trim();
      if (!username) { showToast(t('msg.ignore.enterUsername'), 'warning'); return; }

      lookupBtn.disabled = true;
      const originalBtnText = lookupBtn.textContent;
      lookupBtn.textContent = t('msg.lookup.searching');
      lookupResult.style.display = 'none';
      lookupResult.className = 'mt-3';

      try {
        const data = await api.lookupUserVoice(username);
        lookupResult.style.display = 'block';
        if (data.voiceId) {
          lookupResult.className = 'mt-3 alert alert-success';
          // Both values are attacker-controlled — the username is echoed back
          // from the lookup and the voice ID is whatever the viewer stored — so
          // this goes through textContent. That costs the bold emphasis the two
          // values used to carry: keeping it would mean either splicing them
          // into markup, or splitting the translated sentence on its own
          // placeholders, and neither is worth a visual accent.
          const summary = document.createElement('div');
          summary.textContent = t('msg.lookup.hasVoice', { user: data.username, voice: data.voiceId });
          lookupResult.replaceChildren(summary);

          if (allVoices.includes(data.voiceId)) {
            const calibrateBtn = document.createElement('button');
            calibrateBtn.className = 'btn btn-sm btn-success mt-2';
            calibrateBtn.textContent = t('msg.lookup.calibrate', { voice: formatVoiceName(data.voiceId) });
            calibrateBtn.onclick = () => {
              voiceCalibration?.selectVoice(data.voiceId!);
            };
            lookupResult.appendChild(calibrateBtn);
          } else {
            const warning = document.createElement('div');
            warning.className = 'text-warning small mt-1';
            warning.textContent = t('msg.lookup.voiceUnknown');
            lookupResult.appendChild(warning);
          }
        } else {
          lookupResult.className = 'mt-3 alert alert-info';
          lookupResult.textContent = t('msg.lookup.noVoice', { user: data.username });
        }
      } catch (e) {
        const err = e as Error;
        lookupResult.style.display = 'block';
        lookupResult.className = 'mt-3 alert alert-danger';
        lookupResult.textContent = t('msg.lookup.error', { reason: displayError(err) });
      } finally {
        lookupBtn.disabled = false;
        lookupBtn.textContent = originalBtnText || t('msg.lookup.button');
      }
    };

    lookupBtn.addEventListener('click', () => void performLookup());
    lookupInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') void performLookup(); });
  }

  async function loadBotSettings(): Promise<void> {
    const user = getLoggedInUser();
    if (!user?.login) {
      console.warn('No logged in user, cannot load bot settings');
      return;
    }

    if (testMode) {
      // Demo settings...
      const demoTts: TtsSettings = {
        engineEnabled: true,
        botRespondsInChat: true,
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
        languageBoost: 'auto',
        englishNormalization: false,
        // One of each shape, so test mode exercises both provenance badges: a
        // viewer who opted out themselves and someone the broadcaster muted.
        ignoredUserIds: {
          'twitch:52343457': { label: 'Spammer1', source: 'moderator', by: 'twitch:1', at: null },
          'twitch:19571641': { label: 'Troll2', source: 'self', by: 'twitch:19571641', at: null },
        },
        pronunciationEnabled: true,
        profanityFilterEnabled: false,
        pronunciations: { wcat: 'wildcat', lfg: '' }
      };
      applyTtsSettings(demoTts);
      displayIgnoreList('tts', demoTts.ignoredUserIds || {});
      dependencies.displayBannedWords(['testbadword', 'naughtyword']);
      dependencies.displayPronunciations(demoTts.pronunciations || {});
      return;
    }

    const response = await api.getSettings(user.login);
    if ('error' in response && response.error) {
      showToast(apiErrorMessage(response, 'msg.settings.loadFailed'), 'error');
      return;
    }

    if ('settings' in response) {
      applyTtsSettings(response.settings || {});
      displayIgnoreList('tts', response.settings?.ignoredUserIds || {});
      dependencies.displayBannedWords(response.settings?.bannedWords || []);
      dependencies.displayPronunciations(response.settings?.pronunciations || {});
    }
  }

  function applyTtsSettings(settings: TtsSettings): void {
    if (settings.voiceVolumes) {
      currentVoiceVolumes = settings.voiceVolumes;
      voiceCalibration?.updateVolumes(currentVoiceVolumes);
    }

    if (ttsEnabledCheckbox) ttsEnabledCheckbox.checked = settings.engineEnabled || false;
    if (botRespondsInChatCheckbox) botRespondsInChatCheckbox.checked = settings.botRespondsInChat !== false;
    if (ttsModeSelect) ttsModeSelect.value = settings.mode || 'command';
    if (ttsPermissionSelect) ttsPermissionSelect.value = settings.ttsPermissionLevel || 'everyone';
    if (eventsEnabledCheckbox) eventsEnabledCheckbox.checked = settings.speakEvents !== false;
    const cheerEventsEnabledCheckbox = document.getElementById('cheer-events-enabled') as HTMLInputElement | null;
    if (cheerEventsEnabledCheckbox) {
      // Default to speakEvents value (or true if everything undefined) if speakCheerEvents not set
      const defaultState = settings.speakEvents !== false;
      cheerEventsEnabledCheckbox.checked = settings.speakCheerEvents !== undefined ? settings.speakCheerEvents : defaultState;
    }
    const redemptionEventsEnabledCheckbox = document.getElementById('redemption-events-enabled') as HTMLInputElement | null;
    if (redemptionEventsEnabledCheckbox) {
      const defaultRedemptionState = settings.speakEvents !== false;
      redemptionEventsEnabledCheckbox.checked = settings.speakRedemptionEvents !== undefined ? settings.speakRedemptionEvents : defaultRedemptionState;
    }
    const announceUnfulfilledCheckbox = document.getElementById('announce-unfulfilled-redemptions') as HTMLInputElement | null;
    // On unless the channel turned it off, matching the bot's default — a config
    // saved before this setting existed has no field and still announces.
    if (announceUnfulfilledCheckbox) announceUnfulfilledCheckbox.checked = settings.announceUnfulfilledRedemptions !== false;
    const watchStreakEventsEnabledCheckbox = document.getElementById('watch-streak-events-enabled') as HTMLInputElement | null;
    if (watchStreakEventsEnabledCheckbox) {
      const defaultWatchStreakState = settings.speakEvents !== false;
      watchStreakEventsEnabledCheckbox.checked = settings.speakWatchStreakEvents !== undefined ? settings.speakWatchStreakEvents : defaultWatchStreakState;
    }
    if (anonymizeFollowersCheckbox) anonymizeFollowersCheckbox.checked = settings.anonymizeFollowers !== false;
    if (allowViewerPreferencesCheckbox) allowViewerPreferencesCheckbox.checked = settings.allowViewerPreferences !== false;
    if (readFullUrlsCheckbox) readFullUrlsCheckbox.checked = settings.readFullUrls || false;
    // Acronym expansion defaults ON, the profanity filter defaults OFF, so the
    // two undefined cases resolve in opposite directions.
    if (pronunciationEnabledCheckbox) pronunciationEnabledCheckbox.checked = settings.pronunciationEnabled !== false;
    if (profanityFilterCheckbox) profanityFilterCheckbox.checked = settings.profanityFilterEnabled || false;
    if (bitsEnabledCheckbox) bitsEnabledCheckbox.checked = settings.bitsModeEnabled || false;
    if (bitsAmountInput) bitsAmountInput.value = String(settings.bitsMinimumAmount ?? 100);

    if (defaultVoiceDropdown && settings.voiceId) {
      defaultVoiceDropdown.setValue(settings.voiceId);
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

    if (settings.voiceId) updateVolumeSlider(settings.voiceId);

    // Channels saved before the dropdown used "auto" still store the old
    // "Automatic"/"None" spellings; map them so the right option stays selected.
    if (defaultLanguageSelect) {
      const stored = settings.languageBoost || 'auto';
      defaultLanguageSelect.value = (stored === 'Automatic' || stored === 'None') ? 'auto' : stored;
    }
    if (englishNormalizationCheckbox) englishNormalizationCheckbox.checked = settings.englishNormalization || false;
    if (emoteModeSelect) emoteModeSelect.value = settings.emoteMode || 'describe';

    // YouTube integration
    if (youtubeEnabledCheckbox) youtubeEnabledCheckbox.checked = settings.youtubeEnabled || false;
    if (youtubeHandleInput) youtubeHandleInput.value = settings.youtubeHandle || '';

    updateSidebarPreview();
  }
}
