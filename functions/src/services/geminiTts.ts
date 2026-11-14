/**
 * Speech synthesis through Gemini TTS (the Interactions API, not streamed).
 *
 * The provider takes a voice, the text, an optional language hint and one
 * free-text style. It has no volume field, so the volume is applied to the
 * samples here. Mirrors src/components/tts/ttsService.js in the tts-twitch repo.
 */

import * as locales from "./locales.json";

const DEFAULT_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/interactions";
const DEFAULT_MODEL = "gemini-3.8-flash-lite-tts";
const DEFAULT_SAMPLE_RATE = 24000;
const WAV_HEADER_BYTES = 44;
// Below the 60 second limit of the function, so the client gets an answer.
const REQUEST_TIMEOUT_MS = 45000;

/** The request was refused by the content filter of the provider. */
export class TtsBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TtsBlockedError";
  }
}

/** Any other failure of the provider. `reason` is safe to show to a client. */
export class TtsProviderError extends Error {
  reason: string;
  constructor(message: string, reason: string) {
    super(message);
    this.name = "TtsProviderError";
    this.reason = reason;
  }
}

export function getGeminiTtsModel(): string {
  return process.env.GEMINI_TTS_MODEL || DEFAULT_MODEL;
}

/**
 * The BCP-47 hint for a stored languageBoost.
 * @param languageBoost - A key of LANGUAGE_BOOSTS, or an automatic value
 * @return The tag, or null for automatic and unknown values
 */
export function languageHint(languageBoost: unknown): string | null {
  if (typeof languageBoost !== "string") return null;
  if ((locales.AUTO_VALUES as string[]).includes(languageBoost)) return null;
  const boosts = locales.LANGUAGE_BOOSTS as Record<string, { bcp47?: string }>;
  return (Object.hasOwn(boosts, languageBoost) && boosts[languageBoost].bcp47) || null;
}

/** A 44-byte RIFF header in front of 16-bit mono PCM. */
export function wavFromPcm(pcm: Buffer, sampleRate = DEFAULT_SAMPLE_RATE): Buffer {
  const header = Buffer.alloc(WAV_HEADER_BYTES);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

/**
 * Multiply 16-bit samples by a volume, in place, and clip at full scale.
 * @param pcm - 16-bit little-endian samples
 * @param volume - The gain. 1 leaves the samples as they are.
 * @param offset - The first byte to change, to skip a WAV header
 * @return The same buffer
 */
export function applyGain(pcm: Buffer, volume: number, offset = 0): Buffer {
  if (!(volume > 0) || volume === 1) return pcm;
  for (let i = offset; i + 1 < pcm.length; i += 2) {
    const sample = Math.round(pcm.readInt16LE(i) * volume);
    pcm.writeInt16LE(Math.max(-32768, Math.min(32767, sample)), i);
  }
  return pcm;
}

function isWav(audio: Buffer): boolean {
  return audio.length >= WAV_HEADER_BYTES && audio.toString("latin1", 0, 4) === "RIFF" && audio.toString("latin1", 8, 12) === "WAVE";
}

/** The first sample byte of a WAV file: after the header of its "data" chunk. */
function wavDataOffset(wav: Buffer): number {
  let pos = 12;
  while (pos + 8 <= wav.length) {
    const size = wav.readUInt32LE(pos + 4);
    if (wav.toString("latin1", pos, pos + 4) === "data") return pos + 8;
    pos += 8 + size + (size % 2);
  }
  return WAV_HEADER_BYTES;
}

function isBlocked(code: unknown, message: string): boolean {
  return code === "prohibited_content" || /\b(input|output|response|request) (was )?blocked\b/i.test(message);
}

interface AudioPart {
  type?: string;
  data?: string;
  mime_type?: string;
}

function findAudio(body: unknown): AudioPart | null {
  const steps = (body as { steps?: Array<{ content?: AudioPart[] }> } | null)?.steps;
  if (!Array.isArray(steps)) return null;
  for (const step of steps) {
    if (!Array.isArray(step?.content)) continue;
    const part = step.content.find((item) => item?.type === "audio" && typeof item.data === "string" && item.data);
    if (part) return part;
  }
  return null;
}

export interface SpeechRequest {
  apiKey: string;
  text: string;
  voice: string;
  style?: string;
  language?: string | null;
  volume?: number;
}

/**
 * Generate one clip.
 * @param request - The text, the Gemini voice and the options of the clip
 * @return A WAV file with the volume applied, and the model that made it
 * @throws TtsBlockedError for a refusal, TtsProviderError for anything else
 */
export async function generateSpeech(request: SpeechRequest): Promise<{ wav: Buffer; model: string }> {
  const model = getGeminiTtsModel();
  const content: Record<string, unknown> = { type: "text", text: request.text };
  if (request.style) content.annotations = [{ type: "speech_metadata", style: request.style }];
  const speech: Record<string, string> = { voice: request.voice };
  if (request.language) speech.language = request.language;

  let res: Response;
  try {
    res = await fetch(process.env.GEMINI_TTS_ENDPOINT || DEFAULT_ENDPOINT, {
      method: "POST",
      headers: { "x-goog-api-key": request.apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        input: [{ type: "user_input", content: [content] }],
        response_format: { type: "audio" },
        generation_config: { speech_config: [speech] },
        // Interactions are stored for weeks unless this is off.
        store: false,
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    const err = error as Error;
    const timedOut = err.name === "TimeoutError" || err.name === "AbortError";
    throw new TtsProviderError(`Gemini TTS request failed: ${err.message}`, timedOut ? "timeout" : "network");
  }

  const raw = await res.text();
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Not JSON. An error page, for example.
  }

  if (!res.ok) {
    const error = (parsed as { error?: { code?: unknown; message?: unknown } } | null)?.error;
    const message = typeof error?.message === "string" ? error.message : raw.replace(/\s+/g, " ").slice(0, 300);
    if (isBlocked(error?.code, message)) throw new TtsBlockedError(`Gemini TTS blocked the text: ${message}`);
    throw new TtsProviderError(`Gemini TTS HTTP ${res.status}: ${message}`, `HTTP ${res.status}`);
  }

  const part = findAudio(parsed);
  if (!part?.data) throw new TtsProviderError("Gemini TTS returned no audio", "no audio");

  const audio = Buffer.from(part.data, "base64");
  const volume = typeof request.volume === "number" ? request.volume : 1;
  if (isWav(audio)) return { wav: applyGain(audio, volume, wavDataOffset(audio)), model };

  // Raw PCM. The rate is in the type: "audio/L16;rate=24000".
  const rate = Number(/rate=(\d+)/.exec(part.mime_type || "")?.[1]) || DEFAULT_SAMPLE_RATE;
  const even = audio.subarray(0, audio.length - (audio.length % 2));
  return { wav: wavFromPcm(applyGain(even, volume), rate), model };
}
