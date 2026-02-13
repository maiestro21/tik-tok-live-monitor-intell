const { TikTokConnectionWrapper } = require('./connectionWrapper');
const triggerService = require('./triggerService');
const { v4: uuidv4 } = require('uuid');
const { read, write, append, update, updateNested, bulkInsert } = require('../storage/dbStorage');
const { query } = require('../config/database');
const path = require('path');

// Active connections map: handle -> connection wrapper
const activeConnections = new Map();

// Active sessions map: handle -> sessionId
const activeSessions = new Map();

// Stats update queue: sessionId -> pending updates
const statsUpdateQueue = new Map();

// Stats update interval
let statsUpdateInterval = null;
const STATS_UPDATE_INTERVAL_MS = 5 * 1000; // 5 seconds

// Statistics history tracking: sessionId -> last snapshot time
const statsHistoryTracking = new Map();
const STATS_HISTORY_SNAPSHOT_INTERVAL_MS = 15 * 1000; // 15 seconds

// Interval for updating lastLiveTime for active sessions
let lastLiveTimeUpdateInterval = null;
const LAST_LIVE_TIME_UPDATE_INTERVAL_MS = 30 * 1000; // 30 seconds

// Health check interval for active connections
let healthCheckInterval = null;
const HEALTH_CHECK_INTERVAL_MS = 60 * 1000; // Check every minute

// Event buffer: sessionId -> [events] (batched writes for performance)
const eventBuffers = new Map();

// Event flush interval
let eventFlushInterval = null;
const EVENT_FLUSH_INTERVAL_MS = 1 * 1000; // Flush every second

/**
 * Start monitoring a live stream
 */
async function startMonitoring(handle, roomId, io) {
    try {
        // Check if already monitoring
        if (activeConnections.has(handle)) {
            console.log(`Already monitoring @${handle}`);
            return;
        }

        // Create new live session
        const sessionId = uuidv4();
            const session = {
                sessionId,
                handle,
                startTime: new Date().toISOString(),
                endTime: null,
                status: 'live',
                roomId,
                stats: {
                    totalLikes: 0,
                    totalViewers: 0,
                    totalGifts: 0,
                    totalMessages: 0,
                    totalJoins: 0,
                    totalFollows: 0,
                    totalShares: 0,
                    totalReposts: 0,
                    totalLeaves: 0,
                    totalSubscribes: 0,
                    totalEmotes: 0
                }
            };

        // Store session (no need for directories with PostgreSQL)
        try {
            await write(`live_sessions/${handle}/${sessionId}.json`, session);
            console.log(`[Live Connector] ✓ Session ${sessionId} created in database for @${handle}`);
        } catch (error) {
            console.error(`[Live Connector] ❌ Error creating session ${sessionId} in database for @${handle}:`, error);
            throw error; // Re-throw to prevent continuing with invalid session
        }
        
        // Initialize events (empty array - events will be written via append/write)
        try {
            await write(`events/${sessionId}.json`, []);
        } catch (error) {
            console.error(`[Live Connector] ⚠️ Error initializing events for session ${sessionId}:`, error.message);
            // Don't throw - events can be initialized later
        }

        // Get current monitored status to preserve enabled state
        const monitored = await read('monitored.json');
        const currentStatus = monitored[handle] || { enabled: true };
        
        // Update monitored status with lastLiveTime (startTime) and preserve enabled state
        await updateNested('monitored.json', handle, {
            enabled: currentStatus.enabled !== undefined ? currentStatus.enabled : true,
            currentLiveSessionId: sessionId,
            lastLiveTime: session.startTime
        });

        activeSessions.set(handle, sessionId);
        
        // Initialize stats history (empty array - stats will be written via append)
        await write(`stats_history/${sessionId}.json`, []);
        
        // Start lastLiveTime update interval if not already running
        startLastLiveTimeUpdates();
        
        // Start stats history tracking for this session
        startStatsHistoryTracking(handle, sessionId);
        
        // Start health checks if not already running
        startHealthChecks();

        // Get session options if account has use_session enabled
        let connectOptions = {};
        try {
            const accounts = await read('tiktok_accounts.json');
            const account = Array.isArray(accounts) ? accounts.find(a => a.handle === handle) : null;
            if (account?.useSession) {
                const sessionResult = await query(
                    'SELECT session_id, tt_target_idc, valid_until FROM tiktok_session WHERE id = 1'
                );
                const row = sessionResult.rows[0];
                if (row?.session_id && row.valid_until && new Date(row.valid_until) > new Date()) {
                    connectOptions = { sessionId: row.session_id };
                    console.log(`[Live Connector] Using TikTok session for @${handle}`);
                } else {
                    console.warn(`[Live Connector] @${handle} - use_session enabled but no valid session (expired or not set)`);
                }
            }
        } catch (err) {
            console.warn(`[Live Connector] Error fetching session for @${handle}:`, err.message);
        }

        // Create connection wrapper
        const connectionWrapper = new TikTokConnectionWrapper(handle, connectOptions, true);

        // Connect with error handling
        connectionWrapper.connect().catch(async (err) => {
            const errorMessage = err?.message || err?.toString() || String(err);
            const isDeviceBlocked = errorMessage.includes('DEVICE_BLOCKED') || 
                                   errorMessage.includes('handshake-status: 415') ||
                                   errorMessage.includes('Device blocked by TikTok') ||
                                   errorMessage.includes('NoWSUpgradeError');
            
            if (isDeviceBlocked) {
                console.error(`[Live Connector] ⚠️ Device/IP blocked by TikTok for @${handle}. Cannot connect to live stream.`);
                
                // Mark session as connection failed
                try {
                    const session = await read(`live_sessions/${handle}/${sessionId}.json`);
                    session.status = 'connection_failed';
                    session.endTime = new Date().toISOString();
                    session.error = 'Device/IP blocked by TikTok. Cannot establish connection.';
                    await write(`live_sessions/${handle}/${sessionId}.json`, session);
                    
                    // Update monitored status
                    await updateNested('monitored.json', handle, {
                        currentLiveSessionId: null,
                        lastLiveTime: session.endTime
                    });
                    
                    // Clean up
                    activeConnections.delete(handle);
                    activeSessions.delete(handle);
                    
                    // Emit Socket.IO event to notify frontend
                    if (io) {
                        io.emit('liveSessionError', {
                            handle,
                            sessionId,
                            error: 'Device/IP blocked by TikTok. Cannot connect to live stream.',
                            canRetry: false
                        });
                    }
                    
                    console.log(`[Live Connector] Session marked as connection_failed for @${handle}`);
                } catch (cleanupError) {
                    console.error(`[Live Connector] Error cleaning up blocked session for @${handle}:`, cleanupError);
                }
            } else {
                // Other connection errors - log but don't crash
                console.error(`[Live Connector] Connection error for @${handle}:`, errorMessage);
            }
        });

        connectionWrapper.once('connected', async (state) => {
            console.log(`[Live Connector] Connected to live stream @${handle}, sessionId: ${sessionId}, roomId: ${state.roomId}`);
            activeConnections.set(handle, connectionWrapper);

            // Set up event handlers AFTER connection is established
            // This ensures events are captured properly
            console.log(`[Live Connector] Setting up event handlers for @${handle}...`);
            setupEventHandlers(connectionWrapper, handle, sessionId, io);
            console.log(`[Live Connector] Event handlers set up for @${handle}`);

            // Emit Socket.IO event
            if (io) {
                console.log(`[Live Connector] Emitting liveSessionStarted event for @${handle}`);
                io.emit('liveSessionStarted', {
                    handle,
                    sessionId,
                    roomId: state.roomId
                });
                console.log(`[Live Connector] Event emitted successfully`);
            } else {
                console.warn(`[Live Connector] Socket.IO (io) is not available - cannot emit events`);
            }
        });

        // Handle blocked event
        connectionWrapper.once('blocked', async (data) => {
            console.error(`[Live Connector] ⚠️ Device blocked event received for @${handle}`);
            // The connect().catch() handler will take care of cleanup
        });

        connectionWrapper.once('disconnected', async (reason) => {
            console.log(`Disconnected from live stream @${handle}: ${reason}`);
            
            // Check if it's a device blocked error
            const isDeviceBlocked = reason && (
                reason.includes('DEVICE_BLOCKED') ||
                reason.includes('Device blocked by TikTok') ||
                reason.includes('NoWSUpgradeError')
            );
            
            if (isDeviceBlocked) {
                // Handle blocking in the connect().catch() handler
                return;
            }
            
            if (reason && (reason.includes('LIVE has ended') || reason.includes('streamEnd'))) {
                await endSession(handle, sessionId, io);
            } else {
                // Connection lost but stream might still be live
                // Keep session active, connection wrapper will try to reconnect
            }
        });

        // Store connection
        activeConnections.set(handle, connectionWrapper);

    } catch (error) {
        console.error(`Error starting monitoring for @${handle}:`, error);
        
        // If it's a device blocked error, handle it gracefully
        const errorMessage = error?.message || error?.toString() || String(error);
        const isDeviceBlocked = errorMessage.includes('DEVICE_BLOCKED') || 
                               errorMessage.includes('handshake-status: 415') ||
                               errorMessage.includes('Device blocked by TikTok') ||
                               errorMessage.includes('NoWSUpgradeError');
        
        if (isDeviceBlocked) {
            console.error(`[Live Connector] ⚠️ Device/IP blocked by TikTok for @${handle}. Session creation failed.`);
            // Don't throw - return gracefully
            return;
        }
        
        // For other errors, still throw to allow caller to handle
        throw error;
    }
}

/**
 * Stop monitoring a live stream
 */
async function stopMonitoring(handle, io) {
    try {
        const connectionWrapper = activeConnections.get(handle);
        if (connectionWrapper) {
            connectionWrapper.disconnect();
            activeConnections.delete(handle);
        }

        const sessionId = activeSessions.get(handle);
        if (sessionId) {
            // Flush any pending events before stopping
            await flushEventsForSession(sessionId);
            
            // Process any pending stats updates before ending session
            const key = `${handle}:${sessionId}`;
            if (statsUpdateQueue.has(key)) {
                await processStatsUpdates();
            }
            
            await endSession(handle, sessionId, io);
            activeSessions.delete(handle);
            
            // Remove from stats queue and event buffer
            statsUpdateQueue.delete(key);
            eventBuffers.delete(sessionId);
        }
    } catch (error) {
        console.error(`Error stopping monitoring for @${handle}:`, error);
    }
}

/**
 * End a live session
 */
async function endSession(handle, sessionId, io) {
    try {
        // Flush any pending events before ending session
        await flushEventsForSession(sessionId);
        
        // Process any pending stats updates before ending session
        const key = `${handle}:${sessionId}`;
        if (statsUpdateQueue.has(key)) {
            await processStatsUpdates();
        }
        
        // Load session
        const session = await read(`live_sessions/${handle}/${sessionId}.json`);
        
        // Check if session exists
        if (!session) {
            console.warn(`[End Session] Session ${sessionId} for @${handle} not found in database. Cleaning up monitoring state only.`);
            
            // Clean up monitoring state even if session doesn't exist
            await updateNested('monitored.json', handle, {
                currentLiveSessionId: null,
                lastSessionEndTime: new Date().toISOString()
            });
            
            // Remove from active sessions
            activeSessions.delete(handle);
            
            // Emit Socket.IO event
            if (io) {
                io.emit('liveSessionEnded', {
                    handle,
                    sessionId
                });
            }
            
            console.log(`[End Session] Cleaned up monitoring state for @${handle} (session ${sessionId} not found in DB)`);
            return;
        }
        
        // Update session
        session.endTime = new Date().toISOString();
        session.status = 'ended';
        
        await write(`live_sessions/${handle}/${sessionId}.json`, session);
        
        // Remove from stats queue
        statsUpdateQueue.delete(key);
        
        // Stop stats history tracking
        stopStatsHistoryTracking(sessionId);
        
        // Take final snapshot
        await takeStatsSnapshot(handle, sessionId);

        // Update monitored status with lastLiveTime (endTime) and hard-clear currentLiveSessionId
        // Add lastSessionEndTime for cooldown period (60-120s) to avoid reconnecting to lingering TikTok rooms
        await updateNested('monitored.json', handle, {
            currentLiveSessionId: null, // Hard-clear - never leave stale session IDs
            lastLiveTime: session.endTime,
            lastSessionEndTime: new Date().toISOString() // Track when session ended for cooldown
        });

        // Emit Socket.IO event
        if (io) {
            io.emit('liveSessionEnded', {
                handle,
                sessionId
            });
        }

        console.log(`Session ended for @${handle}, sessionId: ${sessionId}`);
    } catch (error) {
        console.error(`Error ending session for @${handle}:`, error);
    }
}

/**
 * Set up event handlers for live stream events - ALL EVENTS from TikTok
 */
function setupEventHandlers(connectionWrapper, handle, sessionId, io) {
    const connection = connectionWrapper.connection;
    
    console.log(`[Live Connector] Setting up event handlers for @${handle}, sessionId: ${sessionId}`);

    // Chat messages
    connection.on('chat', async (msg) => {
        const event = await handleEvent(handle, sessionId, 'chat', msg, io);
        await updateStats(handle, sessionId, { totalMessages: 1 });
        
        // Check trigger words for chat messages
        if (msg.comment && event) {
            await triggerService.checkAndCreateAlert(msg.comment, handle, sessionId, event.id, io);
        }
    });

    // Gifts
    connection.on('gift', async (msg) => {
        await handleEvent(handle, sessionId, 'gift', msg, io);
        await updateStats(handle, sessionId, { totalGifts: 1 });
    });

    // Likes
    connection.on('like', async (msg) => {
        await handleEvent(handle, sessionId, 'like', msg, io);
        if (msg.totalLikeCount) {
            await updateStats(handle, sessionId, { totalLikes: msg.totalLikeCount });
        }
    });

    // Member joins/leaves
    connection.on('member', async (msg) => {
        await handleEvent(handle, sessionId, 'member', msg, io);
        const actionType = (msg.actionType || '').toLowerCase();
        if (actionType === 'leave' || actionType === 'left') {
            await updateStats(handle, sessionId, { totalLeaves: 1 });
            console.log(`[Live Connector] Leave event @${handle}: ${msg.user?.uniqueId || 'unknown'}`);
        } else {
            await updateStats(handle, sessionId, { totalJoins: 1 });
        }
    });

    // Social events (follows, shares, reposts)
    connection.on('social', async (msg) => {
        const event = await handleEvent(handle, sessionId, 'social', msg, io);
        // Track different social event types
        if (msg.displayType) {
            const displayType = msg.displayType.toLowerCase();
            if (displayType.includes('follow')) {
                await updateStats(handle, sessionId, { totalFollows: 1 });
                console.log(`[Live Connector] Follow event @${handle}: ${msg.user?.uniqueId || 'unknown'}`);
            } else if (displayType.includes('share') || displayType.includes('shared')) {
                await updateStats(handle, sessionId, { totalShares: 1 });
                console.log(`[Live Connector] Share event @${handle}: ${msg.user?.uniqueId || 'unknown'}`);
            } else if (displayType.includes('repost') || displayType.includes('reposted')) {
                await updateStats(handle, sessionId, { totalReposts: 1 });
                console.log(`[Live Connector] Repost event @${handle}: ${msg.user?.uniqueId || 'unknown'}`);
            }
        }
    });

    // Viewer count updates
    connection.on('roomUser', async (msg) => {
        await handleEvent(handle, sessionId, 'roomUser', msg, io);
        if (msg.viewerCount) {
            await updateStats(handle, sessionId, { totalViewers: msg.viewerCount });
        }
    });

    // Questions
    connection.on('questionNew', async (msg) => {
        await handleEvent(handle, sessionId, 'questionNew', msg, io);
    });

    // Link Mic Battle
    connection.on('linkMicBattle', async (msg) => {
        await handleEvent(handle, sessionId, 'linkMicBattle', msg, io);
    });

    // Link Mic Armies
    connection.on('linkMicArmies', async (msg) => {
        await handleEvent(handle, sessionId, 'linkMicArmies', msg, io);
    });

    // Live Intro
    connection.on('liveIntro', async (msg) => {
        await handleEvent(handle, sessionId, 'liveIntro', msg, io);
    });

    // Emotes
    connection.on('emote', async (msg) => {
        await handleEvent(handle, sessionId, 'emote', msg, io);
        await updateStats(handle, sessionId, { totalEmotes: 1 });
        console.log(`[Live Connector] Emote event @${handle}: ${msg.user?.uniqueId || 'unknown'}`);
    });

    // Envelopes (red packets)
    connection.on('envelope', async (msg) => {
        await handleEvent(handle, sessionId, 'envelope', msg, io);
    });

    // Subscribes
    connection.on('subscribe', async (msg) => {
        await handleEvent(handle, sessionId, 'subscribe', msg, io);
        await updateStats(handle, sessionId, { totalSubscribes: 1 });
        console.log(`[Live Connector] Subscribe event @${handle}: ${msg.user?.uniqueId || 'unknown'}`);
    });

    // Stream end
    connection.on('streamEnd', async () => {
        console.log(`[Live Connector] StreamEnd event received @${handle}`);
        await handleEvent(handle, sessionId, 'streamEnd', {}, io);
        await endSession(handle, sessionId, io);
        await stopMonitoring(handle, io);
    });
    
    // Add error handler for connection events
    connection.on('error', (err) => {
        console.error(`[Live Connector] Connection error event @${handle}:`, err);
    });
    
    console.log(`[Live Connector] All event handlers registered for @${handle}`);
}

/**
 * Handle an event from the live stream
 * Events are buffered and written in batches for better performance
 */
async function handleEvent(handle, sessionId, type, data, io) {
    try {
        const event = {
            id: uuidv4(),
            sessionId,
            type,
            timestamp: new Date().toISOString(),
            user: extractUserInfo(data),
            data: extractEventData(type, data),
            location: data.location || null
        };

        // Emit Socket.IO event immediately for real-time UI updates
        // This ensures UI sees events instantly while file writes are batched
        if (io) {
            io.emit('liveEvent', {
                handle,
                sessionId,
                event
            });
        } else {
            console.warn(`[Live Connector] Socket.IO (io) not available - cannot emit liveEvent for @${handle}`);
        }

        // Buffer event for batch writing (improves I/O performance)
        if (!eventBuffers.has(sessionId)) {
            eventBuffers.set(sessionId, []);
        }
        eventBuffers.get(sessionId).push(event);

        // Start flush interval if not already running
        if (!eventFlushInterval) {
            startEventFlush();
        }

        return event;
    } catch (error) {
        console.error(`Error handling event for @${handle}, type: ${type}:`, error);
    }
}

/**
 * Start event flush interval (batched writes)
 */
function startEventFlush() {
    if (eventFlushInterval) {
        return; // Already running
    }

    eventFlushInterval = setInterval(async () => {
        if (eventBuffers.size === 0) {
            // Stop interval if no buffers
            clearInterval(eventFlushInterval);
            eventFlushInterval = null;
            return;
        }

        // Get all buffers to flush
        const buffersToFlush = Array.from(eventBuffers.entries());
        eventBuffers.clear();

        // Flush all buffers in parallel
        await Promise.all(buffersToFlush.map(async ([sessionId, events]) => {
            if (events.length === 0) return;

            try {
                // Verify session exists before writing events (foreign key constraint)
                const { query } = require('../config/database');
                const sessionCheck = await query('SELECT id FROM live_sessions WHERE id = $1', [sessionId]);
                
                if (sessionCheck.rows.length === 0) {
                    console.warn(`[Live Connector] Session ${sessionId} does not exist in database. Discarding ${events.length} buffered events.`);
                    return; // Discard events if session doesn't exist
                }
                
                // Read current events once
                let data = [];
                try {
                    data = await read(`events/${sessionId}.json`);
                } catch (error) {
                    // If file doesn't exist or is corrupted, start with empty array
                    if (error.code === 'ENOENT' || error instanceof SyntaxError) {
                        data = [];
                    } else {
                        throw error;
                    }
                }

                if (!Array.isArray(data)) {
                    data = [];
                }

                // Add all buffered events at once
                data.push(...events);

                // Write once (batch write - much faster than individual appends)
                // dbStorage will verify session exists again before writing
                await write(`events/${sessionId}.json`, data);
            } catch (error) {
                // Check if it's a foreign key constraint error
                if (error.message && error.message.includes('foreign key constraint')) {
                    console.warn(`[Live Connector] Session ${sessionId} does not exist in database (foreign key constraint). Discarding ${events.length} buffered events.`);
                    return; // Don't retry if session doesn't exist
                }
                
                console.error(`[Live Connector] ❌ Error flushing events for session ${sessionId}:`, error.message);
                // Put events back in buffer for retry (limit to prevent memory issues)
                if (eventBuffers.size < 100) {
                    const existing = eventBuffers.get(sessionId) || [];
                    eventBuffers.set(sessionId, [...existing, ...events]);
                }
            }
        }));
    }, EVENT_FLUSH_INTERVAL_MS);
}

/**
 * Flush events for a specific session (called before ending session)
 */
async function flushEventsForSession(sessionId) {
    if (!eventBuffers.has(sessionId)) {
        return; // No buffered events
    }

    const events = eventBuffers.get(sessionId);
    eventBuffers.delete(sessionId);

    if (events.length === 0) {
        return;
    }

    try {
        // Verify session exists in database before writing events (foreign key constraint)
        // Directly query database to ensure session exists
        const { query } = require('../config/database');
        const sessionCheck = await query('SELECT id, handle FROM live_sessions WHERE id = $1', [sessionId]);
        
        if (sessionCheck.rows.length === 0) {
            console.warn(`[Flush Events] Session ${sessionId} does not exist in database. Cannot write events (foreign key constraint). Discarding ${events.length} buffered events.`);
            return; // Discard events if session doesn't exist
        }
        
        const handle = sessionCheck.rows[0].handle;
        
        // Read current events
        let data = [];
        try {
            data = await read(`events/${sessionId}.json`);
        } catch (error) {
            if (error.code === 'ENOENT' || error instanceof SyntaxError) {
                data = [];
            } else {
                throw error;
            }
        }

        if (!Array.isArray(data)) {
            data = [];
        }

        // Add all buffered events
        data.push(...events);

        // Write once (dbStorage will verify session exists again before writing)
        await write(`events/${sessionId}.json`, data);
    } catch (error) {
        // Check if it's a foreign key constraint error
        if (error.message && error.message.includes('foreign key constraint')) {
            console.warn(`[Flush Events] Session ${sessionId} does not exist in database (foreign key constraint). Discarding ${events.length} buffered events.`);
            return; // Don't retry if session doesn't exist
        }
        
        console.error(`[Live Connector] ❌ Error flushing events for session ${sessionId} before end:`, error.message);
        // If flush fails, try to put events back (but only if buffer is not too large)
        if (eventBuffers.size < 100) {
            eventBuffers.set(sessionId, events);
        }
    }
}

/**
 * Get event count for a session (for logging)
 */
async function getEventCount(sessionId) {
    try {
        const events = await read(`events/${sessionId}.json`);
        return Array.isArray(events) ? events.length : 0;
    } catch {
        return 0;
    }
}

/**
 * Extract user info from event data
 */
function extractUserInfo(data) {
    const user = data.user || data;
    return {
        userId: data.userId || user.userId || null,
        uniqueId: data.uniqueId || user.uniqueId || null,
        nickname: data.nickname || user.nickname || null,
        profilePictureUrl: data.profilePictureUrl || user.profilePictureUrl || user.avatarLarger || user.avatarMedium || user.avatarThumb || null
    };
}

/**
 * Extract type-specific event data - preserve ALL data from TikTok events
 * This function ensures we capture EVERY field from the event data, not just specific ones
 */
function extractEventData(type, data) {
    // For all event types, preserve ALL fields from the original data
    // This ensures we don't lose any information
    
    // Base object with common fields that might exist
    const baseData = {
        ...data,  // Spread all original data first
    };
    
    // For specific types, ensure we capture important fields explicitly
    switch (type) {
        case 'chat':
            return {
                ...baseData,  // Include all original fields
                comment: data.comment || '',
                language: data.language || null,
                msgType: data.msgType || null,
                // Explicitly include any other chat-specific fields
                commentUser: data.commentUser || null,
                createTime: data.createTime || null
            };
        case 'gift':
            return {
                ...baseData,
                giftId: data.giftId || null,
                giftName: data.giftName || null,
                diamondCount: data.diamondCount || 0,
                repeatCount: data.repeatCount || 1,
                repeatEnd: data.repeatEnd || false,
                describe: data.describe || '',
                giftPictureUrl: data.giftPictureUrl || '',
                timestamp: data.timestamp || null,
                groupCount: data.groupCount || 1,
                giftType: data.giftType || null
            };
        case 'like':
            return {
                ...baseData,
                likeCount: data.likeCount || 0,
                totalLikeCount: data.totalLikeCount || 0,
                label: data.label || null
            };
        case 'member':
            return {
                ...baseData,
                actionType: data.actionType || 'join',  // 'join' or 'leave'
                memberCount: data.memberCount || 0,
                action: data.action || null,
                userEnterTip: data.userEnterTip || null
            };
        case 'social':
            // Social events can be: follow, share, repost, etc.
            return {
                ...baseData,
                displayType: data.displayType || '',
                label: data.label || '',
                shareType: data.shareType || null,
                action: data.action || null,
                // Determine the specific social action
                socialAction: determineSocialAction(data),
                followStatus: data.followStatus || null,
                shareTarget: data.shareTarget || null
            };
        case 'roomUser':
            return {
                ...baseData,
                viewerCount: data.viewerCount || 0,
                viewerCountStr: data.viewerCountStr || null,
                topViewers: data.topViewers || [],
                viewerList: data.viewerList || []
            };
        case 'questionNew':
            return {
                ...baseData,
                question: data.question || '',
                questionId: data.questionId || null,
                questionText: data.questionText || null
            };
        case 'linkMicBattle':
            return {
                ...baseData,
                battleId: data.battleId || null,
                status: data.status || null,
                battleUsers: data.battleUsers || []
            };
        case 'linkMicArmies':
            return {
                ...baseData,
                armies: data.armies || [],
                armyUsers: data.armyUsers || []
            };
        case 'liveIntro':
            return {
                ...baseData,
                intro: data.intro || null,
                title: data.title || null,
                description: data.description || null
            };
        case 'emote':
            return {
                ...baseData,
                emoteId: data.emoteId || null,
                emoteImageId: data.emoteImageId || null,
                emoteUrl: data.emoteUrl || null
            };
        case 'envelope':
            return {
                ...baseData,
                envelopeId: data.envelopeId || null,
                envelopeIdCipher: data.envelopeIdCipher || null,
                treasureBoxUser: data.treasureBoxUser || null
            };
        case 'subscribe':
            return {
                ...baseData,
                subscribeType: data.subscribeType || null,
                subscribeCount: data.subscribeCount || 0,
                monthCount: data.monthCount || 0
            };
        case 'streamEnd':
            return {
                ...baseData,
                reason: data.reason || null
            };
        default:
            // For unknown event types, preserve ALL data
            console.log(`[Live Connector] Unknown event type: ${type}, preserving all data`);
            return baseData;
    }
}

/**
 * Determine the specific social action from event data
 */
function determineSocialAction(data) {
    const displayType = (data.displayType || '').toLowerCase();
    const label = (data.label || '').toLowerCase();
    
    if (displayType.includes('follow') || label.includes('follow')) {
        return 'follow';
    } else if (displayType.includes('share') || label.includes('share') || displayType.includes('shared')) {
        return 'share';
    } else if (displayType.includes('repost') || label.includes('repost') || displayType.includes('reposted')) {
        return 'repost';
    } else if (displayType.includes('unfollow') || label.includes('unfollow')) {
        return 'unfollow';
    }
    
    return 'unknown';
}

/**
 * Queue stats update (batched for performance)
 */
function queueStatsUpdate(handle, sessionId, updates) {
    const key = `${handle}:${sessionId}`;
    
    if (!statsUpdateQueue.has(key)) {
        statsUpdateQueue.set(key, {
            handle,
            sessionId,
            pendingUpdates: {
                totalLikes: null,
                totalViewers: null,
                totalGifts: 0,
                totalMessages: 0,
                totalJoins: 0,
                totalFollows: 0,
                totalShares: 0,
                totalReposts: 0,
                totalLeaves: 0,
                totalSubscribes: 0,
                totalEmotes: 0
            }
        });
    }
    
    const queueItem = statsUpdateQueue.get(key);
    
    // Accumulate updates
    if (updates.totalLikes !== undefined) {
        queueItem.pendingUpdates.totalLikes = updates.totalLikes;
    }
    if (updates.totalViewers !== undefined) {
        if (queueItem.pendingUpdates.totalViewers === null || updates.totalViewers > queueItem.pendingUpdates.totalViewers) {
            queueItem.pendingUpdates.totalViewers = updates.totalViewers;
        }
    }
    if (updates.totalGifts) {
        queueItem.pendingUpdates.totalGifts += updates.totalGifts;
    }
    if (updates.totalMessages) {
        queueItem.pendingUpdates.totalMessages += updates.totalMessages;
    }
    if (updates.totalJoins) {
        queueItem.pendingUpdates.totalJoins += updates.totalJoins;
    }
    if (updates.totalFollows) {
        queueItem.pendingUpdates.totalFollows += updates.totalFollows;
    }
    if (updates.totalShares) {
        queueItem.pendingUpdates.totalShares += updates.totalShares;
    }
    if (updates.totalReposts) {
        queueItem.pendingUpdates.totalReposts += updates.totalReposts;
    }
    if (updates.totalLeaves) {
        queueItem.pendingUpdates.totalLeaves += updates.totalLeaves;
    }
    if (updates.totalSubscribes) {
        queueItem.pendingUpdates.totalSubscribes += updates.totalSubscribes;
    }
    if (updates.totalEmotes) {
        queueItem.pendingUpdates.totalEmotes += updates.totalEmotes;
    }
    
    // Start batch processor if not running
    startStatsUpdateProcessor();
}

/**
 * Process queued stats updates (batched writes)
 */
async function processStatsUpdates() {
    if (statsUpdateQueue.size === 0) {
        // Stop interval if no updates
        if (statsUpdateInterval) {
            clearInterval(statsUpdateInterval);
            statsUpdateInterval = null;
        }
        return;
    }
    
    const updatesToProcess = Array.from(statsUpdateQueue.values());
    statsUpdateQueue.clear();
    
    // Process all updates
    await Promise.all(updatesToProcess.map(async (queueItem) => {
        try {
            await updateStatsInternal(
                queueItem.handle,
                queueItem.sessionId,
                queueItem.pendingUpdates
            );
        } catch (error) {
            console.error(`Error processing stats update for @${queueItem.handle}:`, error);
        }
    }));
}

/**
 * Start stats update processor
 */
function startStatsUpdateProcessor() {
    if (statsUpdateInterval) {
        return; // Already running
    }
    
    // Process immediately
    processStatsUpdates();
    
    // Then process every 5 seconds
    statsUpdateInterval = setInterval(processStatsUpdates, STATS_UPDATE_INTERVAL_MS);
}

/**
 * Update session statistics (internal, called from batch processor)
 */
async function updateStatsInternal(handle, sessionId, updates) {
    try {
        const session = await read(`live_sessions/${handle}/${sessionId}.json`);
        
        // Check if session exists
        if (!session) {
            console.warn(`[Update Stats] Session ${sessionId} for @${handle} not found in database. Skipping stats update.`);
            return;
        }
        
        // Ensure stats object exists
        if (!session.stats) {
            console.warn(`[Update Stats] Session ${sessionId} for @${handle} has no stats object. Initializing...`);
            session.stats = {
                totalLikes: 0,
                totalViewers: 0,
                totalGifts: 0,
                totalMessages: 0,
                totalJoins: 0,
                totalFollows: 0,
                totalShares: 0,
                totalReposts: 0,
                totalLeaves: 0,
                totalSubscribes: 0,
                totalEmotes: 0
            };
        }
        
        if (updates.totalLikes !== null && updates.totalLikes !== undefined) {
            session.stats.totalLikes = updates.totalLikes;
        }
        if (updates.totalViewers !== null && updates.totalViewers !== undefined) {
            session.stats.totalViewers = Math.max(session.stats.totalViewers, updates.totalViewers);
        }
        if (updates.totalGifts > 0) {
            session.stats.totalGifts += updates.totalGifts;
        }
        if (updates.totalMessages > 0) {
            session.stats.totalMessages += updates.totalMessages;
        }
        if (updates.totalJoins > 0) {
            session.stats.totalJoins += updates.totalJoins;
        }
        if (updates.totalFollows > 0) {
            session.stats.totalFollows += updates.totalFollows;
        }
        if (updates.totalShares > 0) {
            session.stats.totalShares += updates.totalShares;
        }
        if (updates.totalReposts > 0) {
            session.stats.totalReposts += updates.totalReposts;
        }
        if (updates.totalLeaves > 0) {
            session.stats.totalLeaves += updates.totalLeaves;
        }
        if (updates.totalSubscribes > 0) {
            session.stats.totalSubscribes += updates.totalSubscribes;
        }
        if (updates.totalEmotes > 0) {
            session.stats.totalEmotes += updates.totalEmotes;
        }
        
        await write(`live_sessions/${handle}/${sessionId}.json`, session);
    } catch (error) {
        console.error(`Error updating stats for @${handle}:`, error);
        throw error;
    }
}

/**
 * Update session statistics (public API - queues update)
 */
async function updateStats(handle, sessionId, updates) {
    queueStatsUpdate(handle, sessionId, updates);
}

/**
 * Ensure session directory exists
 */
async function ensureSessionDir(handle) {
    // No longer needed for PostgreSQL - directories are not used
    // This function is kept for backward compatibility but does nothing
}

/**
 * Update lastLiveTime for all active live sessions
 */
async function updateLastLiveTimeForActiveSessions() {
    try {
        const now = new Date().toISOString();
        
        // Update lastLiveTime for all active sessions
        for (const [handle, sessionId] of activeSessions.entries()) {
            try {
                await updateNested('monitored.json', handle, {
                    lastLiveTime: now
                });
            } catch (error) {
                console.error(`Error updating lastLiveTime for @${handle}:`, error);
            }
        }
        
        // If no active sessions, stop the interval
        if (activeSessions.size === 0 && lastLiveTimeUpdateInterval) {
            clearInterval(lastLiveTimeUpdateInterval);
            lastLiveTimeUpdateInterval = null;
            console.log('[Live Connector] Stopped lastLiveTime update interval (no active sessions)');
        }
    } catch (error) {
        console.error('Error updating lastLiveTime for active sessions:', error);
    }
}

/**
 * Start the interval for updating lastLiveTime for active sessions
 */
function startLastLiveTimeUpdates() {
    if (lastLiveTimeUpdateInterval) {
        return; // Already running
    }
    
    console.log('[Live Connector] Starting lastLiveTime update interval');
    
    // Update immediately
    updateLastLiveTimeForActiveSessions();
    
    // Then update every 30 seconds
    lastLiveTimeUpdateInterval = setInterval(updateLastLiveTimeForActiveSessions, LAST_LIVE_TIME_UPDATE_INTERVAL_MS);
}

/**
 * Take a snapshot of current stats for history
 */
async function takeStatsSnapshot(handle, sessionId) {
    try {
        const session = await read(`live_sessions/${handle}/${sessionId}.json`);
        
        // Check if session exists
        if (!session) {
            console.warn(`[Take Stats Snapshot] Session ${sessionId} for @${handle} not found in database. Skipping snapshot.`);
            return;
        }
        
        // Ensure stats object exists
        if (!session.stats) {
            console.warn(`[Take Stats Snapshot] Session ${sessionId} for @${handle} has no stats object. Using empty stats.`);
            session.stats = {
                totalLikes: 0,
                totalViewers: 0,
                totalGifts: 0,
                totalMessages: 0,
                totalJoins: 0,
                totalFollows: 0,
                totalShares: 0,
                totalReposts: 0,
                totalLeaves: 0,
                totalSubscribes: 0,
                totalEmotes: 0
            };
        }
        
        const snapshot = {
            timestamp: new Date().toISOString(),
            stats: {
                totalLikes: session.stats.totalLikes || 0,
                totalViewers: session.stats.totalViewers || 0,
                totalGifts: session.stats.totalGifts || 0,
                totalMessages: session.stats.totalMessages || 0,
                totalJoins: session.stats.totalJoins || 0,
                totalFollows: session.stats.totalFollows || 0,
                totalShares: session.stats.totalShares || 0,
                totalReposts: session.stats.totalReposts || 0,
                totalLeaves: session.stats.totalLeaves || 0,
                totalSubscribes: session.stats.totalSubscribes || 0,
                totalEmotes: session.stats.totalEmotes || 0
            }
        };
        
        // Append to history file
        const history = await read(`stats_history/${sessionId}.json`);
        if (!Array.isArray(history)) {
            await write(`stats_history/${sessionId}.json`, [snapshot]);
        } else {
            history.push(snapshot);
            await write(`stats_history/${sessionId}.json`, history);
        }
    } catch (error) {
        console.error(`Error taking stats snapshot for @${handle}:`, error);
    }
}

/**
 * Start stats history tracking for a session
 */
function startStatsHistoryTracking(handle, sessionId) {
    // Take initial snapshot
    takeStatsSnapshot(handle, sessionId);
    
    // Set up interval to take snapshots every 15 seconds
    const intervalId = setInterval(async () => {
        // Check if session is still active
        if (activeSessions.get(handle) === sessionId) {
            await takeStatsSnapshot(handle, sessionId);
        } else {
            // Session ended, clear interval
            clearInterval(intervalId);
            statsHistoryTracking.delete(sessionId);
        }
    }, STATS_HISTORY_SNAPSHOT_INTERVAL_MS);
    
    statsHistoryTracking.set(sessionId, intervalId);
}

/**
 * Stop stats history tracking for a session
 */
function stopStatsHistoryTracking(sessionId) {
    const intervalId = statsHistoryTracking.get(sessionId);
    if (intervalId) {
        clearInterval(intervalId);
        statsHistoryTracking.delete(sessionId);
    }
}

/**
 * Ensure stats history directory exists
 */
async function ensureStatsHistoryDir(sessionId) {
    // No longer needed for PostgreSQL - directories are not used
    // This function is kept for backward compatibility but does nothing
}

/**
 * Get active session ID for a handle
 */
function getActiveSessionId(handle) {
    return activeSessions.get(handle) || null;
}

/**
 * Check if monitoring a handle and connection is actually active
 */
function isMonitoring(handle) {
    const connectionWrapper = activeConnections.get(handle);
    if (!connectionWrapper) {
        return false;
    }
    
    // Verify connection is actually still connected
    try {
        const connectionState = connectionWrapper.connection.getState();
        if (!connectionState || !connectionState.isConnected) {
            // Connection exists in map but is not actually connected
            // Clean up stale entry
            console.warn(`[Live Connector] Connection for @${handle} exists in map but is not connected, cleaning up...`);
            activeConnections.delete(handle);
            return false;
        }
        return true;
    } catch (error) {
        // If we can't get state, assume connection is dead
        console.warn(`[Live Connector] Error checking connection state for @${handle}:`, error.message);
        activeConnections.delete(handle);
        return false;
    }
}

/**
 * Start periodic health checks for active connections
 * This detects and cleans up dead connections
 */
function startHealthChecks() {
    if (healthCheckInterval) {
        return; // Already running
    }
    
    healthCheckInterval = setInterval(() => {
        for (const [handle, connectionWrapper] of activeConnections.entries()) {
            try {
                const state = connectionWrapper.connection.getState();
                if (!state || !state.isConnected) {
                    console.warn(`[Health Check] Connection for @${handle} is dead, cleaning up...`);
                    activeConnections.delete(handle);
                    // Note: We don't end the session here, as the connection wrapper should handle reconnection
                    // If reconnection fails after max attempts, the disconnected event will end the session
                }
            } catch (error) {
                console.warn(`[Health Check] Error checking connection for @${handle}:`, error.message);
                activeConnections.delete(handle);
            }
        }
    }, HEALTH_CHECK_INTERVAL_MS);
}

/**
 * Verify and clean up orphaned sessions at startup
 * This checks all "live" sessions and marks them as ended if they're not actually active
 */
async function verifyAndCleanupSessions(io) {
    try {
        console.log('[Session Cleanup] Starting session verification and cleanup...');
        
        // Get monitored status
        let monitored = {};
        try {
            monitored = await read('monitored.json');
        } catch (error) {
            console.warn('[Session Cleanup] Could not read monitored.json:', error);
        }
        
        // Flush all buffered events before cleanup
        const { query } = require('../config/database');
        const buffersToFlush = Array.from(eventBuffers.entries());
        eventBuffers.clear();
        if (buffersToFlush.length > 0) {
            console.log(`[Session Cleanup] Flushing ${buffersToFlush.length} event buffers...`);
            await Promise.all(buffersToFlush.map(async ([sessionId, events]) => {
                if (events.length === 0) return;
                try {
                    // Append events to database
                    for (const event of events) {
                        try {
                            await append(`events/${sessionId}.json`, event);
                        } catch (error) {
                            console.error(`[Session Cleanup] Error appending event for session ${sessionId}:`, error.message);
                        }
                    }
                } catch (error) {
                    console.error(`[Session Cleanup] Error flushing events for session ${sessionId}:`, error.message);
                }
            }));
        }
        
        // Clear all active sessions and connections (start fresh)
        activeSessions.clear();
        for (const [handle, connection] of activeConnections.entries()) {
            try {
                connection.disconnect();
            } catch (error) {
                console.error(`[Session Cleanup] Error disconnecting @${handle}:`, error);
            }
        }
        activeConnections.clear();
        console.log('[Session Cleanup] Cleared all active sessions and connections');
        
        // First, check monitored.json and clear currentLiveSessionId for all handles
        // This ensures we start fresh regardless of session file state
        // Also set lastSessionEndTime for cooldown period to avoid reconnecting to lingering rooms
        const now = new Date().toISOString();
        for (const handle in monitored) {
            const monitorStatus = monitored[handle] || {};
            if (monitorStatus.currentLiveSessionId) {
                console.log(`[Session Cleanup] Clearing currentLiveSessionId for @${handle} (from monitored.json) and setting session end cooldown`);
                await updateNested('monitored.json', handle, {
                    currentLiveSessionId: null, // Hard-clear - never leave stale session IDs
                    lastSessionEndTime: now, // Set cooldown timestamp to avoid reconnecting to lingering rooms
                    enabled: monitorStatus.enabled,
                    lastCheckedAt: monitorStatus.lastCheckedAt,
                    lastLiveTime: monitorStatus.lastLiveTime || now
                });
            }
        }
        
        // Reload monitored.json after clearing (to have fresh data for session file checks)
        try {
            monitored = await read('monitored.json');
        } catch (error) {
            console.warn('[Session Cleanup] Could not re-read monitored.json after clearing:', error);
        }
        
        // Check all session files and mark old "live" sessions as "ended"
        let fixedCount = 0;
        let totalSessions = 0;
        
        try {
            const { query } = require('../config/database');
            
            // Get all live sessions from database
            const sessionsResult = await query(
                'SELECT * FROM live_sessions WHERE status = $1',
                ['live']
            );
            
            totalSessions = sessionsResult.rows.length;
            
            for (const row of sessionsResult.rows) {
                const sessionId = row.id;
                const handle = row.handle;
                
                try {
                    // All "live" sessions from previous run should be marked as ended
                    // The application was restarted, so these sessions are no longer active
                    // The poller will check if the account is still live and start a new session if needed
                    console.log(`[Session Cleanup] Found old live session: @${handle} / ${sessionId} (from previous run, marking as ended)`);
                    
                    // Process pending stats updates if any
                    const key = `${handle}:${sessionId}`;
                    if (statsUpdateQueue.has(key)) {
                        await processStatsUpdates();
                        statsUpdateQueue.delete(key);
                    }
                    
                    // Stop stats history tracking
                    stopStatsHistoryTracking(sessionId);
                    
                    // Take final snapshot before ending
                    await takeStatsSnapshot(handle, sessionId);
                    
                    // Mark session as ended in database
                    const endTime = new Date();
                    await query(
                        'UPDATE live_sessions SET status = $1, end_time = COALESCE(end_time, $2) WHERE id = $3',
                        ['ended', endTime, sessionId]
                    );
                    
                    // Note: currentLiveSessionId was already cleared in monitored.json above
                    // Also ensure lastSessionEndTime is set for cooldown (may have been set above, but ensure it)
                    const currentMonitored = await read('monitored.json').catch(() => ({}));
                    const currentStatus = currentMonitored[handle] || {};
                    if (!currentStatus.lastSessionEndTime) {
                        await updateNested('monitored.json', handle, {
                            lastSessionEndTime: endTime.toISOString(),
                            lastLiveTime: currentStatus.lastLiveTime || endTime.toISOString()
                        });
                    }
                    
                    fixedCount++;
                    console.log(`[Session Cleanup] Ended old session @${handle} / ${sessionId}`);
                } catch (error) {
                    console.error(`[Session Cleanup] Error processing session ${sessionId} for @${handle}:`, error);
                }
            }
            
            console.log(`[Session Cleanup] Verification complete: ${fixedCount} orphaned sessions fixed out of ${totalSessions} total sessions`);
        } catch (error) {
            console.error('[Session Cleanup] Error during verification:', error);
        }
        
        // Clean up any remaining stats update intervals
        if (statsUpdateInterval) {
            clearInterval(statsUpdateInterval);
            statsUpdateInterval = null;
        }
        
        // Clean up any stats history tracking intervals
        for (const [sessionId, intervalId] of statsHistoryTracking.entries()) {
            clearInterval(intervalId);
        }
        statsHistoryTracking.clear();
        
        console.log('[Session Cleanup] Session cleanup completed');
    } catch (error) {
        console.error('[Session Cleanup] Error during session cleanup:', error);
    }
}

module.exports = {
    startMonitoring,
    stopMonitoring,
    endSession,
    getActiveSessionId,
    isMonitoring,
    verifyAndCleanupSessions
};
