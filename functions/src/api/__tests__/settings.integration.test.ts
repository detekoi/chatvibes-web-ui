
import request from "supertest";
import express from "express";
import settingsRoutes from "../settings";
import { authenticateApiRequest } from "../../middleware/auth";

// Mock the dependencies
jest.mock("../../services/firestore");
jest.mock("../../middleware/auth");
jest.mock("../../services/utils", () => ({
    getAllowedChannelsList: jest.fn().mockResolvedValue(["testchannel"]),
}));
jest.mock("../../logger", () => ({
    logger: {
        info: jest.fn(),
        error: jest.fn(),
        warn: jest.fn(),
    },
    createLogger: jest.fn().mockReturnValue({
        info: jest.fn(),
        error: jest.fn(),
        warn: jest.fn(),
    }),
}));

const mockAuth = authenticateApiRequest as jest.Mock;
mockAuth.mockImplementation((req, _res, next) => {
    req.user = { userLogin: "testchannel", userId: "123" };
    next();
});

const app = express();
app.use(express.json());
// Mount exactly as index.ts does
app.use("/api", settingsRoutes);

describe("Settings API", () => {
    it("GET /api/tts/settings/channel/:channelName should return 200", async () => {
        // Mock db logic would be needed if we want real data, but we just want to check routing
        const { db, COLLECTIONS } = require("../../services/firestore");
        const mockGet = jest.fn().mockResolvedValue({
            exists: true,
            data: () => ({ voiceId: "test-voice" }),
        });
        const mockDoc = jest.fn().mockReturnValue({ get: mockGet });
        const mockCollection = jest.fn().mockReturnValue({ doc: mockDoc });
        db.collection = mockCollection;
        COLLECTIONS.TTS_CHANNEL_CONFIGS = "ttsChannelConfigs";

        const res = await request(app).get("/api/tts/settings/channel/testchannel");
        console.log(res.status, res.body);
        expect(res.status).toBe(200);
        expect(res.body.settings.voiceId).toBe("test-voice");
    });
});
