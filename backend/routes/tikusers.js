const express = require('express');
const router = express.Router();
const { requireAuth } = require('../utils/auth');
const { v4: uuidv4 } = require('uuid');
const { read, write, findBy, update, deleteById, deleteNested } = require('../storage/dbStorage');
const { query } = require('../config/database');
const { fetchUserProfile, detectChanges, storeAccountHistory } = require('../services/tikTokMetaService');
const liveConnectorService = require('../services/liveConnectorService');
const blockTrackerService = require('../services/blockTrackerService');
const pollerService = require('../services/pollerService');
const ExcelJS = require('exceljs');

// All routes require authentication
router.use(requireAuth);

/**
 * GET /api/tikusers
 * List all TikTok accounts
 */
router.get('/', async (req, res) => {
    try {
        const accounts = await read('tiktok_accounts.json');
        res.json(accounts);
    } catch (error) {
        console.error('List TikTok accounts error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * GET /api/tikusers/export/excel
 * Export all TikTok accounts to Excel with all metadata
 */
router.get('/export/excel', async (req, res) => {
    try {
        // Get all accounts
        const accounts = await read('tiktok_accounts.json');
        const accountsArray = Array.isArray(accounts) ? accounts : Object.values(accounts);
        
        // Get monitoring status for each account
        const monitoredData = await read('monitored.json');
        const monitoredMap = {};
        if (Array.isArray(monitoredData)) {
            monitoredData.forEach(m => {
                if (m.handle) monitoredMap[m.handle] = m;
            });
        } else if (monitoredData && typeof monitoredData === 'object') {
            Object.values(monitoredData).forEach(m => {
                if (m && m.handle) monitoredMap[m.handle] = m;
            });
        }
        
        // Create Excel workbook
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('TikTok Accounts');
        
        // Define columns
        worksheet.columns = [
            { header: 'Handle', key: 'handle', width: 20 },
            { header: 'Nickname', key: 'nickname', width: 25 },
            { header: 'User ID', key: 'id', width: 20 },
            { header: 'Unique ID', key: 'uniqueId', width: 20 },
            { header: 'Sec UID', key: 'secUid', width: 30 },
            { header: 'Signature/Bio', key: 'signature', width: 40 },
            { header: 'Profile Picture URL', key: 'profilePictureUrl', width: 50 },
            { header: 'Verified', key: 'verified', width: 10 },
            { header: 'Secret', key: 'secret', width: 10 },
            { header: 'Private Account', key: 'privateAccount', width: 15 },
            { header: 'Language', key: 'language', width: 15 },
            { header: 'Region', key: 'region', width: 15 },
            { header: 'Followers', key: 'followerCount', width: 12 },
            { header: 'Following', key: 'followingCount', width: 12 },
            { header: 'Videos', key: 'videoCount', width: 12 },
            { header: 'Likes', key: 'heartCount', width: 12 },
            { header: 'Diggs', key: 'diggCount', width: 12 },
            { header: 'Friends', key: 'friendCount', width: 12 },
            { header: 'Creation Date', key: 'creationDate', width: 20 },
            { header: 'Unique ID Modify Time', key: 'uniqueIdModifyTime', width: 20 },
            { header: 'Nickname Modify Time', key: 'nickNameModifyTime', width: 20 },
            { header: 'Last Synced', key: 'lastSyncedAt', width: 20 },
            { header: 'Monitoring Enabled', key: 'monitoringEnabled', width: 18 },
            { header: 'Last Checked', key: 'lastCheckedAt', width: 20 },
            { header: 'Last Live', key: 'lastLiveTime', width: 20 },
            { header: 'Current Live Session ID', key: 'currentLiveSessionId', width: 40 },
            { header: 'Status', key: 'status', width: 15 }
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
                let dateObj;
                if (date instanceof Date) {
                    dateObj = date;
                } else if (typeof date === 'string') {
                    dateObj = new Date(date);
                } else if (typeof date === 'number') {
                    dateObj = date < 10000000000 ? new Date(date * 1000) : new Date(date);
                } else {
                    return 'N/A';
                }
                if (isNaN(dateObj.getTime())) return 'N/A';
                return dateObj.toLocaleString();
            } catch {
                return 'N/A';
            }
        };
        
        // Add data rows
        for (const account of accountsArray) {
            const monitored = monitoredMap[account.handle] || {};
            const isMonitoring = liveConnectorService.isMonitoring(account.handle);
            const activeSessionId = liveConnectorService.getActiveSessionId(account.handle);
            
            // Determine status
            let status = 'Offline';
            if (isMonitoring && activeSessionId) {
                status = 'Live';
            } else if (monitored.enabled) {
                status = 'Monitoring';
            }
            
            worksheet.addRow({
                handle: `@${account.handle}`,
                nickname: account.nickname || account.handle || 'N/A',
                id: account.id || 'N/A',
                uniqueId: account.uniqueId || account.handle || 'N/A',
                secUid: account.secUid || 'N/A',
                signature: account.signature || account.bio || 'N/A',
                profilePictureUrl: account.profilePictureUrl || 'N/A',
                verified: account.verified ? 'Yes' : 'No',
                secret: account.secret ? 'Yes' : 'No',
                privateAccount: account.privateAccount ? 'Yes' : 'No',
                language: account.language || 'N/A',
                region: account.region || 'N/A',
                followerCount: account.followerCount || 0,
                followingCount: account.followingCount || 0,
                videoCount: account.videoCount || 0,
                heartCount: account.heartCount || 0,
                diggCount: account.diggCount || 0,
                friendCount: account.friendCount || 0,
                creationDate: formatDate(account.creationDate || account.createTime),
                uniqueIdModifyTime: formatDate(account.uniqueIdModifyTime),
                nickNameModifyTime: formatDate(account.nickNameModifyTime),
                lastSyncedAt: formatDate(account.lastSyncedAt),
                monitoringEnabled: monitored.enabled ? 'Yes' : 'No',
                lastCheckedAt: formatDate(monitored.lastCheckedAt),
                lastLiveTime: formatDate(monitored.lastLiveTime),
                currentLiveSessionId: monitored.currentLiveSessionId || activeSessionId || 'N/A',
                status: status
            });
        }
        
        // Auto-fit columns
        worksheet.columns.forEach(column => {
            column.width = Math.max(column.width || 10, 10);
        });
        
        // Set response headers
        const filename = `tiktok_accounts_export_${new Date().toISOString().split('T')[0]}.xlsx`;
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        
        // Write to response
        await workbook.xlsx.write(res);
        res.end();
        
        console.log(`[Export] Exported ${accountsArray.length} TikTok accounts to Excel`);
    } catch (error) {
        console.error('Export TikTok accounts error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * POST /api/tikusers
 * Add new TikTok account by handle
 */
router.post('/', async (req, res) => {
    try {
        const { handle } = req.body;
        
        if (!handle) {
            return res.status(400).json({ error: 'Handle is required' });
        }
        
        const cleanHandle = handle.replace('@', '').trim();
        
        // Check if account already exists
        const existing = await findBy('tiktok_accounts.json', 'handle', cleanHandle);
        if (existing) {
            return res.status(409).json({ error: 'Account already exists' });
        }
        
        // Fetch profile data from TikTok
        const profileData = await fetchUserProfile(cleanHandle);
        
        const account = {
            id: uuidv4(),
            ...profileData,
            lastSyncedAt: new Date().toISOString(),
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };
        
        const accounts = await read('tiktok_accounts.json');
        accounts.push(account);
        await write('tiktok_accounts.json', accounts);
        
        res.status(201).json(account);
    } catch (error) {
        console.error('Add TikTok account error:', error);
        res.status(500).json({ error: error.message || 'Failed to add TikTok account' });
    }
});

/**
 * GET /api/tikusers/:handle
 * Get account details
 */
router.get('/:handle', async (req, res) => {
    try {
        const { handle } = req.params;
        const cleanHandle = handle.replace('@', '').trim();
        
        const account = await findBy('tiktok_accounts.json', 'handle', cleanHandle);
        if (!account) {
            return res.status(404).json({ error: 'Account not found' });
        }
        
        res.json(account);
    } catch (error) {
        console.error('Get TikTok account error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * PUT /api/tikusers/:handle
 * Update account (manual edit)
 */
router.put('/:handle', async (req, res) => {
    try {
        const { handle } = req.params;
        const cleanHandle = handle.replace('@', '').trim();
        const updates = req.body;
        
        const account = await findBy('tiktok_accounts.json', 'handle', cleanHandle);
        if (!account) {
            return res.status(404).json({ error: 'Account not found' });
        }
        
        // Track changes for history
        const changes = [];
        const editableFields = [
            'id', 'uniqueId', 'nickname', 'bio', 'signature', 'profilePictureUrl',
            'verified', 'secret', 'privateAccount',
            'language', 'region',
            'followerCount', 'followingCount', 'videoCount', 'heartCount', 'diggCount', 'friendCount',
            'secUid', 'creationDate', 'uniqueIdModifyTime', 'nickNameModifyTime'
        ];
        
        for (const field of editableFields) {
            if (field in updates && updates[field] !== account[field]) {
                changes.push({
                    field,
                    oldValue: account[field],
                    newValue: updates[field]
                });
            }
        }
        
        // Store history if there are changes
        if (changes.length > 0) {
            await storeAccountHistory(cleanHandle, changes, 'manual');
        }
        
        // Apply updates
        const updatedAccount = {
            ...account,
            ...updates,
            updatedAt: new Date().toISOString()
        };
        
        await update('tiktok_accounts.json', account.id, updatedAccount);
        
        res.json(updatedAccount);
    } catch (error) {
        console.error('Update TikTok account error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * POST /api/tikusers/:handle/sync
 * Sync/update account from TikTok API
 */
router.post('/:handle/sync', async (req, res) => {
    try {
        const { handle } = req.params;
        const cleanHandle = handle.replace('@', '').trim();
        
        const account = await findBy('tiktok_accounts.json', 'handle', cleanHandle);
        if (!account) {
            return res.status(404).json({ error: 'Account not found' });
        }
        
        // Fetch fresh data from TikTok
        const freshProfile = await fetchUserProfile(cleanHandle);
        
        // Detect changes
        const changes = detectChanges(account, freshProfile);
        
        // Store history if there are changes
        if (changes.length > 0) {
            await storeAccountHistory(cleanHandle, changes, 'sync');
        }
        
        // Update account
        const updatedAccount = {
            ...account,
            ...freshProfile,
            lastSyncedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };
        
        await update('tiktok_accounts.json', account.id, updatedAccount);
        
        res.json({
            account: updatedAccount,
            changes: changes.length,
            changeDetails: changes
        });
    } catch (error) {
        console.error('Sync TikTok account error:', error);
        res.status(500).json({ error: error.message || 'Failed to sync account' });
    }
});

/**
 * DELETE /api/tikusers/:handle
 * Delete account and all associated data
 */
router.delete('/:handle', async (req, res) => {
    try {
        const { handle } = req.params;
        const cleanHandle = handle.replace('@', '').trim();
        
        const account = await findBy('tiktok_accounts.json', 'handle', cleanHandle);
        if (!account) {
            return res.status(404).json({ error: 'Account not found' });
        }
        
        const io = req.app.get('io');
        const deletedItems = [];
        
        // 1. Clear poller intervals for this account
        try {
            pollerService.clearAccountInterval(cleanHandle);
            deletedItems.push('poller intervals');
        } catch (error) {
            console.warn(`[Delete Account] Error clearing poller intervals for @${cleanHandle}:`, error.message);
        }
        
        // 2. Stop active monitoring if any
        try {
            const monitored = await read('monitored.json');
            const monitorStatus = monitored[cleanHandle];
            
            if (monitorStatus && monitorStatus.currentLiveSessionId) {
                console.log(`[Delete Account] Stopping active monitoring for @${cleanHandle}`);
                await liveConnectorService.stopMonitoring(cleanHandle, io);
                deletedItems.push('active monitoring session');
            }
        } catch (error) {
            console.warn(`[Delete Account] Error stopping monitoring for @${cleanHandle}:`, error.message);
        }
        
        // 3. Get counts before deletion (for reporting)
        let sessionCount = 0;
        let alertCount = 0;
        let accountHistoryCount = 0;
        
        try {
            const sessionResult = await query(
                'SELECT COUNT(*) as count FROM live_sessions WHERE handle = $1',
                [cleanHandle]
            );
            sessionCount = parseInt(sessionResult.rows[0].count) || 0;
        } catch (error) {
            console.warn(`[Delete Account] Error counting sessions for @${cleanHandle}:`, error.message);
        }
        
        try {
            const alertResult = await query(
                'SELECT COUNT(*) as count FROM alerts WHERE handle = $1',
                [cleanHandle]
            );
            alertCount = parseInt(alertResult.rows[0].count) || 0;
        } catch (error) {
            console.warn(`[Delete Account] Error counting alerts for @${cleanHandle}:`, error.message);
        }
        
        try {
            const historyResult = await query(
                'SELECT COUNT(*) as count FROM account_history WHERE handle = $1',
                [cleanHandle]
            );
            accountHistoryCount = parseInt(historyResult.rows[0].count) || 0;
        } catch (error) {
            console.warn(`[Delete Account] Error counting account history for @${cleanHandle}:`, error.message);
        }
        
        // 4. Delete alerts for this handle (CASCADE will handle it, but we do it explicitly for reporting)
        if (alertCount > 0) {
            try {
                await query('DELETE FROM alerts WHERE handle = $1', [cleanHandle]);
                deletedItems.push(`${alertCount} alert(s)`);
            } catch (error) {
                console.warn(`[Delete Account] Error deleting alerts for @${cleanHandle}:`, error.message);
            }
        }
        
        // 5. Delete account_history for this handle
        if (accountHistoryCount > 0) {
            try {
                await query('DELETE FROM account_history WHERE handle = $1', [cleanHandle]);
                deletedItems.push(`${accountHistoryCount} account history entry/entries`);
            } catch (error) {
                console.warn(`[Delete Account] Error deleting account history for @${cleanHandle}:`, error.message);
            }
        }
        
        // 6. Delete tiktok_blocks entry if exists
        try {
            const blockResult = await query(
                'SELECT COUNT(*) as count FROM tiktok_blocks WHERE handle = $1',
                [cleanHandle]
            );
            const blockCount = parseInt(blockResult.rows[0].count) || 0;
            if (blockCount > 0) {
                await query('DELETE FROM tiktok_blocks WHERE handle = $1', [cleanHandle]);
                deletedItems.push('block tracking data');
            }
        } catch (error) {
            console.warn(`[Delete Account] Error deleting tiktok_blocks for @${cleanHandle}:`, error.message);
        }
        
        // 7. Remove from monitored table
        try {
            const monitoredResult = await query(
                'SELECT COUNT(*) as count FROM monitored WHERE handle = $1',
                [cleanHandle]
            );
            const monitoredCount = parseInt(monitoredResult.rows[0].count) || 0;
            if (monitoredCount > 0) {
                await query('DELETE FROM monitored WHERE handle = $1', [cleanHandle]);
                deletedItems.push('monitoring status');
            }
        } catch (error) {
            console.warn(`[Delete Account] Error removing from monitored for @${cleanHandle}:`, error.message);
        }
        
        // 8. Delete live_sessions (this will CASCADE delete events and stats_history automatically)
        if (sessionCount > 0) {
            try {
                await query('DELETE FROM live_sessions WHERE handle = $1', [cleanHandle]);
                deletedItems.push(`${sessionCount} live session(s) with all related events and stats`);
            } catch (error) {
                console.warn(`[Delete Account] Error deleting live sessions for @${cleanHandle}:`, error.message);
            }
        }
        
        // 9. Remove block entries for this handle
        try {
            await blockTrackerService.initialize();
            if (blockTrackerService.getActiveBlocks().find(b => b.handle === cleanHandle)) {
                await blockTrackerService.clearBlock(cleanHandle);
                deletedItems.push('block tracking data');
            }
        } catch (error) {
            console.warn(`[Delete Account] Error clearing blocks for @${cleanHandle}:`, error.message);
        }
        
        // 10. Finally, delete the account itself
        await deleteById('tiktok_accounts.json', account.id);
        deletedItems.push('account record');
        
        console.log(`[Delete Account] Successfully deleted @${cleanHandle}. Removed: ${deletedItems.join(', ')}`);
        
        res.json({ 
            message: 'Account and all associated data deleted successfully',
            deleted: deletedItems
        });
    } catch (error) {
        console.error('Delete TikTok account error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * GET /api/tikusers/:handle/history
 * Get account change history
 */
router.get('/:handle/history', async (req, res) => {
    try {
        const { handle } = req.params;
        const cleanHandle = handle.replace('@', '').trim();
        
        // Check if account exists
        const account = await findBy('tiktok_accounts.json', 'handle', cleanHandle);
        if (!account) {
            return res.status(404).json({ error: 'Account not found' });
        }
        
        // Read history file
        const historyFile = `account_history/${cleanHandle}.json`;
        let history = [];
        
        try {
            const historyData = await read(historyFile);
            // Ensure it's an array
            if (Array.isArray(historyData)) {
                history = historyData;
            } else if (historyData && typeof historyData === 'object') {
                // If it's an object (not array), convert to array or start fresh
                history = [];
            } else {
                history = [];
            }
        } catch (error) {
            // File doesn't exist, return empty array
            history = [];
        }
        
        // Sort by timestamp descending (most recent first)
        if (Array.isArray(history) && history.length > 0) {
            history.sort((a, b) => {
                const dateA = a.timestamp ? new Date(a.timestamp) : new Date(0);
                const dateB = b.timestamp ? new Date(b.timestamp) : new Date(0);
                return dateB - dateA;
            });
        }
        
        res.json(history);
    } catch (error) {
        console.error('Get account history error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

    /**
     * GET /api/tikusers/:handle/analytics
     * Get comprehensive analytics for a TikTok account
     */
    router.get('/:handle/analytics', async (req, res) => {
        try {
            const { handle } = req.params;
            const cleanHandle = handle.replace('@', '').trim();
            
            const account = await findBy('tiktok_accounts.json', 'handle', cleanHandle);
            if (!account) {
                return res.status(404).json({ error: 'Account not found' });
            }
            
            // Get all sessions for this user from database
            let allSessions = [];
            
            try {
                const sessionsResult = await query(
                    'SELECT * FROM live_sessions WHERE handle = $1 ORDER BY start_time DESC',
                    [cleanHandle]
                );
                
                allSessions = sessionsResult.rows.map(row => ({
                    sessionId: row.id,
                    handle: row.handle,
                    startTime: row.start_time.toISOString(),
                    endTime: row.end_time ? row.end_time.toISOString() : null,
                    status: row.status,
                    roomId: row.room_id ? String(row.room_id) : null,
                    stats: row.stats || {}
                }));
            } catch (error) {
                console.error(`Error reading sessions for @${cleanHandle}:`, error);
            }
            
            // Sort sessions by start time (newest first)
            allSessions.sort((a, b) => new Date(b.startTime) - new Date(a.startTime));
            
            // Calculate last 7 days statistics
            const sevenDaysAgo = new Date();
            sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
            
            const last7DaysSessions = allSessions.filter(session => {
                const startTime = new Date(session.startTime);
                return startTime >= sevenDaysAgo;
            });
            
            const last7DaysStats = calculatePeriodStats(last7DaysSessions);
            
            // Calculate all-time statistics
            const allTimeStats = calculatePeriodStats(allSessions);
            
            // Calculate session frequency
            const sessionFreq = calculateSessionFrequency(allSessions);
            
            // Get recent sessions (last 10)
            const recentSessions = allSessions.slice(0, 10).map(session => ({
                sessionId: session.sessionId,
                startTime: session.startTime,
                endTime: session.endTime,
                status: session.status,
                stats: session.stats || {}
            }));
            
            // Create activity chart data (last 7 days daily breakdown)
            const activityChart = generateActivityChart(last7DaysSessions);
            
            res.json({
                accountInfo: {
                    id: account.id,
                    verified: account.verified || false,
                    privateAccount: account.privateAccount || false,
                    language: account.language || null,
                    region: account.region || null,
                    createTime: account.createTime ? (typeof account.createTime === 'number' ? account.createTime : (account.createTime < 10000000000 ? account.createTime : null)) : null
                },
                last7Days: last7DaysStats,
                allTimeStats: allTimeStats,
                sessionFreq: sessionFreq,
                recentSessions: recentSessions,
                activityChart: activityChart
            });
        } catch (error) {
            console.error('Get analytics error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    });

    /**
     * Calculate statistics for a period of sessions
     */
    function calculatePeriodStats(sessions) {
        if (!sessions || sessions.length === 0) {
            return {
                totalSessions: 0,
                totalDuration: 0,
                totalLikes: 0,
                maxViewers: 0,
                totalGifts: 0,
                totalMessages: 0,
                totalJoins: 0,
                totalFollows: 0,
                totalShares: 0,
                totalReposts: 0,
                totalSubscribes: 0,
                totalEmotes: 0,
                avgSessionDuration: 0
            };
        }
        
        let totalDuration = 0;
        let totalLikes = 0;
        let maxViewers = 0;
        let peakViewers = 0;
        let totalGifts = 0;
        let totalMessages = 0;
        let totalJoins = 0;
        let totalFollows = 0;
        let totalShares = 0;
        let totalReposts = 0;
        let totalSubscribes = 0;
        let totalEmotes = 0;
        
        sessions.forEach(session => {
            const startTime = new Date(session.startTime);
            const endTime = session.endTime ? new Date(session.endTime) : new Date();
            const duration = Math.floor((endTime - startTime) / 1000); // seconds
            totalDuration += duration;
            
            const stats = session.stats || {};
            totalLikes += stats.totalLikes || 0;
            const sessionViewers = stats.totalViewers || 0;
            maxViewers = Math.max(maxViewers, sessionViewers);
            peakViewers = Math.max(peakViewers, sessionViewers); // Peak across all sessions
            totalGifts += stats.totalGifts || 0;
            totalMessages += stats.totalMessages || 0;
            totalJoins += stats.totalJoins || 0;
            totalFollows += stats.totalFollows || 0;
            totalShares += stats.totalShares || 0;
            totalReposts += stats.totalReposts || 0;
            totalSubscribes += stats.totalSubscribes || 0;
            totalEmotes += (stats.totalEmotes || 0);
        });
        
        return {
            totalSessions: sessions.length,
            totalDuration: totalDuration,
            totalLikes: totalLikes,
            maxViewers: maxViewers,
            peakViewers: peakViewers,
            totalGifts: totalGifts,
            totalMessages: totalMessages,
            totalJoins: totalJoins,
            totalFollows: totalFollows,
            totalShares: totalShares,
            totalReposts: totalReposts,
            totalSubscribes: totalSubscribes,
            totalEmotes: totalEmotes,
            avgSessionDuration: sessions.length > 0 ? Math.floor(totalDuration / sessions.length) : 0
        };
    }

    /**
     * Calculate session frequency statistics
     */
    function calculateSessionFrequency(sessions) {
        if (!sessions || sessions.length === 0) {
            return {
                totalSessions: 0,
                daysTracked: 0,
                dailyBreakdown: []
            };
        }
        
        // Group sessions by date
        const dailyGroups = {};
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        sessions.forEach(session => {
            const sessionDate = new Date(session.startTime);
            sessionDate.setHours(0, 0, 0, 0);
            const dateKey = sessionDate.toISOString().split('T')[0];
            
            if (!dailyGroups[dateKey]) {
                dailyGroups[dateKey] = {
                    date: dateKey,
                    sessions: 0,
                    totalDuration: 0
                };
            }
            
            dailyGroups[dateKey].sessions += 1;
            const startTime = new Date(session.startTime);
            const endTime = session.endTime ? new Date(session.endTime) : new Date();
            const duration = Math.floor((endTime - startTime) / 1000);
            dailyGroups[dateKey].totalDuration += duration;
        });
        
        // Convert to array and sort by date
        const dailyBreakdown = Object.values(dailyGroups).sort((a, b) => 
            new Date(b.date) - new Date(a.date)
        );
        
        // Calculate days tracked (from first session to today)
        const firstSession = sessions[sessions.length - 1]; // Oldest
        const firstDate = new Date(firstSession.startTime);
        firstDate.setHours(0, 0, 0, 0);
        const daysTracked = Math.ceil((today - firstDate) / (1000 * 60 * 60 * 24)) || 1;
        
        return {
            totalSessions: sessions.length,
            daysTracked: daysTracked,
            dailyBreakdown: dailyBreakdown
        };
    }

    /**
     * Generate activity chart data for last 7 days
     */
    function generateActivityChart(sessions) {
        const chart = [0, 0, 0, 0, 0, 0, 0]; // 7 days
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        sessions.forEach(session => {
            const sessionDate = new Date(session.startTime);
            sessionDate.setHours(0, 0, 0, 0);
            const daysAgo = Math.floor((today - sessionDate) / (1000 * 60 * 60 * 24));
            
            if (daysAgo >= 0 && daysAgo < 7) {
                // Add session duration (in minutes) to chart
                const startTime = new Date(session.startTime);
                const endTime = session.endTime ? new Date(session.endTime) : new Date();
                const duration = Math.floor((endTime - startTime) / (1000 * 60)); // minutes
                chart[6 - daysAgo] += duration;
            }
        });
        
        return chart;
    }

    module.exports = router;
