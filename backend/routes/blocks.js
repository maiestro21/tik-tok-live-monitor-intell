const express = require('express');
const router = express.Router();
const { requireAuth } = require('../utils/auth');
const blockTrackerService = require('../services/blockTrackerService');

/**
 * GET /api/blocks/status
 * Check if there are active TikTok blocks with cooldown info
 */
router.get('/status', requireAuth, async (req, res) => {
    try {
        await blockTrackerService.initialize();
        const hasBlocks = blockTrackerService.hasActiveBlocks();
        const activeBlocks = blockTrackerService.getActiveBlocks();
        
        // Add cooldown info to each block
        const blocksWithCooldown = activeBlocks.map(block => ({
            ...block,
            isInCooldown: blockTrackerService.isInCooldown(block.handle),
            remainingCooldownMinutes: blockTrackerService.getRemainingCooldown(block.handle),
            blockCount: block.blockCount || 1,
            cooldownHours: block.cooldownHours || 1
        }));
        
        res.json({
            hasActiveBlocks: hasBlocks,
            activeBlocks: blocksWithCooldown
        });
    } catch (error) {
        console.error('Get blocks status error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * POST /api/blocks/:handle/dismiss
 * Dismiss warning for a handle
 */
router.post('/:handle/dismiss', requireAuth, async (req, res) => {
    try {
        const { handle } = req.params;
        await blockTrackerService.initialize();
        await blockTrackerService.dismissWarning(handle);
        
        res.json({ success: true, message: 'Warning dismissed' });
    } catch (error) {
        console.error('Dismiss warning error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
