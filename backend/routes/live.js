const express = require('express');
const router = express.Router();
const { requireAuth } = require('../utils/auth');
const { read, write, updateNested } = require('../storage/dbStorage');
const { query } = require('../config/database');
const { findBy } = require('../storage/dbStorage');
const liveConnectorService = require('../services/liveConnectorService');
const ExcelJS = require('exceljs');

// All routes require authentication
router.use(requireAuth);

/**
 * GET /api/live/active
 * Get all currently active live sessions
 */
router.get('/active', async (req, res) => {
    try {
        const monitored = await read('monitored.json');
        const activeSessions = [];
        
        for (const [handle, status] of Object.entries(monitored)) {
            // Verify actual monitoring state - this is the source of truth
            const isActuallyMonitoring = liveConnectorService.isMonitoring(handle);
            const activeSessionId = liveConnectorService.getActiveSessionId(handle);
            
            // Only include sessions that are actually being monitored
            const sessionId = isActuallyMonitoring && activeSessionId ? activeSessionId : null;
            
            // If monitored.json has a session ID but monitoring is not active, clear it
            if (status.currentLiveSessionId && !isActuallyMonitoring) {
                try {
                    await updateNested('monitored.json', handle, {
                        currentLiveSessionId: null
                    });
                } catch (error) {
                    console.warn(`[Live Active] Error clearing stale session ID for @${handle}:`, error.message);
                }
            }
            
            // If monitoring is active but monitored.json is out of sync, sync it
            if (isActuallyMonitoring && activeSessionId && status.currentLiveSessionId !== activeSessionId) {
                try {
                    await updateNested('monitored.json', handle, {
                        currentLiveSessionId: activeSessionId,
                        enabled: status.enabled !== undefined ? status.enabled : true
                    });
                } catch (error) {
                    console.warn(`[Live Active] Error syncing monitored.json for @${handle}:`, error.message);
                }
            }
            
            if (sessionId) {
                try {
                    // Try to read from database first
                    const sessionResult = await query(
                        'SELECT * FROM live_sessions WHERE id = $1',
                        [sessionId]
                    );
                    
                    let session;
                    if (sessionResult.rows.length > 0) {
                        const row = sessionResult.rows[0];
                        session = {
                            startTime: row.start_time.toISOString(),
                            stats: row.stats || {}
                        };
                    } else {
                        // Fallback to file if not in database
                        session = await read(`live_sessions/${handle}/${sessionId}.json`);
                    }
                    
                    if (!session) continue;
                    
                    // Get account info
                    const account = await findBy('tiktok_accounts.json', 'handle', handle) || { handle, nickname: handle };
                    
                    activeSessions.push({
                        handle,
                        sessionId: sessionId,
                        startTime: session.startTime,
                        stats: session.stats || {},
                        account: {
                            nickname: account.nickname || handle,
                            profilePictureUrl: account.profilePictureUrl || null
                        }
                    });
                } catch (error) {
                    console.error(`Error loading session for @${handle}:`, error);
                }
            }
        }
        
        res.json(activeSessions);
    } catch (error) {
        console.error('Get active sessions error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * GET /api/live/sessions
 * List all live sessions with consistency checks
 */
router.get('/sessions', async (req, res) => {
    try {
        // Get all sessions from database
        const sessionsResult = await query(
            'SELECT * FROM live_sessions ORDER BY start_time DESC'
        );
        
        // Get monitored status to check for active sessions
        let monitored = {};
        try {
            monitored = await read('monitored.json');
        } catch (error) {
            console.warn('Could not read monitored.json:', error);
        }

        const sessions = [];
        
        for (const row of sessionsResult.rows) {
            const session = {
                sessionId: row.id,
                handle: row.handle,
                startTime: row.start_time.toISOString(),
                endTime: row.end_time ? row.end_time.toISOString() : null,
                status: row.status,
                roomId: row.room_id ? String(row.room_id) : null,
                stats: row.stats || {}
            };
            
            // Check consistency: verify actual monitoring state - this is the source of truth
            const monitorStatus = monitored[row.handle] || {};
            const isActuallyMonitoring = liveConnectorService.isMonitoring(row.handle);
            const activeSessionId = liveConnectorService.getActiveSessionId(row.handle);
            const isActuallyLive = isActuallyMonitoring && activeSessionId === row.id;
            
            // If session is marked as live but not actually monitoring, mark as ended
            if (session.status === 'live' && !isActuallyLive) {
                // Session is marked as live but monitoring is not active - mark as ended
                console.log(`[Consistency Fix] Session ${row.id} for @${row.handle} marked as live but not active, fixing...`);
                
                await query(
                    'UPDATE live_sessions SET status = $1, end_time = COALESCE(end_time, $2) WHERE id = $3',
                    ['ended', new Date(), row.id]
                );
                session.status = 'ended';
                if (!session.endTime) {
                    session.endTime = new Date().toISOString();
                }
                
                // Clear stale session ID from monitored.json
                if (monitorStatus.currentLiveSessionId === row.id) {
                    try {
                        await updateNested('monitored.json', row.handle, {
                            currentLiveSessionId: null,
                            lastSessionEndTime: new Date().toISOString()
                        });
                    } catch (error) {
                        console.warn(`[Consistency Fix] Error clearing stale session ID for @${row.handle}:`, error.message);
                    }
                }
            } else if (session.status === 'live' && isActuallyLive) {
                // Session is actually active - sync monitored.json if needed
                if (monitorStatus.currentLiveSessionId !== row.id) {
                    try {
                        await updateNested('monitored.json', row.handle, {
                            currentLiveSessionId: row.id,
                            enabled: monitorStatus.enabled !== undefined ? monitorStatus.enabled : true,
                            lastLiveTime: monitorStatus.lastLiveTime || row.start_time.toISOString(),
                            lastCheckedAt: new Date().toISOString()
                        });
                    } catch (error) {
                        console.warn(`[Consistency Fix] Error syncing monitored.json for @${row.handle}:`, error.message);
                    }
                }
            }
            
            // Additional check: if session has endTime, it should be marked as ended
            if (session.endTime && session.status === 'live') {
                console.log(`[Consistency Fix] Session ${row.id} for @${row.handle} has endTime but marked as live, fixing...`);
                await query(
                    'UPDATE live_sessions SET status = $1 WHERE id = $2',
                    ['ended', row.id]
                );
                session.status = 'ended';
            }
            
            sessions.push(session);
        }

        res.json(sessions);
    } catch (error) {
        console.error('List sessions error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * GET /api/live/sessions/:sessionId
 * Get session details with consistency check
 */
router.get('/sessions/:sessionId', async (req, res) => {
    try {
        const { sessionId } = req.params;
        
        // Get session from database
        const sessionResult = await query(
            'SELECT * FROM live_sessions WHERE id = $1',
            [sessionId]
        );
        
        if (sessionResult.rows.length === 0) {
            return res.status(404).json({ error: 'Session not found' });
        }
        
        const row = sessionResult.rows[0];
        let session = {
            sessionId: row.id,
            handle: row.handle,
            startTime: row.start_time.toISOString(),
            endTime: row.end_time ? row.end_time.toISOString() : null,
            status: row.status,
            roomId: row.room_id ? String(row.room_id) : null,
            stats: row.stats || {}
        };
        
        // Get monitored status to check for active sessions
        let monitored = {};
        try {
            monitored = await read('monitored.json');
        } catch (error) {
            console.warn('Could not read monitored.json:', error);
        }
        
        // Check consistency: verify actual monitoring state - this is the source of truth
        const monitorStatus = monitored[row.handle] || {};
        const isActuallyMonitoring = liveConnectorService.isMonitoring(row.handle);
        const activeSessionId = liveConnectorService.getActiveSessionId(row.handle);
        const isActuallyLive = isActuallyMonitoring && activeSessionId === sessionId;
        
        // If session is marked as live but not actually monitoring, mark as ended
        if (session.status === 'live' && !isActuallyLive) {
            // Session is marked as live but monitoring is not active - mark as ended
            console.log(`[Consistency Fix] Session ${sessionId} for @${row.handle} marked as live but not active, fixing...`);
            
            await query(
                'UPDATE live_sessions SET status = $1, end_time = COALESCE(end_time, $2) WHERE id = $3',
                ['ended', new Date(), sessionId]
            );
            session.status = 'ended';
            if (!session.endTime) {
                session.endTime = new Date().toISOString();
            }
            
            // Clear stale session ID from monitored.json
            if (monitorStatus.currentLiveSessionId === sessionId) {
                try {
                    await updateNested('monitored.json', row.handle, {
                        currentLiveSessionId: null,
                        lastSessionEndTime: new Date().toISOString()
                    });
                } catch (error) {
                    console.warn(`[Consistency Fix] Error clearing stale session ID for @${row.handle}:`, error.message);
                }
            }
        } else if (session.status === 'live' && isActuallyLive) {
            // Session is actually active - sync monitored.json if needed
            if (monitorStatus.currentLiveSessionId !== sessionId) {
                try {
                    await updateNested('monitored.json', row.handle, {
                        currentLiveSessionId: sessionId,
                        enabled: monitorStatus.enabled !== undefined ? monitorStatus.enabled : true,
                        lastLiveTime: monitorStatus.lastLiveTime || session.startTime,
                        lastCheckedAt: new Date().toISOString()
                    });
                } catch (error) {
                    console.warn(`[Consistency Fix] Error syncing monitored.json for @${row.handle}:`, error.message);
                }
            }
        }
        
        // Additional check: if session has endTime, it should be marked as ended
        if (session.endTime && session.status === 'live') {
            console.log(`[Consistency Fix] Session ${sessionId} for @${row.handle} has endTime but marked as live, fixing...`);
            await query(
                'UPDATE live_sessions SET status = $1 WHERE id = $2',
                ['ended', sessionId]
            );
            session.status = 'ended';
        }
        
        res.json(session);
    } catch (error) {
        console.error('Get session error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * GET /api/live/:handle/history
 * Get historical sessions for account with consistency checks
 */
router.get('/:handle/history', async (req, res) => {
    try {
        const { handle } = req.params;
        const cleanHandle = handle.replace('@', '').trim();
        
        // Get all sessions for this handle from database
        const sessionsResult = await query(
            'SELECT * FROM live_sessions WHERE handle = $1 ORDER BY start_time DESC',
            [cleanHandle]
        );
        
        // Get monitored status to check for active sessions
        let monitored = {};
        try {
            monitored = await read('monitored.json');
        } catch (error) {
            console.warn('Could not read monitored.json:', error);
        }
        
        const monitorStatus = monitored[cleanHandle] || {};
        const sessions = [];
        
        for (const row of sessionsResult.rows) {
            let session = {
                sessionId: row.id,
                handle: row.handle,
                startTime: row.start_time.toISOString(),
                endTime: row.end_time ? row.end_time.toISOString() : null,
                status: row.status,
                roomId: row.room_id ? String(row.room_id) : null,
                stats: row.stats || {}
            };
            
            // Check consistency: verify actual monitoring state - this is the source of truth
            const isActuallyMonitoring = liveConnectorService.isMonitoring(cleanHandle);
            const activeSessionId = liveConnectorService.getActiveSessionId(cleanHandle);
            const isActuallyLive = isActuallyMonitoring && activeSessionId === row.id;
            
            // If session is marked as live but not actually live, fix it
            if (session.status === 'live' && !isActuallyLive) {
                console.log(`[Consistency Fix] Session ${row.id} for @${cleanHandle} marked as live but not active, fixing...`);
                
                await query(
                    'UPDATE live_sessions SET status = $1, end_time = COALESCE(end_time, $2) WHERE id = $3',
                    ['ended', new Date(), row.id]
                );
                session.status = 'ended';
                if (!session.endTime) {
                    session.endTime = new Date().toISOString();
                }
                
                // Clear stale session ID from monitored.json
                if (monitorStatus.currentLiveSessionId === row.id) {
                    try {
                        await updateNested('monitored.json', cleanHandle, {
                            currentLiveSessionId: null,
                            lastSessionEndTime: new Date().toISOString()
                        });
                    } catch (error) {
                        console.warn(`[Consistency Fix] Error clearing stale session ID for @${cleanHandle}:`, error.message);
                    }
                }
            }
            
            // Additional check: if session has endTime, it should be marked as ended
            if (session.endTime && session.status === 'live') {
                console.log(`[Consistency Fix] Session ${row.id} for @${cleanHandle} has endTime but marked as live, fixing...`);
                await query(
                    'UPDATE live_sessions SET status = $1 WHERE id = $2',
                    ['ended', row.id]
                );
                session.status = 'ended';
            }
            
            sessions.push(session);
        }
        
        res.json(sessions);
    } catch (error) {
        console.error('Get history error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * GET /api/live/sessions/:sessionId/events
 * Get events for a session with optional filters
 */
router.get('/sessions/:sessionId/events', async (req, res) => {
    try {
        const { sessionId } = req.params;
        const { type, limit } = req.query;
        
        // Build query
        let eventsQuery = 'SELECT id, session_id, type, timestamp, user_data, event_data, location FROM events WHERE session_id = $1';
        const params = [sessionId];
        
        if (type) {
            eventsQuery += ' AND type = $2';
            params.push(type);
        }
        
        eventsQuery += ' ORDER BY timestamp DESC';
        
        // Only apply limit if explicitly requested (for performance in other endpoints)
        // For session-view, we want ALL events, so don't limit by default
        if (limit && parseInt(limit) > 0) {
            const limitNum = parseInt(limit);
            eventsQuery += ` LIMIT $${params.length + 1}`;
            params.push(limitNum);
        }
        // If no limit specified, return all events (up to 100000 for safety)
        else if (!limit) {
            eventsQuery += ' LIMIT 100000';
        }
        
        const eventsResult = await query(eventsQuery, params);
        
        console.log(`[API] Get events for session ${sessionId}: found ${eventsResult.rows.length} events`);
        
        const events = eventsResult.rows.map(row => ({
            id: row.id,
            sessionId: row.session_id,
            type: row.type,
            timestamp: row.timestamp.toISOString(),
            user: row.user_data,
            data: row.event_data,
            location: row.location
        }));
        
        res.json(events);
    } catch (error) {
        console.error('[API] Get events error:', error);
        res.status(500).json({ error: 'Internal server error', details: error.message });
    }
});

/**
 * GET /api/live/sessions/:sessionId/stats-history
 * Get historical snapshots of statistics for a session
 */
router.get('/sessions/:sessionId/stats-history', async (req, res) => {
    try {
        const { sessionId } = req.params;
        
        const statsResult = await query(
            'SELECT * FROM stats_history WHERE session_id = $1 ORDER BY timestamp ASC',
            [sessionId]
        );
        
        const history = statsResult.rows.map(row => ({
            id: row.id,
            sessionId: row.session_id,
            timestamp: row.timestamp.toISOString(),
            stats: row.stats
        }));
        
        res.json(history);
    } catch (error) {
        console.error('Get stats history error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * GET /api/live/sessions/:sessionId/chart-data
 * Get normalized chart data for activity graph
 */
router.get('/sessions/:sessionId/chart-data', async (req, res) => {
    try {
        const { sessionId } = req.params;
        const { interval = 'minute' } = req.query; // 'minute' or 'segment'
        
        // Get session data
        const sessionResult = await query(
            'SELECT * FROM live_sessions WHERE id = $1',
            [sessionId]
        );
        
        if (sessionResult.rows.length === 0) {
            return res.status(404).json({ error: 'Session not found' });
        }
        
        const row = sessionResult.rows[0];
        const sessionData = {
            sessionId: row.id,
            handle: row.handle,
            startTime: row.start_time.toISOString(),
            endTime: row.end_time ? row.end_time.toISOString() : null,
            status: row.status,
            roomId: row.room_id ? String(row.room_id) : null,
            stats: row.stats || {}
        };
        
        // Get events - use index idx_events_session_time for optimal performance
        const eventsResult = await query(
            'SELECT id, session_id, type, timestamp, user_data, event_data, location FROM events WHERE session_id = $1 ORDER BY timestamp ASC LIMIT 50000',
            [sessionId]
        );
        
        const events = eventsResult.rows.map(row => ({
            id: row.id,
            sessionId: row.session_id,
            type: row.type,
            timestamp: row.timestamp.toISOString(),
            user: row.user_data,
            data: row.event_data,
            location: row.location
        }));
        
        // Get stats history
        const statsResult = await query(
            'SELECT * FROM stats_history WHERE session_id = $1 ORDER BY timestamp ASC',
            [sessionId]
        );
        
        const statsHistory = statsResult.rows.map(row => ({
            id: row.id,
            sessionId: row.session_id,
            timestamp: row.timestamp.toISOString(),
            stats: row.stats
        }));
        
        // Calculate time range
        const startTime = new Date(sessionData.startTime);
        const endTime = sessionData.endTime ? new Date(sessionData.endTime) : new Date();
        const durationMs = endTime - startTime;
        const durationMinutes = Math.floor(durationMs / (1000 * 60));
        
        // Determine interval based on duration
        let segmentSize = 60; // seconds
        if (interval === 'segment') {
            // For longer sessions, use larger segments
            if (durationMinutes > 120) {
                segmentSize = 300; // 5 minutes
            } else if (durationMinutes > 60) {
                segmentSize = 180; // 3 minutes
            } else {
                segmentSize = 60; // 1 minute
            }
        }
        
        const numSegments = Math.ceil(durationMs / (segmentSize * 1000));
        const segmentDuration = durationMs / numSegments;
        
        // Initialize data arrays
        const chartData = {
            labels: [],
            viewers: [],
            likes: [],
            comments: [],
            gifts: [],
            shares: [],
            followers: []
        };
        
        // Process stats history if available
        if (statsHistory.length > 0) {
            for (let i = 0; i < numSegments; i++) {
                const segmentStart = startTime.getTime() + (i * segmentDuration);
                const segmentEnd = segmentStart + segmentDuration;
                
                // Find stats snapshot closest to segment end
                let closestSnapshot = null;
                let closestTime = Infinity;
                
                for (const snapshot of statsHistory) {
                    const snapshotTime = new Date(snapshot.timestamp).getTime();
                    if (snapshotTime >= segmentStart && snapshotTime <= segmentEnd) {
                        const diff = Math.abs(snapshotTime - segmentEnd);
                        if (diff < closestTime) {
                            closestTime = diff;
                            closestSnapshot = snapshot;
                        }
                    }
                }
                
                if (closestSnapshot && closestSnapshot.stats) {
                    const stats = closestSnapshot.stats;
                    chartData.viewers.push(stats.totalViewers || 0);
                    chartData.likes.push(stats.totalLikes || 0);
                    chartData.comments.push(stats.totalMessages || 0);
                    chartData.gifts.push(stats.totalGifts || 0);
                    chartData.shares.push(stats.totalShares || 0);
                    chartData.followers.push(stats.totalFollows || 0);
                } else {
                    // Use previous value or 0
                    const prevValue = i > 0 ? {
                        viewers: chartData.viewers[i - 1] || 0,
                        likes: chartData.likes[i - 1] || 0,
                        comments: chartData.comments[i - 1] || 0,
                        gifts: chartData.gifts[i - 1] || 0,
                        shares: chartData.shares[i - 1] || 0,
                        followers: chartData.followers[i - 1] || 0
                    } : { viewers: 0, likes: 0, comments: 0, gifts: 0, shares: 0, followers: 0 };
                    
                    chartData.viewers.push(prevValue.viewers);
                    chartData.likes.push(prevValue.likes);
                    chartData.comments.push(prevValue.comments);
                    chartData.gifts.push(prevValue.gifts);
                    chartData.shares.push(prevValue.shares);
                    chartData.followers.push(prevValue.followers);
                }
                
                // Label (time)
                const segmentTime = new Date(segmentStart);
                chartData.labels.push(segmentTime.toLocaleTimeString());
            }
        } else {
            // Fallback: process events directly
            for (let i = 0; i < numSegments; i++) {
                const segmentStart = startTime.getTime() + (i * segmentDuration);
                const segmentEnd = segmentStart + segmentDuration;
                
                let segmentViewers = 0;
                let segmentLikes = 0;
                let segmentComments = 0;
                let segmentGifts = 0;
                let segmentShares = 0;
                let segmentFollowers = 0;
                
                // Count events in this segment
                for (const event of events) {
                    const eventTime = new Date(event.timestamp).getTime();
                    if (eventTime >= segmentStart && eventTime < segmentEnd) {
                        if (event.type === 'roomUser') {
                            segmentViewers = Math.max(segmentViewers, event.data?.totalUserCount || 0);
                        } else if (event.type === 'like') {
                            segmentLikes++;
                        } else if (event.type === 'chat') {
                            segmentComments++;
                        } else if (event.type === 'gift') {
                            segmentGifts++;
                        } else if (event.type === 'social' && (event.data?.displayType === 'pm_mt_message_viewer_share' || event.data?.actionType === 'share')) {
                            segmentShares++;
                        } else if (event.type === 'social' && (event.data?.displayType === 'pm_mt_message_viewer_follow' || event.data?.actionType === 'follow')) {
                            segmentFollowers++;
                        }
                    }
                }
                
                chartData.viewers.push(segmentViewers);
                chartData.likes.push(segmentLikes);
                chartData.comments.push(segmentComments);
                chartData.gifts.push(segmentGifts);
                chartData.shares.push(segmentShares);
                chartData.followers.push(segmentFollowers);
                
                const segmentTime = new Date(segmentStart);
                chartData.labels.push(segmentTime.toLocaleTimeString());
            }
        }
        
        // Get max values for normalization
        const maxViewers = Math.max(...chartData.viewers, 1);
        const maxLikes = Math.max(...chartData.likes, 1);
        const maxComments = Math.max(...chartData.comments, 1);
        const maxGifts = Math.max(...chartData.gifts, 1);
        const maxShares = Math.max(...chartData.shares, 1);
        const maxFollowers = Math.max(...chartData.followers, 1);
        
        // Normalize to 0-100 scale
        const normalize = (value, max) => max > 0 ? (value / max) * 100 : 0;
        
        res.json({
            labels: chartData.labels,
            data: {
                viewers: chartData.viewers.map(v => ({ value: v, normalized: normalize(v, maxViewers) })),
                likes: chartData.likes.map(v => ({ value: v, normalized: normalize(v, maxLikes) })),
                comments: chartData.comments.map(v => ({ value: v, normalized: normalize(v, maxComments) })),
                gifts: chartData.gifts.map(v => ({ value: v, normalized: normalize(v, maxGifts) })),
                shares: chartData.shares.map(v => ({ value: v, normalized: normalize(v, maxShares) })),
                followers: chartData.followers.map(v => ({ value: v, normalized: normalize(v, maxFollowers) }))
            },
            maxValues: {
                viewers: maxViewers,
                likes: maxLikes,
                comments: maxComments,
                gifts: maxGifts,
                shares: maxShares,
                followers: maxFollowers
            }
        });
    } catch (error) {
        console.error('Get chart data error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * POST /api/live/sessions/:sessionId/end
 * Manually end a live session
 */
router.post('/sessions/:sessionId/end', async (req, res) => {
    try {
        const { sessionId } = req.params;
        
        // Validate sessionId is a valid UUID
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (!uuidRegex.test(sessionId)) {
            return res.status(400).json({ error: 'Invalid session ID format' });
        }
        
        // Get session from database
        const sessionResult = await query(
            'SELECT * FROM live_sessions WHERE id = $1',
            [sessionId]
        );
        
        if (sessionResult.rows.length === 0) {
            return res.status(404).json({ error: 'Session not found' });
        }
        
        const session = sessionResult.rows[0];
        
        // Check if session is actually live (verify with liveConnectorService - source of truth)
        const isActuallyMonitoring = liveConnectorService.isMonitoring(session.handle);
        const activeSessionId = liveConnectorService.getActiveSessionId(session.handle);
        const isActuallyLive = isActuallyMonitoring && activeSessionId === sessionId;
        
        if (session.status !== 'live' && !isActuallyLive) {
            return res.status(400).json({ error: `Session is already ${session.status}` });
        }
        
        // Get io instance
        const io = req.app.get('io');
        
        // Stop monitoring for this handle
        await liveConnectorService.stopMonitoring(session.handle, io);
        
        // Verify session was ended (liveConnectorService should have updated it)
        const updatedSession = await query(
            'SELECT status, end_time FROM live_sessions WHERE id = $1',
            [sessionId]
        );
        
        if (updatedSession.rows.length > 0 && updatedSession.rows[0].status === 'live') {
            // If still live, manually update it (fallback)
            console.log(`[Manual End] Session ${sessionId} still marked as live after stopMonitoring, manually ending...`);
            await query(
                'UPDATE live_sessions SET status = $1, end_time = $2 WHERE id = $3',
                ['ended', new Date(), sessionId]
            );
            
            // Clear monitored status with session end cooldown
            await updateNested('monitored.json', session.handle, {
                currentLiveSessionId: null,
                lastSessionEndTime: new Date().toISOString(),
                lastLiveTime: session.start_time.toISOString()
            });
        }
        
        res.json({ 
            success: true, 
            message: `Session ended for @${session.handle}`,
            sessionId 
        });
    } catch (error) {
        console.error('Error ending session:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * GET /api/live/sessions/:sessionId/export/excel
 * Export session data to Excel with multiple sheets
 */
router.get('/sessions/:sessionId/export/excel', async (req, res) => {
    try {
        const { sessionId } = req.params;
        
        // Validate sessionId is a valid UUID
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (!uuidRegex.test(sessionId)) {
            return res.status(400).json({ error: 'Invalid session ID format' });
        }
        
        // Get session data
        const sessionResult = await query(
            'SELECT * FROM live_sessions WHERE id = $1',
            [sessionId]
        );
        
        if (sessionResult.rows.length === 0) {
            return res.status(404).json({ error: 'Session not found' });
        }
        
        const sessionRow = sessionResult.rows[0];
        
        // Get all events
        const eventsResult = await query(
            'SELECT id, session_id, type, timestamp, user_data, event_data, location FROM events WHERE session_id = $1 ORDER BY timestamp ASC',
            [sessionId]
        );
        
        // Get stats history
        const statsResult = await query(
            'SELECT * FROM stats_history WHERE session_id = $1 ORDER BY timestamp ASC',
            [sessionId]
        );
        
        // Create Excel workbook
        const workbook = new ExcelJS.Workbook();
        
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
        
        // Sheet 1: Session Information
        const sessionSheet = workbook.addWorksheet('Session Info');
        sessionSheet.columns = [
            { header: 'Property', key: 'property', width: 25 },
            { header: 'Value', key: 'value', width: 50 }
        ];
        
        sessionSheet.getRow(1).font = { bold: true };
        sessionSheet.getRow(1).fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFE0E0E0' }
        };
        
        const sessionData = [
            { property: 'Session ID', value: sessionRow.id },
            { property: 'Handle', value: `@${sessionRow.handle}` },
            { property: 'Status', value: sessionRow.status },
            { property: 'Start Time', value: formatDate(sessionRow.start_time) },
            { property: 'End Time', value: formatDate(sessionRow.end_time) },
            { property: 'Room ID', value: sessionRow.room_id ? String(sessionRow.room_id) : 'N/A' },
            { property: 'Duration', value: sessionRow.end_time 
                ? `${Math.floor((new Date(sessionRow.end_time) - new Date(sessionRow.start_time)) / 1000 / 60)} minutes`
                : 'Ongoing' }
        ];
        
        // Add stats summary
        if (sessionRow.stats && typeof sessionRow.stats === 'object') {
            const stats = sessionRow.stats;
            sessionData.push(
                { property: 'Total Viewers (Peak)', value: stats.viewerCount || 0 },
                { property: 'Total Likes', value: stats.likeCount || 0 },
                { property: 'Total Comments', value: stats.commentCount || 0 },
                { property: 'Total Gifts', value: stats.giftCount || 0 },
                { property: 'Total Shares', value: stats.shareCount || 0 },
                { property: 'Total Followers', value: stats.followerCount || 0 }
            );
        }
        
        sessionData.forEach(row => sessionSheet.addRow(row));
        
        // Sheet 2: All Events
        const eventsSheet = workbook.addWorksheet('All Events');
        eventsSheet.columns = [
            { header: 'Timestamp', key: 'timestamp', width: 20 },
            { header: 'Type', key: 'type', width: 15 },
            { header: 'User ID', key: 'userId', width: 20 },
            { header: 'Username', key: 'username', width: 25 },
            { header: 'Nickname', key: 'nickname', width: 25 },
            { header: 'Event Data', key: 'eventData', width: 50 },
            { header: 'Location', key: 'location', width: 30 }
        ];
        
        eventsSheet.getRow(1).font = { bold: true };
        eventsSheet.getRow(1).fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFE0E0E0' }
        };
        
        eventsResult.rows.forEach(row => {
            const user = row.user_data || {};
            const eventData = row.event_data || {};
            eventsSheet.addRow({
                timestamp: formatDate(row.timestamp),
                type: row.type,
                userId: user.userId || user.id || 'N/A',
                username: user.uniqueId || user.username || 'N/A',
                nickname: user.nickname || 'N/A',
                eventData: JSON.stringify(eventData),
                location: row.location ? JSON.stringify(row.location) : 'N/A'
            });
        });
        
        // Sheet 3: Chat Events
        const chatEvents = eventsResult.rows.filter(e => e.type === 'chat');
        if (chatEvents.length > 0) {
            const chatSheet = workbook.addWorksheet('Chat Events');
            chatSheet.columns = [
                { header: 'Timestamp', key: 'timestamp', width: 20 },
                { header: 'User ID', key: 'userId', width: 20 },
                { header: 'Username', key: 'username', width: 25 },
                { header: 'Nickname', key: 'nickname', width: 25 },
                { header: 'Message', key: 'message', width: 60 },
                { header: 'Profile Picture', key: 'profilePicture', width: 50 }
            ];
            
            chatSheet.getRow(1).font = { bold: true };
            chatSheet.getRow(1).fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: 'FFE0E0E0' }
            };
            
            chatEvents.forEach(row => {
                const user = row.user_data || {};
                const data = row.event_data || {};
                chatSheet.addRow({
                    timestamp: formatDate(row.timestamp),
                    userId: user.userId || user.id || 'N/A',
                    username: user.uniqueId || user.username || 'N/A',
                    nickname: user.nickname || 'N/A',
                    message: data.comment || data.text || data.message || 'N/A',
                    profilePicture: user.profilePictureUrl || 'N/A'
                });
            });
        }
        
        // Sheet 4: Gift Events
        const giftEvents = eventsResult.rows.filter(e => e.type === 'gift');
        if (giftEvents.length > 0) {
            const giftSheet = workbook.addWorksheet('Gift Events');
            giftSheet.columns = [
                { header: 'Timestamp', key: 'timestamp', width: 20 },
                { header: 'User ID', key: 'userId', width: 20 },
                { header: 'Username', key: 'username', width: 25 },
                { header: 'Nickname', key: 'nickname', width: 25 },
                { header: 'Gift Name', key: 'giftName', width: 25 },
                { header: 'Gift Count', key: 'giftCount', width: 12 },
                { header: 'Diamond Value', key: 'diamondValue', width: 15 }
            ];
            
            giftSheet.getRow(1).font = { bold: true };
            giftSheet.getRow(1).fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: 'FFE0E0E0' }
            };
            
            giftEvents.forEach(row => {
                const user = row.user_data || {};
                const data = row.event_data || {};
                giftSheet.addRow({
                    timestamp: formatDate(row.timestamp),
                    userId: user.userId || user.id || 'N/A',
                    username: user.uniqueId || user.username || 'N/A',
                    nickname: user.nickname || 'N/A',
                    giftName: data.giftName || data.name || 'N/A',
                    giftCount: data.giftCount || data.count || 1,
                    diamondValue: data.diamondValue || data.diamonds || 0
                });
            });
        }
        
        // Sheet 5: Like Events
        const likeEvents = eventsResult.rows.filter(e => e.type === 'like');
        if (likeEvents.length > 0) {
            const likeSheet = workbook.addWorksheet('Like Events');
            likeSheet.columns = [
                { header: 'Timestamp', key: 'timestamp', width: 20 },
                { header: 'User ID', key: 'userId', width: 20 },
                { header: 'Username', key: 'username', width: 25 },
                { header: 'Nickname', key: 'nickname', width: 25 },
                { header: 'Like Count', key: 'likeCount', width: 12 }
            ];
            
            likeSheet.getRow(1).font = { bold: true };
            likeSheet.getRow(1).fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: 'FFE0E0E0' }
            };
            
            likeEvents.forEach(row => {
                const user = row.user_data || {};
                const data = row.event_data || {};
                likeSheet.addRow({
                    timestamp: formatDate(row.timestamp),
                    userId: user.userId || user.id || 'N/A',
                    username: user.uniqueId || user.username || 'N/A',
                    nickname: user.nickname || 'N/A',
                    likeCount: data.likeCount || data.count || 1
                });
            });
        }
        
        // Sheet 6: Stats History
        if (statsResult.rows.length > 0) {
            const statsSheet = workbook.addWorksheet('Stats History');
            statsSheet.columns = [
                { header: 'Timestamp', key: 'timestamp', width: 20 },
                { header: 'Viewers', key: 'viewers', width: 12 },
                { header: 'Likes', key: 'likes', width: 12 },
                { header: 'Comments', key: 'comments', width: 12 },
                { header: 'Gifts', key: 'gifts', width: 12 },
                { header: 'Shares', key: 'shares', width: 12 },
                { header: 'Followers', key: 'followers', width: 12 }
            ];
            
            statsSheet.getRow(1).font = { bold: true };
            statsSheet.getRow(1).fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: 'FFE0E0E0' }
            };
            
            statsResult.rows.forEach(row => {
                const stats = row.stats || {};
                statsSheet.addRow({
                    timestamp: formatDate(row.timestamp),
                    viewers: stats.viewerCount || 0,
                    likes: stats.likeCount || 0,
                    comments: stats.commentCount || 0,
                    gifts: stats.giftCount || 0,
                    shares: stats.shareCount || 0,
                    followers: stats.followerCount || 0
                });
            });
        }
        
        // Set response headers
        const filename = `session_${sessionRow.handle}_${sessionId.substring(0, 8)}_${new Date().toISOString().split('T')[0]}.xlsx`;
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        
        // Write to response
        await workbook.xlsx.write(res);
        res.end();
        
        console.log(`[Export] Exported session ${sessionId} to Excel with ${workbook.worksheets.length} sheets`);
    } catch (error) {
        console.error('Export session to Excel error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
