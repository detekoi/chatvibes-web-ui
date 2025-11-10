import { fetchWithAuth } from "../common/api.js";
import { showToast, syncTextareas } from "../common/ui.js";
import { formatNumberCompact, formatVoiceName } from "../common/utils.js";
import { performVoiceTest } from "../common/voice-preview.js";
import { getLanguageExample } from "../common/language-examples.js";
function initPreferencesModule(context, services, deps = {}) {
  const { apiBaseUrl, testMode } = context;
  const { getCurrentChannel } = services;
  const { onPreferencesLoaded } = deps;
  const elements = {
    voiceSelect: document.getElementById("voice-select"),
    voiceSearch: document.getElementById("voice-search"),
    voiceDropdown: document.getElementById("voice-dropdown"),
    voiceMenu: document.getElementById("voice-menu"),
    pitchSlider: document.getElementById("pitch-slider"),
    pitchValue: document.getElementById("pitch-value"),
    speedSlider: document.getElementById("speed-slider"),
    speedValue: document.getElementById("speed-value"),
    emotionSelect: document.getElementById("emotion-select"),
    languageSelect: document.getElementById("language-select"),
    voiceReset: document.getElementById("voice-reset"),
    pitchReset: document.getElementById("pitch-reset"),
    speedReset: document.getElementById("speed-reset"),
    emotionReset: document.getElementById("emotion-reset"),
    languageReset: document.getElementById("language-reset"),
    englishNormalizationCheckbox: document.getElementById("english-normalization-checkbox"),
    englishNormalizationReset: document.getElementById("english-normalization-reset"),
    hintVoice: document.getElementById("hint-voice"),
    hintPitch: document.getElementById("hint-pitch"),
    hintSpeed: document.getElementById("hint-speed"),
    hintEmotion: document.getElementById("hint-emotion"),
    hintLanguage: document.getElementById("hint-language"),
    hintEnglishNorm: document.getElementById("hint-englishNormalization"),
    previewText: document.getElementById("preview-text"),
    previewBtn: document.getElementById("preview-btn"),
    previewTextMobile: document.getElementById("preview-text-mobile"),
    previewBtnMobile: document.getElementById("preview-btn-mobile"),
    previewPlayer: document.getElementById("voice-preview-player"),
    previewPlayerMobile: document.getElementById("voice-preview-player-mobile"),
    previewSource: document.getElementById("voice-preview-source"),
    previewSourceMobile: document.getElementById("voice-preview-source-mobile"),
    previewHint: document.getElementById("voice-preview-hint"),
    previewHintMobile: document.getElementById("voice-preview-hint-mobile"),
    prefsDisabledNote: document.getElementById("prefs-disabled-note")
  };
  const state = {
    availableVoices: [],
    currentPreferences: {},
    cachedAudioUrl: null,
    cachedSettings: null,
    isDirty: false,
    currentlyPlayingAudio: null,
    currentlyPlayingVoiceId: null
  };
  syncTextareas(elements.previewText, elements.previewTextMobile);
  attachSliderOutputs();
  attachResetButtons();
  attachPreferenceSaves();
  attachPreviewHandlers();
  function updatePreviewTextForLanguage() {
    const selectedLanguage = elements.languageSelect?.value || "";
    const exampleText = getLanguageExample(selectedLanguage, "viewer");
    if (elements.previewText) {
      elements.previewText.value = exampleText;
    }
    if (elements.previewTextMobile) {
      elements.previewTextMobile.value = exampleText;
    }
  }
  return {
    async loadVoices() {
      await loadVoices();
    },
    async loadPreferences() {
      const info = await loadPreferences();
      onPreferencesLoaded?.(info);
      return info;
    },
    clearCachedAudio,
    getCurrentPreferences: () => state.currentPreferences
  };
  function attachSliderOutputs() {
    if (elements.pitchSlider && elements.pitchValue) {
      elements.pitchSlider.addEventListener("input", () => {
        if (elements.pitchSlider && elements.pitchValue) {
          elements.pitchValue.textContent = elements.pitchSlider.value;
        }
      });
    }
    if (elements.speedSlider && elements.speedValue) {
      elements.speedSlider.addEventListener("input", () => {
        if (elements.speedSlider && elements.speedValue) {
          elements.speedValue.textContent = Number(elements.speedSlider.value).toFixed(2);
        }
      });
    }
  }
  function attachResetButtons() {
    const { voiceReset, pitchReset, speedReset, emotionReset, languageReset, englishNormalizationReset, englishNormalizationCheckbox } = elements;
    if (voiceReset) voiceReset.addEventListener("click", () => resetPreference("voiceId", elements.voiceSelect, ""));
    if (pitchReset) pitchReset.addEventListener("click", () => resetPreference("pitch", elements.pitchSlider, 0));
    if (speedReset) speedReset.addEventListener("click", () => resetPreference("speed", elements.speedSlider, 1));
    if (emotionReset) emotionReset.addEventListener("click", () => resetPreference("emotion", elements.emotionSelect, ""));
    if (languageReset) languageReset.addEventListener("click", () => resetPreference("language", elements.languageSelect, ""));
    if (englishNormalizationReset && englishNormalizationCheckbox) {
      englishNormalizationReset.addEventListener("click", () => resetPreference("englishNormalization", englishNormalizationCheckbox, false));
    }
  }
  function attachPreferenceSaves() {
    const {
      voiceSelect,
      pitchSlider,
      speedSlider,
      emotionSelect,
      languageSelect,
      englishNormalizationCheckbox
    } = elements;
    if (voiceSelect) voiceSelect.addEventListener("change", () => savePreference("voiceId", voiceSelect.value || null));
    if (pitchSlider) {
      pitchSlider.addEventListener("change", () => {
        const v = Number(pitchSlider.value);
        savePreference("pitch", v);
      });
    }
    if (speedSlider) {
      speedSlider.addEventListener("change", () => {
        const v = Number(speedSlider.value);
        savePreference("speed", v);
      });
    }
    if (emotionSelect) emotionSelect.addEventListener("change", () => savePreference("emotion", emotionSelect.value || null));
    if (languageSelect) {
      languageSelect.addEventListener("change", () => {
        savePreference("language", languageSelect.value || null);
        updatePreviewTextForLanguage();
      });
    }
    if (englishNormalizationCheckbox) englishNormalizationCheckbox.addEventListener("change", () => {
      savePreference("englishNormalization", englishNormalizationCheckbox.checked || false);
    });
  }
  function attachPreviewHandlers() {
    const { previewBtn, previewBtnMobile, previewText, previewTextMobile, voiceSelect, pitchSlider, speedSlider, emotionSelect, languageSelect, englishNormalizationCheckbox } = elements;
    const changeElements = [voiceSelect, pitchSlider, speedSlider, emotionSelect, languageSelect, englishNormalizationCheckbox];
    changeElements.forEach((el) => {
      if (el) el.addEventListener("change", markSettingsAsDirty);
    });
    if (previewBtn) previewBtn.addEventListener("click", () => testVoice());
    if (previewBtnMobile) previewBtnMobile.addEventListener("click", () => testVoice());
    window.addEventListener("beforeunload", () => {
      if (state.cachedAudioUrl) URL.revokeObjectURL(state.cachedAudioUrl);
    });
    function markSettingsAsDirty() {
      state.isDirty = true;
      if (elements.previewHint && state.cachedAudioUrl) elements.previewHint.style.display = "block";
      if (elements.previewHintMobile && state.cachedAudioUrl) elements.previewHintMobile.style.display = "block";
    }
    async function testVoice() {
      const text = (previewText?.value || previewTextMobile?.value || "").trim();
      if (!text) {
        showToast("Please enter some text to test", "warning");
        return;
      }
      if (testMode) {
        showToast("Test validated \u2713 (test mode)", "success");
        return;
      }
      const pitchHasOverride = state.currentPreferences?.pitch !== void 0 && state.currentPreferences?.pitch !== null;
      const speedHasOverride = state.currentPreferences?.speed !== void 0 && state.currentPreferences?.speed !== null;
      const payload = {
        text,
        voiceId: voiceSelect?.value || void 0,
        pitch: pitchHasOverride ? Number(pitchSlider?.value ?? 0) : void 0,
        speed: speedHasOverride ? Number(speedSlider?.value ?? 1) : void 0,
        emotion: emotionSelect?.value || void 0,
        languageBoost: languageSelect?.value || void 0
      };
      const playerElements = {
        playerEl: elements.previewPlayer,
        playerElMobile: elements.previewPlayerMobile,
        sourceEl: elements.previewSource,
        sourceElMobile: elements.previewSourceMobile
      };
      const hintElements = {
        hintEl: elements.previewHint,
        hintElMobile: elements.previewHintMobile
      };
      const buttons = [previewBtn, previewBtnMobile].filter((btn) => btn !== null);
      const onAudioGenerated = (audioUrl, settings) => {
        if (state.cachedAudioUrl) URL.revokeObjectURL(state.cachedAudioUrl);
        state.cachedAudioUrl = audioUrl;
        state.cachedSettings = settings;
        state.isDirty = false;
        if (elements.previewHint) elements.previewHint.style.display = "none";
        if (elements.previewHintMobile) elements.previewHintMobile.style.display = "none";
      };
      const selectedLanguage = languageSelect?.value || "";
      const defaultText = getLanguageExample(selectedLanguage, "viewer");
      await performVoiceTest(payload, buttons, {
        defaultText,
        playerElements,
        hintElements,
        onAudioGenerated
      });
    }
  }
  async function loadVoices() {
    const fallback = [
      "Friendly_Person",
      "Professional_Woman",
      "Casual_Male",
      "Energetic_Youth",
      "Warm_Grandmother",
      "Confident_Leader",
      "Soothing_Narrator",
      "Cheerful_Assistant",
      "Deep_Narrator",
      "Bright_Assistant",
      "Calm_Guide",
      "Energetic_Host"
    ];
    let voices = fallback;
    if (!testMode) {
      try {
        const response = await fetch("https://chatvibes-tts-service-h7kj56ct4q-uc.a.run.app/api/voices");
        if (response.ok) {
          const data = await response.json();
          voices = data.voices || fallback;
        }
      } catch (error) {
        console.error("Failed to load voices, using fallback:", error);
      }
    }
    state.availableVoices = voices;
    setupVoiceDropdown(voices);
  }
  function setupVoiceDropdown(voices) {
    const { voiceSearch, voiceSelect, voiceMenu, voiceDropdown } = elements;
    if (!voiceSearch || !voiceSelect || !voiceMenu || !voiceDropdown) return;
    const list = voiceMenu.querySelector(".voice-dropdown-list");
    if (!list) return;
    voiceSelect.value = "";
    voiceSearch.value = "Use channel default";
    renderVoiceList(voices);
    voiceSearch.addEventListener("click", (e) => {
      e.stopPropagation();
      const isOpen = voiceMenu.classList.contains("show");
      if (isOpen) {
        closeDropdown();
      } else {
        openDropdown();
      }
    });
    voiceSearch.addEventListener("input", () => {
      const query = voiceSearch.value.toLowerCase();
      if (query === "" || query === "use channel default") {
        renderVoiceList(voices);
        return;
      }
      const filtered = voices.filter(
        (voice) => formatVoiceName(voice).toLowerCase().includes(query)
      );
      renderVoiceList(filtered, false);
    });
    document.addEventListener("click", (e) => {
      if (!voiceDropdown.contains(e.target)) {
        closeDropdown();
      }
    });
    function openDropdown() {
      if (!voiceMenu || !voiceSearch) return;
      voiceMenu.classList.add("show");
      voiceSearch.removeAttribute("readonly");
      voiceSearch.focus();
      voiceSearch.select();
    }
    function closeDropdown() {
      if (!voiceMenu || !voiceSearch || !voiceSelect) return;
      voiceMenu.classList.remove("show");
      voiceSearch.setAttribute("readonly", "readonly");
      const currentValue = voiceSelect.value;
      voiceSearch.value = currentValue ? formatVoiceName(currentValue) : "Use channel default";
    }
    function renderVoiceList(listVoices, showDefault = true) {
      if (!list) return;
      list.innerHTML = "";
      if (showDefault) {
        const defaultItem = document.createElement("div");
        defaultItem.className = "voice-dropdown-item";
        const label = document.createElement("span");
        label.className = "voice-label";
        label.textContent = "Use channel default";
        label.addEventListener("click", () => {
          selectVoice("");
        });
        defaultItem.appendChild(label);
        list.appendChild(defaultItem);
      }
      if (!listVoices.length) {
        const empty = document.createElement("div");
        empty.className = "voice-dropdown-item no-results";
        empty.textContent = "No voices found";
        list.appendChild(empty);
        return;
      }
      listVoices.forEach((voiceId) => {
        const item = document.createElement("div");
        item.className = "voice-dropdown-item d-flex justify-content-between align-items-center";
        const label = document.createElement("span");
        label.className = "voice-label";
        label.textContent = formatVoiceName(voiceId);
        label.addEventListener("click", () => selectVoice(voiceId));
        const playBtn = document.createElement("button");
        playBtn.type = "button";
        playBtn.className = "voice-play-btn";
        playBtn.setAttribute("aria-label", `Preview ${voiceId}`);
        playBtn.innerHTML = `
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M8 5v14l11-7z"/>
                    </svg>
                `;
        playBtn.addEventListener("click", async (e) => {
          e.stopPropagation();
          await playVoiceSample(voiceId, playBtn);
        });
        item.appendChild(label);
        item.appendChild(playBtn);
        list.appendChild(item);
      });
    }
    function selectVoice(voiceId) {
      if (!voiceSelect || !voiceSearch || !voiceMenu) return;
      voiceSelect.value = voiceId;
      voiceSearch.value = voiceId ? formatVoiceName(voiceId) : "Use channel default";
      voiceMenu.classList.remove("show");
      voiceSearch.setAttribute("readonly", "readonly");
      savePreference("voiceId", voiceId || null);
    }
  }
  async function playVoiceSample(voiceId, button) {
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
      const prevBtn = document.querySelector(".voice-play-btn.playing");
      if (prevBtn) updatePlayButton(prevBtn, false);
    }
    const preMadeUrl = `/assets/voices/${voiceId}-chat-is-this-real.mp3`;
    try {
      const response = await fetch(preMadeUrl);
      if (!response.ok) {
        showToast("No preview available for this voice yet", "info");
        return;
      }
      const blob = await response.blob();
      const audioUrl = URL.createObjectURL(blob);
      const audio = new Audio(audioUrl);
      state.currentlyPlayingAudio = audio;
      state.currentlyPlayingVoiceId = voiceId;
      updatePlayButton(button, true);
      const cleanup = () => {
        URL.revokeObjectURL(audioUrl);
        updatePlayButton(button, false);
        state.currentlyPlayingAudio = null;
        state.currentlyPlayingVoiceId = null;
      };
      audio.addEventListener("ended", cleanup, { once: true });
      audio.addEventListener("error", cleanup, { once: true });
      await audio.play();
    } catch (error) {
      console.error("Error playing voice preview:", error);
      updatePlayButton(button, false);
      state.currentlyPlayingAudio = null;
      state.currentlyPlayingVoiceId = null;
    }
  }
  function updatePlayButton(button, isPlaying) {
    if (!button) return;
    if (isPlaying) {
      button.classList.add("playing");
      button.innerHTML = `
                <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z"/>
                </svg>
            `;
    } else {
      button.classList.remove("playing");
      button.innerHTML = `
                <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M8 5v14l11-7z"/>
                </svg>
            `;
    }
  }
  async function loadPreferences() {
    const currentChannel = getCurrentChannel();
    if (testMode) {
      const demo = {
        voiceId: "",
        pitch: null,
        speed: null,
        emotion: "",
        language: "",
        englishNormalization: false,
        channelDefaults: {
          voiceId: "Friendly_Person",
          pitch: 0,
          speed: 1,
          emotion: "neutral",
          language: "auto",
          englishNormalization: false
        },
        channelPolicy: { allowViewerPreferences: true },
        ignoreStatus: { tts: false, music: false }
      };
      applyPreferences(demo);
      return {
        allowViewerPreferences: true,
        ignoreStatus: demo.ignoreStatus || {},
        channelDefaults: demo.channelDefaults || {}
      };
    }
    try {
      const endpoint = currentChannel ? `${apiBaseUrl}/api/viewer/preferences/${encodeURIComponent(currentChannel)}` : `${apiBaseUrl}/api/viewer/preferences`;
      const response = await fetchWithAuth(endpoint, { method: "GET" });
      const data = await response.json();
      applyPreferences(data);
      return {
        allowViewerPreferences: data?.channelPolicy?.allowViewerPreferences !== false,
        ignoreStatus: data?.ignoreStatus || {},
        channelDefaults: data?.channelDefaults || {}
      };
    } catch (error) {
      console.error("Failed to load preferences:", error);
      showToast("Failed to load preferences", "error");
      throw error;
    }
  }
  function applyPreferences(data) {
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
      prefsDisabledNote
    } = elements;
    if (voiceSelect) {
      voiceSelect.value = prefs.voiceId || "";
      if (elements.voiceSearch) {
        elements.voiceSearch.value = voiceSelect.value ? formatVoiceName(voiceSelect.value) : "Use channel default";
      }
    }
    if (pitchSlider && pitchValue) {
      pitchSlider.value = String(prefs.pitch ?? 0);
      pitchValue.textContent = String(prefs.pitch ?? 0);
    }
    if (speedSlider && speedValue) {
      const val = prefs.speed ?? 1;
      speedSlider.value = String(val);
      speedValue.textContent = Number(val).toFixed(2);
    }
    if (emotionSelect) emotionSelect.value = prefs.emotion || "";
    if (languageSelect) {
      languageSelect.value = prefs.language || "";
      updatePreviewTextForLanguage();
    }
    if (englishNormalizationCheckbox) englishNormalizationCheckbox.checked = prefs.englishNormalization || false;
    updateHints();
    const allowViewerPrefs = prefs?.channelPolicy?.allowViewerPreferences !== false;
    const inputs = [
      voiceSelect,
      pitchSlider,
      speedSlider,
      emotionSelect,
      languageSelect,
      englishNormalizationCheckbox,
      voiceReset,
      pitchReset,
      speedReset,
      emotionReset,
      languageReset
    ];
    inputs.forEach((el) => {
      if (!el) return;
      el.disabled = !allowViewerPrefs;
    });
    if (prefsDisabledNote) {
      prefsDisabledNote.classList.toggle("d-none", allowViewerPrefs);
    }
  }
  function updateHints(keys) {
    const map = {
      voiceId: elements.hintVoice,
      pitch: elements.hintPitch,
      speed: elements.hintSpeed,
      emotion: elements.hintEmotion,
      language: elements.hintLanguage,
      englishNormalization: elements.hintEnglishNorm
    };
    const toUpdate = Array.isArray(keys) ? keys : Object.keys(map);
    toUpdate.forEach((key) => {
      const el = map[key];
      if (!el) return;
      el.textContent = describePreferenceHint(key);
      el.style.display = "";
      void el.offsetHeight;
    });
  }
  function describePreferenceHint(key) {
    const prefs = state.currentPreferences || {};
    const cd = prefs.channelDefaults || {};
    const userVal = prefs[key];
    const defVal = cd[key];
    const hasUser = userVal !== null && userVal !== void 0 && userVal !== "";
    const hasDef = defVal !== null && defVal !== void 0 && defVal !== "";
    if (hasUser) return `Using your global preference: ${formatValueForHint(key, userVal)}`;
    if (hasDef) return `Using channel default: ${formatValueForHint(key, defVal)}`;
    return "Using system default";
  }
  function formatValueForHint(key, value) {
    if (value === "" || value === void 0 || value === null) return String(value);
    if (key === "speed") return formatNumberCompact(Number(value));
    return String(value);
  }
  async function savePreference(key, value) {
    const previous = state.currentPreferences ? state.currentPreferences[key] : void 0;
    if (state.currentPreferences) {
      state.currentPreferences[key] = value;
      updateHints([key]);
    }
    if (testMode) {
      showToast("Preference updated (test mode)", "success");
      return;
    }
    try {
      const currentChannel = getCurrentChannel();
      const body = { [key]: value };
      const url = currentChannel ? `${apiBaseUrl}/api/viewer/preferences/${encodeURIComponent(currentChannel)}` : `${apiBaseUrl}/api/viewer/preferences`;
      await fetchWithAuth(url, { method: "PUT", body: JSON.stringify(body) });
      showToast("Preference updated", "success");
    } catch (error) {
      if (state.currentPreferences) {
        state.currentPreferences[key] = previous;
        updateHints([key]);
      }
      console.error(`Failed to save ${key}:`, error);
      const err = error;
      showToast(`Failed to save ${key}: ${err.message}`, "error");
    }
  }
  async function resetPreference(key, element, fallbackValue) {
    const cd = state.currentPreferences && state.currentPreferences.channelDefaults ? state.currentPreferences.channelDefaults : {};
    const defaultValue = cd[key] !== void 0 && cd[key] !== null ? cd[key] : fallbackValue;
    if (!element) return;
    if (element instanceof HTMLInputElement && element.type === "checkbox") {
      element.checked = Boolean(defaultValue);
    } else {
      element.value = defaultValue === void 0 || defaultValue === null ? "" : String(defaultValue);
    }
    if (element instanceof HTMLInputElement && element.type === "range") {
      const output = document.getElementById(element.id.replace("-slider", "-value"));
      if (output) {
        const outVal = element.id === "speed-slider" ? Number(defaultValue ?? 1).toFixed(2) : String(defaultValue ?? 0);
        output.textContent = outVal;
      }
    }
    await savePreference(key, null);
  }
  function clearCachedAudio() {
    if (state.cachedAudioUrl) {
      URL.revokeObjectURL(state.cachedAudioUrl);
      state.cachedAudioUrl = null;
    }
    state.cachedSettings = null;
    if (elements.previewPlayer) elements.previewPlayer.style.display = "none";
    if (elements.previewPlayerMobile) elements.previewPlayerMobile.style.display = "none";
    if (elements.previewBtn) elements.previewBtn.textContent = "Send Preview";
    if (elements.previewBtnMobile) elements.previewBtnMobile.textContent = "Send Preview";
    state.isDirty = false;
  }
}
export {
  initPreferencesModule
};
//# sourceMappingURL=preferences.js.map
