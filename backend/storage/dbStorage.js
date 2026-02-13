const { query, pool } = require('../config/database');
const { v4: uuidv4 } = require('uuid');

/**
 * Parse file path to determine table and parameters
 */
function parseFilePath(filePath) {
    // Handle nested paths like 'live_sessions/{handle}/{id}.json'
    if (filePath.startsWith('live_sessions/')) {
        const parts = filePath.split('/');
        if (parts.length === 3) {
            const sessionFile = parts[2].replace('.json', '');
            return {
                table: 'live_sessions',
                type: 'session',
                handle: parts[1],
                id: sessionFile
            };
        }
    }
    
    // Handle events/{sessionId}.json
    if (filePath.startsWith('events/')) {
        const sessionId = filePath.replace('events/', '').replace('.json', '');
        return {
            table: 'events',
            type: 'events',
            sessionId: sessionId
        };
    }
    
    // Handle stats_history/{sessionId}.json
    if (filePath.startsWith('stats_history/')) {
        const sessionId = filePath.replace('stats_history/', '').replace('.json', '');
        return {
            table: 'stats_history',
            type: 'stats_history',
            sessionId: sessionId
        };
    }
    
    // Handle account_history/{handle}.json
    if (filePath.startsWith('account_history/')) {
        const handle = filePath.replace('account_history/', '').replace('.json', '');
        return {
            table: 'account_history',
            type: 'account_history',
            handle: handle
        };
    }
    
    // Handle simple JSON files
    const fileName = filePath.replace('.json', '');
    
    const tableMap = {
        'users': 'users',
        'tiktok_accounts': 'tiktok_accounts',
        'monitored': 'monitored',
        'alerts': 'alerts',
        'trigger_words': 'trigger_words',
        'anti_blocking_settings': 'anti_blocking_settings',
        'tiktok_blocks': 'tiktok_blocks',
        'console_logs': 'console_logs'
    };
    
    return {
        table: tableMap[fileName],
        type: fileName,
        fileName: fileName
    };
}

/**
 * Convert database row to JSON format
 */
function rowToJson(row, tableName) {
    if (!row) return null;
    
    const json = { ...row };
    
    // Convert snake_case to camelCase for compatibility
    if (tableName === 'tiktok_accounts') {
        return {
            id: json.id,
            handle: json.handle,
            uniqueId: json.unique_id,
            nickname: json.nickname,
            signature: json.signature,
            bio: json.bio,
            profilePictureUrl: json.profile_picture_url,
            verified: json.verified,
            secret: json.secret,
            privateAccount: json.private_account,
            language: json.language,
            region: json.region,
            secUid: json.sec_uid,
            followerCount: json.follower_count,
            followingCount: json.following_count,
            videoCount: json.video_count,
            heartCount: json.heart_count,
            diggCount: json.digg_count,
            friendCount: json.friend_count,
            creationDate: json.creation_date,
            createTime: json.create_time,
            uniqueIdModifyTime: json.unique_id_modify_time,
            uniqueIdModifyTimeUnix: json.unique_id_modify_time_unix,
            nickNameModifyTime: json.nick_name_modify_time,
            nickNameModifyTimeUnix: json.nick_name_modify_time_unix,
            lastSyncedAt: json.last_synced_at,
            useSession: json.use_session || false,
            createdAt: json.created_at,
            updatedAt: json.updated_at
        };
    }
    
    if (tableName === 'users') {
        return {
            id: json.id,
            username: json.username,
            password: json.password_hash, // Keep as 'password' for compatibility
            createdAt: json.created_at
        };
    }
    
    if (tableName === 'monitored') {
        return {
            enabled: json.enabled,
            currentLiveSessionId: json.current_live_session_id,
            lastCheckedAt: json.last_checked_at,
            lastLiveTime: json.last_live_time
        };
    }
    
    if (tableName === 'live_sessions') {
        return {
            sessionId: json.id,
            handle: json.handle,
            startTime: json.start_time,
            endTime: json.end_time,
            status: json.status,
            roomId: json.room_id ? String(json.room_id) : null,
            stats: json.stats || {}
        };
    }
    
    if (tableName === 'events') {
        return {
            id: json.id,
            sessionId: json.session_id,
            type: json.type,
            timestamp: json.timestamp,
            user: json.user_data,
            data: json.event_data,
            location: json.location
        };
    }
    
    if (tableName === 'stats_history') {
        return {
            id: json.id,
            sessionId: json.session_id,
            timestamp: json.timestamp,
            stats: json.stats
        };
    }
    
    if (tableName === 'alerts') {
        return {
            id: json.id,
            triggerWord: json.type, // Map type to triggerWord for compatibility
            sessionId: json.session_id,
            handle: json.handle,
            eventId: json.event_id,
            timestamp: json.timestamp,
            severity: json.severity.toLowerCase(),
            status: json.status,
            message: json.message,
            acknowledgedAt: json.acknowledged_at,
            resolvedAt: json.resolved_at
        };
    }
    
    if (tableName === 'trigger_words') {
        return {
            id: json.id,
            word: (json.word || '').toLowerCase(), // Always return lowercase
            severity: json.severity || 'medium', // Default to medium if null
            createdAt: json.created_at
        };
    }
    
    if (tableName === 'tiktok_blocks') {
        return {
            activeBlocks: json.active_blocks || {},
            blockHistory: json.block_history || {},
            dismissedWarnings: json.dismissed_warnings || {}
        };
    }
    
    if (tableName === 'account_history') {
        return {
            id: json.id,
            handle: json.handle,
            timestamp: json.timestamp,
            field: json.field,
            oldValue: json.old_value,
            newValue: json.new_value,
            source: json.source
        };
    }
    
    if (tableName === 'console_logs') {
        return {
            id: json.id,
            timestamp: json.timestamp,
            level: json.level,
            message: json.message,
            metadata: json.metadata || {}
        };
    }
    
    return json;
}

/**
 * Convert JSON format to database row
 */
function jsonToRow(data, tableName) {
    const row = {};
    
    if (tableName === 'tiktok_accounts') {
        row.id = data.id;
        row.handle = data.handle;
        row.unique_id = data.uniqueId || data.unique_id;
        row.nickname = data.nickname;
        row.signature = data.signature;
        row.bio = data.bio;
        row.profile_picture_url = data.profilePictureUrl || data.profile_picture_url;
        row.verified = data.verified;
        row.secret = data.secret;
        row.private_account = data.privateAccount || data.private_account;
        row.language = data.language;
        row.region = data.region;
        row.sec_uid = data.secUid || data.sec_uid;
        row.follower_count = data.followerCount || data.follower_count || 0;
        row.following_count = data.followingCount || data.following_count || 0;
        row.video_count = data.videoCount || data.video_count || 0;
        row.heart_count = data.heartCount || data.heart_count || 0;
        row.digg_count = data.diggCount || data.digg_count || 0;
        row.friend_count = data.friendCount || data.friend_count || 0;
        row.creation_date = data.creationDate || data.creation_date;
        row.create_time = data.createTime || data.create_time;
        row.unique_id_modify_time = data.uniqueIdModifyTime || data.unique_id_modify_time;
        row.unique_id_modify_time_unix = data.uniqueIdModifyTimeUnix || data.unique_id_modify_time_unix;
        row.nick_name_modify_time = data.nickNameModifyTime || data.nick_name_modify_time;
        row.nick_name_modify_time_unix = data.nickNameModifyTimeUnix || data.nick_name_modify_time_unix;
        row.last_synced_at = data.lastSyncedAt || data.last_synced_at;
        row.use_session = data.useSession !== undefined ? data.useSession : (data.use_session || false);
        if (data.createdAt) row.created_at = data.createdAt;
        if (data.updatedAt) row.updated_at = data.updatedAt;
        return row;
    }
    
    if (tableName === 'users') {
        row.id = data.id || uuidv4();
        row.username = data.username;
        row.password_hash = data.password || data.password_hash;
        if (data.createdAt) row.created_at = data.createdAt;
        return row;
    }
    
    if (tableName === 'monitored') {
        row.handle = data.handle;
        row.enabled = data.enabled !== undefined ? data.enabled : false;
        row.current_live_session_id = data.currentLiveSessionId || data.current_live_session_id;
        row.last_checked_at = data.lastCheckedAt || data.last_checked_at;
        row.last_live_time = data.lastLiveTime || data.last_live_time;
        return row;
    }
    
    if (tableName === 'live_sessions') {
        row.id = data.sessionId || data.id || uuidv4();
        row.handle = data.handle;
        row.start_time = data.startTime;
        row.end_time = data.endTime;
        row.status = data.status || 'live';
        row.room_id = data.roomId ? BigInt(data.roomId) : null;
        row.stats = data.stats || {};
        return row;
    }
    
    if (tableName === 'events') {
        row.id = data.id || uuidv4();
        row.session_id = data.sessionId || data.session_id;
        row.type = data.type;
        row.timestamp = data.timestamp;
        row.user_data = data.user || data.user_data;
        row.event_data = data.data || data.event_data;
        row.location = data.location;
        return row;
    }
    
    if (tableName === 'stats_history') {
        row.id = data.id || uuidv4();
        row.session_id = data.sessionId || data.session_id;
        row.timestamp = data.timestamp;
        row.stats = data.stats || {};
        return row;
    }
    
    if (tableName === 'alerts') {
        row.id = data.id || uuidv4();
        row.handle = data.handle;
        row.session_id = data.sessionId || data.session_id;
        row.event_id = data.eventId || data.event_id;
        row.type = data.triggerWord || data.type;
        row.message = data.message;
        row.severity = (data.severity || 'MED').toUpperCase();
        row.status = data.status || 'pending';
        row.acknowledged_at = data.acknowledgedAt || data.acknowledged_at;
        row.resolved_at = data.resolvedAt || data.resolved_at;
        if (data.timestamp) row.timestamp = data.timestamp;
        return row;
    }
    
    if (tableName === 'trigger_words') {
        row.id = data.id || uuidv4();
        row.word = (data.word || '').toLowerCase(); // Always save as lowercase
        row.case_sensitive = false; // Always false, case sensitivity is ignored
        row.severity = data.severity || 'medium'; // Default to medium if not provided
        if (data.createdAt) row.created_at = data.createdAt;
        return row;
    }
    
    if (tableName === 'tiktok_blocks') {
        row.handle = data.handle;
        row.active_blocks = data.activeBlocks || data.active_blocks || {};
        row.block_history = data.blockHistory || data.block_history || {};
        row.dismissed_warnings = data.dismissedWarnings || data.dismissed_warnings || {};
        return row;
    }
    
    if (tableName === 'account_history') {
        row.id = data.id || uuidv4();
        row.handle = data.handle;
        row.timestamp = data.timestamp;
        row.field = data.field;
        row.old_value = data.oldValue || data.old_value;
        row.new_value = data.newValue || data.new_value;
        row.source = data.source || 'sync';
        return row;
    }
    
    if (tableName === 'console_logs') {
        row.id = data.id || uuidv4();
        row.timestamp = data.timestamp;
        row.level = data.level;
        row.message = data.message;
        row.metadata = data.metadata || {};
        return row;
    }
    
    return data;
}

/**
 * Read data from database (compatible with fileStorage API)
 */
async function read(filePath) {
    const parsed = parseFilePath(filePath);
    
    if (!parsed || !parsed.table) {
        throw new Error(`Unknown file path: ${filePath}`);
    }
    
    try {
        if (parsed.type === 'session') {
            // Read single session: live_sessions/{handle}/{id}.json
            const result = await query(
                'SELECT * FROM live_sessions WHERE id = $1',
                [parsed.id]
            );
            return result.rows.length > 0 ? rowToJson(result.rows[0], 'live_sessions') : null;
        }
        
        if (parsed.type === 'events') {
            // Read events for session: events/{sessionId}.json
            // Use index idx_events_session_time for optimal performance
            const result = await query(
                'SELECT id, session_id, type, timestamp, user_data, event_data, location FROM events WHERE session_id = $1 ORDER BY timestamp DESC LIMIT 10000',
                [parsed.sessionId]
            );
            return result.rows.map(row => rowToJson(row, 'events'));
        }
        
        if (parsed.type === 'stats_history') {
            // Read stats history: stats_history/{sessionId}.json
            const result = await query(
                'SELECT * FROM stats_history WHERE session_id = $1 ORDER BY timestamp ASC',
                [parsed.sessionId]
            );
            return result.rows.map(row => rowToJson(row, 'stats_history'));
        }
        
        if (parsed.type === 'account_history') {
            // Read account history: account_history/{handle}.json
            const result = await query(
                'SELECT * FROM account_history WHERE handle = $1 ORDER BY timestamp DESC',
                [parsed.handle]
            );
            return result.rows.map(row => rowToJson(row, 'account_history'));
        }
        
        if (parsed.type === 'monitored') {
            // Read all monitored accounts and return as object: {handle: {...}}
            const result = await query('SELECT * FROM monitored');
            const monitored = {};
            for (const row of result.rows) {
                monitored[row.handle] = rowToJson(row, 'monitored');
            }
            return monitored;
        }
        
        if (parsed.type === 'tiktok_blocks') {
            // Read all blocks and return as object: {handle: {...}}
            const result = await query('SELECT * FROM tiktok_blocks');
            const blocks = {};
            for (const row of result.rows) {
                blocks[row.handle] = rowToJson(row, 'tiktok_blocks');
            }
            return blocks;
        }
        
        if (parsed.type === 'anti_blocking_settings') {
            // Read singleton settings
            const result = await query('SELECT settings FROM anti_blocking_settings WHERE id = 1');
            return result.rows.length > 0 ? result.rows[0].settings : {};
        }
        
        if (parsed.type === 'console_logs') {
            // Read last 1000 logs
            const result = await query(
                'SELECT * FROM console_logs ORDER BY timestamp DESC LIMIT 1000'
            );
            return result.rows.map(row => rowToJson(row, 'console_logs'));
        }
        
        // Array-based tables (users, tiktok_accounts, alerts, trigger_words)
        const result = await query(`SELECT * FROM ${parsed.table}`);
        return result.rows.map(row => rowToJson(row, parsed.table));
        
    } catch (error) {
        // Return appropriate defaults for missing data
        if (parsed.type === 'monitored' || parsed.type === 'tiktok_blocks' || parsed.type === 'anti_blocking_settings') {
            return {};
        }
        return [];
    }
}

/**
 * Write data to database (compatible with fileStorage API)
 */
async function write(filePath, data) {
    const parsed = parseFilePath(filePath);
    
    if (!parsed || !parsed.table) {
        throw new Error(`Unknown file path: ${filePath}`);
    }
    
    try {
        if (parsed.type === 'session') {
            // Write single session: live_sessions/{handle}/{id}.json
            const row = jsonToRow({ ...data, id: parsed.id }, 'live_sessions');
            await query(
                `INSERT INTO live_sessions (id, handle, start_time, end_time, status, room_id, stats)
                 VALUES ($1, $2, $3, $4, $5, $6, $7)
                 ON CONFLICT (id) DO UPDATE SET
                    handle = EXCLUDED.handle,
                    start_time = EXCLUDED.start_time,
                    end_time = EXCLUDED.end_time,
                    status = EXCLUDED.status,
                    room_id = EXCLUDED.room_id,
                    stats = EXCLUDED.stats`,
                [row.id, row.handle, row.start_time, row.end_time, row.status, row.room_id, JSON.stringify(row.stats)]
            );
            return;
        }
        
        if (parsed.type === 'events') {
            // Events write: insert all events, using ON CONFLICT to avoid duplicates
            // This is used when flushing buffered events or writing all events at once
            // We use ON CONFLICT instead of DELETE + INSERT to avoid race conditions and improve performance
            if (!Array.isArray(data)) {
                throw new Error(`events/${parsed.sessionId}.json must be an array`);
            }
            
            // Verify session exists before inserting events (foreign key constraint)
            if (data.length > 0) {
                const sessionCheck = await query(
                    'SELECT id FROM live_sessions WHERE id = $1',
                    [parsed.sessionId]
                );
                
                if (sessionCheck.rows.length === 0) {
                    console.warn(`[dbStorage] Session ${parsed.sessionId} does not exist. Cannot write ${data.length} events (foreign key constraint). Discarding events.`);
                    return; // Skip writing events if session doesn't exist
                }
                
                // Use bulk insert for better performance
                const client = await pool.connect();
                try {
                    await client.query('BEGIN');
                    
                    for (const item of data) {
                        const row = jsonToRow(item, 'events');
                        try {
                            await client.query(
                                `INSERT INTO events (id, session_id, type, timestamp, user_data, event_data, location)
                                 VALUES ($1, $2, $3, $4, $5, $6, $7)
                                 ON CONFLICT (id) DO NOTHING`,
                                [
                                    row.id,
                                    row.session_id,
                                    row.type,
                                    row.timestamp,
                                    JSON.stringify(row.user_data),
                                    JSON.stringify(row.event_data),
                                    row.location ? JSON.stringify(row.location) : null
                                ]
                            );
                        } catch (error) {
                            // Check if it's a foreign key constraint error
                            if (error.message && error.message.includes('foreign key constraint')) {
                                console.warn(`[dbStorage] Session ${row.session_id} does not exist. Skipping event ${row.id}.`);
                                continue; // Skip this event, continue with others
                            }
                            throw error; // Re-throw other errors
                        }
                    }
                    
                    await client.query('COMMIT');
                } catch (error) {
                    await client.query('ROLLBACK');
                    // If it's a foreign key constraint error, log and return gracefully
                    if (error.message && error.message.includes('foreign key constraint')) {
                        console.warn(`[dbStorage] Session ${parsed.sessionId} does not exist. Cannot write events (foreign key constraint).`);
                        return;
                    }
                    throw error;
                } finally {
                    client.release();
                }
            }
            return;
        }
        
        if (parsed.type === 'stats_history') {
            // Stats history is written via append() - this is for initial empty array
            return;
        }
        
        if (parsed.type === 'monitored') {
            // Write monitored object: {handle: {...}, ...}
            if (typeof data !== 'object' || Array.isArray(data)) {
                throw new Error('monitored.json must be an object');
            }
            
            for (const [handle, value] of Object.entries(data)) {
                const row = jsonToRow({ ...value, handle }, 'monitored');
                await query(
                    `INSERT INTO monitored (handle, enabled, current_live_session_id, last_checked_at, last_live_time)
                     VALUES ($1, $2, $3, $4, $5)
                     ON CONFLICT (handle) DO UPDATE SET
                        enabled = EXCLUDED.enabled,
                        current_live_session_id = EXCLUDED.current_live_session_id,
                        last_checked_at = EXCLUDED.last_checked_at,
                        last_live_time = EXCLUDED.last_live_time`,
                    [row.handle, row.enabled, row.current_live_session_id, row.last_checked_at, row.last_live_time]
                );
            }
            return;
        }
        
        if (parsed.type === 'tiktok_blocks') {
            // Handle two possible data structures:
            // 1. Old format: {activeBlocks: {}, blockHistory: {}, dismissedWarnings: {}}
            // 2. New format: {handle: {active_blocks, block_history, dismissed_warnings}, ...}
            
            if (typeof data !== 'object' || Array.isArray(data)) {
                throw new Error('tiktok_blocks.json must be an object');
            }
            
            // Check if it's the old format (has activeBlocks, blockHistory, dismissedWarnings as top-level keys)
            if (data.activeBlocks || data.blockHistory || data.dismissedWarnings || 
                data.active_blocks || data.block_history || data.dismissed_warnings) {
                // Old format: transform to per-handle structure
                const activeBlocks = data.activeBlocks || data.active_blocks || {};
                const blockHistory = data.blockHistory || data.block_history || {};
                const dismissedWarnings = data.dismissedWarnings || data.dismissed_warnings || {};
                
                // Get all unique handles from all three objects
                const allHandles = new Set([
                    ...Object.keys(activeBlocks),
                    ...Object.keys(blockHistory),
                    ...Object.keys(dismissedWarnings)
                ]);
                
                // Write one row per handle
                for (const handle of allHandles) {
                    // Skip if handle looks like a metadata key (not a real handle)
                    if (handle === 'activeBlocks' || handle === 'blockHistory' || 
                        handle === 'dismissedWarnings' || handle === 'active_blocks' || 
                        handle === 'block_history' || handle === 'dismissed_warnings') {
                        continue;
                    }
                    
                    // Verify handle exists in tiktok_accounts
                    const accountCheck = await query('SELECT handle FROM tiktok_accounts WHERE handle = $1', [handle]);
                    if (accountCheck.rows.length === 0) {
                        console.warn(`[dbStorage] Skipping tiktok_blocks entry for handle "${handle}" - account not found in tiktok_accounts`);
                        continue;
                    }
                    
                    const row = jsonToRow({
                        handle,
                        active_blocks: activeBlocks[handle] || null,
                        block_history: blockHistory[handle] || null,
                        dismissed_warnings: dismissedWarnings[handle] || null
                    }, 'tiktok_blocks');
                    
                    await query(
                        `INSERT INTO tiktok_blocks (handle, active_blocks, block_history, dismissed_warnings)
                         VALUES ($1, $2, $3, $4)
                         ON CONFLICT (handle) DO UPDATE SET
                            active_blocks = EXCLUDED.active_blocks,
                            block_history = EXCLUDED.block_history,
                            dismissed_warnings = EXCLUDED.dismissed_warnings`,
                        [row.handle, JSON.stringify(row.active_blocks), JSON.stringify(row.block_history), JSON.stringify(row.dismissed_warnings)]
                    );
                }
            } else {
                // New format: {handle: {...}, ...}
                for (const [handle, value] of Object.entries(data)) {
                    // Skip metadata keys
                    if (handle === 'activeBlocks' || handle === 'blockHistory' || 
                        handle === 'dismissedWarnings' || handle === 'active_blocks' || 
                        handle === 'block_history' || handle === 'dismissed_warnings') {
                        continue;
                    }
                    
                    // Verify handle exists in tiktok_accounts
                    const accountCheck = await query('SELECT handle FROM tiktok_accounts WHERE handle = $1', [handle]);
                    if (accountCheck.rows.length === 0) {
                        console.warn(`[dbStorage] Skipping tiktok_blocks entry for handle "${handle}" - account not found in tiktok_accounts`);
                        continue;
                    }
                    
                    const row = jsonToRow({ ...value, handle }, 'tiktok_blocks');
                    await query(
                        `INSERT INTO tiktok_blocks (handle, active_blocks, block_history, dismissed_warnings)
                         VALUES ($1, $2, $3, $4)
                         ON CONFLICT (handle) DO UPDATE SET
                            active_blocks = EXCLUDED.active_blocks,
                            block_history = EXCLUDED.block_history,
                            dismissed_warnings = EXCLUDED.dismissed_warnings`,
                        [row.handle, JSON.stringify(row.active_blocks), JSON.stringify(row.block_history), JSON.stringify(row.dismissed_warnings)]
                    );
                }
            }
            return;
        }
        
        if (parsed.type === 'anti_blocking_settings') {
            // Write singleton settings (upsert to handle first-time write)
            await query(
                `INSERT INTO anti_blocking_settings (id, settings)
                 VALUES (1, $1)
                 ON CONFLICT (id) DO UPDATE SET settings = EXCLUDED.settings`,
                [JSON.stringify(data)]
            );
            return;
        }
        
        if (parsed.type === 'account_history') {
            // Write account history for specific handle
            if (!Array.isArray(data)) {
                throw new Error(`account_history/${parsed.handle}.json must be an array`);
            }
            
            // Delete existing history for this handle only
            await query(
                'DELETE FROM account_history WHERE handle = $1',
                [parsed.handle]
            );
            
            // Insert new history entries
            if (data.length > 0) {
                for (const item of data) {
                    const row = jsonToRow(item, 'account_history');
                    await query(
                        `INSERT INTO account_history (id, handle, timestamp, field, old_value, new_value, source)
                         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                        [row.id, row.handle, row.timestamp, row.field, row.old_value, row.new_value, row.source]
                    );
                }
            }
            return;
        }
        
        // Array-based tables - clear and insert all
        if (!Array.isArray(data)) {
            throw new Error(`${parsed.fileName}.json must be an array`);
        }
        
        // For console_logs, don't delete all logs - just upsert
        // This prevents issues with logService calling both append() and write()
        if (parsed.table === 'console_logs') {
            // Delete logs older than MAX_LOGS (1000)
            await query(
                `DELETE FROM console_logs 
                 WHERE id NOT IN (
                     SELECT id FROM console_logs 
                     ORDER BY timestamp DESC 
                     LIMIT $1
                 )`,
                [1000]
            );
            
            // Insert/update logs with ON CONFLICT DO NOTHING
            if (data.length > 0) {
                for (const item of data) {
                    const row = jsonToRow(item, parsed.table);
                    const columns = Object.keys(row);
                    const values = Object.values(row);
                    const placeholders = values.map((_, i) => `$${i + 1}`).join(', ');
                    
                    await query(
                        `INSERT INTO ${parsed.table} (${columns.join(', ')}) VALUES (${placeholders})
                         ON CONFLICT (id) DO NOTHING`,
                        values
                    );
                }
            }
        } else {
            // For tiktok_accounts, use UPSERT to preserve foreign key relationships (monitored table)
            // For other tables, clear and insert all
            if (parsed.table === 'tiktok_accounts') {
                // Use UPSERT (INSERT ... ON CONFLICT DO UPDATE) to avoid deleting and recreating
                // This preserves foreign key relationships with monitored table
                if (data.length > 0) {
                    for (const item of data) {
                        const row = jsonToRow(item, parsed.table);
                        const columns = Object.keys(row);
                        const values = Object.values(row);
                        const placeholders = values.map((_, i) => `$${i + 1}`).join(', ');
                        
                        // Build UPDATE clause for all columns except id
                        // Use EXCLUDED to reference the new values in PostgreSQL
                        const updateColumns = columns.filter(col => col !== 'id');
                        const updateClauses = updateColumns.map(col => `${col} = EXCLUDED.${col}`).join(', ');
                        
                        await query(
                            `INSERT INTO ${parsed.table} (${columns.join(', ')}) 
                             VALUES (${placeholders})
                             ON CONFLICT (id) DO UPDATE SET ${updateClauses}`,
                            values
                        );
                    }
                }
                
                // Remove accounts that are no longer in the data array
                // Get all IDs from data
                const dataIds = data.map(item => {
                    const row = jsonToRow(item, parsed.table);
                    return row.id;
                });
                
                if (dataIds.length > 0) {
                    // Delete accounts that are not in the new data
                    await query(
                        `DELETE FROM ${parsed.table} WHERE id NOT IN (${dataIds.map((_, i) => `$${i + 1}`).join(', ')})`,
                        dataIds
                    );
                } else {
                    // If data is empty, delete all (shouldn't happen, but handle it)
                    await query(`DELETE FROM ${parsed.table}`);
                }
            } else {
                // For other tables, clear and insert all
                await query(`DELETE FROM ${parsed.table}`);
                
                // Bulk insert
                if (data.length > 0) {
                    for (const item of data) {
                        const row = jsonToRow(item, parsed.table);
                        const columns = Object.keys(row);
                        const values = Object.values(row);
                        const placeholders = values.map((_, i) => `$${i + 1}`).join(', ');
                        
                        await query(
                            `INSERT INTO ${parsed.table} (${columns.join(', ')}) VALUES (${placeholders})`,
                            values
                        );
                    }
                }
            }
        }
        
    } catch (error) {
        console.error(`[dbStorage] Error writing ${filePath}:`, error.message);
        throw error;
    }
}

/**
 * Append item to array (compatible with fileStorage API)
 */
async function append(filePath, item) {
    const parsed = parseFilePath(filePath);
    
    if (!parsed || !parsed.table) {
        throw new Error(`Unknown file path: ${filePath}`);
    }
    
    try {
        if (parsed.type === 'events') {
            // Append event to events table
            const row = jsonToRow(item, 'events');
            
            // Verify session exists before inserting event (foreign key constraint)
            const sessionCheck = await query(
                'SELECT id FROM live_sessions WHERE id = $1',
                [row.session_id]
            );
            
            if (sessionCheck.rows.length === 0) {
                console.warn(`[dbStorage] Session ${row.session_id} does not exist. Cannot append event ${row.id} (foreign key constraint). Discarding event.`);
                return; // Skip appending event if session doesn't exist
            }
            
            try {
                await query(
                    `INSERT INTO events (id, session_id, type, timestamp, user_data, event_data, location)
                     VALUES ($1, $2, $3, $4, $5, $6, $7)
                     ON CONFLICT (id) DO NOTHING`,
                    [
                        row.id,
                        row.session_id,
                        row.type,
                        row.timestamp,
                        JSON.stringify(row.user_data),
                        JSON.stringify(row.event_data),
                        row.location ? JSON.stringify(row.location) : null
                    ]
                );
            } catch (error) {
                // Check if it's a foreign key constraint error
                if (error.message && error.message.includes('foreign key constraint')) {
                    console.warn(`[dbStorage] Session ${row.session_id} does not exist. Cannot append event ${row.id} (foreign key constraint).`);
                    return; // Skip appending event if session doesn't exist
                }
                throw error; // Re-throw other errors
            }
            return;
        }
        
        if (parsed.type === 'stats_history') {
            // Append stats snapshot
            const row = jsonToRow(item, 'stats_history');
            await query(
                `INSERT INTO stats_history (id, session_id, timestamp, stats)
                 VALUES ($1, $2, $3, $4)`,
                [row.id, row.session_id, row.timestamp, JSON.stringify(row.stats)]
            );
            return;
        }
        
        if (parsed.type === 'account_history') {
            // Append account history entry
            const row = jsonToRow(item, 'account_history');
            await query(
                `INSERT INTO account_history (id, handle, timestamp, field, old_value, new_value, source)
                 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                [row.id, row.handle, row.timestamp, row.field, row.old_value, row.new_value, row.source]
            );
            return;
        }
        
        // For array-based tables (users, alerts, trigger_words, console_logs, tiktok_accounts)
        const row = jsonToRow(item, parsed.table);
        const columns = Object.keys(row);
        const values = Object.values(row);
        const placeholders = values.map((_, i) => `$${i + 1}`).join(', ');
        
        // For console_logs, use ON CONFLICT DO NOTHING to prevent duplicate key errors
        // since logService may call both append() and write() for the same entry
        if (parsed.table === 'console_logs') {
            await query(
                `INSERT INTO ${parsed.table} (${columns.join(', ')}) VALUES (${placeholders})
                 ON CONFLICT (id) DO NOTHING`,
                values
            );
        } else {
            await query(
                `INSERT INTO ${parsed.table} (${columns.join(', ')}) VALUES (${placeholders})`,
                values
            );
        }
        
    } catch (error) {
        console.error(`[dbStorage] Error appending to ${filePath}:`, error.message);
        throw error;
    }
}

/**
 * Update item in array by ID (compatible with fileStorage API)
 */
async function update(filePath, id, updates) {
    const parsed = parseFilePath(filePath);
    
    if (!parsed || !parsed.table) {
        throw new Error(`Unknown file path: ${filePath}`);
    }
    
    const row = jsonToRow(updates, parsed.table);
    const setClauses = [];
    const values = [];
    let paramIndex = 1;
    
    for (const [key, value] of Object.entries(row)) {
        if (value !== undefined) {
            setClauses.push(`${key} = $${paramIndex++}`);
            values.push(value);
        }
    }
    
    values.push(id);
    
    await query(
        `UPDATE ${parsed.table} SET ${setClauses.join(', ')} WHERE id = $${paramIndex}`,
        values
    );
    
    // Return updated row
    const result = await query(`SELECT * FROM ${parsed.table} WHERE id = $1`, [id]);
    return result.rows.length > 0 ? rowToJson(result.rows[0], parsed.table) : null;
}

/**
 * Delete item from array by ID (compatible with fileStorage API)
 */
async function deleteById(filePath, id) {
    const parsed = parseFilePath(filePath);
    
    if (!parsed || !parsed.table) {
        throw new Error(`Unknown file path: ${filePath}`);
    }
    
    await query(`DELETE FROM ${parsed.table} WHERE id = $1`, [id]);
}

/**
 * Find item in array by field value (compatible with fileStorage API)
 */
async function findBy(filePath, field, value) {
    const parsed = parseFilePath(filePath);
    
    if (!parsed || !parsed.table) {
        throw new Error(`Unknown file path: ${filePath}`);
    }
    
    // Map camelCase to snake_case for database columns
    const dbField = field.replace(/([A-Z])/g, '_$1').toLowerCase();
    
    const result = await query(
        `SELECT * FROM ${parsed.table} WHERE ${dbField} = $1 LIMIT 1`,
        [value]
    );
    
    return result.rows.length > 0 ? rowToJson(result.rows[0], parsed.table) : null;
}

/**
 * Find all items matching criteria (compatible with fileStorage API)
 */
async function findWhere(filePath, criteria) {
    const parsed = parseFilePath(filePath);
    
    if (!parsed || !parsed.table) {
        throw new Error(`Unknown file path: ${filePath}`);
    }
    
    const whereClauses = [];
    const values = [];
    let paramIndex = 1;
    
    for (const [key, value] of Object.entries(criteria)) {
        const dbField = key.replace(/([A-Z])/g, '_$1').toLowerCase();
        whereClauses.push(`${dbField} = $${paramIndex++}`);
        values.push(value);
    }
    
    const result = await query(
        `SELECT * FROM ${parsed.table} WHERE ${whereClauses.join(' AND ')}`,
        values
    );
    
    return result.rows.map(row => rowToJson(row, parsed.table));
}

/**
 * Update nested object property (for monitored.json, tiktok_blocks.json)
 */
async function updateNested(filePath, key, updates) {
    const parsed = parseFilePath(filePath);
    
    if (!parsed || !parsed.table) {
        throw new Error(`Unknown file path: ${filePath}`);
    }
    
    if (parsed.type === 'monitored') {
        // Read existing row first to preserve values not in updates
        const existingResult = await query('SELECT * FROM monitored WHERE handle = $1', [key]);
        const existing = existingResult.rows.length > 0 ? rowToJson(existingResult.rows[0], 'monitored') : null;
        
        // Merge updates with existing values, preserving enabled if not specified
        const mergedData = {
            handle: key,
            enabled: existing?.enabled !== undefined ? existing.enabled : true, // Default to true if new
            currentLiveSessionId: existing?.currentLiveSessionId || null,
            lastCheckedAt: existing?.lastCheckedAt || null,
            lastLiveTime: existing?.lastLiveTime || null,
            ...updates // Override with updates (if enabled is specified, it will override)
        };
        
        // Only include enabled in updates if it was explicitly provided
        if (updates.enabled === undefined && existing) {
            mergedData.enabled = existing.enabled; // Preserve existing enabled value
        }
        
        const row = jsonToRow(mergedData, 'monitored');
        
        await query(
            `INSERT INTO monitored (handle, enabled, current_live_session_id, last_checked_at, last_live_time)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (handle) DO UPDATE SET
                enabled = EXCLUDED.enabled,
                current_live_session_id = COALESCE(EXCLUDED.current_live_session_id, monitored.current_live_session_id),
                last_checked_at = COALESCE(EXCLUDED.last_checked_at, monitored.last_checked_at),
                last_live_time = COALESCE(EXCLUDED.last_live_time, monitored.last_live_time)`,
            [key, row.enabled, row.current_live_session_id, row.last_checked_at, row.last_live_time]
        );
        
        // Return updated row
        const result = await query('SELECT * FROM monitored WHERE handle = $1', [key]);
        return result.rows.length > 0 ? rowToJson(result.rows[0], 'monitored') : null;
    }
    
    if (parsed.type === 'tiktok_blocks') {
        // Update tiktok_blocks row by handle
        const row = jsonToRow({ ...updates, handle: key }, 'tiktok_blocks');
        
        await query(
            `INSERT INTO tiktok_blocks (handle, active_blocks, block_history, dismissed_warnings)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (handle) DO UPDATE SET
                active_blocks = COALESCE(EXCLUDED.active_blocks, tiktok_blocks.active_blocks),
                block_history = COALESCE(EXCLUDED.block_history, tiktok_blocks.block_history),
                dismissed_warnings = COALESCE(EXCLUDED.dismissed_warnings, tiktok_blocks.dismissed_warnings)`,
            [
                key,
                JSON.stringify(row.active_blocks),
                JSON.stringify(row.block_history),
                JSON.stringify(row.dismissed_warnings)
            ]
        );
        
        // Return updated row
        const result = await query('SELECT * FROM tiktok_blocks WHERE handle = $1', [key]);
        return result.rows.length > 0 ? rowToJson(result.rows[0], 'tiktok_blocks') : null;
    }
    
    throw new Error(`updateNested not supported for ${filePath}`);
}

/**
 * Delete nested object property
 */
async function deleteNested(filePath, key) {
    const parsed = parseFilePath(filePath);
    
    if (!parsed || !parsed.table) {
        throw new Error(`Unknown file path: ${filePath}`);
    }
    
    if (parsed.type === 'monitored' || parsed.type === 'tiktok_blocks') {
        await query(`DELETE FROM ${parsed.table} WHERE handle = $1`, [key]);
        return;
    }
    
    throw new Error(`deleteNested not supported for ${filePath}`);
}

/**
 * Bulk insert for events (optimization)
 */
async function bulkInsert(tableName, items) {
    if (items.length === 0) return;
    
    const parsed = { table: tableName };
    
    // Use a transaction for bulk insert
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        for (const item of items) {
            const row = jsonToRow(item, tableName);
            const columns = Object.keys(row);
            const values = Object.values(row);
            const placeholders = values.map((_, i) => `$${i + 1}`).join(', ');
            
            await client.query(
                `INSERT INTO ${tableName} (${columns.join(', ')}) VALUES (${placeholders})`,
                values
            );
        }
        
        await client.query('COMMIT');
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

// DB_DIR is not needed for database storage, but kept for compatibility
const DB_DIR = null;

module.exports = {
    read,
    write,
    append,
    update,
    deleteById,
    findBy,
    findWhere,
    updateNested,
    deleteNested,
    bulkInsert,
    DB_DIR
};
