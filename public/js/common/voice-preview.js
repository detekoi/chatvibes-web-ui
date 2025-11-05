import { getApiBaseUrl, fetchWithAuth } from "./api.js";
import { showToast } from "./ui.js";
async function performVoiceTest(payload, buttons = [], options = {}) {
  const safeButtons = Array.isArray(buttons) ? buttons.filter((btn) => btn !== null) : [];
  safeButtons.forEach((btn) => {
    btn.disabled = true;
    btn.textContent = "Generating...";
  });
  try {
    let audioUrl = null;
    if (options.defaultText && isDefaultSettings(payload, options.defaultText)) {
      audioUrl = await tryLoadPreMadeRecording(payload, options.defaultText);
      if (audioUrl) {
        console.log("Using pre-made recording");
      }
    }
    if (!audioUrl) {
      const response = await fetchWithAuth(`${getApiBaseUrl()}/api/tts/test`, {
        method: "POST",
        body: JSON.stringify(payload)
      });
      const contentType = response.headers.get("Content-Type") || "";
      if (contentType.startsWith("audio/")) {
        const blob = await response.blob();
        audioUrl = URL.createObjectURL(blob);
      } else {
        const data = await response.json();
        const candidateUrl = data.audioUrl || data.audio_url || data.url || data.audio || (Array.isArray(data.output) ? data.output[0] : typeof data.output === "object" && data.output !== null ? data.output.audio || data.output.audio_url || data.output.url : data.output);
        if (candidateUrl && typeof candidateUrl === "string") {
          audioUrl = candidateUrl;
        } else if (data.audioBase64) {
          const byteString = atob(data.audioBase64);
          const arrayBuffer = new Uint8Array(byteString.length);
          for (let i = 0; i < byteString.length; i++) {
            arrayBuffer[i] = byteString.charCodeAt(i);
          }
          const blob = new Blob([arrayBuffer], { type: "audio/mpeg" });
          audioUrl = URL.createObjectURL(blob);
        } else {
          throw new Error(data.message || data.error || "No audio returned by server");
        }
      }
    }
    if (options.playerElements) {
      await handleAudioPlayer(audioUrl, options.playerElements, options.hintElements);
    } else if (audioUrl) {
      const audio = new Audio(audioUrl);
      await audio.play();
      audio.addEventListener("ended", () => {
        if (audioUrl && audioUrl.startsWith("blob:")) {
          URL.revokeObjectURL(audioUrl);
        }
      });
    }
    if (options.onAudioGenerated && audioUrl) {
      options.onAudioGenerated(audioUrl, payload);
    }
    return audioUrl;
  } catch (error) {
    console.error("Voice test failed:", error);
    const err = error;
    let errorMessage = err.message;
    if (err.message && err.message.includes("API Error:")) {
      const match = err.message.match(/API Error: \d+ (.+)/);
      if (match) {
        errorMessage = match[1] || errorMessage;
      }
    }
    showToast(`Test failed: ${errorMessage}`, "error");
  } finally {
    safeButtons.forEach((btn) => {
      btn.disabled = false;
      btn.textContent = "Regenerate";
    });
  }
}
function isDefaultSettings(payload, defaultText) {
  const isDefaultText = payload.text.trim().toLowerCase() === defaultText.toLowerCase();
  const isDefault = (!payload.pitch || payload.pitch === 0) && (!payload.speed || payload.speed === 1) && (!payload.emotion || payload.emotion === "auto" || payload.emotion === "neutral") && (!payload.languageBoost || payload.languageBoost === "Automatic" || payload.languageBoost === "auto");
  return isDefaultText && isDefault;
}
async function tryLoadPreMadeRecording(payload, defaultText) {
  const voiceId = payload.voiceId || "Friendly_Person";
  const fileName = defaultText.toLowerCase().replace(/[^a-z0-9]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  const preMadeUrl = `/assets/voices/${voiceId}-${fileName}.mp3`;
  try {
    const response = await fetch(preMadeUrl);
    if (response.ok) {
      const blob = await response.blob();
      return URL.createObjectURL(blob);
    }
  } catch (error) {
    console.log("No pre-made recording available for", voiceId, "with text:", defaultText);
  }
  return null;
}
async function handleAudioPlayer(audioUrl, playerElements, hintElements) {
  if (!audioUrl) return;
  const { playerEl, playerElMobile, sourceEl, sourceElMobile } = playerElements;
  const { hintEl, hintElMobile } = hintElements || {};
  if (sourceEl && playerEl) {
    sourceEl.src = audioUrl;
    const audioElement = playerEl.querySelector("audio");
    if (audioElement) {
      audioElement.load();
      try {
        await audioElement.play();
      } catch (err) {
        console.error("Error playing audio:", err);
        showToast("Error playing audio sample", "error");
      }
    }
    playerEl.style.display = "block";
    if (hintEl) hintEl.style.display = "none";
  }
  if (sourceElMobile && playerElMobile) {
    sourceElMobile.src = audioUrl;
    const audioElementMobile = playerElMobile.querySelector("audio");
    if (audioElementMobile) {
      audioElementMobile.load();
    }
    playerElMobile.style.display = "block";
    if (hintElMobile) hintElMobile.style.display = "none";
  }
  if (audioUrl.startsWith("blob:")) {
    const audioElements = [];
    if (playerEl) {
      const audioEl = playerEl.querySelector("audio");
      if (audioEl) audioElements.push(audioEl);
    }
    if (playerElMobile) {
      const audioElMobile = playerElMobile.querySelector("audio");
      if (audioElMobile) audioElements.push(audioElMobile);
    }
    audioElements.forEach((audioEl) => {
      audioEl.addEventListener("ended", () => {
        URL.revokeObjectURL(audioUrl);
      });
    });
  }
}
export {
  performVoiceTest
};
//# sourceMappingURL=voice-preview.js.map
