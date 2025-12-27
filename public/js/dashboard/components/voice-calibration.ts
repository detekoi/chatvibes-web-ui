import { formatVoiceName } from '../../common/utils.js';
import { VoiceDropdown } from './voice-dropdown.js';

export interface VoiceCalibrationOptions {
    voiceDropdown: VoiceDropdown;
    currentVoiceVolumes: Record<string, number>;
    onSave: (voiceId: string, volume: number) => Promise<void>;
    onReset: (voiceId: string) => Promise<void>;
    // UI Element IDs
    sliderId: string;
    valueSpanId: string;
    saveBtnId: string;
    listId: string;
}

export class VoiceCalibration {
    private voiceDropdown: VoiceDropdown;
    private currentVoiceVolumes: Record<string, number>;
    private onSave: (voiceId: string, volume: number) => Promise<void>;
    private onReset: (voiceId: string) => Promise<void>;

    private slider: HTMLInputElement | null;
    private valueSpan: HTMLSpanElement | null;
    private saveBtn: HTMLButtonElement | null;
    private list: HTMLElement | null;

    constructor(options: VoiceCalibrationOptions) {
        this.voiceDropdown = options.voiceDropdown;
        this.currentVoiceVolumes = options.currentVoiceVolumes;
        this.onSave = options.onSave;
        this.onReset = options.onReset;

        this.slider = document.getElementById(options.sliderId) as HTMLInputElement | null;
        this.valueSpan = document.getElementById(options.valueSpanId) as HTMLSpanElement | null;
        this.saveBtn = document.getElementById(options.saveBtnId) as HTMLButtonElement | null;
        this.list = document.getElementById(options.listId) as HTMLElement | null;

        this.attachEventListeners();
        this.renderList();
    }

    updateVolumes(newVolumes: Record<string, number>): void {
        this.currentVoiceVolumes = newVolumes;
        this.renderList();
    }

    selectVoice(voiceId: string): void {
        this.voiceDropdown.setValue(voiceId);

        const currentVol = this.currentVoiceVolumes[voiceId] ?? 1.0;
        if (this.slider && this.valueSpan) {
            this.slider.value = String(currentVol);
            this.valueSpan.textContent = String(currentVol);
        }

        if (this.saveBtn) {
            this.saveBtn.disabled = true;
        }

        this.voiceDropdown.scrollIntoView();
        this.voiceDropdown.highlight();
    }

    private attachEventListeners(): void {
        if (!this.slider || !this.valueSpan || !this.saveBtn) return;

        this.slider.addEventListener('input', () => {
            if (this.valueSpan && this.slider) {
                this.valueSpan.textContent = this.slider.value;
            }
            if (this.saveBtn) {
                this.saveBtn.disabled = false;
            }
        });

        this.saveBtn.addEventListener('click', async () => {
            const voiceId = this.voiceDropdown.getValue();
            if (!voiceId) return;

            const vol = parseFloat(this.slider!.value);

            // Optimistic update
            this.currentVoiceVolumes[voiceId] = vol;
            this.saveBtn!.disabled = true;
            this.renderList();

            try {
                await this.onSave(voiceId, vol);
            } catch (e) {
                console.error('Failed to save calibration', e);
                this.saveBtn!.disabled = false; // Re-enable on error?
            }
        });
    }

    private renderList(): void {
        if (!this.list) return;
        this.list.innerHTML = '';

        const calibratedIds = Object.keys(this.currentVoiceVolumes).filter(id => this.currentVoiceVolumes[id] !== 1.0);

        if (calibratedIds.length === 0) {
            this.list.innerHTML = '<li class="list-group-item text-center text-muted py-3">No voices calibrated yet</li>';
            return;
        }

        calibratedIds.forEach(voiceId => {
            const vol = this.currentVoiceVolumes[voiceId];
            const li = document.createElement('li');
            li.className = 'list-group-item d-flex justify-content-between align-items-center';

            const nameSpan = document.createElement('span');
            nameSpan.textContent = `${formatVoiceName(voiceId)} (${vol})`;

            const actionsDiv = document.createElement('div');

            const editBtn = document.createElement('button');
            editBtn.className = 'btn btn-sm btn-outline-secondary me-2';
            editBtn.textContent = 'Edit';
            editBtn.onclick = () => {
                this.selectVoice(voiceId);
            };

            const resetBtn = document.createElement('button');
            resetBtn.className = 'btn btn-sm btn-outline-danger';
            resetBtn.textContent = 'Reset';
            resetBtn.onclick = async () => {
                if (confirm(`Reset calibration for ${formatVoiceName(voiceId)}?`)) {
                    // Optimistic update
                    this.currentVoiceVolumes[voiceId] = 1.0;
                    this.renderList();

                    if (this.voiceDropdown.getValue() === voiceId && this.slider) {
                        this.slider.value = '1.0';
                        if (this.valueSpan) this.valueSpan.textContent = '1.0';
                    }

                    try {
                        await this.onReset(voiceId);
                    } catch (e) {
                        console.error('Failed to reset', e);
                    }
                }
            };

            actionsDiv.appendChild(editBtn);
            actionsDiv.appendChild(resetBtn);
            li.appendChild(nameSpan);
            li.appendChild(actionsDiv);
            this.list!.appendChild(li);
        });
    }
}
