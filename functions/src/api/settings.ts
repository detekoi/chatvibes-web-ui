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

export default router;
