/**
 * Configuration module for ChatVibes Web UI Functions
 * Centralizes environment variables and secret loading
 */
declare const secretManagerClient: import("@google-cloud/secret-manager/build/src/v1").SecretManagerServiceClient;
interface Secrets {
    TWITCH_CLIENT_ID: string;
    TWITCH_CLIENT_SECRET: string;
    JWT_SECRET: string;
    WAVESPEED_API_KEY: string;
}
interface Config {
    CALLBACK_URL: string | undefined;
    FRONTEND_URL: string | undefined;
    OBS_BROWSER_BASE_URL: string;
    GCLOUD_PROJECT: string | undefined;
    TWITCH_BOT_USERNAME: string;
}
declare const secrets: Secrets;
declare const config: Config;
declare const secretsLoadedPromise: Promise<void>;
export { secrets, secretsLoadedPromise, config, secretManagerClient, };
export type { Secrets, Config };
//# sourceMappingURL=config.d.ts.map