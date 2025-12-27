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

export default router;
