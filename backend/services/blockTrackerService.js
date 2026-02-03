const { read, write } = require('../storage/dbStorage');
const logService = require('./logService');
const settingsService = require('./settingsService');

const BLOCKS_FILE = 'tiktok_blocks.json';

/**
 * Service to track TikTok blocks and warnings with auto-cooldown
 */
class BlockTrackerService {
    constructor() {
        this.blocks = {};
    }

    /**
     * Initialize and load blocks
     */
    async initialize() {
        try {
            this.blocks = await read(BLOCKS_FILE);
            // Ensure blockHistory exists
            if (!this.blocks.blockHistory) {
                this.blocks.blockHistory = {};
            }
        } catch (error) {
            // File doesn't exist, start fresh
            this.blocks = {
                activeBlocks: {},
                dismissedWarnings: {},
                blockHistory: {}
            };
            await this.save();
        }
    }

    /**
     * Save blocks to file
     */
    async save() {
        try {
            await write(BLOCKS_FILE, this.blocks);
        } catch (error) {
            console.error('Error saving blocks:', error);
        }
    }

    /**
     * Record a TikTok block for a user with auto-cooldown
     */
    async recordBlock(handle, errorInfo = {}) {
        if (!this.blocks.activeBlocks) {
            this.blocks.activeBlocks = {};
        }
        if (!this.blocks.blockHistory) {
            this.blocks.blockHistory = {};
        }

        // Track block history
        const userHistory = this.blocks.blockHistory[handle] || { count: 0, lastBlock: null };
        userHistory.count += 1;
        userHistory.lastBlock = new Date().toISOString();
        
        // Get cooldown settings from config
        const cooldownSettings = await settingsService.getCooldownSettings();
        const baseHours = cooldownSettings.baseHours || 1;
        const maxHours = cooldownSettings.maxHours || 72;
        
        // Calculate cooldown: exponential backoff based on count
        // Formula: baseHours * 2^(count-1), capped at maxHours
        const cooldownHours = Math.min(maxHours, baseHours * Math.pow(2, Math.min(userHistory.count - 1, Math.floor(Math.log2(maxHours / baseHours)))));
        const cooldownUntil = new Date(Date.now() + cooldownHours * 60 * 60 * 1000);
        
        this.blocks.blockHistory[handle] = userHistory;

        // Create/update block record
        const blockData = {
            handle,
            timestamp: new Date().toISOString(),
            errorInfo,
            dismissed: false,
            cooldownUntil: cooldownUntil.toISOString(),
            cooldownHours,
            blockCount: userHistory.count
        };

        this.blocks.activeBlocks[handle] = blockData;

        // Remove from dismissed warnings if it was previously dismissed
        if (this.blocks.dismissedWarnings && this.blocks.dismissedWarnings[handle]) {
            delete this.blocks.dismissedWarnings[handle];
        }

        // Log with enhanced details
        logService.warn(`TikTok block recorded for @${handle}`, {
            handle,
            blockCount: userHistory.count,
            cooldownHours,
            cooldownUntil: cooldownUntil.toISOString(),
            errorInfo: {
                type: errorInfo.type || 'DEVICE_BLOCKED',
                timestamp: new Date().toISOString()
            }
        }).catch(console.error);

        await this.save();
        return blockData;
    }

    /**
     * Check if there are active blocks
     */
    hasActiveBlocks() {
        if (!this.blocks.activeBlocks) {
            return false;
        }
        
        // Filter out dismissed blocks
        const active = Object.values(this.blocks.activeBlocks).filter(block => !block.dismissed);
        return active.length > 0;
    }

    /**
     * Get active blocks
     */
    getActiveBlocks() {
        if (!this.blocks.activeBlocks) {
            return [];
        }
        
        return Object.values(this.blocks.activeBlocks).filter(block => !block.dismissed);
    }

    /**
     * Dismiss warning for a handle
     */
    async dismissWarning(handle) {
        if (!this.blocks.activeBlocks) {
            this.blocks.activeBlocks = {};
        }
        if (!this.blocks.dismissedWarnings) {
            this.blocks.dismissedWarnings = {};
        }

        // Mark block as dismissed
        if (this.blocks.activeBlocks[handle]) {
            this.blocks.activeBlocks[handle].dismissed = true;
        }

        // Also track in dismissed warnings
        this.blocks.dismissedWarnings[handle] = {
            handle,
            dismissedAt: new Date().toISOString()
        };

        await this.save();
    }

    /**
     * Clear all blocks (for testing/admin purposes)
     */
    async clearBlocks() {
        this.blocks = {
            activeBlocks: {},
            dismissedWarnings: {}
        };
        await this.save();
    }

    /**
     * Remove block for a handle (when connection succeeds again)
     */
    async clearBlock(handle) {
        if (this.blocks.activeBlocks && this.blocks.activeBlocks[handle]) {
            delete this.blocks.activeBlocks[handle];
            
            // Log recovery
            logService.info(`TikTok block cleared for @${handle} - connection recovered`, {
                handle,
                recoveredAt: new Date().toISOString()
            }).catch(console.error);
            
            await this.save();
        }
    }

    /**
     * Check if account is in cooldown period
     */
    isInCooldown(handle) {
        const block = this.blocks.activeBlocks?.[handle];
        if (!block || !block.cooldownUntil) return false;
        
        const now = new Date();
        const cooldownUntil = new Date(block.cooldownUntil);
        return now < cooldownUntil;
    }

    /**
     * Get remaining cooldown time in minutes
     */
    getRemainingCooldown(handle) {
        const block = this.blocks.activeBlocks?.[handle];
        if (!block || !block.cooldownUntil) return null;
        
        const now = new Date();
        const cooldownUntil = new Date(block.cooldownUntil);
        const remainingMs = cooldownUntil - now;
        
        return remainingMs > 0 ? Math.ceil(remainingMs / (1000 * 60)) : 0; // minutes
    }

    /**
     * Get block details with cooldown info
     */
    getBlockDetails(handle) {
        const block = this.blocks.activeBlocks?.[handle];
        if (!block) return null;
        
        return {
            ...block,
            isInCooldown: this.isInCooldown(handle),
            remainingCooldownMinutes: this.getRemainingCooldown(handle)
        };
    }
}

// Create singleton instance
const blockTrackerService = new BlockTrackerService();

module.exports = blockTrackerService;
