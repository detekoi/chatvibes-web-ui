/**
 * The voice catalog from `GET /api/voices`, with the search index and the
 * sample player that both pages share.
 */
import { getLocale, t } from './i18n.js';
import { showToast } from './ui.js';

export interface VoiceEntry {
  id: string;
  name: string;
  studio: boolean;
  /** BCP-47, for example "en-US". */
  language: string;
  region: string;
  accent: string;
  /** female, male or neutral. */
  gender: string;
  /** low, medium or high. */
  pitch: string;
  persona: string;
  context: string;
  /** An English sentence. The catalog has no translations in this release. */
  description: string;
}

interface VoicesResponse {
  success?: boolean;
  version?: string;
  defaultVoiceId?: string;
  voices?: VoiceEntry[];
}

export interface VoiceFilters {
  language?: string;
  gender?: string;
  pitch?: string;
  studioOnly?: boolean;
}

export interface VoiceCatalog {
  voices: VoiceEntry[];
  /** The voice the server uses when nothing is stored. Empty when the catalog did not load. */
  defaultVoiceId: string;
  version: string;
  get: (id: string | null | undefined) => VoiceEntry | undefined;
  /** The display name, or "Legacy voice (<id>)" for an ID that is not in the catalog. */
  displayName: (id: string | null | undefined) => string;
  /** Voices that contain every word of the query and pass every filter, in catalog order. */
  search: (query: string, filters?: VoiceFilters) => VoiceEntry[];
  /** The language tags in the catalog with a readable name, sorted by that name. */
  languages: () => { tag: string; label: string }[];
}

/** Three real catalog entries, for test mode on a host that has no API. */
const DEMO_VOICES: VoiceEntry[] = [
  {
    id: 'puck', name: 'Puck', studio: true, language: 'en-US', region: 'US', accent: 'General American',
    gender: 'male', pitch: 'low', persona: 'Podcaster', context: 'Conversational',
    description: 'Upbeat, energetic, and cheerful voice with a rich, approachable tone. Recommended for podcasts, conversational agents, entertainment reviews, or ads.',
  },
  {
    id: 'kore', name: 'Kore', studio: true, language: 'en-US', region: 'US', accent: 'General American',
    gender: 'female', pitch: 'medium', persona: 'News & Podcast Host', context: 'Content & Media',
    description: 'Firm, direct, and authoritative voice with a medium pitch. Recommended for news reports or official messages.',
  },
  {
    id: 'de-de-advisor-1', name: 'Authoritative Advisor 1', studio: false, language: 'de-DE', region: 'DE', accent: 'German',
    gender: 'female', pitch: 'low', persona: 'High-Trust Advisor / Authoritative Advisor (Lawyer)', context: 'Enterprise Agent',
    description: '41-year-old Lawyer from Germany. Speaks German. Tone is objective, direct, and helpful',
  },
];

const displayNames = new Map<string, Intl.DisplayNames | null>();

/** A readable name for a BCP-47 tag in the given locale, or the tag itself. */
export function languageName(tag: string, locale: string = getLocale()): string {
  if (!tag) return '';
  let names = displayNames.get(locale);
  if (names === undefined) {
    try {
      names = new Intl.DisplayNames([locale, 'en'], { type: 'language' });
    } catch {
      names = null;
    }
    displayNames.set(locale, names);
  }
  try {
    return names?.of(tag) || tag;
  } catch {
    return tag;
  }
}

export function buildVoiceCatalog(voices: VoiceEntry[], defaultVoiceId = '', version = ''): VoiceCatalog {
  const byId = new Map(voices.map(v => [v.id.toLowerCase(), v]));
  // One lowercase string for each voice. The language is indexed three ways,
  // so "german", "deutsch" (in a German dashboard) and "de-de" all match.
  const languageText = new Map<string, string>();
  const languageWords = (tag: string): string => {
    let text = languageText.get(tag);
    if (text === undefined) {
      text = `${tag} ${languageName(tag, 'en')} ${languageName(tag)}`;
      languageText.set(tag, text);
    }
    return text;
  };
  const index = voices.map(v => [
    v.name, v.description, v.accent, v.persona, languageWords(v.language), v.id, `${v.pitch} pitch`,
  ].join(' \n ').toLowerCase());

  const get = (id: string | null | undefined): VoiceEntry | undefined =>
    (id ? byId.get(String(id).toLowerCase()) : undefined);

  return {
    voices,
    defaultVoiceId,
    version,
    get,
    displayName: (id) => {
      if (!id) return '';
      return get(id)?.name ?? t('msg.voice.legacy', { id: String(id) });
    },
    search: (query, filters = {}) => {
      const words = query.toLowerCase().split(/\s+/).filter(Boolean);
      const out: VoiceEntry[] = [];
      for (let i = 0; i < voices.length; i++) {
        const v = voices[i];
        if (filters.studioOnly && !v.studio) continue;
        if (filters.language && v.language !== filters.language) continue;
        if (filters.gender && v.gender !== filters.gender) continue;
        if (filters.pitch && v.pitch !== filters.pitch) continue;
        const haystack = index[i];
        if (words.every(w => haystack.includes(w))) out.push(v);
      }
      return out;
    },
    languages: () => {
      const tags = [...new Set(voices.map(v => v.language).filter(Boolean))];
      return tags
        .map(tag => ({ tag, label: languageName(tag) }))
        .sort((a, b) => a.label.localeCompare(b.label, getLocale()));
    },
  };
}

/**
 * Load the catalog. A failed request gives an empty catalog, so the page still
 * works and a stored voice shows as a legacy voice. With `demoFallback`, a
 * failed request gives three demo voices instead (test mode).
 */
export async function loadVoiceCatalog(url: string, options: { demoFallback?: boolean } = {}): Promise<VoiceCatalog> {
  try {
    const response = await fetch(url);
    if (response.ok) {
      const data = await response.json() as VoicesResponse;
      const voices = Array.isArray(data.voices)
        ? data.voices.filter(v => v && typeof v.id === 'string' && typeof v.name === 'string')
        : [];
      if (voices.length) return buildVoiceCatalog(voices, data.defaultVoiceId || '', data.version || '');
    }
  } catch (error) {
    console.warn('Failed to load voices:', error);
  }
  return options.demoFallback ? buildVoiceCatalog(DEMO_VOICES, 'puck', 'demo') : buildVoiceCatalog([]);
}

// ---------------------------------------------------------------------------
// Sample player: one static file for each voice, one sample at a time.
// ---------------------------------------------------------------------------

const PLAY_ICON = '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>';
const STOP_ICON = '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M6 6h12v12H6z"/></svg>';

let playing: { audio: HTMLAudioElement; voiceId: string; name: string; button: HTMLButtonElement } | null = null;

export function sampleUrl(voiceId: string): string {
  return `/assets/voices/gemini/${encodeURIComponent(voiceId)}.mp3`;
}

/** Draw a sample button. The icon and the accessible name carry the state, not the color alone. */
export function paintSampleButton(button: HTMLButtonElement, name: string, isPlaying: boolean): void {
  button.innerHTML = isPlaying ? STOP_ICON : PLAY_ICON;
  button.classList.toggle('playing', isPlaying);
  button.setAttribute('aria-label', isPlaying ? t('msg.voice.stopSample', { voice: name }) : t('msg.voice.preview', { voice: name }));
}

/** A list that draws its rows again calls this, so the new button shows the sample that plays. */
export function adoptSampleButton(voiceId: string, name: string, button: HTMLButtonElement): void {
  const isPlaying = playing?.voiceId === voiceId;
  if (playing && isPlaying) playing.button = button;
  paintSampleButton(button, name, isPlaying);
}

export function stopVoiceSample(): void {
  if (!playing) return;
  const { audio, button, name } = playing;
  playing = null;
  audio.pause();
  if (button.isConnected) paintSampleButton(button, name, false);
}

/** Play the sample of a voice, or stop it if it plays now. */
export async function toggleVoiceSample(voiceId: string, name: string, button: HTMLButtonElement): Promise<void> {
  const wasThisVoice = playing?.voiceId === voiceId;
  stopVoiceSample();
  if (wasThisVoice || !voiceId) return;

  const audio = new Audio(sampleUrl(voiceId));
  const state = { audio, voiceId, name, button };
  playing = state;
  paintSampleButton(button, name, true);

  const finish = (): void => {
    if (playing !== state) return;
    playing = null;
    if (state.button.isConnected) paintSampleButton(state.button, name, false);
  };
  audio.addEventListener('ended', finish, { once: true });

  try {
    await audio.play();
  } catch (error) {
    // A pause during the load rejects play() with AbortError. That is not a failure.
    if (playing !== state) return;
    finish();
    console.warn('Cannot play the voice sample:', error);
    showToast(t('msg.preview.unavailable'), 'info');
  }
}
