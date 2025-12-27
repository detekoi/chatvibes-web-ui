import {
    TtsSettings,
    SettingsResponse,
    VoicesResponse,
    ErrorResponse,
    VoiceLookupResponse
} from '../types.js';

export class SettingsApi {
    private apiBaseUrl: string;
    private getSessionToken: () => string | null;

    constructor(apiBaseUrl: string, getSessionToken: () => string | null) {
        this.apiBaseUrl = apiBaseUrl;
        this.getSessionToken = getSessionToken;
    }

    private authHeaders(): Record<string, string> {
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        const token = this.getSessionToken();
        if (token) headers['Authorization'] = `Bearer ${token}`;
        return headers;
    }

    async getSettings(channelName: string): Promise<SettingsResponse | ErrorResponse> {
        try {
            const response = await fetch(`${this.apiBaseUrl}/tts/settings/channel/${channelName}?t=${Date.now()}`, {
                headers: this.authHeaders(),
                cache: 'no-store'
            });
            return this.handleResponse<SettingsResponse>(response);
        } catch (error) {
            console.error('Failed to get settings:', error);
            return { error: 'Network error' };
        }
    }

    async saveTtsSetting(channelName: string, key: string, value: any): Promise<void> {
        const response = await fetch(`${this.apiBaseUrl}/tts/settings/channel/${channelName}`, {
            method: 'PUT',
            headers: this.authHeaders(),
            body: JSON.stringify({ key, value })
        });
        return this.handleVoidResponse(response);
    }

    async saveMusicSetting(channelName: string, key: string, value: any): Promise<void> {
        const response = await fetch(`${this.apiBaseUrl}/music/settings/channel/${channelName}`, {
            method: 'PUT',
            headers: this.authHeaders(),
            body: JSON.stringify({ key, value })
        });
        return this.handleVoidResponse(response);
    }

    async getVoices(): Promise<VoicesResponse> {
        try {
            const response = await fetch(`${this.apiBaseUrl}/voices`);
            if (response.ok) {
                return await response.json() as VoicesResponse;
            }
            return { voices: [] };
        } catch (error) {
            console.warn('Failed to load voices:', error);
            return { voices: [] };
        }
    }

    async lookupUserVoice(username: string): Promise<VoiceLookupResponse> {
        try {
            const headers = this.authHeaders();
            delete headers['Content-Type']; // GET request

            const response = await fetch(`${this.apiBaseUrl}/tts/user-voice/${username}`, { headers });
            const data = await response.json();

            if (response.ok) {
                return data as VoiceLookupResponse;
            } else {
                const errorData = data as { error?: string, message?: string };
                throw new Error(errorData.message || errorData.error || 'Lookup failed');
            }
        } catch (error) {
            throw error;
        }
    }

    private async handleResponse<T>(response: Response): Promise<T | ErrorResponse> {
        if (response.ok) {
            return await response.json() as T;
        }
        try {
            const errorData = await response.json() as ErrorResponse;
            // Synthesize a more useful error object if needed, but passing through is usually fine
            // We might want to attach status code
            return { ...errorData, error: errorData.error || `HTTP ${response.status}` };
        } catch {
            return { error: `HTTP ${response.status}` };
        }
    }

    private async handleVoidResponse(response: Response): Promise<void> {
        if (response.ok) return;

        let errorText = `HTTP ${response.status}`;
        try {
            const errorData = await response.json() as ErrorResponse;
            errorText = errorData.details || errorData.message || errorData.error || errorText;
        } catch { }

        // Special handling for 403 contact me link
        if (response.status === 403 && errorText.includes('https://detekoi.github.io/#contact-me')) {
            // Throw specific error or handle in UI? 
            // For now, let's throw an error with the enhanced message
            throw new Error(errorText);
        }

        throw new Error(errorText);
    }
}
