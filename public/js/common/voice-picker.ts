/**
 * The voice picker that the dashboard (default voice, calibration) and the
 * viewer page share.
 *
 * A button shows the current voice and opens a panel with a search box,
 * filters and a list. The catalog holds about 2,100 voices, so the list draws
 * one page of rows and adds the next page when the reader scrolls near the end.
 *
 * Keyboard: Enter, Space or the down arrow opens the panel. In the search box
 * the up and down arrows move through the list, Enter selects, and Escape
 * closes the panel. Focus returns to the button.
 */
import { t } from './i18n.js';
import {
  adoptSampleButton,
  languageName,
  toggleVoiceSample,
  type VoiceCatalog,
  type VoiceEntry,
  type VoiceFilters,
  buildVoiceCatalog,
} from './voice-catalog.js';

export interface VoicePickerOptions {
  /** The empty element that the picker fills. */
  root: HTMLElement | null;
  /** The id of the visible label of the setting. It names the button and the panel. */
  labelId?: string;
  /** Runs when the reader selects a voice. An empty string is the empty choice. */
  onSelect: (voiceId: string) => void;
  /** Adds a first row with this label that selects the empty value. */
  emptyLabel?: string;
  /** Shown on the button while no voice is selected and there is no empty row. */
  placeholder?: string;
}

const PAGE_SIZE = 50;
const CHECK_ICON = '<svg class="voice-picker-check" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" aria-hidden="true"><path d="M5 12l5 5L20 7"/></svg>';

let pickerCount = 0;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export class VoicePicker {
  private readonly root: HTMLElement | null;
  private readonly uid: string;
  private readonly onSelect: (voiceId: string) => void;
  private readonly emptyLabel?: string;
  private readonly placeholder: string;

  private catalog: VoiceCatalog = buildVoiceCatalog([]);
  private value = '';
  private filters: VoiceFilters = {};
  /** The rows that match now. Null is the empty choice. */
  private results: (VoiceEntry | null)[] = [];
  private rendered = 0;
  private activeIndex = -1;
  private isOpen = false;

  private trigger!: HTMLButtonElement;
  private triggerName!: HTMLElement;
  private triggerDetail!: HTMLElement;
  private panel!: HTMLElement;
  private search!: HTMLInputElement;
  private languageSelect!: HTMLSelectElement;
  private genderSelect!: HTMLSelectElement;
  private pitchSelect!: HTMLSelectElement;
  private studioCheckbox!: HTMLInputElement;
  private count!: HTMLElement;
  private list!: HTMLElement;

  constructor(options: VoicePickerOptions) {
    this.root = options.root;
    this.uid = `voice-picker-${++pickerCount}`;
    this.onSelect = options.onSelect;
    this.emptyLabel = options.emptyLabel;
    this.placeholder = options.placeholder ?? t('msg.voice.choose');
    if (!this.root) return;
    this.build(options.labelId);
    this.paintTrigger();
  }

  setCatalog(catalog: VoiceCatalog): void {
    this.catalog = catalog;
    if (!this.root) return;
    this.fillLanguageFilter();
    this.paintTrigger();
    if (this.isOpen) this.refresh();
  }

  /** Set the value without a call to `onSelect`. An ID that is not in the catalog shows as a legacy voice. */
  setValue(voiceId: string | null | undefined): void {
    this.value = voiceId ? String(voiceId) : '';
    if (!this.root) return;
    this.paintTrigger();
    if (this.isOpen) this.refresh();
  }

  getValue(): string {
    return this.value;
  }

  setDisabled(disabled: boolean): void {
    if (!this.root) return;
    if (disabled) this.close(false);
    this.trigger.disabled = disabled;
  }

  scrollIntoView(): void {
    this.root?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  focus(): void {
    if (this.root) this.trigger.focus();
  }

  /** Flash the button, to show the reader where a value changed. */
  highlight(): void {
    if (!this.root) return;
    this.trigger.classList.add('highlight-flash');
    setTimeout(() => this.trigger.classList.remove('highlight-flash'), 2000);
  }

  // -------------------------------------------------------------------------
  // Markup
  // -------------------------------------------------------------------------

  private build(labelId?: string): void {
    const root = this.root!;
    const id = (part: string): string => `${this.uid}-${part}`;
    root.classList.add('voice-picker');
    root.replaceChildren();

    this.trigger = el('button', 'form-select voice-picker-trigger');
    this.trigger.type = 'button';
    this.trigger.id = id('trigger');
    this.trigger.setAttribute('aria-haspopup', 'dialog');
    this.trigger.setAttribute('aria-expanded', 'false');
    this.trigger.setAttribute('aria-controls', id('panel'));
    const valueWrap = el('span', 'voice-picker-value');
    valueWrap.id = id('value');
    this.triggerName = el('span', 'voice-picker-value-name');
    this.triggerDetail = el('span', 'voice-picker-value-detail');
    valueWrap.append(this.triggerName, this.triggerDetail);
    this.trigger.appendChild(valueWrap);
    // The label says which setting this is, and the value says what it holds.
    if (labelId) this.trigger.setAttribute('aria-labelledby', `${labelId} ${id('value')}`);

    this.panel = el('div', 'voice-picker-panel');
    this.panel.id = id('panel');
    this.panel.setAttribute('role', 'dialog');
    this.panel.setAttribute('aria-label', t('msg.voice.panelLabel'));
    this.panel.hidden = true;

    const searchLabel = el('label', 'visually-hidden', t('msg.voice.searchLabel'));
    searchLabel.htmlFor = id('search');
    this.search = el('input', 'form-control voice-picker-search');
    this.search.type = 'search';
    this.search.id = id('search');
    this.search.placeholder = t('msg.voice.searchLabel');
    this.search.autocomplete = 'off';
    this.search.spellcheck = false;
    this.search.setAttribute('role', 'combobox');
    this.search.setAttribute('aria-expanded', 'true');
    this.search.setAttribute('aria-autocomplete', 'list');
    this.search.setAttribute('aria-controls', id('list'));
    this.search.setAttribute('aria-describedby', id('hint'));
    const hint = el('p', 'voice-picker-hint', t('msg.voice.searchHint'));
    hint.id = id('hint');

    const filters = el('div', 'voice-picker-filters');
    this.languageSelect = this.buildFilter(filters, t('msg.voice.filterLanguage'), [['', t('msg.voice.anyLanguage')]]);
    this.genderSelect = this.buildFilter(filters, t('msg.voice.filterGender'), [
      ['', t('msg.voice.anyGender')],
      ['female', t('msg.voice.gender.female')],
      ['male', t('msg.voice.gender.male')],
      ['neutral', t('msg.voice.gender.neutral')],
    ]);
    this.pitchSelect = this.buildFilter(filters, t('msg.voice.filterPitch'), [
      ['', t('msg.voice.anyPitch')],
      ['low', t('msg.voice.pitch.low')],
      ['medium', t('msg.voice.pitch.medium')],
      ['high', t('msg.voice.pitch.high')],
    ]);
    const studioLabel = el('label', 'voice-picker-studio');
    this.studioCheckbox = el('input', 'form-check-input');
    this.studioCheckbox.type = 'checkbox';
    studioLabel.append(this.studioCheckbox, el('span', undefined, t('msg.voice.studioOnly')));
    filters.appendChild(studioLabel);

    this.count = el('p', 'voice-picker-count');
    this.count.setAttribute('aria-live', 'polite');

    this.list = el('div', 'voice-picker-list');
    this.list.id = id('list');
    this.list.setAttribute('role', 'listbox');
    this.list.setAttribute('aria-label', t('msg.voice.listLabel'));
    this.list.tabIndex = -1;

    this.panel.append(searchLabel, this.search, hint, filters, this.count, this.list);
    root.append(this.trigger, this.panel);
    this.attachEvents();
  }

  private buildFilter(parent: HTMLElement, label: string, options: [string, string][]): HTMLSelectElement {
    const select = el('select', 'form-select voice-picker-filter');
    select.setAttribute('aria-label', label);
    for (const [value, text] of options) {
      const option = el('option', undefined, text);
      option.value = value;
      select.appendChild(option);
    }
    parent.appendChild(select);
    return select;
  }

  private fillLanguageFilter(): void {
    const previous = this.languageSelect.value;
    while (this.languageSelect.options.length > 1) this.languageSelect.remove(1);
    for (const { tag, label } of this.catalog.languages()) {
      const option = el('option', undefined, label);
      option.value = tag;
      this.languageSelect.appendChild(option);
    }
    this.languageSelect.value = previous;
    if (this.languageSelect.value !== previous) {
      this.languageSelect.value = '';
      this.filters.language = undefined;
    }
  }

  private paintTrigger(): void {
    const voice = this.catalog.get(this.value);
    if (!this.value) {
      this.triggerName.textContent = this.emptyLabel ?? this.placeholder;
      this.triggerDetail.textContent = '';
    } else if (voice) {
      this.triggerName.textContent = voice.name;
      // Names repeat across languages, so the language is part of the value.
      this.triggerDetail.textContent = languageName(voice.language);
    } else {
      this.triggerName.textContent = this.catalog.displayName(this.value);
      this.triggerDetail.textContent = '';
    }
  }

  // -------------------------------------------------------------------------
  // Events
  // -------------------------------------------------------------------------

  private attachEvents(): void {
    this.trigger.addEventListener('click', () => { if (this.isOpen) this.close(false); else this.open(); });
    this.trigger.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        this.open();
      }
    });

    this.search.addEventListener('input', () => this.refresh());
    this.search.addEventListener('keydown', (e) => {
      switch (e.key) {
        case 'ArrowDown': e.preventDefault(); this.moveActive(1); break;
        case 'ArrowUp': e.preventDefault(); this.moveActive(-1); break;
        case 'PageDown': e.preventDefault(); this.moveActive(8); break;
        case 'PageUp': e.preventDefault(); this.moveActive(-8); break;
        case 'Enter':
          e.preventDefault();
          if (this.activeIndex >= 0 && this.activeIndex < this.results.length) this.select(this.results[this.activeIndex]);
          break;
        default:
      }
    });

    const onFilter = (): void => {
      this.filters = {
        language: this.languageSelect.value || undefined,
        gender: this.genderSelect.value || undefined,
        pitch: this.pitchSelect.value || undefined,
        studioOnly: this.studioCheckbox.checked,
      };
      this.refresh();
    };
    [this.languageSelect, this.genderSelect, this.pitchSelect, this.studioCheckbox]
      .forEach(control => control.addEventListener('change', onFilter));

    this.panel.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        this.close(true);
      }
    });

    // A press on a row must not take focus from the search box, or the arrow
    // keys stop. The click still arrives.
    this.list.addEventListener('mousedown', (e) => e.preventDefault());
    this.list.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      const sample = target.closest<HTMLButtonElement>('.voice-play-btn');
      if (sample) {
        const voice = this.catalog.get(sample.dataset.voiceId);
        if (voice) void toggleVoiceSample(voice.id, voice.name, sample);
        return;
      }
      const option = target.closest<HTMLElement>('[role="option"]');
      if (option?.dataset.index !== undefined) this.select(this.results[Number(option.dataset.index)]);
    });
    this.list.addEventListener('scroll', () => {
      if (this.list.scrollTop + this.list.clientHeight >= this.list.scrollHeight - 240) this.renderMore();
    }, { passive: true });

    document.addEventListener('click', (e) => {
      if (this.isOpen && !this.root!.contains(e.target as Node)) this.close(false);
    });
    this.root!.addEventListener('focusout', (e) => {
      const next = (e as FocusEvent).relatedTarget as Node | null;
      if (this.isOpen && next && !this.root!.contains(next)) this.close(false);
    });
  }

  private open(): void {
    if (this.isOpen || this.trigger.disabled) return;
    this.isOpen = true;
    this.panel.hidden = false;
    this.trigger.setAttribute('aria-expanded', 'true');
    this.search.value = '';
    this.refresh();
    this.search.focus();
  }

  private close(returnFocus: boolean): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.panel.hidden = true;
    this.trigger.setAttribute('aria-expanded', 'false');
    this.search.removeAttribute('aria-activedescendant');
    this.list.replaceChildren();
    this.rendered = 0;
    if (returnFocus) this.trigger.focus();
  }

  private select(entry: VoiceEntry | null | undefined): void {
    if (entry === undefined) return;
    this.value = entry ? entry.id : '';
    this.paintTrigger();
    this.close(true);
    this.onSelect(this.value);
  }

  // -------------------------------------------------------------------------
  // List
  // -------------------------------------------------------------------------

  private hasFilter(): boolean {
    return Boolean(this.filters.language || this.filters.gender || this.filters.pitch || this.filters.studioOnly);
  }

  /** Run the search again and draw the first page. */
  private refresh(): void {
    const query = this.search.value.trim();
    const matches = this.catalog.search(query, this.filters);
    const narrowed = query !== '' || this.hasFilter();
    const rows: (VoiceEntry | null)[] = [];
    if (this.emptyLabel !== undefined && !narrowed) rows.push(null);
    // Without a query the selected voice comes first. In catalog order it can
    // be row 1,800, which the first page does not show.
    const selected = this.catalog.get(this.value);
    if (selected && !narrowed) {
      rows.push(selected);
      for (const voice of matches) if (voice !== selected) rows.push(voice);
    } else {
      for (const voice of matches) rows.push(voice);
    }
    this.results = rows;

    this.count.textContent = matches.length
      ? t('msg.voice.count', { count: matches.length })
      : t('msg.voice.noneFound');

    this.list.replaceChildren();
    this.list.scrollTop = 0;
    this.rendered = 0;
    this.renderMore();

    const selectedIndex = rows.findIndex(r => (r ? r.id : '') === this.value);
    this.setActive(selectedIndex >= 0 && selectedIndex < this.rendered ? selectedIndex : (rows.length ? 0 : -1), false);
  }

  private renderMore(): void {
    if (this.rendered >= this.results.length) return;
    const end = Math.min(this.rendered + PAGE_SIZE, this.results.length);
    const fragment = document.createDocumentFragment();
    for (let i = this.rendered; i < end; i++) fragment.appendChild(this.buildRow(this.results[i], i));
    this.list.appendChild(fragment);
    this.rendered = end;
  }

  private buildRow(voice: VoiceEntry | null, index: number): HTMLElement {
    const row = el('div', 'voice-picker-row');
    row.setAttribute('role', 'none');
    const option = el('div', 'voice-picker-option');
    option.id = `${this.uid}-option-${index}`;
    option.dataset.index = String(index);
    option.setAttribute('role', 'option');
    const isSelected = (voice ? voice.id : '') === this.value;
    option.setAttribute('aria-selected', String(isSelected));

    const title = el('span', 'voice-picker-name', voice ? voice.name : this.emptyLabel);
    // A check mark shows the selected row, so the state does not depend on color.
    if (isSelected) title.insertAdjacentHTML('beforeend', CHECK_ICON);
    option.appendChild(title);

    if (voice) {
      if (voice.description) option.appendChild(el('span', 'voice-picker-desc', voice.description));
      const tags = el('span', 'voice-picker-tags');
      tags.appendChild(el('span', 'wc-tag', languageName(voice.language)));
      const gender = this.genderLabel(voice.gender);
      if (gender) tags.appendChild(el('span', 'wc-tag', gender));
      const pitch = this.pitchLabel(voice.pitch);
      if (pitch) tags.appendChild(el('span', 'wc-tag', pitch));
      if (voice.studio) tags.appendChild(el('span', 'wc-tag voice-picker-tag-studio', t('msg.voice.studioTag')));
      option.appendChild(tags);
    }
    row.appendChild(option);

    if (voice) {
      const sample = el('button', 'voice-play-btn');
      sample.type = 'button';
      sample.dataset.voiceId = voice.id;
      // Only the sample of the active row is a tab stop. See setActive.
      sample.tabIndex = -1;
      adoptSampleButton(voice.id, voice.name, sample);
      row.appendChild(sample);
    }
    return row;
  }

  private genderLabel(gender: string): string {
    switch (gender) {
      case 'female': return t('msg.voice.gender.female');
      case 'male': return t('msg.voice.gender.male');
      case 'neutral': return t('msg.voice.gender.neutral');
      default: return '';
    }
  }

  private pitchLabel(pitch: string): string {
    switch (pitch) {
      case 'low': return t('msg.voice.pitch.low');
      case 'medium': return t('msg.voice.pitch.medium');
      case 'high': return t('msg.voice.pitch.high');
      default: return '';
    }
  }

  private moveActive(delta: number): void {
    if (!this.results.length) return;
    const next = Math.max(0, Math.min(this.results.length - 1, this.activeIndex + delta));
    while (next >= this.rendered) this.renderMore();
    this.setActive(next, true);
  }

  private setActive(index: number, scroll: boolean): void {
    const previous = this.list.querySelector('.voice-picker-row.is-active');
    previous?.classList.remove('is-active');
    previous?.querySelector<HTMLButtonElement>('.voice-play-btn')?.setAttribute('tabindex', '-1');

    this.activeIndex = index;
    const option = index >= 0 ? document.getElementById(`${this.uid}-option-${index}`) : null;
    if (!option) {
      this.search.removeAttribute('aria-activedescendant');
      return;
    }
    const row = option.parentElement!;
    row.classList.add('is-active');
    row.querySelector<HTMLButtonElement>('.voice-play-btn')?.setAttribute('tabindex', '0');
    this.search.setAttribute('aria-activedescendant', option.id);
    if (scroll) row.scrollIntoView({ block: 'nearest' });
  }
}
