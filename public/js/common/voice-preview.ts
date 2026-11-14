import { getApiBaseUrl, fetchWithAuth } from './api.js';
import { showToast } from './ui.js';
import { apiErrorMessage, displayError, t } from './i18n.js';

/**
 * The body of `POST /api/tts/test`.
 */
export interface TTSPayload {
  text: string;
  voiceId?: string;
  emotion?: string;
  /** Free text that tells the voice model how to speak. When it is not empty, it replaces the emotion. */
  style?: string;
  pitch?: number;
  speed?: number;
  volume?: number;
  languageBoost?: string;
}

/**
 * Player elements for audio playback
 */
export interface PlayerElements {
  playerEl?: HTMLElement | null;
  sourceEl?: HTMLSourceElement | null;
}

/**
 * Hint elements to hide when audio is ready
 */
export interface HintElements {
  hintEl?: HTMLElement | null;
}

/**
 * Options for voice test
 */
export interface VoiceTestOptions {
  playerElements?: PlayerElements;
  hintElements?: HintElements;
  onAudioGenerated?: (audioUrl: string, payload: TTSPayload) => void;
}

/**
 * API response for TTS test
 */
interface TTSResponse {
  success?: boolean;
  audioBase64?: string;
  /** The server sends WAV ("audio/wav"). */
  mimeType?: string;
  provider?: string;
  model?: string;
  message?: string;
  error?: string;
}

const DEFAULT_MIME_TYPE = 'audio/wav';

/**
 * Send a TTS preview request and play the resulting audio.
 * @returns The audio URL, if available.
 */
export async function performVoiceTest(
  payload: TTSPayload,
  buttons: (HTMLButtonElement | null)[] = [],
  options: VoiceTestOptions = {}
): Promise<string | undefined> {
  const safeButtons = Array.isArray(buttons) ? buttons.filter((btn): btn is HTMLButtonElement => btn !== null) : [];

  safeButtons.forEach(btn => {
    btn.disabled = true;
    btn.textContent = t('msg.voice.generating');
  });

  try {
    const response = await fetchWithAuth(`${getApiBaseUrl()}/api/tts/test`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });

    let blob: Blob;
    const contentType = response.headers.get('Content-Type') || '';
    if (contentType.startsWith('audio/')) {
      blob = await response.blob();
    } else {
      const data = await response.json() as TTSResponse;
      if (!data.audioBase64) {
        throw new Error(apiErrorMessage(data, 'msg.voice.noAudio'));
      }
      const byteString = atob(data.audioBase64);
      const bytes = new Uint8Array(byteString.length);
      for (let i = 0; i < byteString.length; i++) {
        bytes[i] = byteString.charCodeAt(i);
      }
      blob = new Blob([bytes], { type: data.mimeType || DEFAULT_MIME_TYPE });
    }

    const audioUrl = URL.createObjectURL(blob);
    const mimeType = blob.type || DEFAULT_MIME_TYPE;

    if (options.playerElements) {
      await handleAudioPlayer(audioUrl, mimeType, options.playerElements, options.hintElements);
    } else {
      const audio = new Audio(audioUrl);
      audio.addEventListener('ended', () => URL.revokeObjectURL(audioUrl));
      await audio.play();
    }

    options.onAudioGenerated?.(audioUrl, payload);
    return audioUrl;
  } catch (error) {
    console.error('Voice test failed:', error);
    showToast(t('msg.voice.testFailed', { reason: displayError(error) }), 'error');
  } finally {
    safeButtons.forEach(btn => {
      btn.disabled = false;
      btn.textContent = t('msg.voice.regenerate');
    });
  }
  return undefined;
}

async function handleAudioPlayer(
  audioUrl: string,
  mimeType: string,
  playerElements: PlayerElements,
  hintElements?: HintElements
): Promise<void> {
  const { playerEl, sourceEl } = playerElements;
  const { hintEl } = hintElements || {};
  if (!sourceEl || !playerEl) return;

  // The caller owns the URL and revokes it when the next preview replaces it.
  // A revoke at the end of playback stopped the reader from playing it again.
  sourceEl.type = mimeType;
  sourceEl.src = audioUrl;
  playerEl.style.display = 'block';
  if (hintEl) hintEl.style.display = 'none';

  const audioElement = playerEl.querySelector('audio');
  if (audioElement) {
    audioElement.load();
    try {
      await audioElement.play();
    } catch (err) {
      console.error('Error playing audio:', err);
      showToast(t('msg.voice.cannotPlay'), 'error');
    }
  }
}
