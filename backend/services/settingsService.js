const { read, write } = require('../storage/dbStorage');

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
 * Settings Service - Manages anti-blocking settings with caching
 */
class SettingsService {
    constructor() {
        this.settings = null;
        this.lastLoadTime = null;
        this.cacheTimeout = 60000; // Cache for 1 minute
    }

    /**
     * Load settings from file (with caching)
     */
    async loadSettings(forceReload = false) {
        const now = Date.now();
        
        // Return cached settings if still valid
        if (!forceReload && this.settings && this.lastLoadTime && (now - this.lastLoadTime) < this.cacheTimeout) {
            return this.settings;
        }
        
        try {
            let settings;
            try {
                settings = await read(SETTINGS_FILE);
            } catch (error) {
                // File doesn't exist, use defaults
                settings = { ...DEFAULT_SETTINGS };
                await write(SETTINGS_FILE, settings);
            }
            
            // Merge with defaults to ensure all fields exist
            this.settings = { ...DEFAULT_SETTINGS, ...settings };
            this.lastLoadTime = now;
            
            return this.settings;
        } catch (error) {
            console.error('[Settings Service] Error loading settings:', error);
            // Return defaults on error
            this.settings = { ...DEFAULT_SETTINGS };
            this.lastLoadTime = now;
            return this.settings;
        }
    }

    /**
     * Get polling intervals in milliseconds
     */
    async getPollingIntervals() {
        const settings = await this.loadSettings();
        return {
            offlineMs: settings.pollIntervalOfflineMinutes * 60 * 1000,
            onlineMs: settings.pollIntervalOnlineSeconds * 1000
        };
    }

    /**
     * Get cooldown settings
     */
    async getCooldownSettings() {
        const settings = await this.loadSettings();
        return {
            baseHours: settings.cooldownBaseHours,
            maxHours: settings.cooldownMaxHours
        };
    }

    /**
     * Get recovery test settings
     */
    async getRecoveryTestSettings() {
        const settings = await this.loadSettings();
        return {
            delayHours: settings.recoveryTestDelayHours,
            intervalHours: settings.recoveryTestIntervalHours,
            enabled: settings.enableAutoRecovery
        };
    }

    /**
     * Get quick retry settings
     */
    async getQuickRetrySettings() {
        const settings = await this.loadSettings();
        return {
            enabled: settings.enableQuickRetry,
            attempts: settings.quickRetryAttempts,
            intervalMinutes: settings.quickRetryIntervalMinutes
        };
    }

    /**
     * Check if auto-cooldown is enabled
     */
    async isAutoCooldownEnabled() {
        const settings = await this.loadSettings();
        return settings.enableAutoCooldown !== false;
    }

    /**
     * Check if stop monitoring on block is enabled
     */
    async shouldStopMonitoringOnBlock() {
        const settings = await this.loadSettings();
        return settings.stopMonitoringOnBlock !== false;
    }

    /**
     * Check if block events should be logged
     */
    async shouldLogBlockEvents() {
        const settings = await this.loadSettings();
        return settings.logBlockEvents !== false;
    }

    /**
     * Clear cache (force reload on next access)
     */
    clearCache() {
        this.settings = null;
        this.lastLoadTime = null;
    }
}

// Create singleton instance
const settingsService = new SettingsService();

module.exports = settingsService;
