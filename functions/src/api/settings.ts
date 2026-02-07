/**
 * Channel settings API routes (TTS)
 */

import express, { Request, Response, Router } from "express";
import { db, COLLECTIONS } from "../services/firestore";
import { authenticateApiRequest } from "../middleware/auth";
import { getAllowedChannelsList } from "../services/utils";
import { logger } from "../logger";

const router: Router = express.Router();

/**
 * Middleware to check if channel is allowed to access settings
 */
const checkAllowedChannel = async (channelName: string): Promise<{ allowed: boolean; error?: string }> => {
    try {
        const allowedList = await getAllowedChannelsList();
        if (allowedList && !allowedList.includes(channelName.toLowerCase())) {
            return { allowed: false, error: "Channel is not in the allow-list" };
        }
        return { allowed: true };
    } catch (error) {
        logger.error({ error }, "Error checking allow-list");
        return { allowed: false, error: "Server error checking permissions" };
    }
};

// ==========================================
// TTS SETTINGS
// ==========================================

// GET /tts/settings/channel/:channelName
router.get("/tts/settings/channel/:channelName", authenticateApiRequest, async (req: Request, res: Response): Promise<void> => {
    const { channelName } = req.params;

    // Verify user is authorized for this channel
    if (!req.user || req.user.userLogin.toLowerCase() !== channelName.toLowerCase()) {
        res.status(403).json({ error: "Unauthorized access to channel settings" });
        return;
    }

    const allowCheck = await checkAllowedChannel(channelName);
    if (!allowCheck.allowed) {
        res.status(403).json({ error: allowCheck.error });
        return;
    }

    try {
        const docRef = db.collection(COLLECTIONS.TTS_CHANNEL_CONFIGS).doc(channelName);
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
});

// PUT /tts/settings/channel/:channelName
router.put("/tts/settings/channel/:channelName", authenticateApiRequest, async (req: Request, res: Response): Promise<void> => {
    const { channelName } = req.params;
    const { key, value } = req.body;

    // Verify user is authorized for this channel
    if (!req.user || req.user.userLogin.toLowerCase() !== channelName.toLowerCase()) {
        res.status(403).json({ error: "Unauthorized access to channel settings" });
        return;
    }

    const allowCheck = await checkAllowedChannel(channelName);
    if (!allowCheck.allowed) {
        res.status(403).json({ error: allowCheck.error });
        return;
    }

    if (!key) {
        res.status(400).json({ error: "Key is required" });
        return;
    }

    try {
        const docRef = db.collection(COLLECTIONS.TTS_CHANNEL_CONFIGS).doc(channelName);

        try {
            await docRef.update({ [key]: value });
        } catch (err: any) {
            // If document doesn't exist (code 5), create it first then update
            if (err.code === 5) {
                // We use set for the first write. 
                // Note: set with merge:true does NOT support dot notation for keys in the same way update does.
                // So we create an empty doc then update.
                await docRef.set({});
                await docRef.update({ [key]: value });
            } else {
                throw err;
            }
        }

        logger.info({ channelName, key, value }, "Updated TTS setting");
        res.json({ success: true, message: "Setting updated" });
    } catch (error) {
        logger.error({ error, channelName, key }, "Error updating TTS settings");
        res.status(500).json({ error: "Failed to update TTS setting" });
    }
});

// ==========================================
// TTS IGNORE LIST MANAGEMENT
// ==========================================

// POST /tts/ignore/channel/:channelName - Add user to ignore list
router.post("/tts/ignore/channel/:channelName", authenticateApiRequest, async (req: Request, res: Response): Promise<void> => {
    const { channelName } = req.params;
    const { username } = req.body;

    // Verify user is authorized for this channel
    if (!req.user || req.user.userLogin.toLowerCase() !== channelName.toLowerCase()) {
        res.status(403).json({ error: "Unauthorized access to channel settings" });
        return;
    }

    const allowCheck = await checkAllowedChannel(channelName);
    if (!allowCheck.allowed) {
        res.status(403).json({ error: allowCheck.error });
        return;
    }

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
        const docRef = db.collection(COLLECTIONS.TTS_CHANNEL_CONFIGS).doc(channelName);
        const docSnap = await docRef.get();

        const currentData = docSnap.exists ? docSnap.data() : {};
        const ignoredUsers: string[] = currentData?.ignoredUsers || [];

        // Check if user is already ignored
        if (ignoredUsers.includes(normalizedUsername)) {
            res.status(400).json({ error: "User is already in the ignore list" });
            return;
        }

        // Add user to ignore list
        const updatedIgnoredUsers = [...ignoredUsers, normalizedUsername];

        if (!docSnap.exists) {
            await docRef.set({ ignoredUsers: updatedIgnoredUsers });
        } else {
            await docRef.update({ ignoredUsers: updatedIgnoredUsers });
        }

        logger.info({ channelName, username: normalizedUsername }, "Added user to TTS ignore list");
        res.json({ success: true, message: "User added to ignore list", ignoredUsers: updatedIgnoredUsers });
    } catch (error) {
        logger.error({ error, channelName, username }, "Error adding user to ignore list");
        res.status(500).json({ error: "Failed to add user to ignore list" });
    }
});

// DELETE /tts/ignore/channel/:channelName - Remove user from ignore list
router.delete("/tts/ignore/channel/:channelName", authenticateApiRequest, async (req: Request, res: Response): Promise<void> => {
    const { channelName } = req.params;
    const { username } = req.body;

    // Verify user is authorized for this channel
    if (!req.user || req.user.userLogin.toLowerCase() !== channelName.toLowerCase()) {
        res.status(403).json({ error: "Unauthorized access to channel settings" });
        return;
    }

    const allowCheck = await checkAllowedChannel(channelName);
    if (!allowCheck.allowed) {
        res.status(403).json({ error: allowCheck.error });
        return;
    }

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
        const docRef = db.collection(COLLECTIONS.TTS_CHANNEL_CONFIGS).doc(channelName);
        const docSnap = await docRef.get();

        if (!docSnap.exists) {
            res.status(404).json({ error: "Channel settings not found" });
            return;
        }

        const currentData = docSnap.data();
        const ignoredUsers: string[] = currentData?.ignoredUsers || [];

        // Check if user is in the ignore list
        if (!ignoredUsers.includes(normalizedUsername)) {
            res.status(400).json({ error: "User is not in the ignore list" });
            return;
        }

        // Remove user from ignore list
        const updatedIgnoredUsers = ignoredUsers.filter((user) => user !== normalizedUsername);
        await docRef.update({ ignoredUsers: updatedIgnoredUsers });

        logger.info({ channelName, username: normalizedUsername }, "Removed user from TTS ignore list");
        res.json({ success: true, message: "User removed from ignore list", ignoredUsers: updatedIgnoredUsers });
    } catch (error) {
        logger.error({ error, channelName, username }, "Error removing user from ignore list");
        res.status(500).json({ error: "Failed to remove user from ignore list" });
    }
});

// ==========================================
// TTS BANNED WORDS MANAGEMENT
// ==========================================

// POST /tts/banned-words/channel/:channelName - Add word to banned list
router.post("/tts/banned-words/channel/:channelName", authenticateApiRequest, async (req: Request, res: Response): Promise<void> => {
    const { channelName } = req.params;
    const { word } = req.body;

    // Verify user is authorized for this channel
    if (!req.user || req.user.userLogin.toLowerCase() !== channelName.toLowerCase()) {
        res.status(403).json({ error: "Unauthorized access to channel settings" });
        return;
    }

    const allowCheck = await checkAllowedChannel(channelName);
    if (!allowCheck.allowed) {
        res.status(403).json({ error: allowCheck.error });
        return;
    }

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
        const docRef = db.collection(COLLECTIONS.TTS_CHANNEL_CONFIGS).doc(channelName);
        const docSnap = await docRef.get();

        const currentData = docSnap.exists ? docSnap.data() : {};
        const bannedWords: string[] = currentData?.bannedWords || [];

        if (bannedWords.includes(normalizedWord)) {
            res.status(400).json({ error: "Word is already in the banned list" });
            return;
        }

        const updatedBannedWords = [...bannedWords, normalizedWord];

        if (!docSnap.exists) {
            await docRef.set({ bannedWords: updatedBannedWords });
        } else {
            await docRef.update({ bannedWords: updatedBannedWords });
        }

        logger.info({ channelName, word: normalizedWord }, "Added word to TTS banned list");
        res.json({ success: true, message: "Word added to banned list", bannedWords: updatedBannedWords });
    } catch (error) {
        logger.error({ error, channelName, word }, "Error adding word to banned list");
        res.status(500).json({ error: "Failed to add word to banned list" });
    }
});

// DELETE /tts/banned-words/channel/:channelName - Remove word from banned list
router.delete("/tts/banned-words/channel/:channelName", authenticateApiRequest, async (req: Request, res: Response): Promise<void> => {
    const { channelName } = req.params;
    const { word } = req.body;

    // Verify user is authorized for this channel
    if (!req.user || req.user.userLogin.toLowerCase() !== channelName.toLowerCase()) {
        res.status(403).json({ error: "Unauthorized access to channel settings" });
        return;
    }

    const allowCheck = await checkAllowedChannel(channelName);
    if (!allowCheck.allowed) {
        res.status(403).json({ error: allowCheck.error });
        return;
    }

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
        const docRef = db.collection(COLLECTIONS.TTS_CHANNEL_CONFIGS).doc(channelName);
        const docSnap = await docRef.get();

        if (!docSnap.exists) {
            res.status(404).json({ error: "Channel settings not found" });
            return;
        }

        const currentData = docSnap.data();
        const bannedWords: string[] = currentData?.bannedWords || [];

        if (!bannedWords.includes(normalizedWord)) {
            res.status(400).json({ error: "Word is not in the banned list" });
            return;
        }

        const updatedBannedWords = bannedWords.filter((w) => w !== normalizedWord);
        await docRef.update({ bannedWords: updatedBannedWords });

        logger.info({ channelName, word: normalizedWord }, "Removed word from TTS banned list");
        res.json({ success: true, message: "Word removed from banned list", bannedWords: updatedBannedWords });
    } catch (error) {
        logger.error({ error, channelName, word }, "Error removing word from banned list");
        res.status(500).json({ error: "Failed to remove word from banned list" });
    }
});

export default router;
