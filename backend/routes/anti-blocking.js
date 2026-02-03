const express = require('express');
const router = express.Router();
const { requireAuth } = require('../utils/auth');
const { read, write } = require('../storage/dbStorage');
const settingsService = require('../services/settingsService');

const SETTINGS_FILE = 'anti_blocking_settings.json';

// Default settings
const DEFAULT_SETTINGS = {
    enableQuickRetry: true,
    quickRetryAttempts: 3,
    quickRetryIntervalMinutes: 5,
    pollIntervalOfflineMinutes: 10,
    pollIntervalOnlineSeconds: 60,
    cooldownBaseHours: 1,
    cooldownMaxHours: 72,
    recoveryTestDelayHours: 2,
    recoveryTestIntervalHours: 2,
    enableAutoCooldown: true,
    enableAutoRecovery: true,
    stopMonitoringOnBlock: true,
    logBlockEvents: true
};

/**
 * GET /api/anti-blocking/settings
 * Get anti-blocking settings
 */
router.get('/settings', requireAuth, async (req, res) => {
    try {
        let settings;
        try {
            settings = await read(SETTINGS_FILE);
        } catch (error) {
            // File doesn't exist, return defaults
            settings = DEFAULT_SETTINGS;
            await write(SETTINGS_FILE, settings);
        }
        
        // Merge with defaults to ensure all fields exist
        settings = { ...DEFAULT_SETTINGS, ...settings };
        
        res.json(settings);
    } catch (error) {
        console.error('Get anti-blocking settings error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * POST /api/anti-blocking/settings
 * Save anti-blocking settings
 */
router.post('/settings', requireAuth, async (req, res) => {
    try {
        const {
            enableQuickRetry,
            quickRetryAttempts,
            quickRetryIntervalMinutes,
            pollIntervalOfflineMinutes,
            pollIntervalOnlineSeconds,
            cooldownBaseHours,
            cooldownMaxHours,
            recoveryTestDelayHours,
            recoveryTestIntervalHours,
            enableAutoCooldown,
            enableAutoRecovery,
            stopMonitoringOnBlock,
            logBlockEvents
        } = req.body;
        
        // Validate inputs
        const settings = {
            enableQuickRetry: enableQuickRetry !== false,
            quickRetryAttempts: Math.max(1, Math.min(10, parseInt(quickRetryAttempts) || DEFAULT_SETTINGS.quickRetryAttempts)),
            quickRetryIntervalMinutes: Math.max(1, Math.min(30, parseInt(quickRetryIntervalMinutes) || DEFAULT_SETTINGS.quickRetryIntervalMinutes)),
            pollIntervalOfflineMinutes: Math.max(5, Math.min(60, parseInt(pollIntervalOfflineMinutes) || DEFAULT_SETTINGS.pollIntervalOfflineMinutes)),
            pollIntervalOnlineSeconds: Math.max(30, Math.min(300, parseInt(pollIntervalOnlineSeconds) || DEFAULT_SETTINGS.pollIntervalOnlineSeconds)),
            cooldownBaseHours: Math.max(1, Math.min(24, parseInt(cooldownBaseHours) || DEFAULT_SETTINGS.cooldownBaseHours)),
            cooldownMaxHours: Math.max(24, Math.min(168, parseInt(cooldownMaxHours) || DEFAULT_SETTINGS.cooldownMaxHours)),
            recoveryTestDelayHours: Math.max(1, Math.min(24, parseInt(recoveryTestDelayHours) || DEFAULT_SETTINGS.recoveryTestDelayHours)),
            recoveryTestIntervalHours: Math.max(1, Math.min(12, parseInt(recoveryTestIntervalHours) || DEFAULT_SETTINGS.recoveryTestIntervalHours)),
            enableAutoCooldown: enableAutoCooldown !== false,
            enableAutoRecovery: enableAutoRecovery !== false,
            stopMonitoringOnBlock: stopMonitoringOnBlock !== false,
            logBlockEvents: logBlockEvents !== false
        };
        
        await write(SETTINGS_FILE, settings);
        
        // Clear settings cache to force reload
        settingsService.clearCache();
        
        res.json({ success: true, settings });
    } catch (error) {
        console.error('Save anti-blocking settings error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
