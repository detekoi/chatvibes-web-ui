import { getApiBaseUrl, fetchWithAuth } from './api.js';
import { showToast } from './ui.js';

/**
 * TTS test payload
 */
export interface TTSPayload {
  text: string;
  voiceId?: string;
  pitch?: number;
  speed?: number;
  emotion?: string;
  languageBoost?: string;
}

/**
 * Player elements for audio playback
 */
export interface PlayerElements {
  playerEl?: HTMLElement | null;
  playerElMobile?: HTMLElement | null;
  sourceEl?: HTMLSourceElement | null;
  sourceElMobile?: HTMLSourceElement | null;
}

/**
 * Hint elements to hide when audio is ready
 */
export interface HintElements {
  hintEl?: HTMLElement | null;
  hintElMobile?: HTMLElement | null;
}

/**
 * Options for voice test
 */
export interface VoiceTestOptions {
  defaultText?: string;
  playerElements?: PlayerElements;
  hintElements?: HintElements;
  onAudioGenerated?: (audioUrl: string, payload: TTSPayload) => void;
}

/**
 * API response for TTS test
 */
interface TTSResponse {
  audioUrl?: string;
  audio_url?: string;
  url?: string;
  audio?: string;
  audioBase64?: string;
  output?: string | string[] | {
    audio?: string;
    audio_url?: string;
    url?: string;
  };
  message?: string;
  error?: string;
}

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
    btn.textContent = 'Generating...';
  });

  try {
    let audioUrl: string | null = null;

    if (options.defaultText && isDefaultSettings(payload, options.defaultText)) {
      audioUrl = await tryLoadPreMadeRecording(payload, options.defaultText);
      if (audioUrl) {
        console.log('Using pre-made recording');
      }
    }

    if (!audioUrl) {
      const response = await fetchWithAuth(`${getApiBaseUrl()}/api/tts/test`, {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      const contentType = response.headers.get('Content-Type') || '';
      if (contentType.startsWith('audio/')) {
        const blob = await response.blob();
        audioUrl = URL.createObjectURL(blob);
      } else {
        const data = await response.json() as TTSResponse;
        const candidateUrl = (
          data.audioUrl || data.audio_url || data.url || data.audio ||
          (Array.isArray(data.output) ? data.output[0] : (
            typeof data.output === 'object' && data.output !== null ?
              (data.output.audio || data.output.audio_url || data.output.url) :
              data.output
          ))
        );

        if (candidateUrl && typeof candidateUrl === 'string') {
          audioUrl = candidateUrl;
        } else if (data.audioBase64) {
          const byteString = atob(data.audioBase64);
          const arrayBuffer = new Uint8Array(byteString.length);
          for (let i = 0; i < byteString.length; i++) {
            arrayBuffer[i] = byteString.charCodeAt(i);
          }
          const blob = new Blob([arrayBuffer], { type: 'audio/mpeg' });
          audioUrl = URL.createObjectURL(blob);
        } else {
          throw new Error(data.message || data.error || 'No audio returned by server');
        }
      }
    }

    if (options.playerElements) {
      await handleAudioPlayer(audioUrl, options.playerElements, options.hintElements);
    } else if (audioUrl) {
      const audio = new Audio(audioUrl);
      await audio.play();
      audio.addEventListener('ended', () => {
        if (audioUrl && audioUrl.startsWith('blob:')) {
          URL.revokeObjectURL(audioUrl);
        }
      });
    }

    if (options.onAudioGenerated && audioUrl) {
      options.onAudioGenerated(audioUrl, payload);
    }

    return audioUrl;
  } catch (error) {
    console.error('Voice test failed:', error);
    const err = error as Error;
    let errorMessage = err.message;
    if (err.message && err.message.includes('API Error:')) {
      const match = err.message.match(/API Error: \d+ (.+)/);
      if (match) {
        errorMessage = match[1] || errorMessage;
      }
    }
    showToast(`Test failed: ${errorMessage}`, 'error');
  } finally {
    safeButtons.forEach(btn => {
      btn.disabled = false;
      btn.textContent = 'Regenerate';
    });
  }
}

function isDefaultSettings(payload: TTSPayload, defaultText: string): boolean {
  const isDefaultText = payload.text.trim().toLowerCase() === defaultText.toLowerCase();
  const isDefault = (
    (!payload.pitch || payload.pitch === 0) &&
    (!payload.speed || payload.speed === 1.0) &&
    (!payload.emotion || payload.emotion === 'auto' || payload.emotion === 'neutral') &&
    (!payload.languageBoost || payload.languageBoost === 'Automatic' || payload.languageBoost === 'auto')
  );
  return isDefaultText && isDefault;
}

async function tryLoadPreMadeRecording(payload: TTSPayload, defaultText: string): Promise<string | null> {
  const voiceId = payload.voiceId || 'Friendly_Person';
  const fileName = defaultText.toLowerCase()
    .replace(/[^a-z0-9]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  const preMadeUrl = `/assets/voices/${voiceId}-${fileName}.mp3`;

  try {
    const response = await fetch(preMadeUrl);
    if (response.ok) {
      const blob = await response.blob();
      return URL.createObjectURL(blob);
    }
  } catch (error) {
    console.log('No pre-made recording available for', voiceId, 'with text:', defaultText);
  }

  return null;
}

// Track blob URLs for each audio element to properly clean them up
// Use WeakMap to avoid memory leaks when elements are removed
const audioBlobUrls = new WeakMap<HTMLAudioElement, string>();

async function handleAudioPlayer(
  audioUrl: string | null,
  playerElements: PlayerElements,
  hintElements?: HintElements
): Promise<void> {
  if (!audioUrl) return;

  const { playerEl, playerElMobile, sourceEl, sourceElMobile } = playerElements;
  const { hintEl, hintElMobile } = hintElements || {};

  if (sourceEl && playerEl) {
    const audioElement = playerEl.querySelector('audio');
    if (audioElement) {
      // Revoke previous blob URL if it exists (Safari fix)
      const previousUrl = audioBlobUrls.get(audioElement);
      if (previousUrl && previousUrl.startsWith('blob:')) {
        URL.revokeObjectURL(previousUrl);
      }

      // Store new blob URL for future cleanup
      if (audioUrl.startsWith('blob:')) {
        audioBlobUrls.set(audioElement, audioUrl);
      }

      sourceEl.src = audioUrl;
      audioElement.load();
      try {
        await audioElement.play();
      } catch (err) {
        console.error('Error playing audio:', err);
        showToast('Error playing audio sample', 'error');
      }
    }
    playerEl.style.display = 'block';
    if (hintEl) hintEl.style.display = 'none';
  }

  if (sourceElMobile && playerElMobile) {
    const audioElementMobile = playerElMobile.querySelector('audio');
    if (audioElementMobile) {
      // Revoke previous blob URL if it exists (Safari fix)
      const previousUrl = audioBlobUrls.get(audioElementMobile);
      if (previousUrl && previousUrl.startsWith('blob:')) {
        URL.revokeObjectURL(previousUrl);
      }

      // Store new blob URL for future cleanup
      if (audioUrl.startsWith('blob:')) {
        audioBlobUrls.set(audioElementMobile, audioUrl);
      }

      sourceElMobile.src = audioUrl;
      audioElementMobile.load();
    }
    playerElMobile.style.display = 'block';
    if (hintElMobile) hintElMobile.style.display = 'none';
  }
}
