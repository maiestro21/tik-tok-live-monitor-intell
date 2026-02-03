const express = require('express');
const router = express.Router();
const { requireAuth } = require('../utils/auth');
const { v4: uuidv4 } = require('uuid');
const { read, write, update, deleteById, findBy } = require('../storage/dbStorage');
const ExcelJS = require('exceljs');

// All routes require authentication
router.use(requireAuth);

/**
 * GET /api/alerts
 * List all alerts with optional filters
 */
router.get('/', async (req, res) => {
    try {
        const { status, severity, handle, dateFrom, dateTo, triggerWord } = req.query;
        const { query } = require('../config/database');
        
        // Build query with filters
        let sqlQuery = 'SELECT * FROM alerts WHERE 1=1';
        const params = [];
        let paramIndex = 1;
        
        if (status) {
            sqlQuery += ` AND status = $${paramIndex}`;
            params.push(status);
            paramIndex++;
        }
        
        if (severity) {
            // Normalize severity (low, medium, high -> LOW, MED, MEDIUM, HIGH)
            const severityUpper = severity.toUpperCase();
            if (severityUpper === 'MED') {
                sqlQuery += ` AND (severity = 'MED' OR severity = 'MEDIUM')`;
            } else {
                sqlQuery += ` AND severity = $${paramIndex}`;
                params.push(severityUpper);
                paramIndex++;
            }
        }
        
        if (handle) {
            sqlQuery += ` AND handle = $${paramIndex}`;
            params.push(handle.replace('@', ''));
            paramIndex++;
        }
        
        if (dateFrom) {
            sqlQuery += ` AND timestamp >= $${paramIndex}`;
            params.push(new Date(dateFrom).toISOString());
            paramIndex++;
        }
        
        if (dateTo) {
            // Add one day to include the entire end date
            const endDate = new Date(dateTo);
            endDate.setHours(23, 59, 59, 999);
            sqlQuery += ` AND timestamp <= $${paramIndex}`;
            params.push(endDate.toISOString());
            paramIndex++;
        }
        
        if (triggerWord) {
            sqlQuery += ` AND type = $${paramIndex}`;
            params.push(triggerWord);
            paramIndex++;
        }
        
        sqlQuery += ' ORDER BY timestamp DESC';
        
        const result = await query(sqlQuery, params);
        
        // Convert database rows to JSON format
        const alerts = result.rows.map(row => ({
            id: row.id,
            handle: row.handle,
            sessionId: row.session_id,
            eventId: row.event_id,
            triggerWord: row.type, // type contains trigger word
            timestamp: row.timestamp.toISOString(),
            severity: row.severity.toLowerCase(),
            status: row.status,
            message: row.message,
            acknowledgedAt: row.acknowledged_at ? row.acknowledged_at.toISOString() : null,
            resolvedAt: row.resolved_at ? row.resolved_at.toISOString() : null
        }));

        res.json(alerts);
    } catch (error) {
        console.error('List alerts error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * GET /api/alerts/export/excel
 * Export alerts to Excel with filters applied
 * IMPORTANT: This route must be defined BEFORE /:id to avoid route conflicts
 */
router.get('/export/excel', async (req, res) => {
    try {
        const { status, severity, handle, dateFrom, dateTo, triggerWord } = req.query;
        const { query } = require('../config/database');
        
        // Build query with filters (same as GET /api/alerts)
        let sqlQuery = 'SELECT * FROM alerts WHERE 1=1';
        const params = [];
        let paramIndex = 1;
        
        if (status) {
            sqlQuery += ` AND status = $${paramIndex}`;
            params.push(status);
            paramIndex++;
        }
        
        if (severity) {
            const severityUpper = severity.toUpperCase();
            if (severityUpper === 'MED') {
                sqlQuery += ` AND (severity = 'MED' OR severity = 'MEDIUM')`;
            } else {
                sqlQuery += ` AND severity = $${paramIndex}`;
                params.push(severityUpper);
                paramIndex++;
            }
        }
        
        if (handle) {
            sqlQuery += ` AND handle = $${paramIndex}`;
            params.push(handle.replace('@', ''));
            paramIndex++;
        }
        
        if (dateFrom) {
            sqlQuery += ` AND timestamp >= $${paramIndex}`;
            params.push(new Date(dateFrom).toISOString());
            paramIndex++;
        }
        
        if (dateTo) {
            const endDate = new Date(dateTo);
            endDate.setHours(23, 59, 59, 999);
            sqlQuery += ` AND timestamp <= $${paramIndex}`;
            params.push(endDate.toISOString());
            paramIndex++;
        }
        
        if (triggerWord) {
            sqlQuery += ` AND type = $${paramIndex}`;
            params.push(triggerWord);
            paramIndex++;
        }
        
        sqlQuery += ' ORDER BY timestamp DESC';
        
        const result = await query(sqlQuery, params);
        
        // Create Excel workbook
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Alerts');
        
        // Define columns
        worksheet.columns = [
            { header: 'Time', key: 'timestamp', width: 20 },
            { header: 'Account', key: 'handle', width: 20 },
            { header: 'Trigger Word', key: 'triggerWord', width: 20 },
            { header: 'Message', key: 'message', width: 50 },
            { header: 'Severity', key: 'severity', width: 12 },
            { header: 'Status', key: 'status', width: 15 },
            { header: 'Acknowledged At', key: 'acknowledgedAt', width: 20 },
            { header: 'Resolved At', key: 'resolvedAt', width: 20 }
        ];
        
        // Style header row
        worksheet.getRow(1).font = { bold: true };
        worksheet.getRow(1).fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFE0E0E0' }
        };
        
        // Helper function to format dates
        const formatDate = (date) => {
            if (!date) return 'N/A';
            try {
                const d = date instanceof Date ? date : new Date(date);
                if (isNaN(d.getTime())) return 'N/A';
                return d.toLocaleString();
            } catch {
                return 'N/A';
            }
        };
        
        // Add data rows
        result.rows.forEach(row => {
            worksheet.addRow({
                timestamp: formatDate(row.timestamp),
                handle: `@${row.handle}`,
                triggerWord: row.type || 'N/A',
                message: row.message || '',
                severity: (row.severity || 'MEDIUM').toUpperCase(),
                status: row.status || 'pending',
                acknowledgedAt: row.acknowledged_at ? formatDate(row.acknowledged_at) : 'N/A',
                resolvedAt: row.resolved_at ? formatDate(row.resolved_at) : 'N/A'
            });
        });
        
        // Apply text wrapping to message column
        worksheet.getColumn('message').alignment = { wrapText: true, vertical: 'top' };
        
        // Generate filename with timestamp
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
        const filename = `alerts_${timestamp}.xlsx`;
        
        // Set response headers
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        
        // Write to response
        await workbook.xlsx.write(res);
        res.end();
    } catch (error) {
        console.error('Export alerts to Excel error:', error);
        res.status(500).json({ error: 'Failed to export alerts to Excel' });
    }
});

/**
 * GET /api/alerts/trigger-words
 * List all trigger words
 * IMPORTANT: This route must be defined BEFORE /:id to avoid route conflicts
 */
router.get('/trigger-words', async (req, res) => {
    try {
        const { query } = require('../config/database');
        const result = await query('SELECT * FROM trigger_words ORDER BY created_at DESC');
        
        const triggerWords = result.rows.map(row => ({
            id: row.id,
            word: row.word.toLowerCase(), // Always return lowercase
            severity: row.severity || 'medium', // Default to medium if null
            createdAt: row.created_at.toISOString()
        }));
        
        res.json(triggerWords);
    } catch (error) {
        console.error('List trigger words error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * POST /api/alerts/trigger-words
 * Add a trigger word
 * IMPORTANT: This route must be defined BEFORE /:id to avoid route conflicts
 */
router.post('/trigger-words', async (req, res) => {
    try {
        const { word, severity = 'medium' } = req.body;
        
        if (!word || typeof word !== 'string' || word.trim().length === 0) {
            return res.status(400).json({ error: 'Word is required' });
        }
        
        // Normalize word to lowercase
        const normalizedWord = word.trim().toLowerCase();
        
        // Validate and normalize severity
        const validSeverities = ['low', 'medium', 'high'];
        const severityLower = severity.toLowerCase();
        if (!validSeverities.includes(severityLower)) {
            return res.status(400).json({ error: 'Invalid severity. Must be low, medium, or high' });
        }
        
        // Map to database values: 'low' -> 'LOW', 'medium' -> 'MEDIUM', 'high' -> 'HIGH'
        const severityMap = {
            'low': 'LOW',
            'medium': 'MEDIUM',
            'high': 'HIGH'
        };
        const normalizedSeverity = severityMap[severityLower];
        
        const { query } = require('../config/database');
        
        // Check if already exists (case-insensitive check)
        const checkResult = await query(
            'SELECT id FROM trigger_words WHERE LOWER(word) = LOWER($1)',
            [normalizedWord]
        );
        
        if (checkResult.rows.length > 0) {
            return res.status(409).json({ error: 'Trigger word already exists' });
        }
        
        // Insert into database (always save as lowercase, case_sensitive is ignored but kept for compatibility)
        const insertResult = await query(
            'INSERT INTO trigger_words (id, word, case_sensitive, severity, created_at) VALUES (gen_random_uuid(), $1, $2, $3, NOW()) RETURNING *',
            [normalizedWord, false, normalizedSeverity]
        );
        
        const newTrigger = {
            id: insertResult.rows[0].id,
            word: insertResult.rows[0].word.toLowerCase(),
            severity: insertResult.rows[0].severity || normalizedSeverity,
            createdAt: insertResult.rows[0].created_at.toISOString()
        };
        
        res.status(201).json(newTrigger);
    } catch (error) {
        // Handle duplicate key error from database unique constraint
        if (error.code === '23505' || error.message.includes('duplicate key') || error.message.includes('unique constraint')) {
            return res.status(409).json({ error: 'Trigger word already exists' });
        }
        console.error('Add trigger word error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * DELETE /api/alerts/trigger-words/:id
 * Remove a trigger word
 * IMPORTANT: This route must be defined BEFORE /:id to avoid route conflicts
 */
router.delete('/trigger-words/:id', async (req, res) => {
    try {
        const { id } = req.params;
        await deleteById('trigger_words.json', id);
        res.json({ message: 'Trigger word deleted successfully' });
    } catch (error) {
        if (error.message.includes('not found')) {
            return res.status(404).json({ error: error.message });
        }
        console.error('Delete trigger word error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * GET /api/alerts/:id
 * Get alert details
 * IMPORTANT: This route must be defined AFTER specific routes like /trigger-words
 */
router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        
        // Validate that id is a valid UUID format
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (!uuidRegex.test(id)) {
            return res.status(400).json({ error: 'Invalid alert ID format' });
        }
        
        const alert = await findBy('alerts.json', 'id', id);
        
        if (!alert) {
            return res.status(404).json({ error: 'Alert not found' });
        }
        
        res.json(alert);
    } catch (error) {
        console.error('Get alert error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * PUT /api/alerts/:id/acknowledge
 * Acknowledge an alert
 */
router.put('/:id/acknowledge', async (req, res) => {
    try {
        const { id } = req.params;
        
        // Validate that id is a valid UUID format
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (!uuidRegex.test(id)) {
            return res.status(400).json({ error: 'Invalid alert ID format' });
        }
        
        const alert = await findBy('alerts.json', 'id', id);
        
        if (!alert) {
            return res.status(404).json({ error: 'Alert not found' });
        }
        
        await update('alerts.json', id, {
            status: 'acknowledged',
            acknowledgedAt: new Date().toISOString()
        });
        
        // Emit Socket.IO event
        const io = req.app.get('io');
        if (io) {
            io.emit('alertAcknowledged', { id });
        }
        
        res.json({ message: 'Alert acknowledged successfully' });
    } catch (error) {
        console.error('Acknowledge alert error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * PUT /api/alerts/:id/resolve
 * Resolve an alert
 */
router.put('/:id/resolve', async (req, res) => {
    try {
        const { id } = req.params;
        
        // Validate that id is a valid UUID format
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (!uuidRegex.test(id)) {
            return res.status(400).json({ error: 'Invalid alert ID format' });
        }
        
        const alert = await findBy('alerts.json', 'id', id);
        
        if (!alert) {
            return res.status(404).json({ error: 'Alert not found' });
        }
        
        await update('alerts.json', id, {
            status: 'resolved',
            resolvedAt: new Date().toISOString()
        });
        
        // Emit Socket.IO event
        const io = req.app.get('io');
        if (io) {
            io.emit('alertResolved', { id });
        }
        
        res.json({ message: 'Alert resolved successfully' });
    } catch (error) {
        console.error('Resolve alert error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
