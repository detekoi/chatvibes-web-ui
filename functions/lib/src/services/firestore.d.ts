/**
 * Firestore service module
 * Handles database initialization and collection constants
 */
import { Firestore, FieldValue } from "@google-cloud/firestore";
declare let db: Firestore;
declare const COLLECTIONS: {
    readonly MANAGED_CHANNELS: "managedChannels";
    readonly TTS_CHANNEL_CONFIGS: "ttsChannelConfigs";
    readonly MUSIC_SETTINGS: "musicSettings";
    readonly SHORTLINKS: "shortlinks";
};
export { db, FieldValue, COLLECTIONS, };
//# sourceMappingURL=firestore.d.ts.map