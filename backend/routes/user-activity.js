const express = require('express');
const router = express.Router();
const { requireAuth } = require('../utils/auth');
const { query } = require('../config/database');
const ExcelJS = require('exceljs');

// All routes require authentication
router.use(requireAuth);

/**
 * GET /api/user-activity/autocomplete
 * Get usernames for autocomplete (from ALL event types)
 */
router.get('/autocomplete', async (req, res) => {
    try {
        const { q } = req.query;
        if (!q || q.length < 2) {
            return res.json([]);
        }
        
        const searchTerm = `%${q.toLowerCase()}%`;
        
        // Search in user_data from all event types that have user data
        const result = await query(`
            SELECT DISTINCT 
                user_data->>'uniqueId' as unique_id,
                user_data->>'nickname' as nickname
            FROM events 
            WHERE user_data->>'uniqueId' IS NOT NULL
            AND (
                LOWER(user_data->>'uniqueId') LIKE $1 
                OR LOWER(COALESCE(user_data->>'nickname', '')) LIKE $1
            )
            ORDER BY user_data->>'uniqueId' ASC
            LIMIT 20
        `, [searchTerm]);
        
        const suggestions = result.rows
            .filter(row => row.unique_id)
            .map(row => ({
                uniqueId: row.unique_id,
                nickname: row.nickname || row.unique_id
            }))
            .filter((item, index, self) => 
                index === self.findIndex(t => t.uniqueId === item.uniqueId)
            );
        
        res.json(suggestions);
    } catch (error) {
        console.error('User activity autocomplete error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * Build activity type and details from event
 */
function buildActivityLabel(row) {
    const type = row.type;
    const eventData = row.event_data || {};
    const displayType = (eventData.displayType || '').toLowerCase();
    const actionType = (eventData.actionType || '').toLowerCase();
    
    switch (type) {
        case 'chat':
            return { activityType: 'Message', details: eventData.comment || eventData.message || eventData.text || '' };
        case 'member':
            const memberAction = eventData.actionType || 'join';
            return { activityType: memberAction.toLowerCase() === 'leave' || memberAction.toLowerCase() === 'left' ? 'Leave' : 'Join', details: memberAction };
        case 'like':
            return { activityType: 'Like', details: `Count: ${eventData.likeCount || eventData.count || 1}` };
        case 'gift':
            const giftName = eventData.giftName || eventData.name || 'Unknown';
            const giftCount = eventData.giftCount || eventData.count || 1;
            return { activityType: 'Gift', details: `${giftName} (x${giftCount})` };
        case 'social':
            if (displayType.includes('follow') || actionType.includes('follow')) {
                return { activityType: 'Follow', details: 'Followed streamer' };
            }
            if (displayType.includes('share') || actionType.includes('share')) {
                return { activityType: 'Share', details: 'Shared stream' };
            }
            return { activityType: 'Social', details: displayType || actionType || 'Social action' };
        default:
            return { activityType: type, details: JSON.stringify(eventData).substring(0, 100) };
    }
}

/**
 * GET /api/user-activity/search
 * Search all activities for a user across event types
 */
router.get('/search', async (req, res) => {
    try {
        const { username, dateFrom, dateTo } = req.query;
        
        if (!username || !username.trim()) {
            return res.status(400).json({ error: 'Username is required' });
        }
        
        const cleanUsername = username.replace('@', '').toLowerCase().trim();
        
        let sqlQuery = `
            SELECT 
                e.id,
                e.session_id,
                e.type,
                e.timestamp,
                e.user_data,
                e.event_data,
                ls.handle as session_handle
            FROM events e
            INNER JOIN live_sessions ls ON e.session_id = ls.id
            WHERE (
                LOWER(e.user_data->>'uniqueId') = $1
                OR LOWER(e.user_data->>'uniqueId') LIKE $2
                OR LOWER(COALESCE(e.user_data->>'nickname', '')) LIKE $2
            )
        `;
        
        const params = [cleanUsername, `%${cleanUsername}%`];
        let paramIndex = 3;
        
        if (dateFrom) {
            sqlQuery += ` AND e.timestamp >= $${paramIndex}`;
            params.push(new Date(dateFrom).toISOString());
            paramIndex++;
        }
        
        if (dateTo) {
            const endDate = new Date(dateTo);
            endDate.setHours(23, 59, 59, 999);
            sqlQuery += ` AND e.timestamp <= $${paramIndex}`;
            params.push(endDate.toISOString());
            paramIndex++;
        }
        
        sqlQuery += ' ORDER BY e.timestamp DESC LIMIT 10000';
        
        const result = await query(sqlQuery, params);
        
        const activities = result.rows.map(row => {
            const userData = row.user_data || {};
            const { activityType, details } = buildActivityLabel(row);
            
            return {
                id: row.id,
                sessionId: row.session_id,
                type: row.type,
                timestamp: row.timestamp.toISOString(),
                sessionHandle: row.session_handle,
                activityType,
                details,
                uniqueId: userData.uniqueId || '',
                nickname: userData.nickname || userData.uniqueId || ''
            };
        });
        
        res.json(activities);
    } catch (error) {
        console.error('User activity search error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * GET /api/user-activity/export/excel
 * Export user activity to Excel
 */
router.get('/export/excel', async (req, res) => {
    try {
        const { username, dateFrom, dateTo } = req.query;
        
        if (!username || !username.trim()) {
            return res.status(400).json({ error: 'Username is required' });
        }
        
        const cleanUsername = username.replace('@', '').toLowerCase().trim();
        
        let sqlQuery = `
            SELECT 
                e.id,
                e.session_id,
                e.type,
                e.timestamp,
                e.user_data,
                e.event_data,
                ls.handle as session_handle
            FROM events e
            INNER JOIN live_sessions ls ON e.session_id = ls.id
            WHERE (
                LOWER(e.user_data->>'uniqueId') = $1
                OR LOWER(e.user_data->>'uniqueId') LIKE $2
                OR LOWER(COALESCE(e.user_data->>'nickname', '')) LIKE $2
            )
        `;
        
        const params = [cleanUsername, `%${cleanUsername}%`];
        let paramIndex = 3;
        
        if (dateFrom) {
            sqlQuery += ` AND e.timestamp >= $${paramIndex}`;
            params.push(new Date(dateFrom).toISOString());
            paramIndex++;
        }
        
        if (dateTo) {
            const endDate = new Date(dateTo);
            endDate.setHours(23, 59, 59, 999);
            sqlQuery += ` AND e.timestamp <= $${paramIndex}`;
            params.push(endDate.toISOString());
            paramIndex++;
        }
        
        sqlQuery += ' ORDER BY e.timestamp DESC LIMIT 50000';
        
        const result = await query(sqlQuery, params);
        
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('User Activity');
        
        worksheet.columns = [
            { header: 'Time', key: 'timestamp', width: 20 },
            { header: 'Session Account', key: 'sessionHandle', width: 20 },
            { header: 'Activity Type', key: 'activityType', width: 15 },
            { header: 'Details', key: 'details', width: 60 },
            { header: 'Username', key: 'uniqueId', width: 20 },
            { header: 'Nickname', key: 'nickname', width: 25 }
        ];
        
        worksheet.getRow(1).font = { bold: true };
        worksheet.getRow(1).fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFE0E0E0' }
        };
        
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
        
        result.rows.forEach(row => {
            const userData = row.user_data || {};
            const { activityType, details } = buildActivityLabel(row);
            
            worksheet.addRow({
                timestamp: formatDate(row.timestamp),
                sessionHandle: `@${row.session_handle}`,
                activityType,
                details: typeof details === 'string' ? details.substring(0, 32767) : String(details),
                uniqueId: userData.uniqueId || 'N/A',
                nickname: userData.nickname || userData.uniqueId || 'N/A'
            });
        });
        
        worksheet.getColumn('details').alignment = { wrapText: true, vertical: 'top' };
        
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
        const filename = `user_activity_${cleanUsername}_${timestamp}.xlsx`;
        
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        
        await workbook.xlsx.write(res);
        res.end();
    } catch (error) {
        console.error('Export user activity error:', error);
        res.status(500).json({ error: 'Failed to export user activity' });
    }
});

module.exports = router;
