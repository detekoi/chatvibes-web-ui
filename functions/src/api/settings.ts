/**
 * Channel settings API routes (TTS and Music)
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
        await docRef.set({ [key]: value }, { merge: true });

        logger.info({ channelName, key, value }, "Updated TTS setting");
        res.json({ success: true, message: "Setting updated" });
    } catch (error) {
        logger.error({ error, channelName, key }, "Error updating TTS settings");
        res.status(500).json({ error: "Failed to update TTS setting" });
    }
});

// ==========================================
// MUSIC SETTINGS
// ==========================================

// GET /music/settings/channel/:channelName
router.get("/music/settings/channel/:channelName", authenticateApiRequest, async (req: Request, res: Response): Promise<void> => {
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
        const docRef = db.collection(COLLECTIONS.MUSIC_SETTINGS).doc(channelName);
        const docSnap = await docRef.get();

        if (docSnap.exists) {
            res.json({ settings: docSnap.data() || {} });
        } else {
            res.json({ settings: {} });
        }
    } catch (error) {
        logger.error({ error, channelName }, "Error fetching Music settings");
        res.status(500).json({ error: "Failed to fetch Music settings" });
    }
});

// PUT /music/settings/channel/:channelName
router.put("/music/settings/channel/:channelName", authenticateApiRequest, async (req: Request, res: Response): Promise<void> => {
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
        const docRef = db.collection(COLLECTIONS.MUSIC_SETTINGS).doc(channelName);
        await docRef.set({ [key]: value }, { merge: true });

        logger.info({ channelName, key, value }, "Updated Music setting");
        res.json({ success: true, message: "Setting updated" });
    } catch (error) {
        logger.error({ error, channelName, key }, "Error updating Music settings");
        res.status(500).json({ error: "Failed to update Music setting" });
    }
});

export default router;
