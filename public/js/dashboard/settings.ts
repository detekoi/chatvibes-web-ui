import { showToast, syncTextareas } from '../common/ui.js';
import { debounce, formatVoiceName } from '../common/utils.js';
import { performVoiceTest, TTSPayload, PlayerElements, HintElements } from '../common/voice-preview.js';
import { DashboardServices, TtsSettings } from './types.js';
import { SettingsApi } from './services/settings-api.js';
import { VoiceDropdown } from './components/voice-dropdown.js';
import { VoiceCalibration } from './components/voice-calibration.js';

const previewState = {
  currentlyPlayingAudio: null as HTMLAudioElement | null,
  currentlyPlayingVoiceId: null as string | null,
  cachedAudioUrl: null as string | null,
  cachedAudioUrlMobile: null as string | null
};

export interface SettingsModuleContext {
  botApiBaseUrl: string;
  testMode: boolean;
}

export interface SettingsModuleDependencies {
  displayIgnoreList: (type: 'tts', users: string[]) => void;
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
  const { botApiBaseUrl, testMode } = context;
  const { getLoggedInUser, getSessionToken } = services;
  const { displayIgnoreList } = dependencies;

  const api = new SettingsApi(botApiBaseUrl, getSessionToken);

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
    const options = [
      "Automatic", "Chinese", "Chinese,Yue", "English", "Arabic", "Russian", "Spanish", "French", "Portuguese",
      "German", "Turkish", "Dutch", "Ukrainian", "Vietnamese", "Indonesian", "Japanese", "Italian",
      "Korean", "Thai", "Polish", "Romanian", "Greek", "Czech", "Finnish", "Hindi", "Bulgarian",
      "Danish", "Hebrew", "Malay", "Persian", "Slovak", "Swedish", "Croatian", "Filipino",
      "Hungarian", "Norwegian", "Slovenian", "Catalan", "Nynorsk", "Tamil", "Afrikaans"
    ];
    defaultLanguageSelect.innerHTML = options.map(opt => `<option value="${opt}">${opt}</option>`).join('');
  }
  const englishNormalizationCheckbox = document.getElementById('english-normalization') as HTMLInputElement | null;
  const skipEmotesCheckbox = document.getElementById('default-skip-emotes') as HTMLInputElement | null;

  const ttsEnabledCheckbox = document.getElementById('tts-enabled') as HTMLInputElement | null;
  const botRespondsInChatCheckbox = document.getElementById('bot-responds-in-chat') as HTMLInputElement | null;
  const ttsModeSelect = document.getElementById('tts-mode') as HTMLSelectElement | null;
  const ttsPermissionSelect = document.getElementById('tts-permission') as HTMLSelectElement | null;
  const eventsEnabledCheckbox = document.getElementById('events-enabled') as HTMLInputElement | null;
  const allowViewerPreferencesCheckbox = document.getElementById('allow-viewer-preferences') as HTMLInputElement | null;
  const readFullUrlsCheckbox = document.getElementById('read-full-urls') as HTMLInputElement | null;
  const bitsEnabledCheckbox = document.getElementById('bits-enabled') as HTMLInputElement | null;
  const bitsAmountInput = document.getElementById('bits-amount') as HTMLInputElement | null;

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
      maybeSuccessToast('Saved');
      return;
    }
    if (!channelName) {
      showToast('Not logged in', 'error');
      return;
    }
    try {
      await api.saveTtsSetting(channelName, key, value);
      maybeSuccessToast('Saved');
    } catch (e) {
      const err = e as Error;
      showToast(`${label}: ${err.message}`, 'error');
    }
  }

  function updateVolumeSlider(voiceId: string): void {
    if (!defaultVolumeSlider || !volumeValueSpan) return;
    const vol = currentVoiceVolumes[voiceId] ?? 1.0;
    defaultVolumeSlider.value = String(vol);
    volumeValueSpan.textContent = String(vol);
  }

  function setupAutoSaveListeners(): void {
    if (ttsEnabledCheckbox) ttsEnabledCheckbox.addEventListener('change', () => saveSettingWrapper('engineEnabled', !!ttsEnabledCheckbox.checked, 'TTS Engine'));
    if (botRespondsInChatCheckbox) botRespondsInChatCheckbox.addEventListener('change', () => saveSettingWrapper('botRespondsInChat', !!botRespondsInChatCheckbox.checked, 'Bot Responds in Chat'));
    if (ttsModeSelect) ttsModeSelect.addEventListener('change', () => saveSettingWrapper('mode', ttsModeSelect.value || 'command', 'TTS Mode'));
    if (ttsPermissionSelect) ttsPermissionSelect.addEventListener('change', () => saveSettingWrapper('ttsPermissionLevel', ttsPermissionSelect.value || 'everyone', 'TTS Permission'));
    if (eventsEnabledCheckbox) eventsEnabledCheckbox.addEventListener('change', () => saveSettingWrapper('speakEvents', eventsEnabledCheckbox.checked !== false, 'Event Announcements'));
    const cheerEventsEnabledCheckbox = document.getElementById('cheer-events-enabled') as HTMLInputElement | null;
    if (cheerEventsEnabledCheckbox) cheerEventsEnabledCheckbox.addEventListener('change', () => saveSettingWrapper('speakCheerEvents', cheerEventsEnabledCheckbox.checked !== false, 'Cheer Announcements'));
    if (allowViewerPreferencesCheckbox) allowViewerPreferencesCheckbox.addEventListener('change', () => saveSettingWrapper('allowViewerPreferences', !!allowViewerPreferencesCheckbox.checked, 'Allow Viewer Voice Preferences'));
    if (readFullUrlsCheckbox) readFullUrlsCheckbox.addEventListener('change', () => saveSettingWrapper('readFullUrls', !!readFullUrlsCheckbox.checked, 'Read Full URLs'));
    if (bitsEnabledCheckbox) bitsEnabledCheckbox.addEventListener('change', () => saveSettingWrapper('bitsModeEnabled', !!bitsEnabledCheckbox.checked, 'Bits for TTS'));
    if (bitsAmountInput) {
      const debouncedBitsAmountSave = debounce(
        () => saveSettingWrapper('bitsMinimumAmount', parseInt(bitsAmountInput.value || '100', 10), 'Minimum Bits'),
        600
      );
      bitsAmountInput.addEventListener('input', () => { if (!isInitializing) debouncedBitsAmountSave(); });
      bitsAmountInput.addEventListener('change', () => saveSettingWrapper('bitsMinimumAmount', parseInt(bitsAmountInput.value || '100', 10), 'Minimum Bits'));
    }

    if (defaultEmotionSelect) defaultEmotionSelect.addEventListener('change', () => saveSettingWrapper('emotion', defaultEmotionSelect.value || 'auto', 'Default Emotion'));

    if (defaultPitchSlider) {
      const debouncedPitchSave = debounce(
        () => saveSettingWrapper('pitch', parseInt(defaultPitchSlider.value || '0', 10), 'Default Pitch'),
        400
      );
      defaultPitchSlider.addEventListener('input', () => { if (!isInitializing) debouncedPitchSave(); });
      defaultPitchSlider.addEventListener('change', () => saveSettingWrapper('pitch', parseInt(defaultPitchSlider.value || '0', 10), 'Default Pitch'));
    }

    if (defaultSpeedSlider) {
      const debouncedSpeedSave = debounce(
        () => saveSettingWrapper('speed', parseFloat(defaultSpeedSlider.value || '1.0'), 'Default Speed'),
        400
      );
      defaultSpeedSlider.addEventListener('input', () => { if (!isInitializing) debouncedSpeedSave(); });
      defaultSpeedSlider.addEventListener('change', () => saveSettingWrapper('speed', parseFloat(defaultSpeedSlider.value || '1.0'), 'Default Speed'));
    }

    if (defaultVolumeSlider) {
      const debouncedVolumeSave = debounce(
        () => {
          const voiceId = defaultVoiceDropdown?.getValue() || 'Friendly_Person';
          const vol = parseFloat(defaultVolumeSlider.value || '1.0');
          currentVoiceVolumes[voiceId] = vol;
          voiceCalibration?.updateVolumes(currentVoiceVolumes); // Sync calibration component
          saveSettingWrapper(`voiceVolumes.${voiceId}`, vol, 'Voice Volume');
        },
        400
      );
      defaultVolumeSlider.addEventListener('input', () => { if (!isInitializing) debouncedVolumeSave(); });
      defaultVolumeSlider.addEventListener('change', () => {
        const voiceId = defaultVoiceDropdown?.getValue() || 'Friendly_Person';
        const vol = parseFloat(defaultVolumeSlider.value || '1.0');
        currentVoiceVolumes[voiceId] = vol;
        voiceCalibration?.updateVolumes(currentVoiceVolumes);
        saveSettingWrapper(`voiceVolumes.${voiceId}`, vol, 'Voice Volume');
      });
    }

    if (defaultLanguageSelect) defaultLanguageSelect.addEventListener('change', () => saveSettingWrapper('languageBoost', defaultLanguageSelect.value || 'Automatic', 'Default Language'));
    if (englishNormalizationCheckbox) englishNormalizationCheckbox.addEventListener('change', () => saveSettingWrapper('englishNormalization', !!englishNormalizationCheckbox.checked, 'English Normalization'));
    if (skipEmotesCheckbox) skipEmotesCheckbox.addEventListener('change', () => saveSettingWrapper('skipEmotes', !!skipEmotesCheckbox.checked, 'Skip Emotes'));
  }

  function getEffectiveTtsSettings(): Omit<TTSPayload, 'text'> {
    const voiceId = defaultVoiceDropdown?.getValue() || 'Friendly_Person';
    const emotion = defaultEmotionSelect?.value || 'auto';
    const pitch = parseInt(defaultPitchSlider?.value || '0', 10);
    const speed = parseFloat(defaultSpeedSlider?.value || '1.0');
    const volume = parseFloat(defaultVolumeSlider?.value || '1.0');
    const languageBoost = defaultLanguageSelect?.value || 'Automatic';
    return { voiceId, emotion, pitch, speed, volume, languageBoost };
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
        showToast('No preview available for this voice yet', 'info');
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
      saveSettingWrapper('pitch', 0, 'Default Pitch');
    });
    resetSpeedBtn?.addEventListener('click', () => {
      if (!defaultSpeedSlider || !speedValueSpan) return;
      defaultSpeedSlider.value = '1.0';
      speedValueSpan.textContent = '1.0';
      saveSettingWrapper('speed', 1.0, 'Default Speed');
    });
    resetVolumeBtn?.addEventListener('click', () => {
      if (!defaultVolumeSlider || !volumeValueSpan || !defaultVoiceDropdown) return;
      defaultVolumeSlider.value = '1.0';
      volumeValueSpan.textContent = '1.0';
      const voiceId = defaultVoiceDropdown.getValue() || 'Friendly_Person';
      currentVoiceVolumes[voiceId] = 1.0;
      voiceCalibration?.updateVolumes(currentVoiceVolumes);
      saveSettingWrapper(`voiceVolumes.\${voiceId}`, 1.0, 'Voice Volume');
    });

    // Load Voices
    const voicesResponse = await api.getVoices();
    const fallbackVoices = [
      'Friendly_Person', 'Professional_Woman', 'Casual_Male', 'Energetic_Youth',
      'Warm_Grandmother', 'Confident_Leader', 'Soothing_Narrator', 'Cheerful_Assistant',
      'Deep_Narrator', 'Bright_Assistant', 'Calm_Guide', 'Energetic_Host'
    ];
    allVoices = voicesResponse.voices && voicesResponse.voices.length > 0 ? voicesResponse.voices : fallbackVoices;

    // Init Default Voice Dropdown
    defaultVoiceDropdown = new VoiceDropdown({
      containerId: 'default',
      onSelect: (voiceId) => {
        if (!isInitializing) updateVolumeSlider(voiceId);
        saveSettingWrapper('voiceId', voiceId, 'Default Voice');
        // Clear preview cache if voice changed
        const hintEl = document.getElementById('voice-preview-hint');
        if (hintEl) hintEl.style.display = 'block';
      },
      onPlaySample: playVoiceSample
    });
    defaultVoiceDropdown.setVoices(allVoices);

    // Init Calibration Dropdown
    calibrationVoiceDropdown = new VoiceDropdown({
      containerId: 'calibration',
      onSelect: () => { }, // Handled by VoiceCalibration wrapper usually, but VoiceCalibration sets logic?
      // Actually VoiceCalibration doesn't control the dropdown selection event, the dropdown does.
      // VoiceCalibration only listens to clicks on "Edit" in the list, which sets the dropdown value programmatically.
      // But user CAN select from dropdown manually to calibrate.
      // So we need a callback here to update the slider to the selected voice's current volume.
    });
    calibrationVoiceDropdown.setVoices(allVoices);

    // Init Voice Calibration
    voiceCalibration = new VoiceCalibration({
      voiceDropdown: calibrationVoiceDropdown,
      currentVoiceVolumes: currentVoiceVolumes,
      onSave: async (voiceId, volume) => {
        await api.saveTtsSetting(getChannelName() || '', `voiceVolumes.${voiceId}`, volume);
        maybeSuccessToast('Saved');
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

    // Fix Calibration Dropdown onSelect
    // We need to inject the logic to update slider when user picks a voice from list
    // But VoiceDropdown is already created. We passed an empty onSelect.
    // We can't change it easily unless we expose a setter or recreate.
    // Wait, VoiceDropdown just calls `this.onSelect(voice)`.
    // I should have passed the logic in the constructor.
    // Let's create a wrapper function.
    const handleCalibrationVoiceSelect = (voiceId: string) => {
      voiceCalibration?.selectVoice(voiceId); // Re-use selectVoice to update slider state
    };
    // Re-create or hack?
    // JS class properties are mutable.
    (calibrationVoiceDropdown as any).onSelect = handleCalibrationVoiceSelect;

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
      if (!username) { showToast('Please enter a username', 'warning'); return; }

      lookupBtn.disabled = true;
      const originalBtnText = lookupBtn.textContent;
      lookupBtn.textContent = 'Searching...';
      lookupResult.style.display = 'none';
      lookupResult.className = 'mt-3';

      try {
        const data = await api.lookupUserVoice(username);
        lookupResult.style.display = 'block';
        if (data.voiceId) {
          lookupResult.className = 'mt-3 alert alert-success';
          lookupResult.innerHTML = `<div>User <strong>${data.username}</strong> has set custom voice: <strong>${data.voiceId}</strong></div>`;

          if (allVoices.includes(data.voiceId)) {
            const calibrateBtn = document.createElement('button');
            calibrateBtn.className = 'btn btn-sm btn-success mt-2';
            calibrateBtn.textContent = `Calibrate "${formatVoiceName(data.voiceId)}"`;
            calibrateBtn.onclick = () => {
              voiceCalibration?.selectVoice(data.voiceId!);
            };
            lookupResult.appendChild(calibrateBtn);
          } else {
            const warning = document.createElement('div');
            warning.className = 'text-warning small mt-1';
            warning.textContent = 'This voice ID is not in the current available list.';
            lookupResult.appendChild(warning);
          }
        } else {
          lookupResult.className = 'mt-3 alert alert-info';
          lookupResult.textContent = `User ${data.username} has not set a custom voice.`;
        }
      } catch (e) {
        const err = e as Error;
        lookupResult.style.display = 'block';
        lookupResult.className = 'mt-3 alert alert-danger';
        lookupResult.textContent = `Error: ${err.message}`;
      } finally {
        lookupBtn.disabled = false;
        lookupBtn.textContent = originalBtnText || 'Lookup Voice';
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
        languageBoost: 'Automatic',
        englishNormalization: false,
        ignoredUsers: ['spammer1', 'troll2']
      };
      applyTtsSettings(demoTts);
      displayIgnoreList('tts', demoTts.ignoredUsers || []);
      return;
    }

    const response = await api.getSettings(user.login);
    if ('error' in response) {
      showToast(`Failed to load settings: ${response.error}`, 'error');
      return;
    }

    if ('settings' in response) {
      applyTtsSettings(response.settings || {});
      displayIgnoreList('tts', response.settings?.ignoredUsers || []);
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
    if (allowViewerPreferencesCheckbox) allowViewerPreferencesCheckbox.checked = settings.allowViewerPreferences !== false;
    if (readFullUrlsCheckbox) readFullUrlsCheckbox.checked = settings.readFullUrls || false;
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

    if (defaultLanguageSelect) defaultLanguageSelect.value = settings.languageBoost || 'Automatic';
    if (englishNormalizationCheckbox) englishNormalizationCheckbox.checked = settings.englishNormalization || false;
    if (skipEmotesCheckbox) skipEmotesCheckbox.checked = settings.skipEmotes || false;
  }
}
