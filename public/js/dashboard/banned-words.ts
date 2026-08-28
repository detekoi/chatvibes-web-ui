import { showToast } from '../common/ui.js';
import { apiErrorMessage, t } from '../common/i18n.js';

export interface BannedWordsModule {
    displayBannedWords: (words: string[]) => void;
    setOnChange: (cb: () => void) => void;
}

interface BannedWordsConfig {
    apiPrefix: string;
    testMode: boolean;
}

interface BannedWordsServices {
    getSessionToken: () => string | null;
    getLoggedInUser: () => { login: string } | null;
}

export function initBannedWordsModule(
    config: BannedWordsConfig,
    services: BannedWordsServices
): BannedWordsModule {
    const { apiPrefix, testMode } = config;
    let onChange: (() => void) | null = null;

    const listEl = document.getElementById('tts-banned-words-list') as HTMLUListElement | null;
    const inputEl = document.getElementById('tts-banned-word-input') as HTMLInputElement | null;
    const addBtn = document.getElementById('add-tts-banned-word-btn') as HTMLButtonElement | null;

    function authHeaders(): Record<string, string> {
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        const token = services.getSessionToken();
        if (token) headers['Authorization'] = `Bearer ${token}`;
        return headers;
    }

    function displayBannedWords(words: string[]): void {
        if (!listEl) return;
        listEl.innerHTML = '';
        if (!words || words.length === 0) {
            const emptyLi = document.createElement('li');
            emptyLi.className = 'list-group-item text-center text-muted py-3';
            emptyLi.textContent = t('msg.bannedWords.empty');
            listEl.appendChild(emptyLi);
            return;
        }
        words.forEach(word => {
            const li = document.createElement('li');
            li.className = 'list-group-item d-flex justify-content-between align-items-center';
            li.textContent = word;

            const removeBtn = document.createElement('button');
            removeBtn.className = 'btn btn-outline-danger btn-sm';
            removeBtn.textContent = t('msg.action.remove');
            removeBtn.addEventListener('click', () => removeBannedWord(word));
            li.appendChild(removeBtn);
            listEl.appendChild(li);
        });
    }

    async function addBannedWord(word: string): Promise<void> {
        const user = services.getLoggedInUser();
        if (!user?.login) return;

        if (testMode) {
            showToast(t('msg.bannedWords.addedTestMode', { word }), 'success');
            if (onChange) onChange();
            return;
        }

        try {
            const response = await fetch(`${apiPrefix}/tts/banned-words/channel/${user.login}`, {
                method: 'POST',
                headers: authHeaders(),
                body: JSON.stringify({ word })
            });
            const data = await response.json();
            if (data.success) {
                showToast(t('msg.bannedWords.added', { word }), 'success');
                if (onChange) onChange();
            } else {
                showToast(apiErrorMessage(data, 'msg.bannedWords.addFailed'), 'error');
            }
        } catch (error) {
            console.error('Error adding banned word:', error);
            showToast(t('msg.bannedWords.addFailed'), 'error');
        }
    }

    async function removeBannedWord(word: string): Promise<void> {
        const user = services.getLoggedInUser();
        if (!user?.login) return;

        if (testMode) {
            showToast(t('msg.bannedWords.removedTestMode', { word }), 'success');
            if (onChange) onChange();
            return;
        }

        try {
            const response = await fetch(`${apiPrefix}/tts/banned-words/channel/${user.login}`, {
                method: 'DELETE',
                headers: authHeaders(),
                body: JSON.stringify({ word })
            });
            const data = await response.json();
            if (data.success) {
                showToast(t('msg.bannedWords.removed', { word }), 'success');
                if (onChange) onChange();
            } else {
                showToast(apiErrorMessage(data, 'msg.bannedWords.removeFailed'), 'error');
            }
        } catch (error) {
            console.error('Error removing banned word:', error);
            showToast(t('msg.bannedWords.removeFailed'), 'error');
        }
    }

    // Wire up UI
    if (addBtn && inputEl) {
        addBtn.addEventListener('click', () => {
            const word = inputEl.value.trim();
            if (word) {
                addBannedWord(word);
                inputEl.value = '';
            }
        });
        inputEl.addEventListener('keydown', (e: KeyboardEvent) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                addBtn.click();
            }
        });
    }

    return {
        displayBannedWords,
        setOnChange: (cb: () => void) => { onChange = cb; }
    };
}
