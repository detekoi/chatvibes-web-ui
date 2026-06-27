import { fetchWithAuth } from '../common/api.js';
import { copyToClipboard, showToast } from '../common/ui.js';

/**
 * OBS module elements
 */
interface ObsElements {
  ttsUrlField: HTMLInputElement | null;
  copyTtsUrlBtn: HTMLButtonElement | null;
  regenerateTtsUrlBtn: (HTMLAnchorElement | HTMLButtonElement) | null;
  obsToggleBtn?: HTMLButtonElement | null;
  obsPopover?: HTMLDivElement | null;
  obsCloseBtn?: HTMLButtonElement | null;
}

/**
 * OBS module context
 */
interface ObsContext {
  apiBaseUrl: string;
  testMode: boolean;
}

/**
 * OBS module services
 */
interface ObsServices {
  getLoggedInUser: () => { login: string; id: string; displayName: string } | null;
}

/**
 * OBS token API response
 */
interface ObsTokenResponse {
  success: boolean;
  browserSourceUrl?: string;
  message?: string;
}

/**
 * OBS module return type
 */
export interface ObsModule {
  loadExistingTtsUrl: (login: string) => Promise<void>;
  updateTtsUrl: (login: string) => Promise<void>;
}

/**
 * OBS setup helpers (browser source URL management).
 */
export function initObsModule(
  { ttsUrlField, copyTtsUrlBtn, regenerateTtsUrlBtn, obsToggleBtn, obsPopover, obsCloseBtn }: ObsElements,
  context: ObsContext,
  services: ObsServices
): ObsModule {
  const { apiBaseUrl, testMode } = context;
  const { getLoggedInUser } = services;

  async function loadExistingTtsUrl(userLoginName: string): Promise<void> {
    if (!ttsUrlField) return;
    if (testMode) {
      ttsUrlField.value = `https://example.com/tts/test?channel=${encodeURIComponent(userLoginName || 'demo')}`;
      ttsUrlField.placeholder = 'Test mode URL';
      return;
    }
    if (!userLoginName || userLoginName.trim() === '' || userLoginName === 'loading...') {
      ttsUrlField.value = '';
      ttsUrlField.placeholder = 'Could not determine TTS URL.';
      return;
    }
    ttsUrlField.value = 'Loading existing URL...';
    ttsUrlField.placeholder = '';
    try {
      const response = await fetchWithAuth(`${apiBaseUrl}/api/obs/getToken`, { method: 'GET' });
      const data = await response.json() as ObsTokenResponse;
      if (data.success && data.browserSourceUrl) {
        ttsUrlField.value = data.browserSourceUrl;
        ttsUrlField.placeholder = 'Your existing OBS Browser Source URL';
        console.log('Dashboard: Loaded existing OBS URL for', userLoginName);
      } else {
        ttsUrlField.value = '';
        ttsUrlField.placeholder = 'Click "Regenerate URL" to generate your OBS Browser Source URL';
      }
    } catch (error) {
      console.error('Dashboard: Error loading existing TTS URL:', error);
      ttsUrlField.value = '';
      ttsUrlField.placeholder = 'Click "Regenerate URL" to generate your OBS Browser Source URL';
    }
  }

  async function updateTtsUrl(userLoginName: string): Promise<void> {
    if (!ttsUrlField) return;
    if (testMode) {
      ttsUrlField.value = `https://example.com/tts/new-test-url?channel=${encodeURIComponent(userLoginName || 'demo')}`;
      ttsUrlField.placeholder = 'Test mode URL';
      showToast('Generated a new URL successfully. (test mode)', 'success');
      return;
    }
    if (!userLoginName || userLoginName.trim() === '' || userLoginName === 'loading...') {
      ttsUrlField.value = '';
      ttsUrlField.placeholder = 'Could not determine TTS URL.';
      return;
    }
    ttsUrlField.value = 'Generating secure URL...';
    ttsUrlField.placeholder = '';
    try {
      const response = await fetchWithAuth(`${apiBaseUrl}/api/obs/generateToken`, { method: 'POST' });
      const data = await response.json() as ObsTokenResponse;
      if (data.success && data.browserSourceUrl) {
        ttsUrlField.value = data.browserSourceUrl;
        ttsUrlField.placeholder = 'Your secure OBS Browser Source URL';
        showToast('Generated a new URL successfully.', 'success');
      } else {
        throw new Error(data.message || 'Failed to generate OBS URL');
      }
    } catch (error) {
      console.error('Dashboard: Error generating OBS URL:', error);
      ttsUrlField.value = '';
      ttsUrlField.placeholder = 'Error generating URL. Please try refreshing.';
      showToast('Failed to generate OBS URL. Please try again.', 'error');
    }
  }

  if (copyTtsUrlBtn && ttsUrlField) {
    copyTtsUrlBtn.addEventListener('click', async () => {
      if (!ttsUrlField.value) {
        showToast('URL not available yet.', 'warning');
        return;
      }
      ttsUrlField.select();
      ttsUrlField.setSelectionRange(0, 99999);
      try {
        const success = await copyToClipboard(ttsUrlField.value);
        if (success) {
          showToast('Copied to clipboard!', 'success');
          const original = copyTtsUrlBtn.textContent;
          copyTtsUrlBtn.textContent = 'Copied!';
          copyTtsUrlBtn.classList.add('copied');
          setTimeout(() => { 
            copyTtsUrlBtn.textContent = original; 
            copyTtsUrlBtn.classList.remove('copied');
          }, 2000);
        } else {
          showToast('Copy failed.', 'error');
        }
      } catch (err) {
        console.error('Copy attempt error:', err);
        showToast('Failed to copy.', 'error');
      }
    });
  }

  if (regenerateTtsUrlBtn) {
    regenerateTtsUrlBtn.addEventListener('click', async (e: Event) => {
      e.preventDefault();
      const userLogin = getLoggedInUser()?.login;
      if (testMode) {
        const originalText = regenerateTtsUrlBtn.textContent;
        regenerateTtsUrlBtn.textContent = 'Generating...';
        regenerateTtsUrlBtn.style.pointerEvents = 'none';
        await new Promise(r => setTimeout(r, 500));
        await updateTtsUrl(userLogin || 'demo');
        regenerateTtsUrlBtn.style.pointerEvents = 'auto';
        regenerateTtsUrlBtn.textContent = originalText;
        return;
      }
      if (!userLogin) {
        showToast('Error: User not logged in.', 'error');
        return;
      }
      const originalText = regenerateTtsUrlBtn.textContent;
      regenerateTtsUrlBtn.textContent = 'Generating...';
      regenerateTtsUrlBtn.style.pointerEvents = 'none';
      try {
        await updateTtsUrl(userLogin);
      } finally {
        regenerateTtsUrlBtn.style.pointerEvents = 'auto';
        regenerateTtsUrlBtn.textContent = originalText;
      }
    });
  }

  if (obsToggleBtn && obsPopover) {
    obsToggleBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = obsPopover.classList.contains('open');
      if (isOpen) {
        obsPopover.classList.remove('open');
        obsToggleBtn.classList.remove('is-open');
      } else {
        obsPopover.classList.add('open');
        obsToggleBtn.classList.add('is-open');
      }
    });

    if (obsCloseBtn) {
      obsCloseBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        obsPopover.classList.remove('open');
        obsToggleBtn.classList.remove('is-open');
      });
    }

    // Close when clicking outside
    document.addEventListener('click', (e) => {
      if (!obsPopover.contains(e.target as Node) && !obsToggleBtn.contains(e.target as Node)) {
        obsPopover.classList.remove('open');
        obsToggleBtn.classList.remove('is-open');
      }
    });
  }

  return { loadExistingTtsUrl, updateTtsUrl };
}
