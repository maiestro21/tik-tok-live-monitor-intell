const express = require('express');
const router = express.Router();
const { requireAuth } = require('../utils/auth');
const { query } = require('../config/database');
const ExcelJS = require('exceljs');

// All routes require authentication
router.use(requireAuth);

/**
 * GET /api/search-all/accounts
 * Get all TikTok accounts for filter dropdown
 */
router.get('/accounts', async (req, res) => {
    try {
        const result = await query(
            'SELECT handle, nickname, unique_id FROM tiktok_accounts ORDER BY handle ASC'
        );
        
        res.json(result.rows.map(row => ({
            handle: row.handle,
            nickname: row.nickname || '',
            uniqueId: row.unique_id || ''
        })));
    } catch (error) {
        console.error('Get accounts error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * GET /api/search-all/autocomplete
 * Get usernames for autocomplete (from chat events)
 */
router.get('/autocomplete', async (req, res) => {
    try {
        const { q } = req.query;
        if (!q || q.length < 2) {
            return res.json([]);
        }
        
        const searchTerm = `%${q.toLowerCase()}%`;
        
        // Search in user_data from chat events
        const result = await query(`
            SELECT DISTINCT 
                user_data->>'uniqueId' as unique_id,
                user_data->>'nickname' as nickname
            FROM events 
            WHERE type = 'chat' 
            AND (
                LOWER(user_data->>'uniqueId') LIKE $1 
                OR LOWER(user_data->>'nickname') LIKE $1
            )
            ORDER BY user_data->>'uniqueId' ASC
            LIMIT 20
        `, [searchTerm]);
        
        const suggestions = result.rows
            .filter(row => row.unique_id) // Only include rows with unique_id
            .map(row => ({
                uniqueId: row.unique_id,
                nickname: row.nickname || row.unique_id
            }))
            .filter((item, index, self) => 
                index === self.findIndex(t => t.uniqueId === item.uniqueId)
            ); // Remove duplicates
        
        res.json(suggestions);
    } catch (error) {
        console.error('Autocomplete error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * GET /api/search-all/search
 * Search chat messages with filters
 */
router.get('/search', async (req, res) => {
    try {
        const { accountHandle, dateFrom, dateTo, username, keyword } = req.query;
        
        // Build query
        let sqlQuery = `
            SELECT 
                e.id,
                e.session_id,
                e.timestamp,
                e.user_data,
                e.event_data,
                ls.handle as session_handle,
                ls.start_time as session_start,
                ls.end_time as session_end,
                ls.status as session_status
            FROM events e
            INNER JOIN live_sessions ls ON e.session_id = ls.id
            WHERE e.type = 'chat'
        `;
        
        const params = [];
        let paramIndex = 1;
        
        // Filter by account handle (session owner)
        if (accountHandle) {
            sqlQuery += ` AND ls.handle = $${paramIndex}`;
            params.push(accountHandle.replace('@', ''));
            paramIndex++;
        }
        
        // Filter by date range
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
        
        // Filter by username (from user_data)
        if (username) {
            const cleanUsername = username.replace('@', '').toLowerCase();
            sqlQuery += ` AND (
                LOWER(e.user_data->>'uniqueId') = $${paramIndex}
                OR LOWER(e.user_data->>'uniqueId') LIKE $${paramIndex + 1}
            )`;
            params.push(cleanUsername);
            params.push(`%${cleanUsername}%`);
            paramIndex += 2;
        }
        
        // Filter by keyword (in message or username/nickname)
        if (keyword) {
            const keywordLower = keyword.toLowerCase();
            sqlQuery += ` AND (
                LOWER(e.event_data->>'comment') LIKE $${paramIndex}
                OR LOWER(e.user_data->>'uniqueId') LIKE $${paramIndex}
                OR LOWER(e.user_data->>'nickname') LIKE $${paramIndex}
            )`;
            params.push(`%${keywordLower}%`);
            paramIndex++;
        }
        
        sqlQuery += ' ORDER BY e.timestamp DESC LIMIT 10000';
        
        const result = await query(sqlQuery, params);
        
        // Format results
        const messages = result.rows.map(row => {
            const userData = row.user_data || {};
            const eventData = row.event_data || {};
            
            return {
                id: row.id,
                sessionId: row.session_id,
                timestamp: row.timestamp.toISOString(),
                sessionHandle: row.session_handle,
                sessionStart: row.session_start.toISOString(),
                sessionEnd: row.session_end ? row.session_end.toISOString() : null,
                sessionStatus: row.session_status,
                uniqueId: userData.uniqueId || '',
                nickname: userData.nickname || userData.uniqueId || '',
                message: eventData.comment || eventData.message || '',
                profilePictureUrl: userData.profilePictureUrl || ''
            };
        });
        
        res.json(messages);
    } catch (error) {
        console.error('Search error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * GET /api/search-all/export/excel
 * Export search results to Excel
 */
router.get('/export/excel', async (req, res) => {
    try {
        const { accountHandle, dateFrom, dateTo, username, keyword } = req.query;
        
        // Use same search logic as GET /search
        let sqlQuery = `
            SELECT 
                e.id,
                e.session_id,
                e.timestamp,
                e.user_data,
                e.event_data,
                ls.handle as session_handle,
                ls.start_time as session_start,
                ls.end_time as session_end,
                ls.status as session_status
            FROM events e
            INNER JOIN live_sessions ls ON e.session_id = ls.id
            WHERE e.type = 'chat'
        `;
        
        const params = [];
        let paramIndex = 1;
        
        if (accountHandle) {
            sqlQuery += ` AND ls.handle = $${paramIndex}`;
            params.push(accountHandle.replace('@', ''));
            paramIndex++;
        }
        
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
        
        if (username) {
            const cleanUsername = username.replace('@', '').toLowerCase();
            sqlQuery += ` AND (
                LOWER(e.user_data->>'uniqueId') = $${paramIndex}
                OR LOWER(e.user_data->>'uniqueId') LIKE $${paramIndex + 1}
            )`;
            params.push(cleanUsername);
            params.push(`%${cleanUsername}%`);
            paramIndex += 2;
        }
        
        if (keyword) {
            const keywordLower = keyword.toLowerCase();
            sqlQuery += ` AND (
                LOWER(e.event_data->>'comment') LIKE $${paramIndex}
                OR LOWER(e.user_data->>'uniqueId') LIKE $${paramIndex}
                OR LOWER(e.user_data->>'nickname') LIKE $${paramIndex}
            )`;
            params.push(`%${keywordLower}%`);
            paramIndex++;
        }
        
        sqlQuery += ' ORDER BY e.timestamp DESC LIMIT 50000';
        
        const result = await query(sqlQuery, params);
        
        // Create Excel workbook
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Search Results');
        
        // Define columns
        worksheet.columns = [
            { header: 'Time', key: 'timestamp', width: 20 },
            { header: 'Session Account', key: 'sessionHandle', width: 20 },
            { header: 'Username', key: 'uniqueId', width: 20 },
            { header: 'Nickname', key: 'nickname', width: 20 },
            { header: 'Message', key: 'message', width: 60 },
            { header: 'Session Status', key: 'sessionStatus', width: 15 }
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
            const userData = row.user_data || {};
            const eventData = row.event_data || {};
            
            worksheet.addRow({
                timestamp: formatDate(row.timestamp),
                sessionHandle: `@${row.session_handle}`,
                uniqueId: userData.uniqueId || 'N/A',
                nickname: userData.nickname || userData.uniqueId || 'N/A',
                message: eventData.comment || eventData.message || '',
                sessionStatus: row.session_status || 'N/A'
            });
        });
        
        // Apply text wrapping to message column
        worksheet.getColumn('message').alignment = { wrapText: true, vertical: 'top' };
        
        // Generate filename
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
        const filename = `search_results_${timestamp}.xlsx`;
        
        // Set response headers
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        
        // Write to response
        await workbook.xlsx.write(res);
        res.end();
    } catch (error) {
        console.error('Export search to Excel error:', error);
        res.status(500).json({ error: 'Failed to export search results to Excel' });
    }
});

module.exports = router;
