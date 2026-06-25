/**
 * Channel settings API routes (TTS)
 */

import express, { Response, Router, RequestHandler } from "express";
import { db, COLLECTIONS, FieldValue } from "../services/firestore";
import { authenticateApiRequest, authorizeChannelAccess, AuthenticatedRequest } from "../middleware/auth";
import { logger } from "../logger";

const router: Router = express.Router();

// ==========================================
// TTS SETTINGS
// ==========================================

// GET /tts/settings/channel/:channelName
router.get("/tts/settings/channel/:channelName", authenticateApiRequest, authorizeChannelAccess, (async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const { channelName } = req.params;

    try {
        const docRef = db.collection(COLLECTIONS.TTS_CHANNEL_CONFIGS).doc(req.user.userId);
        const docSnap = await docRef.get();

        if (docSnap.exists) {
            res.json({ settings: docSnap.data() || {} });
        } else {
            res.json({ settings: {} });
        }
    } catch (error) {
        logger.error({ error, channelName }, "Error fetching TTS settings");
        res.status(500).json({ error: "Failed to fetch TTS settings" });
    }
}) as RequestHandler);

// PUT /tts/settings/channel/:channelName
router.put("/tts/settings/channel/:channelName", authenticateApiRequest, authorizeChannelAccess, (async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const { channelName } = req.params;
    const { key, value } = req.body;

    if (!key) {
        res.status(400).json({ error: "Key is required" });
        return;
    }

    try {
        const docRef = db.collection(COLLECTIONS.TTS_CHANNEL_CONFIGS).doc(req.user.userId);

        await docRef.set({ [key]: value }, { merge: true });

        logger.info({ channelName, key, value }, "Updated TTS setting");
        res.json({ success: true, message: "Setting updated" });
    } catch (error) {
        logger.error({ error, channelName, key }, "Error updating TTS settings");
        res.status(500).json({ error: "Failed to update TTS setting" });
    }
}) as RequestHandler);

// ==========================================
// TTS IGNORE LIST MANAGEMENT
// ==========================================

// POST /tts/ignore/channel/:channelName - Add user to ignore list
router.post("/tts/ignore/channel/:channelName", authenticateApiRequest, authorizeChannelAccess, (async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const { channelName } = req.params;
    const { username } = req.body;

    if (!username || typeof username !== "string") {
        res.status(400).json({ error: "Username is required" });
        return;
    }

    const normalizedUsername = username.toLowerCase().trim();
    if (!normalizedUsername) {
        res.status(400).json({ error: "Invalid username" });
        return;
    }

    try {
        const docRef = db.collection(COLLECTIONS.TTS_CHANNEL_CONFIGS).doc(req.user.userId);
        await docRef.set({ ignoredUsers: FieldValue.arrayUnion(normalizedUsername) }, { merge: true });

        logger.info({ channelName, username: normalizedUsername }, "Added user to TTS ignore list");
        res.json({ success: true, message: "User added to ignore list" });
    } catch (error) {
        logger.error({ error, channelName, username }, "Error adding user to ignore list");
        res.status(500).json({ error: "Failed to add user to ignore list" });
    }
}) as RequestHandler);

// DELETE /tts/ignore/channel/:channelName - Remove user from ignore list
router.delete("/tts/ignore/channel/:channelName", authenticateApiRequest, authorizeChannelAccess, (async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const { channelName } = req.params;
    const { username } = req.body;

    if (!username || typeof username !== "string") {
        res.status(400).json({ error: "Username is required" });
        return;
    }

    const normalizedUsername = username.toLowerCase().trim();
    if (!normalizedUsername) {
        res.status(400).json({ error: "Invalid username" });
        return;
    }

    try {
        const docRef = db.collection(COLLECTIONS.TTS_CHANNEL_CONFIGS).doc(req.user.userId);
        await docRef.set({ ignoredUsers: FieldValue.arrayRemove(normalizedUsername) }, { merge: true });

        logger.info({ channelName, username: normalizedUsername }, "Removed user from TTS ignore list");
        res.json({ success: true, message: "User removed from ignore list" });
    } catch (error) {
        logger.error({ error, channelName, username }, "Error removing user from ignore list");
        res.status(500).json({ error: "Failed to remove user from ignore list" });
    }
}) as RequestHandler);

// ==========================================
// TTS BANNED WORDS MANAGEMENT
// ==========================================

// POST /tts/banned-words/channel/:channelName - Add word to banned list
router.post("/tts/banned-words/channel/:channelName", authenticateApiRequest, authorizeChannelAccess, (async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const { channelName } = req.params;
    const { word } = req.body;

    if (!word || typeof word !== "string") {
        res.status(400).json({ error: "Word or phrase is required" });
        return;
    }

    const normalizedWord = word.toLowerCase().trim();
    if (!normalizedWord) {
        res.status(400).json({ error: "Invalid word or phrase" });
        return;
    }

    try {
        const docRef = db.collection(COLLECTIONS.TTS_CHANNEL_CONFIGS).doc(req.user.userId);
        await docRef.set({ bannedWords: FieldValue.arrayUnion(normalizedWord) }, { merge: true });

        logger.info({ channelName, word: normalizedWord }, "Added word to TTS banned list");
        res.json({ success: true, message: "Word added to banned list" });
    } catch (error) {
        logger.error({ error, channelName, word }, "Error adding word to banned list");
        res.status(500).json({ error: "Failed to add word to banned list" });
    }
}) as RequestHandler);

// DELETE /tts/banned-words/channel/:channelName - Remove word from banned list
router.delete("/tts/banned-words/channel/:channelName", authenticateApiRequest, authorizeChannelAccess, (async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const { channelName } = req.params;
    const { word } = req.body;

    if (!word || typeof word !== "string") {
        res.status(400).json({ error: "Word or phrase is required" });
        return;
    }

    const normalizedWord = word.toLowerCase().trim();
    if (!normalizedWord) {
        res.status(400).json({ error: "Invalid word or phrase" });
        return;
    }

    try {
        const docRef = db.collection(COLLECTIONS.TTS_CHANNEL_CONFIGS).doc(req.user.userId);
        await docRef.set({ bannedWords: FieldValue.arrayRemove(normalizedWord) }, { merge: true });

        logger.info({ channelName, word: normalizedWord }, "Removed word from TTS banned list");
        res.json({ success: true, message: "Word removed from banned list" });
    } catch (error) {
        logger.error({ error, channelName, word }, "Error removing word from banned list");
        res.status(500).json({ error: "Failed to remove word from banned list" });
    }
}) as RequestHandler);

export default router;
