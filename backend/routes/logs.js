const express = require('express');
const router = express.Router();
const { requireAuth } = require('../utils/auth');
const logService = require('../services/logService');

/**
 * GET /api/logs
 * Get console logs with optional filters
 */
router.get('/', requireAuth, async (req, res) => {
    try {
        const { level, search, limit } = req.query;
        
        const filters = {
            level: level || undefined,
            search: search || undefined,
            limit: limit ? parseInt(limit) : 500
        };
        
        const logs = await logService.getLogs(filters);
        
        res.json({
            logs,
            total: logs.length
        });
    } catch (error) {
        console.error('Get logs error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * DELETE /api/logs
 * Clear all logs
 */
router.delete('/', requireAuth, async (req, res) => {
    try {
        await logService.clearLogs();
        res.json({ success: true, message: 'Logs cleared' });
    } catch (error) {
        console.error('Clear logs error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
