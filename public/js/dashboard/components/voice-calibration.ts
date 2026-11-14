import { VoicePicker } from '../../common/voice-picker.js';
import { displayError, t } from '../../common/i18n.js';
import { showToast } from '../../common/ui.js';

export interface VoiceCalibrationOptions {
    voiceDropdown: VoicePicker;
    /** The display name of a voice ID. A volume can still belong to an ID that is not in the catalog. */
    voiceName: (voiceId: string) => string;
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
    private voiceDropdown: VoicePicker;
    private voiceName: (voiceId: string) => string;
    private currentVoiceVolumes: Record<string, number>;
    private onSave: (voiceId: string, volume: number) => Promise<void>;
    private onReset: (voiceId: string) => Promise<void>;

    private slider: HTMLInputElement | null;
    private valueSpan: HTMLSpanElement | null;
    private saveBtn: HTMLButtonElement | null;
    private list: HTMLElement | null;

    constructor(options: VoiceCalibrationOptions) {
        this.voiceDropdown = options.voiceDropdown;
        this.voiceName = options.voiceName;
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
            this.valueSpan.textContent = this.slider.value;
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
            const previous = this.currentVoiceVolumes[voiceId];

            // Optimistic update
            this.currentVoiceVolumes[voiceId] = vol;
            this.saveBtn!.disabled = true;
            this.renderList();

            try {
                await this.onSave(voiceId, vol);
            } catch (e) {
                console.error('Failed to save calibration', e);
                this.restoreVolume(voiceId, previous, e);
                this.saveBtn!.disabled = false;
            }
        });
    }

    /** Show the stored volume on the slider when the slider is for this voice. */
    private showVolumeOf(voiceId: string): void {
        if (this.voiceDropdown.getValue() !== voiceId || !this.slider) return;
        const volume = String(this.currentVoiceVolumes[voiceId] ?? 1.0);
        this.slider.value = volume;
        if (this.valueSpan) this.valueSpan.textContent = this.slider.value;
    }

    /** The server refused the change: show the value that it still holds, and say why. */
    private restoreVolume(voiceId: string, previous: number | undefined, error: unknown): void {
        if (previous === undefined) delete this.currentVoiceVolumes[voiceId];
        else this.currentVoiceVolumes[voiceId] = previous;
        this.renderList();
        this.showVolumeOf(voiceId);
        showToast(t('msg.settings.saveFailed', { label: t('msg.setting.voiceVolume'), reason: displayError(error) }), 'error');
    }

    private renderList(): void {
        if (!this.list) return;
        this.list.innerHTML = '';

        const calibratedIds = Object.keys(this.currentVoiceVolumes).filter(id => this.currentVoiceVolumes[id] !== 1.0);

        if (calibratedIds.length === 0) {
            const empty = document.createElement('li');
            empty.className = 'list-group-item text-center text-muted py-3';
            empty.textContent = t('msg.calibration.empty');
            this.list.appendChild(empty);
            return;
        }

        calibratedIds.forEach(voiceId => {
            const vol = this.currentVoiceVolumes[voiceId];
            const li = document.createElement('li');
            li.className = 'list-group-item d-flex justify-content-between align-items-center';

            const nameSpan = document.createElement('span');
            nameSpan.textContent = t('msg.calibration.row', { voice: this.voiceName(voiceId), volume: vol });

            const actionsDiv = document.createElement('div');

            const editBtn = document.createElement('button');
            editBtn.className = 'btn btn-sm btn-outline-secondary me-2';
            editBtn.textContent = t('msg.calibration.edit');
            editBtn.onclick = () => {
                this.selectVoice(voiceId);
            };

            const resetBtn = document.createElement('button');
            resetBtn.className = 'btn btn-sm btn-outline-danger';
            resetBtn.textContent = t('msg.calibration.reset');
            resetBtn.onclick = async () => {
                if (confirm(t('msg.calibration.confirmReset', { voice: this.voiceName(voiceId) }))) {
                    const previous = this.currentVoiceVolumes[voiceId];
                    // Optimistic update
                    this.currentVoiceVolumes[voiceId] = 1.0;
                    this.renderList();
                    this.showVolumeOf(voiceId);

                    try {
                        await this.onReset(voiceId);
                    } catch (e) {
                        console.error('Failed to reset', e);
                        this.restoreVolume(voiceId, previous, e);
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
