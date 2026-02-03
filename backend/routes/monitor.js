const express = require('express');
const router = express.Router();
const { requireAuth } = require('../utils/auth');
const { read, updateNested, findBy } = require('../storage/dbStorage');
const { query } = require('../config/database');
const pollerService = require('../services/pollerService');
const liveConnectorService = require('../services/liveConnectorService');

// All routes require authentication
router.use(requireAuth);

/**
 * Get the most recent live session for a handle (current or last ended)
 */
async function getLastLiveSession(handle) {
    try {
        // Query for the most recent session for this handle
        // Prefer live sessions, then ended sessions by end_time, then by start_time
        const result = await query(
            `SELECT start_time, end_time, status 
             FROM live_sessions 
             WHERE handle = $1 
             ORDER BY 
                CASE WHEN status = 'live' THEN 0 ELSE 1 END,
                COALESCE(end_time, start_time) DESC NULLS LAST
             LIMIT 1`,
            [handle]
        );
        
        if (result.rows.length > 0) {
            const session = result.rows[0];
            // For live sessions, use startTime
            // For ended sessions, use endTime if available, otherwise startTime
            if (session.status === 'live' && session.start_time) {
                return session.start_time.toISOString();
            } else if (session.end_time) {
                return session.end_time.toISOString();
            } else if (session.start_time) {
                return session.start_time.toISOString();
            }
        }
        
        return null;
    } catch (error) {
        console.error(`Error getting last live session for ${handle}:`, error.message);
        return null;
    }
}

/**
 * GET /api/monitor/status
 * Get monitoring status for all accounts
 */
router.get('/status', async (req, res) => {
    try {
        const monitored = await read('monitored.json');
        let accounts = await read('tiktok_accounts.json');
        
        // Ensure accounts is always an array
        if (!Array.isArray(accounts)) {
            console.warn('tiktok_accounts.json is not an array, converting to array');
            accounts = [];
        }
        
        // Merge account data with monitoring status and last live session
        const status = await Promise.all(accounts.map(async (account) => {
            const monitorStatus = monitored[account.handle] || { enabled: false, lastCheckedAt: null, currentLiveSessionId: null, lastLiveTime: null };
            
            // Verify actual monitoring state - this is the source of truth
            const isActuallyMonitoring = liveConnectorService.isMonitoring(account.handle);
            const activeSessionId = liveConnectorService.getActiveSessionId(account.handle);
            
            // Only use currentLiveSessionId if monitoring is actually active
            // This prevents showing stale session IDs from monitored.json
            let currentLiveSessionId = null;
            if (isActuallyMonitoring && activeSessionId) {
                currentLiveSessionId = activeSessionId;
                // Sync monitored.json if it's out of date (silent sync)
                if (monitorStatus.currentLiveSessionId !== activeSessionId) {
                    try {
                        await updateNested('monitored.json', account.handle, {
                            currentLiveSessionId: activeSessionId,
                            enabled: monitorStatus.enabled !== undefined ? monitorStatus.enabled : true
                        });
                    } catch (error) {
                        console.warn(`[Monitor Status] Error syncing monitored.json for @${account.handle}:`, error.message);
                    }
                }
            } else if (monitorStatus.currentLiveSessionId && !isActuallyMonitoring) {
                // Stale session ID - clear it
                currentLiveSessionId = null;
                // Clear stale session ID from monitored.json (silent cleanup)
                try {
                    await updateNested('monitored.json', account.handle, {
                        currentLiveSessionId: null
                    });
                } catch (error) {
                    console.warn(`[Monitor Status] Error clearing stale session ID for @${account.handle}:`, error.message);
                }
            }
            
            // Use lastLiveTime from monitored.json if available, otherwise try to get from session files
            let lastLiveTime = monitorStatus.lastLiveTime;
            if (!lastLiveTime) {
                lastLiveTime = await getLastLiveSession(account.handle);
            }
            
            return {
                ...account,
                monitoring: monitorStatus.enabled,
                lastCheckedAt: monitorStatus.lastCheckedAt,
                currentLiveSessionId: currentLiveSessionId, // Use verified session ID
                lastLiveTime: lastLiveTime
            };
        }));
        
        res.json(status);
    } catch (error) {
        console.error('Get monitoring status error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * GET /api/monitor/:handle/status
 * Get monitoring status for specific account
 */
router.get('/:handle/status', async (req, res) => {
    try {
        const { handle } = req.params;
        const cleanHandle = handle.replace('@', '').trim();
        
        const account = await findBy('tiktok_accounts.json', 'handle', cleanHandle);
        if (!account) {
            return res.status(404).json({ error: 'Account not found' });
        }
        
        const monitored = await read('monitored.json');
        const monitorStatus = monitored[cleanHandle] || { enabled: false, lastCheckedAt: null, currentLiveSessionId: null };
        
        res.json({
            handle: cleanHandle,
            ...monitorStatus
        });
    } catch (error) {
        console.error('Get monitoring status error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * PUT /api/monitor/:handle/toggle
 * Toggle monitoring On/Off for an account
 */
router.put('/:handle/toggle', async (req, res) => {
    try {
        const { handle } = req.params;
        const cleanHandle = handle.replace('@', '').trim();
        const { enabled } = req.body;
        
        // Check if account exists
        const account = await findBy('tiktok_accounts.json', 'handle', cleanHandle);
        if (!account) {
            return res.status(404).json({ error: 'Account not found' });
        }
        
        // Update monitoring status
        const monitored = await read('monitored.json');
        const currentStatus = monitored[cleanHandle] || { enabled: false, lastCheckedAt: null, currentLiveSessionId: null };
        
        const newEnabled = enabled !== undefined ? enabled : !currentStatus.enabled;
        
        // Get services
        const io = req.app.get('io');
        const liveConnectorService = require('../services/liveConnectorService');
        const pollerService = require('../services/pollerService');
        const settingsService = require('../services/settingsService');
        
        // If disabling monitoring and there's an active session, stop it
        if (!newEnabled && currentStatus.currentLiveSessionId) {
            console.log(`[Toggle Monitoring] Stopping active monitoring for @${cleanHandle} (monitoring disabled)`);
            try {
                await liveConnectorService.stopMonitoring(cleanHandle, io);
            } catch (error) {
                console.error(`[Toggle Monitoring] Error stopping monitoring for @${cleanHandle}:`, error);
            }
        }
        
        // Clear polling interval when disabling monitoring
        if (!newEnabled) {
            pollerService.clearAccountInterval(cleanHandle);
            console.log(`[Toggle Monitoring] Cleared polling interval for @${cleanHandle} (monitoring disabled)`);
        }
        
        await updateNested('monitored.json', cleanHandle, {
            enabled: newEnabled,
            lastCheckedAt: currentStatus.lastCheckedAt,
            currentLiveSessionId: newEnabled ? currentStatus.currentLiveSessionId : null
        });
        
        // If enabling monitoring, schedule first check
        if (newEnabled && !currentStatus.enabled) {
            console.log(`[Toggle Monitoring] Monitoring enabled for @${cleanHandle}, scheduling first check...`);
            
            // Get polling intervals
            const intervals = await settingsService.getPollingIntervals();
            
            // Schedule first check after a short delay (5 seconds) to ensure monitored.json is saved
            setTimeout(async () => {
                try {
                    console.log(`[Toggle Monitoring] Running first check for @${cleanHandle}...`);
                    await pollerService.checkAccount(cleanHandle);
                } catch (err) {
                    console.error(`[Toggle Monitoring] Error in first check for @${cleanHandle}:`, err);
                }
            }, 5000); // 5 second delay
        }
        
        // Emit Socket.IO event for real-time update
        if (io) {
            io.emit('monitoringStatusChanged', {
                handle: cleanHandle,
                enabled: newEnabled
            });
        }
        
        res.json({
            handle: cleanHandle,
            enabled: enabled !== undefined ? enabled : !currentStatus.enabled
        });
    } catch (error) {
        console.error('Toggle monitoring error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * POST /api/monitor/check-all
 * Check all monitored accounts
 */
router.post('/check-all', async (req, res) => {
    try {
        const monitored = await read('monitored.json');
        let accounts = await read('tiktok_accounts.json');
        
        // Ensure accounts is always an array
        if (!Array.isArray(accounts)) {
            accounts = [];
        }
        
        const enabledAccounts = Object.keys(monitored).filter(handle => {
            return monitored[handle] && monitored[handle].enabled;
        });
        
        console.log(`[Check All] Checking ${enabledAccounts.length} monitored accounts...`);
        
        const results = [];
        const io = req.app.get('io');
        
        for (const handle of enabledAccounts) {
            try {
                const account = await findBy('tiktok_accounts.json', 'handle', handle);
                if (!account) continue;
                
                const currentStatus = monitored[handle] || { enabled: false, lastCheckedAt: null, currentLiveSessionId: null };
                
                await updateNested('monitored.json', handle, {
                    lastCheckedAt: new Date().toISOString(),
                    enabled: currentStatus.enabled,
                    currentLiveSessionId: currentStatus.currentLiveSessionId
                });
                
                const liveStatus = await pollerService.checkIfLive(handle);
                
                // If live and not already monitoring, start monitoring ONLY if enabled
                if (liveStatus.isLive && !currentStatus.currentLiveSessionId && currentStatus.enabled) {
                    console.log(`[Check All] @${handle} is LIVE! Starting monitoring...`);
                    try {
                        await liveConnectorService.startMonitoring(handle, liveStatus.roomId, io);
                        results.push({ handle, isLive: true, action: 'started' });
                    } catch (error) {
                        console.error(`[Check All] Error starting monitoring for @${handle}:`, error);
                        results.push({ handle, isLive: true, action: 'error', error: error.message });
                    }
                } else if (liveStatus.isLive && !currentStatus.enabled) {
                    // Account is live but monitoring is disabled - update lastLiveTime without starting monitoring
                    await updateNested('monitored.json', handle, {
                        lastLiveTime: new Date().toISOString(),
                        lastCheckedAt: new Date().toISOString(),
                        enabled: currentStatus.enabled,
                        currentLiveSessionId: null
                    });
                    results.push({ handle, isLive: true, action: 'live_but_disabled' });
                } else if (liveStatus.isLive && currentStatus.currentLiveSessionId) {
                    // Already monitoring, update lastLiveTime
                    await updateNested('monitored.json', handle, {
                        lastLiveTime: new Date().toISOString(),
                        lastCheckedAt: new Date().toISOString(),
                        enabled: currentStatus.enabled,
                        currentLiveSessionId: currentStatus.currentLiveSessionId
                    });
                    results.push({ handle, isLive: true, action: 'already_monitoring' });
                } else if (!liveStatus.isLive && currentStatus.currentLiveSessionId) {
                    // Not live anymore but there's an active session - end it
                    console.log(`[Check All] @${handle} is no longer live, ending active session`);
                    try {
                        await liveConnectorService.stopMonitoring(handle, io);
                        results.push({ handle, isLive: false, action: 'ended_session' });
                    } catch (error) {
                        console.error(`[Check All] Error ending session for @${handle}:`, error);
                        results.push({ handle, isLive: false, action: 'error', error: error.message });
                    }
                } else {
                    results.push({ handle, isLive: false, action: 'offline' });
                }
                
                // Emit Socket.IO event
                if (io) {
                    io.emit('monitoringStatusChanged', {
                        handle,
                        isLive: liveStatus.isLive
                    });
                }
            } catch (error) {
                console.error(`[Check All] Error checking @${handle}:`, error);
                results.push({ handle, isLive: false, action: 'error', error: error.message });
            }
        }
        
        res.json({
            message: `Checked ${enabledAccounts.length} accounts`,
            results
        });
    } catch (error) {
        console.error('Check all error:', error);
        res.status(500).json({ error: 'Internal server error', message: error.message });
    }
});

/**
 * POST /api/monitor/:handle/check-now
 * Manually trigger a check for a specific account
 */
router.post('/:handle/check-now', async (req, res) => {
    try {
        const { handle } = req.params;
        const cleanHandle = handle.replace('@', '').trim();
        
        // Check if account exists
        const account = await findBy('tiktok_accounts.json', 'handle', cleanHandle);
        if (!account) {
            return res.status(404).json({ error: 'Account not found' });
        }
        
        // Update last checked time
        const monitored = await read('monitored.json');
        const currentStatus = monitored[cleanHandle] || { enabled: false, lastCheckedAt: null, currentLiveSessionId: null };
        
        await updateNested('monitored.json', cleanHandle, {
            lastCheckedAt: new Date().toISOString(),
            enabled: currentStatus.enabled,
            currentLiveSessionId: currentStatus.currentLiveSessionId
        });
        
        // Check if monitoring is actually active first (before checkIfLive)
        const io = req.app.get('io');
        const isActuallyMonitoring = liveConnectorService.isMonitoring(cleanHandle);
        const activeSessionId = liveConnectorService.getActiveSessionId(cleanHandle);
        
        // If monitoring is active but monitored.json has different sessionId, sync it
        if (isActuallyMonitoring && activeSessionId && activeSessionId !== currentStatus.currentLiveSessionId) {
            console.log(`[Check Now] Active session mismatch for @${cleanHandle}. Updating monitored.json from ${currentStatus.currentLiveSessionId} to ${activeSessionId}`);
            await updateNested('monitored.json', cleanHandle, {
                currentLiveSessionId: activeSessionId,
                lastLiveTime: new Date().toISOString(),
                lastCheckedAt: new Date().toISOString(),
                enabled: currentStatus.enabled !== undefined ? currentStatus.enabled : true
            });
            // User is live if actively monitoring, no need to check
            res.json({ 
                message: `Monitoring active for @${cleanHandle}`,
                isLive: true,
                sessionId: activeSessionId
            });
            return;
        }
        
        // Check if live
        console.log(`[Check Now] Checking if @${cleanHandle} is live...`);
        const liveStatus = await pollerService.checkIfLive(cleanHandle);
        console.log(`[Check Now] @${cleanHandle} isLive: ${liveStatus.isLive}, roomId: ${liveStatus.roomId}`);
        
        // If live and not actually monitoring, start monitoring ONLY if enabled
        if (liveStatus.isLive && !isActuallyMonitoring && currentStatus.enabled) {
            console.log(`[Check Now] Starting monitoring for @${cleanHandle} with roomId: ${liveStatus.roomId}`);
            try {
                await liveConnectorService.startMonitoring(cleanHandle, liveStatus.roomId, io);
                console.log(`[Check Now] Successfully started monitoring for @${cleanHandle}`);
            } catch (error) {
                console.error(`[Check Now] Error starting monitoring for @${cleanHandle}:`, error);
            }
        } else if (liveStatus.isLive && !currentStatus.enabled) {
            // Account is live but monitoring is disabled - update lastLiveTime without starting monitoring
            console.log(`[Check Now] @${cleanHandle} is live but monitoring is disabled. Updating lastLiveTime only.`);
            await updateNested('monitored.json', cleanHandle, {
                lastLiveTime: new Date().toISOString(),
                lastCheckedAt: new Date().toISOString(),
                enabled: currentStatus.enabled,
                currentLiveSessionId: null
            });
        } else if (liveStatus.isLive && isActuallyMonitoring) {
            // Already monitoring, but update lastLiveTime to now
            console.log(`[Check Now] @${cleanHandle} is already being monitored (sessionId: ${currentStatus.currentLiveSessionId}), updating lastLiveTime`);
            await updateNested('monitored.json', cleanHandle, {
                lastLiveTime: new Date().toISOString(),
                lastCheckedAt: new Date().toISOString(),
                enabled: currentStatus.enabled !== undefined ? currentStatus.enabled : true,
                currentLiveSessionId: currentStatus.currentLiveSessionId || activeSessionId
            });
        } else if (!liveStatus.isLive && isActuallyMonitoring) {
            // checkIfLive returned false but monitoring is still active - this could be a temporary error
            // Don't close active session, just log warning
            console.warn(`[Check Now] @${cleanHandle} checkIfLive returned false but session ${activeSessionId} is still active. Keeping session open.`);
            await updateNested('monitored.json', cleanHandle, {
                lastCheckedAt: new Date().toISOString(),
                enabled: currentStatus.enabled !== undefined ? currentStatus.enabled : true,
                currentLiveSessionId: activeSessionId
            });
        } else if (!liveStatus.isLive && currentStatus.currentLiveSessionId && !isActuallyMonitoring) {
            // Not live anymore and no active monitoring - end the stale session
            console.log(`[Check Now] @${cleanHandle} is no longer live, ending stale session ${currentStatus.currentLiveSessionId}`);
            try {
                // Update monitored.json to clear stale sessionId
                await updateNested('monitored.json', cleanHandle, {
                    currentLiveSessionId: null,
                    lastCheckedAt: new Date().toISOString(),
                    enabled: currentStatus.enabled !== undefined ? currentStatus.enabled : true
                });
                
                console.log(`[Check Now] Successfully cleaned up stale session for @${cleanHandle}`);
            } catch (error) {
                console.error(`[Check Now] Error cleaning up stale session for @${cleanHandle}:`, error);
            }
        } else {
            console.log(`[Check Now] @${cleanHandle} is not live`);
        }
        
        // Emit Socket.IO event for real-time update
        if (io) {
            io.emit('monitoringStatusChanged', {
                handle: cleanHandle,
                isLive: liveStatus.isLive
            });
        }
        
        res.json({
            handle: cleanHandle,
            isLive: liveStatus.isLive,
            roomId: liveStatus.roomId,
            checkedAt: new Date().toISOString()
        });
    } catch (error) {
        console.error('Check now error:', error);
        res.status(500).json({ error: 'Internal server error', message: error.message });
    }
});

module.exports = router;
