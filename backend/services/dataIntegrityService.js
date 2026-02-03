const { read, deleteNested } = require('../storage/dbStorage');
const { query } = require('../config/database');

/**
 * Data Integrity Service
 * Checks for consistency and data integrity issues across the application
 */
class DataIntegrityService {
    /**
     * Check for orphaned data and consistency issues
     */
    async checkIntegrity() {
        const issues = [];
        
        try {
            // 1. Check accounts vs monitored.json consistency
            const accounts = await read('tiktok_accounts.json');
            const monitored = await read('monitored.json');
            
            // Find accounts not in monitored.json
            for (const account of accounts) {
                if (!monitored[account.handle]) {
                    issues.push({
                        type: 'orphaned_account',
                        severity: 'low',
                        message: `Account @${account.handle} exists but not in monitored.json`,
                        handle: account.handle
                    });
                }
            }
            
            // Find monitored entries without accounts
            for (const handle of Object.keys(monitored)) {
                const account = accounts.find(a => a.handle === handle);
                if (!account) {
                    issues.push({
                        type: 'orphaned_monitoring',
                        severity: 'medium',
                        message: `Monitoring entry for @${handle} exists but account not found`,
                        handle: handle
                    });
                }
            }
            
            // 2. Check live_sessions vs monitored.json consistency
            try {
                const sessionsResult = await query(
                    'SELECT DISTINCT handle FROM live_sessions'
                );
                
                for (const row of sessionsResult.rows) {
                    const handle = row.handle;
                    // Check if account exists
                    const account = accounts.find(a => a.handle === handle);
                    if (!account) {
                        issues.push({
                            type: 'orphaned_sessions',
                            severity: 'high',
                            message: `Live sessions exist for @${handle} but account not found`,
                            handle: handle
                        });
                    }
                    
                    // Check if session ID matches currentLiveSessionId
                    const monitorStatus = monitored[handle];
                    if (monitorStatus && monitorStatus.currentLiveSessionId) {
                        const sessionCheck = await query(
                            'SELECT id FROM live_sessions WHERE id = $1 AND handle = $2',
                            [monitorStatus.currentLiveSessionId, handle]
                        );
                        
                        if (sessionCheck.rows.length === 0) {
                            issues.push({
                                type: 'session_mismatch',
                                severity: 'high',
                                message: `Session ${monitorStatus.currentLiveSessionId} referenced in monitored but not found in database for @${handle}`,
                                handle: handle,
                                sessionId: monitorStatus.currentLiveSessionId
                            });
                        }
                    }
                }
            } catch (error) {
                console.warn('[Integrity Check] Error checking sessions:', error);
            }
            
            // 3. Check events vs sessions consistency
            try {
                const orphanedEvents = await query(
                    `SELECT DISTINCT e.session_id 
                     FROM events e 
                     LEFT JOIN live_sessions ls ON e.session_id = ls.id 
                     WHERE ls.id IS NULL`
                );
                
                for (const row of orphanedEvents.rows) {
                    issues.push({
                        type: 'orphaned_events',
                        severity: 'low',
                        message: `Events exist for session ${row.session_id} but session not found`,
                        sessionId: row.session_id
                    });
                }
            } catch (error) {
                console.warn('[Integrity Check] Error checking events:', error);
            }
            
            // 4. Check stats_history vs sessions consistency
            try {
                const orphanedStats = await query(
                    `SELECT DISTINCT sh.session_id 
                     FROM stats_history sh 
                     LEFT JOIN live_sessions ls ON sh.session_id = ls.id 
                     WHERE ls.id IS NULL`
                );
                
                for (const row of orphanedStats.rows) {
                    issues.push({
                        type: 'orphaned_stats',
                        severity: 'low',
                        message: `Stats history exists for session ${row.session_id} but session not found`,
                        sessionId: row.session_id
                    });
                }
            } catch (error) {
                console.warn('[Integrity Check] Error checking stats_history:', error);
            }
            
            // 5. Check account_history consistency
            try {
                const orphanedHistory = await query(
                    `SELECT DISTINCT ah.handle 
                     FROM account_history ah 
                     LEFT JOIN tiktok_accounts ta ON ah.handle = ta.handle 
                     WHERE ta.handle IS NULL`
                );
                
                for (const row of orphanedHistory.rows) {
                    issues.push({
                        type: 'orphaned_history',
                        severity: 'low',
                        message: `Account history exists for @${row.handle} but account not found`,
                        handle: row.handle
                    });
                }
            } catch (error) {
                console.warn('[Integrity Check] Error checking account_history:', error);
            }
            
            // 6. Check block tracking consistency
            try {
                const blocks = await read('tiktok_blocks.json');
                if (blocks && blocks.activeBlocks) {
                    for (const [handle, block] of Object.entries(blocks.activeBlocks)) {
                        const account = accounts.find(a => a.handle === handle);
                        if (!account && !block.dismissed) {
                            issues.push({
                                type: 'orphaned_block',
                                severity: 'medium',
                                message: `Block entry for @${handle} exists but account not found`,
                                handle: handle
                            });
                        }
                    }
                }
            } catch (error) {
                // File might not exist, that's okay
            }
            
        } catch (error) {
            console.error('[Integrity Check] Error during integrity check:', error);
            issues.push({
                type: 'check_error',
                severity: 'high',
                message: `Error during integrity check: ${error.message}`
            });
        }
        
        return issues;
    }
    
    /**
     * Clean up orphaned data
     */
    async cleanupOrphanedData() {
        const cleaned = [];
        
        try {
            const accounts = await read('tiktok_accounts.json');
            const accountHandles = new Set((accounts || []).map(a => a.handle));
            
            // Clean up orphaned monitoring entries
            const monitored = await read('monitored.json');
            let hasChanges = false;
            for (const handle of Object.keys(monitored)) {
                if (!accountHandles.has(handle)) {
                    delete monitored[handle];
                    hasChanges = true;
                    cleaned.push(`Removed orphaned monitoring entry for @${handle}`);
                }
            }
            if (hasChanges) {
                const { write } = require('../storage/dbStorage');
                await write('monitored.json', monitored);
            }
            
            // Note: We don't automatically delete orphaned sessions/events/stats as they might be historical data
            // User should manually review and clean if needed
            
        } catch (error) {
            console.error('[Cleanup] Error cleaning orphaned data:', error);
        }
        
        return cleaned;
    }
}

const dataIntegrityService = new DataIntegrityService();

module.exports = dataIntegrityService;
