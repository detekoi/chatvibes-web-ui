import { showToast } from '../common/ui.js';
import { apiErrorMessage, displayError, fillLanguageSelect, languageBoostOptions, t } from '../common/i18n.js';
import { debounce } from '../common/utils.js';
import { performVoiceTest, TTSPayload, PlayerElements, HintElements } from '../common/voice-preview.js';
import { VoicePicker } from '../common/voice-picker.js';
import { buildVoiceCatalog, languageName, loadVoiceCatalog, type VoiceCatalog } from '../common/voice-catalog.js';
import {
  CUSTOM_EMOTION, SOUND_TAGS, STYLE_MAX_LENGTH, VALID_EMOTIONS,
  createStepControl, emotionLabel, stepLabel, type StepControl,
} from '../common/tts-options.js';
import { DashboardServices, TtsSettings } from './types.js';
import { SettingsApi } from './services/settings-api.js';
import { VoiceCalibration } from './components/voice-calibration.js';
import type { StoredIgnoreValue } from '../common/ignoreEntries.js';
import type { StoredMutedRewardValue } from './muted-rewards.js';

const previewState = {
  cachedAudioUrl: null as string | null,
};

export interface SettingsModuleContext {
  apiPrefix: string;
  testMode: boolean;
}

export interface SettingsModuleDependencies {
  displayIgnoreList: (type: 'tts', entries: Record<string, StoredIgnoreValue>) => void;
  displayBannedWords: (words: string[]) => void;
  displayPronunciations: (entries: Record<string, string>) => void;
  displayMutedRewards: (muted: Record<string, StoredMutedRewardValue>, ttsRewardId?: string | null) => void;
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
  const defaultStyleGroup = document.getElementById('default-style-group') as HTMLElement | null;
  const defaultStyleInput = document.getElementById('default-style') as HTMLInputElement | null;
  const defaultStyleCount = document.getElementById('default-style-count') as HTMLElement | null;
  const soundTagsList = document.getElementById('sound-tags-list') as HTMLElement | null;
  const defaultVolumeSlider = document.getElementById('default-volume') as HTMLInputElement | null;
  const volumeValueSpan = document.getElementById('volume-value') as HTMLSpanElement | null;
  const resetVolumeBtn = document.getElementById('reset-volume-btn') as HTMLButtonElement | null;
  const defaultLanguageSelect = document.getElementById('default-language') as HTMLSelectElement | null;

  if (defaultLanguageSelect) {
    fillLanguageSelect(defaultLanguageSelect);
  }
  const emoteModeSelect = document.getElementById('emote-mode') as HTMLSelectElement | null;

  const ttsEnabledCheckbox = document.getElementById('tts-enabled') as HTMLInputElement | null;
  const botRespondsInChatCheckbox = document.getElementById('bot-responds-in-chat') as HTMLInputElement | null;
  const ttsModeSelect = document.getElementById('tts-mode') as HTMLSelectElement | null;
  const ttsModeSummaries = document.querySelectorAll<HTMLElement>('[data-tts-mode-summary]');
  const ttsPermissionSelect = document.getElementById('tts-permission') as HTMLSelectElement | null;
  const eventsEnabledCheckbox = document.getElementById('events-enabled') as HTMLInputElement | null;
  const allowViewerPreferencesCheckbox = document.getElementById('allow-viewer-preferences') as HTMLInputElement | null;
  const readFullUrlsCheckbox = document.getElementById('read-full-urls') as HTMLInputElement | null;
  const pronunciationEnabledCheckbox = document.getElementById('pronunciation-enabled') as HTMLInputElement | null;
  const profanityFilterCheckbox = document.getElementById('profanity-filter-enabled') as HTMLInputElement | null;
  const readCheerMessagesCheckbox = document.getElementById('read-cheer-messages') as HTMLInputElement | null;
  const readCheerMessagesModeNote = document.getElementById('read-cheer-messages-mode-note') as HTMLElement | null;
  const bitsAmountInput = document.getElementById('bits-amount') as HTMLInputElement | null;
  let lastStoredReadCheerMessages = true;
  const readCommandMessagesCheckbox = document.getElementById('read-command-messages') as HTMLInputElement | null;
  const readCommandMessagesModeNote = document.getElementById('read-command-messages-mode-note') as HTMLElement | null;
  let lastStoredReadCommandMessages = true;
  const anonymizeFollowersCheckbox = document.getElementById('anonymize-followers') as HTMLInputElement | null;

  // YouTube integration elements
  const youtubeEnabledCheckbox = document.getElementById('youtube-enabled') as HTMLInputElement | null;
  const youtubeHandleInput = document.getElementById('youtube-handle') as HTMLInputElement | null;

  const saveSettingsBtn = document.getElementById('save-settings-btn') as HTMLButtonElement | null;

  const voiceTestTextInput = document.getElementById('voice-test-text') as HTMLTextAreaElement | null;
  const voiceTestBtn = document.getElementById('voice-test-btn') as HTMLButtonElement | null;

  if (voiceTestBtn) voiceTestBtn.disabled = true;

  let isInitializing = true;
  let lastSuccessToastAt = 0;
  let settingsInitializedPromiseResolve: (() => void) | undefined;
  const settingsInitializedPromise = new Promise<void>((resolve) => {
    settingsInitializedPromiseResolve = resolve;
  });

  let catalog: VoiceCatalog = buildVoiceCatalog([]);
  let currentVoiceVolumes: Record<string, number> = {};
  // The emotion and the style as the server holds them. The server clears the
  // style when it saves an emotion, and a style that is not empty replaces the
  // emotion. The select shows Custom while the style is not empty.
  let storedEmotion = 'neutral';
  let storedStyle = '';
  let disabledSoundTags = new Set<string>();

  // Components
  let defaultVoiceDropdown: VoicePicker | null = null;
  let calibrationVoiceDropdown: VoicePicker | null = null;
  let voiceCalibration: VoiceCalibration | null = null;
  let pitchControl: StepControl | null = null;
  let speedControl: StepControl | null = null;

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

  /** Save one setting. A failure ends in a toast. Resolves to true when the server holds the value. */
  async function saveSettingWrapper(key: string, value: any, label: string): Promise<boolean> {
    if (isInitializing) return false;
    const channelName = getChannelName();
    if (testMode) {
      maybeSuccessToast(t('msg.action.saved'));
      return true;
    }
    if (!channelName) {
      showToast(t('msg.auth.signedOut'), 'error');
      return false;
    }
    try {
      await api.saveTtsSetting(channelName, key, value);
      maybeSuccessToast(t('msg.action.saved'));
      return true;
    } catch (e) {
      const err = e as Error;
      showToast(t('msg.settings.saveFailed', { label, reason: displayError(err) }), 'error');
      return false;
    }
  }

  // The emotion and the style are one choice, and the server removes the style
  // when it saves an emotion. Their saves go out one at a time, in the order of
  // the clicks: with two requests in flight, a style that arrives after the
  // emotion stays stored and replaces it.
  let emotionSaveQueue: Promise<unknown> = Promise.resolve();
  function saveEmotionOrStyle(key: 'emotion' | 'style', value: string, label: string): Promise<boolean> {
    const run = emotionSaveQueue.then(() => saveSettingWrapper(key, value, label));
    emotionSaveQueue = run;
    return run;
  }

  /** The voice that the channel uses: the stored one, else the default that the API reports. */
  function currentVoiceId(): string {
    return defaultVoiceDropdown?.getValue() || catalog.defaultVoiceId;
  }

  function saveVoiceVolume(vol: number): void {
    const voiceId = currentVoiceId();
    // No stored voice and no catalog: there is no ID to key the volume by.
    if (!voiceId) return;
    currentVoiceVolumes[voiceId] = vol;
    voiceCalibration?.updateVolumes(currentVoiceVolumes); // Sync calibration component
    saveSettingWrapper(`voiceVolumes.${voiceId}`, vol, t('msg.setting.voiceVolume'));
  }

  function currentStyle(): string {
    if (defaultEmotionSelect?.value !== CUSTOM_EMOTION) return '';
    return (defaultStyleInput?.value || '').trim().slice(0, STYLE_MAX_LENGTH);
  }

  function updateStyleCount(): void {
    if (!defaultStyleCount) return;
    defaultStyleCount.textContent = t('msg.style.count', {
      count: (defaultStyleInput?.value || '').length,
      max: STYLE_MAX_LENGTH,
    });
  }

  function showEmotionAndStyle(): void {
    if (defaultEmotionSelect) defaultEmotionSelect.value = storedStyle ? CUSTOM_EMOTION : storedEmotion;
    if (defaultStyleInput) defaultStyleInput.value = storedStyle;
    if (defaultStyleGroup) defaultStyleGroup.hidden = !storedStyle;
    updateStyleCount();
  }

  function saveStyle(): void {
    const style = currentStyle();
    if (style === storedStyle) return;
    const previous = storedStyle;
    storedStyle = style;
    updateSidebarPreview();
    void saveEmotionOrStyle('style', style, t('msg.setting.style')).then((saved) => {
      // A newer change owns the value now.
      if (saved || storedStyle !== style) return;
      // The server still holds the previous style. The text stays in the box, so
      // that the next blur sends it again.
      storedStyle = previous;
      // A style that was not removed is still the one that applies: show it again.
      if (!style) showEmotionAndStyle();
      updateSidebarPreview();
    });
  }

  function renderSoundTags(): void {
    if (!soundTagsList) return;
    soundTagsList.replaceChildren();
    for (const tag of SOUND_TAGS) {
      const label = document.createElement('label');
      label.className = 'sound-tag';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.className = 'form-check-input';
      input.checked = !disabledSoundTags.has(tag);
      input.addEventListener('change', () => {
        if (input.checked) disabledSoundTags.delete(tag);
        else disabledSoundTags.add(tag);
        // Catalog order, so the stored array does not depend on the click order.
        saveSettingWrapper('disabledSoundTags', SOUND_TAGS.filter(name => disabledSoundTags.has(name)), t('msg.setting.soundTags'));
      });
      // Tag names are what the viewer types, so they are not translated.
      const name = document.createElement('code');
      name.textContent = `<${tag}>`;
      label.append(input, name);
      soundTagsList.appendChild(label);
    }
  }

  function updateVolumeSlider(voiceId: string): void {
    if (!defaultVolumeSlider || !volumeValueSpan) return;
    const raw = currentVoiceVolumes[voiceId] ?? 1.0;
    const vol = Number.isFinite(raw) ? Math.min(2.0, Math.max(0.1, raw)) : 1.0;
    defaultVolumeSlider.value = String(vol);
    volumeValueSpan.textContent = defaultVolumeSlider.value;
  }

  function setupAutoSaveListeners(): void {
    if (ttsEnabledCheckbox) ttsEnabledCheckbox.addEventListener('change', () => saveSettingWrapper('engineEnabled', !!ttsEnabledCheckbox.checked, t('msg.setting.ttsEngine')));
    if (botRespondsInChatCheckbox) botRespondsInChatCheckbox.addEventListener('change', () => saveSettingWrapper('botRespondsInChat', !!botRespondsInChatCheckbox.checked, t('msg.setting.botRespondsInChat')));
    if (ttsModeSelect) ttsModeSelect.addEventListener('change', () => {
      saveSettingWrapper('mode', ttsModeSelect.value || 'command', t('msg.setting.ttsMode'));
      syncTtsModeSummary();
      syncReadCheerMessagesToMode();
      syncReadCommandMessagesToMode();
    });
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
    if (readCheerMessagesCheckbox) readCheerMessagesCheckbox.addEventListener('change', () => {
      lastStoredReadCheerMessages = readCheerMessagesCheckbox.checked !== false;
      saveSettingWrapper('readCheerMessages', lastStoredReadCheerMessages, t('msg.setting.readCheerMessages'));
    });
    if (readCommandMessagesCheckbox) readCommandMessagesCheckbox.addEventListener('change', () => {
      lastStoredReadCommandMessages = readCommandMessagesCheckbox.checked !== false;
      saveSettingWrapper('readCommandMessages', lastStoredReadCommandMessages, t('msg.setting.readCommandMessages'));
    });
    if (bitsAmountInput) {
      const debouncedBitsAmountSave = debounce(
        () => saveSettingWrapper('bitsMinimumAmount', Math.max(1, parseInt(bitsAmountInput.value || '1', 10) || 1), t('msg.setting.minimumBits')),
        600
      );
      bitsAmountInput.addEventListener('input', () => { if (!isInitializing) debouncedBitsAmountSave(); });
      bitsAmountInput.addEventListener('change', () => saveSettingWrapper('bitsMinimumAmount', Math.max(1, parseInt(bitsAmountInput.value || '1', 10) || 1), t('msg.setting.minimumBits')));
    }

    // While the reader types, an empty box is a step on the way to new text. Do not save it.
    const debouncedStyleSave = debounce(() => { if (currentStyle()) saveStyle(); }, 800);

    if (defaultEmotionSelect) defaultEmotionSelect.addEventListener('change', () => {
      // The choice is made. A style save that still waits would undo it.
      debouncedStyleSave.cancel();
      if (defaultEmotionSelect.value === CUSTOM_EMOTION) {
        // Nothing to save until there is text: an empty style means that the emotion applies.
        if (defaultStyleGroup) defaultStyleGroup.hidden = false;
        updateStyleCount();
        defaultStyleInput?.focus();
      } else {
        const previousEmotion = storedEmotion;
        const previousStyle = storedStyle;
        const emotion = defaultEmotionSelect.value || 'neutral';
        storedEmotion = emotion;
        storedStyle = '';
        showEmotionAndStyle();
        void saveEmotionOrStyle('emotion', emotion, t('msg.setting.defaultEmotion')).then((saved) => {
          // A newer change owns the values now.
          if (saved || storedEmotion !== emotion || storedStyle !== '') return;
          storedEmotion = previousEmotion;
          storedStyle = previousStyle;
          showEmotionAndStyle();
          updateSidebarPreview();
        });
      }
      updateSidebarPreview();
    });

    if (defaultStyleInput) {
      defaultStyleInput.maxLength = STYLE_MAX_LENGTH;
      defaultStyleInput.addEventListener('input', () => {
        updateStyleCount();
        if (!isInitializing) debouncedStyleSave();
      });
      defaultStyleInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') defaultStyleInput.blur(); });
      defaultStyleInput.addEventListener('blur', (e) => {
        debouncedStyleSave.cancel();
        saveStyle();
        // An empty style means that the emotion applies, so show the emotion again.
        // Not while the reader opens the emotion list, which this would change under them.
        if (!storedStyle && (e as FocusEvent).relatedTarget !== defaultEmotionSelect) showEmotionAndStyle();
        updateSidebarPreview();
      });
    }

    if (defaultVolumeSlider) {
      const debouncedVolumeSave = debounce(() => saveVoiceVolume(parseFloat(defaultVolumeSlider.value || '1.0')), 400);
      defaultVolumeSlider.addEventListener('input', () => { if (!isInitializing) debouncedVolumeSave(); updateSidebarPreview(); });
      defaultVolumeSlider.addEventListener('change', () => saveVoiceVolume(parseFloat(defaultVolumeSlider.value || '1.0')));
    }

    if (defaultLanguageSelect) defaultLanguageSelect.addEventListener('change', () => { saveSettingWrapper('languageBoost', defaultLanguageSelect.value || 'auto', t('msg.setting.defaultLanguage')); updateSidebarPreview(); });
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

  // Cheers and the Channel Points reward are read in every mode; the mode only
  // decides which unpaid chat is read, so the line under the select spells out
  // what the selected one reads. Matched on the option value, never its label.
  function syncTtsModeSummary(): void {
    const mode = ttsModeSelect?.value;
    ttsModeSummaries.forEach((el) => { el.hidden = el.dataset.ttsModeSummary !== mode; });
  }

  // bits_points_only always reads cheer messages (that is what the mode is
  // for), so the toggle is shown on and locked there rather than offering a
  // switch that would do nothing. The stored value is left alone, so the
  // channel's choice comes back when it changes mode again.
  function syncReadCheerMessagesToMode(): void {
    if (!readCheerMessagesCheckbox) return;
    const locked = ttsModeSelect?.value === 'bits_points_only';
    readCheerMessagesCheckbox.disabled = locked;
    if (locked) readCheerMessagesCheckbox.checked = true;
    else readCheerMessagesCheckbox.checked = lastStoredReadCheerMessages;
    if (readCheerMessagesModeNote) readCheerMessagesModeNote.hidden = !locked;
  }

  // The mirror image for chat commands: only All Chat mode ever reads a
  // "!"-prefixed message, so in every other mode the switch is shown off
  // and locked. The stored value is kept, as above.
  function syncReadCommandMessagesToMode(): void {
    if (!readCommandMessagesCheckbox) return;
    const locked = ttsModeSelect?.value !== 'all';
    readCommandMessagesCheckbox.disabled = locked;
    if (locked) readCommandMessagesCheckbox.checked = false;
    else readCommandMessagesCheckbox.checked = lastStoredReadCommandMessages;
    if (readCommandMessagesModeNote) readCommandMessagesModeNote.hidden = !locked;
  }

  function getEffectiveTtsSettings(): Omit<TTSPayload, 'text'> {
    const style = currentStyle();
    return {
      voiceId: currentVoiceId() || undefined,
      emotion: storedEmotion,
      style,
      pitch: pitchControl?.getValue() ?? 0,
      speed: speedControl?.getValue() ?? 1.0,
      volume: parseFloat(defaultVolumeSlider?.value || '1.0'),
      languageBoost: defaultLanguageSelect?.value || 'auto',
    };
  }

  function updateSidebarPreview(): void {
    const { voiceId, emotion, style, pitch, speed, volume, languageBoost } = getEffectiveTtsSettings();

    const voiceNameEl = document.getElementById('sidebar-voice-name');
    const pitchValEl = document.getElementById('sidebar-pitch-val');
    const speedValEl = document.getElementById('sidebar-speed-val');
    const volumeValEl = document.getElementById('sidebar-volume-val');
    const emotionValEl = document.getElementById('sidebar-emotion-val');
    const languageValEl = document.getElementById('sidebar-language-val');

    if (voiceNameEl) voiceNameEl.textContent = catalog.displayName(voiceId) || '—';
    // These overwrite markup that has already been translated, so they have to
    // be translated too -- capitalizing the raw enum value put an English word
    // back into every locale's sidebar.
    if (pitchValEl) pitchValEl.textContent = stepLabel('pitch', pitch);
    if (speedValEl) speedValEl.textContent = stepLabel('speed', speed);
    if (volumeValEl) volumeValEl.textContent = (volume ?? 1).toFixed(1);
    if (emotionValEl) emotionValEl.textContent = emotionLabel(emotion, style);
    if (languageValEl) {
      // The endonym, matching both language pickers, rather than the English
      // name the `languageBoost` enum happens to use.
      const named = languageBoostOptions().find(o => o.value === languageBoost);
      languageValEl.textContent = languageBoost === 'auto'
        ? t('msg.lang.automatic')
        : (named?.label ?? languageBoost ?? '');
    }
  }

  function attachVoicePreview(): void {
    const playerEl = document.getElementById('voice-preview-player') as HTMLElement | null;
    const sourceEl = document.getElementById('voice-preview-source') as HTMLSourceElement | null;
    const hintEl = document.getElementById('voice-preview-hint') as HTMLElement | null;

    const testVoice = async (): Promise<void> => {
      await settingsInitializedPromise;
      const text = voiceTestTextInput?.value?.trim() || '';

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
      const playerElements: PlayerElements = { playerEl, sourceEl };
      const hintElements: HintElements = { hintEl };

      const onAudioGenerated = (audioUrl: string): void => {
        if (previewState.cachedAudioUrl) URL.revokeObjectURL(previewState.cachedAudioUrl);
        previewState.cachedAudioUrl = audioUrl;
      };

      await performVoiceTest(payload, [voiceTestBtn], { playerElements, hintElements, onAudioGenerated });
    };

    if (voiceTestBtn) voiceTestBtn.addEventListener('click', () => void testVoice());

    // Watch for changes that invalidate preview. The voice picker and the step
    // controls call markPreviewStale from their own callbacks.
    defaultEmotionSelect?.addEventListener('change', markPreviewStale);
    defaultStyleInput?.addEventListener('change', markPreviewStale);
    defaultVolumeSlider?.addEventListener('change', markPreviewStale);
    defaultLanguageSelect?.addEventListener('change', markPreviewStale);

    window.addEventListener('beforeunload', () => {
      if (previewState.cachedAudioUrl) URL.revokeObjectURL(previewState.cachedAudioUrl);
    });
  }

  function markPreviewStale(): void {
    const hintEl = document.getElementById('voice-preview-hint');
    if (hintEl && previewState.cachedAudioUrl) hintEl.style.display = 'block';
  }

  async function initializeSettingsPanel(): Promise<void> {
    if (defaultVolumeSlider && volumeValueSpan) {
      defaultVolumeSlider.addEventListener('input', () => { volumeValueSpan.textContent = defaultVolumeSlider.value; });
    }

    // Pitch and speed: five steps each, stored as the same numbers as before.
    pitchControl = createStepControl(document.getElementById('default-pitch'), 'pitch', (value) => {
      saveSettingWrapper('pitch', value, t('msg.setting.defaultPitch'));
      markPreviewStale();
      updateSidebarPreview();
    });
    speedControl = createStepControl(document.getElementById('default-speed'), 'speed', (value) => {
      saveSettingWrapper('speed', value, t('msg.setting.defaultSpeed'));
      markPreviewStale();
      updateSidebarPreview();
    });
    pitchControl.setValue(0);
    speedControl.setValue(1.0);
    renderSoundTags();

    // Reset Buttons
    resetVolumeBtn?.addEventListener('click', () => {
      if (!defaultVolumeSlider || !volumeValueSpan) return;
      defaultVolumeSlider.value = '1.0';
      volumeValueSpan.textContent = '1.0';
      saveVoiceVolume(1.0);
      updateSidebarPreview();
    });

    // Load the voice catalog. A failed load leaves it empty: the page still
    // works, and a stored voice shows as a legacy voice.
    catalog = await loadVoiceCatalog(`${apiPrefix}/voices`, { demoFallback: testMode });

    defaultVoiceDropdown = new VoicePicker({
      root: document.getElementById('default-voice-picker'),
      labelId: 'default-voice-label',
      onSelect: (voiceId) => {
        if (!isInitializing) updateVolumeSlider(voiceId);
        saveSettingWrapper('voiceId', voiceId, t('msg.setting.defaultVoice'));
        markPreviewStale();
        updateSidebarPreview();
      },
    });
    defaultVoiceDropdown.setCatalog(catalog);

    // Init Calibration picker. VoiceCalibration only handles "Edit" clicks in
    // the list, which set the picker value programmatically — picking a voice
    // from the picker directly has to update the slider itself. voiceCalibration
    // is assigned just below and the callback only fires on user interaction.
    calibrationVoiceDropdown = new VoicePicker({
      root: document.getElementById('calibration-voice-picker'),
      labelId: 'calibration-voice-label',
      onSelect: (voiceId) => voiceCalibration?.selectVoice(voiceId),
    });
    calibrationVoiceDropdown.setCatalog(catalog);

    // Init Voice Calibration
    voiceCalibration = new VoiceCalibration({
      voiceDropdown: calibrationVoiceDropdown,
      voiceName: describeVoice,
      currentVoiceVolumes: currentVoiceVolumes,
      onSave: async (voiceId, volume) => {
        await api.saveTtsSetting(getChannelName() || '', `voiceVolumes.${voiceId}`, volume);
        maybeSuccessToast(t('msg.action.saved'));
        // If this is also the default voice, update the main slider too
        if (currentVoiceId() === voiceId && defaultVolumeSlider) {
          defaultVolumeSlider.value = String(volume);
          if (volumeValueSpan) volumeValueSpan.textContent = String(volume);
          updateSidebarPreview();
        }
      },
      onReset: async (voiceId) => {
        await api.saveTtsSetting(getChannelName() || '', `voiceVolumes.${voiceId}`, 1.0);
        maybeSuccessToast(t('msg.action.saved'));
        if (currentVoiceId() === voiceId && defaultVolumeSlider) {
          defaultVolumeSlider.value = '1.0';
          if (volumeValueSpan) volumeValueSpan.textContent = '1.0';
          updateSidebarPreview();
        }
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

    settingsInitializedPromiseResolve?.();
  }

  /**
   * A voice name that tells two voices with the same name apart: display names
   * repeat across languages. An ID that is not in the catalog shows as a legacy voice.
   */
  function describeVoice(voiceId: string): string {
    const voice = catalog.get(voiceId);
    return voice ? `${voice.name} (${languageName(voice.language)})` : catalog.displayName(voiceId);
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
          summary.textContent = t('msg.lookup.hasVoice', { user: data.username, voice: describeVoice(data.voiceId) });
          lookupResult.replaceChildren(summary);

          // The record can still hold a MiniMax ID. `voiceId` is the Gemini
          // voice that the bot speaks with, and that is the one to calibrate.
          if (data.storedVoiceId) {
            const stored = document.createElement('div');
            stored.className = 'small mt-1';
            stored.textContent = t('msg.lookup.storedVoice', { stored: data.storedVoiceId });
            lookupResult.appendChild(stored);
          }

          const voice = catalog.get(data.voiceId);
          if (voice) {
            const calibrateBtn = document.createElement('button');
            calibrateBtn.className = 'btn btn-sm btn-success mt-2';
            calibrateBtn.textContent = t('msg.lookup.calibrate', { voice: voice.name });
            calibrateBtn.onclick = () => {
              voiceCalibration?.selectVoice(voice.id);
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
        readCheerMessages: true,
        readCommandMessages: true,
        bitsMinimumAmount: 1,
        voiceId: catalog.defaultVoiceId,
        emotion: 'neutral',
        style: '',
        pitch: 0,
        speed: 1.0,
        languageBoost: 'auto',
        disabledSoundTags: ['scream'],
        // One of each shape, so test mode exercises both provenance badges: a
        // viewer who opted out themselves and someone the broadcaster muted.
        ignoredUserIds: {
          'twitch:52343457': { label: 'Spammer1', source: 'moderator', by: 'twitch:1', at: null },
          'twitch:19571641': { label: 'Troll2', source: 'self', by: 'twitch:19571641', at: null },
        },
        pronunciationEnabled: true,
        profanityFilterEnabled: false,
        pronunciations: { wcat: 'wildcat', lfg: '' },
        mutedRewardIds: { 'demo-horn': { title: 'Air Horn', by: null, at: null } },
      };
      applyTtsSettings(demoTts);
      displayIgnoreList('tts', demoTts.ignoredUserIds || {});
      dependencies.displayBannedWords(['testbadword', 'naughtyword']);
      dependencies.displayPronunciations(demoTts.pronunciations || {});
      dependencies.displayMutedRewards(demoTts.mutedRewardIds || {}, null);
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
      dependencies.displayMutedRewards(response.settings?.mutedRewardIds || {}, response.settings?.channelPoints?.rewardId || null);
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
    syncTtsModeSummary();
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
    // On unless the channel turned it off, matching the bot's default.
    lastStoredReadCheerMessages = settings.readCheerMessages !== false;
    syncReadCheerMessagesToMode();
    lastStoredReadCommandMessages = settings.readCommandMessages !== false;
    syncReadCommandMessagesToMode();
    if (bitsAmountInput) bitsAmountInput.value = String(Math.max(1, Number(settings.bitsMinimumAmount) || 1));

    // A channel that never chose a voice uses the default that the API reports.
    // An ID that is not in the catalog stays as it is and shows as a legacy voice.
    defaultVoiceDropdown?.setValue(settings.voiceId || catalog.defaultVoiceId);

    // "auto" and any other value that is not a preset read as neutral, as on the server.
    storedEmotion = (VALID_EMOTIONS as readonly string[]).includes(settings.emotion || '') ? settings.emotion! : 'neutral';
    storedStyle = (settings.style || '').trim();
    showEmotionAndStyle();
    pitchControl?.setValue(settings.pitch ?? 0);
    speedControl?.setValue(settings.speed ?? 1.0);

    disabledSoundTags = new Set(Array.isArray(settings.disabledSoundTags) ? settings.disabledSoundTags : []);
    renderSoundTags();

    const voiceId = currentVoiceId();
    if (voiceId) updateVolumeSlider(voiceId);

    // Channels saved before the dropdown used "auto" still store the old
    // "Automatic"/"None" spellings; map them so the right option stays selected.
    if (defaultLanguageSelect) {
      const stored = settings.languageBoost || 'auto';
      defaultLanguageSelect.value = (stored === 'Automatic' || stored === 'None') ? 'auto' : stored;
    }
    if (emoteModeSelect) emoteModeSelect.value = settings.emoteMode || 'describe';

    // YouTube integration
    if (youtubeEnabledCheckbox) youtubeEnabledCheckbox.checked = settings.youtubeEnabled || false;
    if (youtubeHandleInput) youtubeHandleInput.value = settings.youtubeHandle || '';

    updateSidebarPreview();
  }
}
