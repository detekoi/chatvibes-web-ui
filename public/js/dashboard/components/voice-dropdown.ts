import { formatVoiceName } from '../../common/utils.js';

export interface VoiceDropdownOptions {
    containerId: string; // The parent div containing the custom dropdown structure
    onSelect: (voiceId: string) => void;
    onPlaySample?: (voiceId: string, button: HTMLButtonElement) => void;
    initialVoiceId?: string;
}

export class VoiceDropdown {
    private container: HTMLElement | null;
    private hiddenInput: HTMLInputElement | null;
    private searchInput: HTMLInputElement | null;
    private menu: HTMLElement | null;
    private list: HTMLElement | null;

    private voices: string[] = [];
    private onSelect: (voiceId: string) => void;
    private onPlaySample?: (voiceId: string, button: HTMLButtonElement) => void;

    constructor(options: VoiceDropdownOptions) {
        // We assume the "containerId" is the ID prefix (e.g. "default", "calibration")
        // and that the structure follows the pattern: {prefix}-voice-dropdown, {prefix}-voice-search, etc.
        const prefix = options.containerId;

        this.container = document.getElementById(`${prefix}-voice-dropdown`) as HTMLElement | null;

        // Fallback: maybe the user passed the full ID as the containerId?
        if (!this.container) {
            this.container = document.getElementById(options.containerId);
        }

        if (!this.container) {
            console.warn(`VoiceDropdown container not found: ${options.containerId}`);
        }

        this.hiddenInput = document.getElementById(`${prefix}-voice`) as HTMLInputElement | null;
        this.searchInput = document.getElementById(`${prefix}-voice-search`) as HTMLInputElement | null;
        this.menu = document.getElementById(`${prefix}-voice-menu`) as HTMLElement | null;
        this.menu = document.getElementById(`${prefix}-voice-menu`) as HTMLElement | null;
        this.list = this.menu?.querySelector('.voice-dropdown-list') as HTMLElement | null || null;

        this.onSelect = options.onSelect;
        this.onPlaySample = options.onPlaySample;

        if (options.initialVoiceId && this.hiddenInput && this.searchInput) {
            this.hiddenInput.value = options.initialVoiceId;
            this.searchInput.value = formatVoiceName(options.initialVoiceId);
        }

        this.attachEventListeners();
    }

    setVoices(voices: string[]): void {
        this.voices = voices;
        this.renderList(voices);
    }

    setValue(voiceId: string): void {
        if (this.hiddenInput && this.searchInput) {
            this.hiddenInput.value = voiceId;
            this.searchInput.value = formatVoiceName(voiceId);
        }
    }

    getValue(): string {
        return this.hiddenInput?.value || '';
    }

    scrollIntoView(): void {
        this.searchInput?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    focus(): void {
        this.searchInput?.focus();
    }

    highlight(): void {
        this.searchInput?.classList.add('highlight-flash');
        setTimeout(() => this.searchInput?.classList.remove('highlight-flash'), 2000);
    }

    private attachEventListeners(): void {
        if (!this.searchInput || !this.menu || !this.container) return;

        this.searchInput.addEventListener('click', (e) => {
            e.stopPropagation();
            const isOpen = this.menu!.classList.contains('show');
            if (isOpen) {
                this.closeDropdown();
            } else {
                this.openDropdown();
            }
        });

        this.searchInput.addEventListener('input', () => {
            const query = this.searchInput!.value.toLowerCase();
            const filtered = this.voices.filter(voice =>
                formatVoiceName(voice).toLowerCase().includes(query)
            );
            this.renderList(filtered);
        });

        document.addEventListener('click', (e) => {
            if (this.container && !this.container.contains(e.target as Node)) {
                this.closeDropdown();
            }
        });
    }

    private openDropdown(): void {
        if (!this.menu || !this.searchInput) return;
        this.menu.classList.add('show');
        this.searchInput.removeAttribute('readonly');
        this.searchInput.focus();
        this.searchInput.select();
    }

    private closeDropdown(): void {
        if (!this.menu || !this.searchInput) return;
        this.menu.classList.remove('show');
        this.searchInput.setAttribute('readonly', 'readonly');
    }

    private renderList(voicesToRender: string[]): void {
        if (!this.list) return;
        this.list.innerHTML = '';

        if (!voicesToRender.length) {
            const empty = document.createElement('div');
            empty.className = 'voice-dropdown-empty';
            empty.textContent = 'No voices found';
            this.list.appendChild(empty);
            return;
        }

        voicesToRender.forEach(voice => {
            const item = document.createElement('div');
            item.className = 'voice-dropdown-item d-flex justify-content-between align-items-center';

            const label = document.createElement('span');
            label.textContent = formatVoiceName(voice);

            item.appendChild(label);

            if (this.onPlaySample) {
                const button = document.createElement('button');
                button.type = 'button';
                button.className = 'btn btn-sm btn-outline-primary voice-play-btn';
                button.dataset.voiceId = voice;
                button.innerHTML = `
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <path d="M8 5v14l11-7z"/>
          </svg>
        `;
                button.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.onPlaySample!(voice, button);
                });
                item.appendChild(button);
            }

            item.addEventListener('click', () => {
                this.setValue(voice);
                this.closeDropdown();
                this.onSelect(voice);
            });

            this.list!.appendChild(item);
        });
    }
}
