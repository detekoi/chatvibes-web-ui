
import request from "supertest";
import express from "express";
import { authenticateApiRequest } from "../../middleware/auth";

// 1. Define Mocks BEFORE imports that use them
jest.mock("../../services/firestore", () => ({
    db: {
        collection: jest.fn(),
    },
    COLLECTIONS: {
        TTS_CHANNEL_CONFIGS: "ttsChannelConfigs",
        MUSIC_SETTINGS: "musicSettings",
    },
}));

jest.mock("../../middleware/auth");

jest.mock("../../services/utils", () => ({
    getAllowedChannelsList: jest.fn().mockResolvedValue(["testchannel"]),
}));

jest.mock("../../logger", () => ({
    logger: {
        info: jest.fn(),
        error: jest.fn(),
        warn: jest.fn(),
        child: jest.fn().mockReturnThis(),
    },
    createLogger: jest.fn().mockReturnValue({
        info: jest.fn(),
        error: jest.fn(),
        warn: jest.fn(),
    }),
}));

// 2. Import the module under test AFTER mocks
import settingsRoutes from "../settings";
import { db } from "../../services/firestore";

// 3. Configure Mocks
const mockAuth = authenticateApiRequest as jest.Mock;
mockAuth.mockImplementation((req, _res, next) => {
    req.user = { userLogin: "testchannel", userId: "123" };
    next();
});

const app = express();
app.use(express.json());
app.use("/api", settingsRoutes);

describe("Settings API", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it("GET /api/tts/settings/channel/:channelName should return 200", async () => {
        const mockGet = jest.fn().mockResolvedValue({
            exists: true,
            data: () => ({
                voiceId: "test-voice",
                voiceVolumes: { "Spanish_HumorousElder": 0.9 }
            }),
        });
        const mockDoc = jest.fn().mockReturnValue({ get: mockGet });
        (db.collection as jest.Mock).mockReturnValue({ doc: mockDoc });

        const res = await request(app).get("/api/tts/settings/channel/testchannel");

        expect(res.status).toBe(200);
        expect(res.body.settings.voiceId).toBe("test-voice");
        expect(res.body.settings.voiceVolumes["Spanish_HumorousElder"]).toBe(0.9);
    }, 10000); // 10s timeout
});
