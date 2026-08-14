import { showToast } from '../common/ui.js';

export interface PronunciationsModule {
    displayPronunciations: (entries: Record<string, string>) => void;
    setOnChange: (cb: () => void) => void;
}

interface PronunciationsConfig {
    apiPrefix: string;
    testMode: boolean;
}

interface PronunciationsServices {
    getSessionToken: () => string | null;
    getLoggedInUser: () => { login: string } | null;
}

/**
 * Channel overrides for the bot's built-in acronym dictionary.
 *
 * Unlike the ignore and banned-word lists this is a key/value map, so each row
 * carries two cells and the add form has two inputs. An entry stored with an
 * empty value means "switch off the built-in of this name", which the bot
 * writes via its chat command; the dashboard renders those as Off rather than
 * offering an empty text box.
 */
export function initPronunciationsModule(
    config: PronunciationsConfig,
    services: PronunciationsServices
): PronunciationsModule {
    const { apiPrefix, testMode } = config;
    let onChange: (() => void) | null = null;

    const listEl = document.getElementById('tts-pronunciations-list') as HTMLUListElement | null;
    const matchEl = document.getElementById('tts-pronunciation-match-input') as HTMLInputElement | null;
    const sayEl = document.getElementById('tts-pronunciation-say-input') as HTMLInputElement | null;
    const addBtn = document.getElementById('add-tts-pronunciation-btn') as HTMLButtonElement | null;

    function authHeaders(): Record<string, string> {
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        const token = services.getSessionToken();
        if (token) headers['Authorization'] = `Bearer ${token}`;
        return headers;
    }

    function displayPronunciations(entries: Record<string, string>): void {
        if (!listEl) return;
        listEl.innerHTML = '';

        const matches = Object.keys(entries || {}).sort();
        if (matches.length === 0) {
            const emptyLi = document.createElement('li');
            emptyLi.className = 'list-group-item text-center text-muted py-3';
            emptyLi.textContent = 'No custom pronunciations yet — the built-in list is still active';
            listEl.appendChild(emptyLi);
            return;
        }

        matches.forEach(match => {
            const say = entries[match];

            const li = document.createElement('li');
            li.className = 'list-group-item d-flex justify-content-between align-items-center gap-2';

            // Both halves are user-controlled, so they are set as text nodes.
            // Never build these rows with innerHTML.
            const text = document.createElement('div');
            text.className = 'flex-grow-1 text-truncate';

            const matchSpan = document.createElement('span');
            matchSpan.className = 'fw-bold';
            matchSpan.textContent = match;
            text.appendChild(matchSpan);

            const saySpan = document.createElement('span');
            saySpan.className = 'text-muted';
            if (say === '') {
                saySpan.textContent = ' — built-in switched off';
            } else {
                saySpan.textContent = ` → ${say}`;
            }
            text.appendChild(saySpan);

            li.appendChild(text);

            const removeBtn = document.createElement('button');
            removeBtn.className = 'btn btn-outline-danger btn-sm flex-shrink-0';
            removeBtn.textContent = 'Remove';
            removeBtn.addEventListener('click', () => removePronunciation(match));
            li.appendChild(removeBtn);

            listEl.appendChild(li);
        });
    }

    async function addPronunciation(match: string, say: string): Promise<void> {
        const user = services.getLoggedInUser();
        if (!user?.login) return;

        if (testMode) {
            showToast(`[Test] Added pronunciation: ${match} → ${say}`, 'success');
            if (onChange) onChange();
            return;
        }

        try {
            const response = await fetch(`${apiPrefix}/tts/pronunciations/channel/${user.login}`, {
                method: 'POST',
                headers: authHeaders(),
                body: JSON.stringify({ match, say })
            });
            const data = await response.json();
            if (data.success) {
                showToast(`"${data.match}" will be said as "${data.say}"`, 'success');
                if (onChange) onChange();
            } else {
                showToast(data.error || 'Failed to save pronunciation', 'error');
            }
        } catch (error) {
            console.error('Error adding pronunciation:', error);
            showToast('Failed to save pronunciation', 'error');
        }
    }

    async function removePronunciation(match: string): Promise<void> {
        const user = services.getLoggedInUser();
        if (!user?.login) return;

        if (testMode) {
            showToast(`[Test] Removed pronunciation: ${match}`, 'success');
            if (onChange) onChange();
            return;
        }

        try {
            const response = await fetch(`${apiPrefix}/tts/pronunciations/channel/${user.login}`, {
                method: 'DELETE',
                headers: authHeaders(),
                body: JSON.stringify({ match })
            });
            const data = await response.json();
            if (data.success) {
                showToast(`Removed "${match}"`, 'success');
                if (onChange) onChange();
            } else {
                showToast(data.error || 'Failed to remove pronunciation', 'error');
            }
        } catch (error) {
            console.error('Error removing pronunciation:', error);
            showToast('Failed to remove pronunciation', 'error');
        }
    }

    // Wire up UI
    if (addBtn && matchEl && sayEl) {
        addBtn.addEventListener('click', () => {
            const match = matchEl.value.trim();
            const say = sayEl.value.trim();
            if (!match || !say) {
                showToast('Enter both the word and how it should be said', 'error');
                return;
            }
            addPronunciation(match, say);
            matchEl.value = '';
            sayEl.value = '';
            matchEl.focus();
        });

        const submitOnEnter = (e: KeyboardEvent) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                addBtn.click();
            }
        };
        matchEl.addEventListener('keydown', submitOnEnter);
        sayEl.addEventListener('keydown', submitOnEnter);
    }

    return {
        displayPronunciations,
        setOnChange: (cb: () => void) => { onChange = cb; }
    };
}
