const { WebcastPushConnection } = require('tiktok-live-connector');
const { read, updateNested } = require('../storage/dbStorage');
const { query } = require('../config/database');
const liveConnectorService = require('./liveConnectorService');
const blockTrackerService = require('./blockTrackerService');
const settingsService = require('./settingsService');

// Get io instance when available
let ioInstance = null;

function setIo(io) {
    ioInstance = io;
}

// Track polling intervals per account
const accountPollIntervals = new Map();

// Track recovery test intervals
const recoveryTestIntervals = new Map();

// Track quick retry attempts per handle
const quickRetryAttempts = new Map();

// Session end cooldown period (60-120s recommended to avoid reconnecting to lingering TikTok rooms)
const SESSION_END_COOLDOWN_MS = 90000; // 90 seconds default

/**
 * Check if an account is currently live using two-phase verification:
 * 1. Connect phase: attempt WebSocket connection to get roomId
 * 2. Verification phase: listen for live-only events (chat, gift, viewerCount, etc.)
 * 
 * TikTok allows connecting to inactive/scheduled/ghost rooms, so connection alone
 * doesn't guarantee LIVE status. We need to see actual live events.
 */
async function getSessionOptionsForHandle(handle) {
    try {
        const accounts = await read('tiktok_accounts.json');
        const account = Array.isArray(accounts) ? accounts.find(a => a.handle === handle) : null;
        if (!account?.useSession) return null;
        const sessionResult = await query(
            'SELECT session_id, tt_target_idc, valid_until FROM tiktok_session WHERE id = 1'
        );
        const row = sessionResult.rows[0];
        if (!row?.session_id || !row.valid_until || new Date(row.valid_until) <= new Date()) return null;
        return { sessionId: row.session_id, ttTargetIdc: row.tt_target_idc };
    } catch (err) {
        console.warn(`[checkIfLive] Error fetching session for @${handle}:`, err.message);
        return null;
    }
}

async function checkIfLive(handle, previousRoomId = null, sessionOptions = null) {
    if (sessionOptions === null || sessionOptions === undefined) {
        sessionOptions = await getSessionOptionsForHandle(handle);
    }
    const startTime = Date.now();
    const PROBE_TIMEOUT_MS = 5000; // 5 seconds to detect live events
    const MIN_PROBE_TIME_MS = 2000; // Minimum 2 seconds even if events arrive
    
    console.log(`[DEBUG checkIfLive] Starting two-phase check for @${handle} at ${new Date().toISOString()}`);
    if (previousRoomId) {
        console.log(`[DEBUG checkIfLive] @${handle} - Previous roomId: ${previousRoomId} (checking for reuse)`);
    }
    
    let connection = null;
    let connectedState = null;
    let liveEventsDetected = false;
    let liveEvents = [];
    let viewerCount = 0;
    let probeStartTime = null;
    
    const cleanup = () => {
        if (connection) {
            try {
                connection.removeAllListeners();
                connection.disconnect();
                console.log(`[DEBUG checkIfLive] @${handle} - Connection cleaned up`);
            } catch (err) {
                console.error(`[DEBUG checkIfLive] @${handle} - Error during cleanup:`, err);
            }
        }
    };
    
    try {
        // ========== PHASE 1: CONNECT ==========
        const connectOptions = sessionOptions?.sessionId ? { sessionId: sessionOptions.sessionId } : {};
        console.log(`[DEBUG checkIfLive] @${handle} - [PHASE 1] Creating connection object...${connectOptions.sessionId ? ' (with session)' : ''}`);
        connection = new WebcastPushConnection(handle, connectOptions);
        
        console.log(`[DEBUG checkIfLive] @${handle} - [PHASE 1] Attempting WebSocket connection...`);
        connectedState = await connection.connect();
        const connectTime = Date.now() - startTime;
        
        console.log(`[DEBUG checkIfLive] @${handle} - [PHASE 1] ✓ Connection successful! roomId: ${connectedState.roomId}, connectTime: ${connectTime}ms`);
        
        // Check for roomId reuse
        if (previousRoomId && connectedState.roomId === previousRoomId) {
            console.log(`[DEBUG checkIfLive] @${handle} - ⚠️ RoomId REUSE detected (${connectedState.roomId}). This might be a lingering/ghost room.`);
        }
        
        // ========== PHASE 2: PROBE FOR LIVE EVENTS ==========
        console.log(`[DEBUG checkIfLive] @${handle} - [PHASE 2] Starting live event probe (timeout: ${PROBE_TIMEOUT_MS}ms, min: ${MIN_PROBE_TIME_MS}ms)...`);
        probeStartTime = Date.now();
        
        // Track live signals
        const liveSignals = {
            chat: false,
            gift: false,
            like: false,
            viewerCount: false,
            member: false,
            social: false,
            roomUser: false,
            liveIntro: false
        };
        
        // Set up event listeners for live-only signals
        const eventHandlers = {
            chat: (msg) => {
                liveSignals.chat = true;
                liveEvents.push({ type: 'chat', timestamp: Date.now(), user: msg.user?.uniqueId || 'unknown' });
                console.log(`[DEBUG checkIfLive] @${handle} - [PHASE 2] ✓ LIVE SIGNAL: Chat message from ${msg.user?.uniqueId || 'unknown'}`);
            },
            gift: (msg) => {
                liveSignals.gift = true;
                liveEvents.push({ type: 'gift', timestamp: Date.now(), giftName: msg.giftName || 'unknown' });
                console.log(`[DEBUG checkIfLive] @${handle} - [PHASE 2] ✓ LIVE SIGNAL: Gift (${msg.giftName || 'unknown'})`);
            },
            like: (msg) => {
                liveSignals.like = true;
                liveEvents.push({ type: 'like', timestamp: Date.now(), totalLikes: msg.totalLikeCount || 0 });
                console.log(`[DEBUG checkIfLive] @${handle} - [PHASE 2] ✓ LIVE SIGNAL: Like (total: ${msg.totalLikeCount || 0})`);
            },
            roomUser: (msg) => {
                liveSignals.roomUser = true;
                // Track viewerCount but don't use it as primary LIVE signal (can appear in ghost rooms)
                if (msg.viewerCount !== undefined) {
                    // Only track if viewerCount is increasing (multiple events)
                    const previousViewerCount = viewerCount;
                    viewerCount = msg.viewerCount;
                    liveEvents.push({ type: 'roomUser', timestamp: Date.now(), viewerCount: msg.viewerCount, previousViewerCount });
                    console.log(`[DEBUG checkIfLive] @${handle} - [PHASE 2] ⚠️ roomUser event (viewerCount: ${msg.viewerCount}, previous: ${previousViewerCount || 'none'}) - NOT counting as LIVE signal (can be ghost room)`);
                } else {
                    liveEvents.push({ type: 'roomUser', timestamp: Date.now(), viewerCount: 0 });
                    console.log(`[DEBUG checkIfLive] @${handle} - [PHASE 2] ⚠️ roomUser event but viewerCount is missing`);
                }
            },
            member: (msg) => {
                liveSignals.member = true;
                liveEvents.push({ type: 'member', timestamp: Date.now(), action: msg.actionType || 'unknown' });
                console.log(`[DEBUG checkIfLive] @${handle} - [PHASE 2] ✓ LIVE SIGNAL: Member event (${msg.actionType || 'unknown'})`);
            },
            social: (msg) => {
                liveSignals.social = true;
                liveEvents.push({ type: 'social', timestamp: Date.now(), displayType: msg.displayType || 'unknown' });
                console.log(`[DEBUG checkIfLive] @${handle} - [PHASE 2] ✓ LIVE SIGNAL: Social event (${msg.displayType || 'unknown'})`);
            },
            liveIntro: (msg) => {
                liveSignals.liveIntro = true;
                liveEvents.push({ type: 'liveIntro', timestamp: Date.now() });
                console.log(`[DEBUG checkIfLive] @${handle} - [PHASE 2] ✓ LIVE SIGNAL: LiveIntro event (explicit LIVE_START signal)`);
            },
            streamEnd: () => {
                console.log(`[DEBUG checkIfLive] @${handle} - [PHASE 2] ✗ StreamEnd received - definitely not live!`);
                liveEvents.push({ type: 'streamEnd', timestamp: Date.now() });
                cleanup();
                return {
                    isLive: false,
                    roomId: connectedState.roomId,
                    reason: 'streamEnd_event_received',
                    totalTime: Date.now() - startTime
                };
            },
            error: (err) => {
                console.log(`[DEBUG checkIfLive] @${handle} - [PHASE 2] ⚠️ Connection error during probe:`, err.message || err);
                liveEvents.push({ type: 'error', timestamp: Date.now(), error: err.message || String(err) });
            }
        };
        
        // Register all event handlers
        Object.entries(eventHandlers).forEach(([event, handler]) => {
            connection.on(event, handler);
        });
        
        // Wait for live events or timeout
        await new Promise((resolve) => {
            const checkInterval = setInterval(() => {
                const elapsed = Date.now() - probeStartTime;
                const hasLiveSignal = Object.values(liveSignals).some(val => val === true);
                
                // If we got a live signal and minimum probe time passed, we can resolve
                if (hasLiveSignal && elapsed >= MIN_PROBE_TIME_MS) {
                    console.log(`[DEBUG checkIfLive] @${handle} - [PHASE 2] ✓ Live signal detected after ${elapsed}ms. Signals:`, liveSignals);
                    clearInterval(checkInterval);
                    resolve();
                    return;
                }
                
                // If timeout reached, resolve anyway
                if (elapsed >= PROBE_TIMEOUT_MS) {
                    console.log(`[DEBUG checkIfLive] @${handle} - [PHASE 2] ⏱️ Probe timeout reached (${elapsed}ms). Signals detected:`, liveSignals);
                    clearInterval(checkInterval);
                    resolve();
                    return;
                }
            }, 100); // Check every 100ms
        });
        
        const probeTime = Date.now() - probeStartTime;
        const totalTime = Date.now() - startTime;
        
        // Determine if live based on STRONG signals received (exclude roomUser/viewerCount as they can be false positives)
        // Only count: chat, gift, like, member, social, liveIntro as valid LIVE signals
        const strongLiveSignals = {
            chat: liveSignals.chat,
            gift: liveSignals.gift,
            like: liveSignals.like,
            member: liveSignals.member,
            social: liveSignals.social,
            liveIntro: liveSignals.liveIntro
        };
        const hasStrongLiveSignal = Object.values(strongLiveSignals).some(val => val === true);
        
        // Check if viewerCount is increasing (multiple roomUser events with increasing count)
        const roomUserEvents = liveEvents.filter(e => e.type === 'roomUser' && e.viewerCount !== undefined);
        const viewerCountIncreasing = roomUserEvents.length >= 2 && 
            roomUserEvents.every((e, i) => i === 0 || e.viewerCount >= roomUserEvents[i - 1].viewerCount);
        
        console.log(`[DEBUG checkIfLive] @${handle} - [PHASE 2] Probe complete:`, {
            probeTime: `${probeTime}ms`,
            totalTime: `${totalTime}ms`,
            hasStrongLiveSignal,
            strongSignals: strongLiveSignals,
            allSignals: liveSignals,
            viewerCount,
            viewerCountIncreasing,
            roomUserEventsCount: roomUserEvents.length,
            eventsReceived: liveEvents.length,
            eventTypes: liveEvents.map(e => e.type),
            previousRoomId,
            roomIdReuse: previousRoomId === connectedState.roomId
        });
        
        // Clean up connection
        cleanup();
        
        // ========== DECISION LOGIC ==========
        // Special case: RoomId reuse - require stronger signals
        if (previousRoomId && connectedState.roomId === previousRoomId) {
            console.log(`[DEBUG checkIfLive] @${handle} - ⚠️ RoomId REUSE detected. Requiring STRONG live signals...`);
            
            if (!hasStrongLiveSignal) {
                console.log(`[DEBUG checkIfLive] @${handle} - ✗ RoomId reuse + no STRONG signals (only viewerCount/roomUser) = CONFIRMED OFFLINE (ghost room)`);
                return {
                    isLive: false,
                    roomId: connectedState.roomId,
                    reason: 'roomId_reuse_no_strong_signals',
                    previousRoomId,
                    signalsReceived: liveSignals,
                    totalTime
                };
            }
            
            // RoomId reuse but strong signals detected - might be genuinely live
            console.log(`[DEBUG checkIfLive] @${handle} - ✓ RoomId reuse BUT strong signals detected, treating as LIVE`);
        }
        
        if (!hasStrongLiveSignal) {
            // No strong live signals - treat as OFFLINE
            // viewerCount alone is NOT sufficient (ghost rooms can have viewerCount > 0)
            console.log(`[DEBUG checkIfLive] @${handle} - ✗ NO STRONG LIVE SIGNALS detected (only roomUser/viewerCount). Room may be inactive/scheduled/ghost.`);
            console.log(`[DEBUG checkIfLive] @${handle} - ⚠️ viewerCount = ${viewerCount} but NO chat/gift/like/member/social events = GHOST ROOM`);
            
            return {
                isLive: false,
                roomId: connectedState.roomId,
                reason: 'no_strong_live_events_only_viewercount',
                signals: liveSignals,
                viewerCount,
                probeTime,
                totalTime
            };
        }
        
        // Strong live signals detected - CONFIRMED LIVE
        console.log(`[DEBUG checkIfLive] @${handle} - ✓ CONFIRMED LIVE! Strong signals:`, Object.entries(strongLiveSignals).filter(([_, val]) => val).map(([key]) => key));
        
        return {
            isLive: true,
            roomId: connectedState.roomId,
            signals: {
                ...liveSignals,
                strongSignals: strongLiveSignals
            },
            viewerCount,
            eventsReceived: liveEvents.length,
            probeTime,
            totalTime
        };
        
    } catch (error) {
        const errorTime = Date.now() - startTime;
        const errorMessage = error?.message || error?.toString() || String(error);
        const errorName = error?.name || 'UnknownError';
        
        console.log(`[DEBUG checkIfLive] @${handle} - ✗ Connection/Probe failed after ${errorTime}ms`);
        console.log(`[DEBUG checkIfLive] @${handle} - Error: ${errorName}: ${errorMessage}`);
        
        // Clean up on error
        cleanup();
        
        // Check if it's a device blocked error
        const isDeviceBlocked = errorMessage.includes('DEVICE_BLOCKED') || 
                               errorMessage.includes('handshake-status: 415') ||
                               errorMessage.includes('Device blocked by TikTok') ||
                               errorMessage.includes('NoWSUpgradeError');
        
        if (isDeviceBlocked) {
            console.warn(`[DEBUG checkIfLive] @${handle} - ⚠️ Device/IP BLOCKED detected. Cannot determine live status.`);
            return {
                isLive: false,
                roomId: null,
                blocked: true,
                error: 'Device/IP blocked by TikTok',
                errorDetails: { name: errorName, message: errorMessage },
                totalTime: errorTime
            };
        }
        
        // Other connection errors - likely means they're not live
        return {
            isLive: false,
            roomId: null,
            error: errorMessage,
            errorName: errorName,
            totalTime: errorTime
        };
    }
}

/**
 * Check a single account and update status
 */
async function checkAccount(handle) {
    const checkStartTime = Date.now();
    console.log(`[DEBUG checkAccount] ========== Starting check for @${handle} at ${new Date().toISOString()} ==========`);
    
    try {
        // Initialize block tracker
        await blockTrackerService.initialize();
        
        // Check if auto-cooldown is enabled and account is in cooldown period
        const autoCooldownEnabled = await settingsService.isAutoCooldownEnabled();
        if (autoCooldownEnabled && blockTrackerService.isInCooldown(handle)) {
            const remaining = blockTrackerService.getRemainingCooldown(handle);
            const blockDetails = blockTrackerService.getBlockDetails(handle);
            console.log(`[DEBUG checkAccount] @${handle} - In cooldown, skipping check. Remaining: ${remaining} minutes (Block #${blockDetails?.blockCount || 1}, ${blockDetails?.cooldownHours || 1}h cooldown)`);
            
            // Schedule next check after cooldown expires (or max 24h)
            const cooldownMs = remaining * 60 * 1000;
            const maxWaitMs = 24 * 60 * 60 * 1000; // Max 24h
            const waitMs = Math.min(cooldownMs + 60000, maxWaitMs); // Add 1 min buffer after cooldown
            
            scheduleNextCheck(handle, waitMs);
            
            // Schedule recovery test if not already scheduled
            if (!recoveryTestIntervals.has(handle)) {
                scheduleRecoveryTest(handle);
            }
            
            console.log(`[DEBUG checkAccount] @${handle} - Exiting early due to cooldown (total time: ${Date.now() - checkStartTime}ms)`);
            return;
        }
        
        const monitored = await read('monitored.json');
        const monitorStatus = monitored[handle] || { enabled: false, lastCheckedAt: null, currentLiveSessionId: null };
        console.log(`[DEBUG checkAccount] @${handle} - Loaded monitor status:`, JSON.stringify(monitorStatus));
        
        // Check if monitoring is actually active (even if enabled is false in database)
        const isActuallyMonitoring = liveConnectorService.isMonitoring(handle);
        const activeSessionId = liveConnectorService.getActiveSessionId(handle);
        console.log(`[DEBUG checkAccount] @${handle} - Monitoring state check:`, {
            isActuallyMonitoring,
            activeSessionId,
            enabled: monitorStatus.enabled,
            currentLiveSessionId: monitorStatus.currentLiveSessionId
        });
        
        // If monitoring is actually active but enabled is false in database, sync it
        // Use a double-check pattern to prevent duplicate syncs from concurrent checkAccount calls
        if (isActuallyMonitoring && activeSessionId && !monitorStatus.enabled) {
            // Re-read monitored to check if it was already synced by another concurrent call
            const currentMonitored = await read('monitored.json');
            const currentStatus = currentMonitored[handle] || {};
            
            // Only sync if still needed (prevent race condition with concurrent calls)
            // Double-check: verify again that enabled is still false after read
            if (!currentStatus.enabled || currentStatus.currentLiveSessionId !== activeSessionId) {
                // Triple-check: re-read once more right before update to be extra safe
                const finalCheck = await read('monitored.json');
                const finalStatus = finalCheck[handle] || {};
                
                // Only log and sync if absolutely necessary
                if (!finalStatus.enabled || finalStatus.currentLiveSessionId !== activeSessionId) {
                    console.log(`[@${handle}] Monitoring is active but enabled=false in database. Syncing...`);
                    await updateNested('monitored.json', handle, {
                        enabled: true,
                        currentLiveSessionId: activeSessionId,
                        lastCheckedAt: new Date().toISOString(),
                        lastLiveTime: finalStatus.lastLiveTime || monitorStatus.lastLiveTime || new Date().toISOString()
                    });
                }
            }
            // Continue with checks since monitoring is actually active
        } else if (!monitorStatus.enabled && !isActuallyMonitoring) {
            // Not enabled and not monitoring - if there's a stale sessionId in database, clean it up
            if (monitorStatus.currentLiveSessionId) {
                console.log(`[@${handle}] Monitoring disabled and not active, cleaning up stale sessionId ${monitorStatus.currentLiveSessionId}`);
                await updateNested('monitored.json', handle, {
                    currentLiveSessionId: null,
                    lastCheckedAt: new Date().toISOString(),
                    enabled: false
                });
            }
            // Clear any scheduled checks
            clearAccountInterval(handle);
            console.log(`[DEBUG checkAccount] @${handle} - Exiting early: monitoring disabled and not active (total time: ${Date.now() - checkStartTime}ms)`);
            return; // Not enabled, skip automatic checks
        } else if (!monitorStatus.enabled && isActuallyMonitoring) {
            // Not enabled in database but monitoring is actually active - don't stop it
            // This can happen during race conditions - just skip automatic checks
            console.log(`[DEBUG checkAccount] @${handle} - Monitoring disabled in database but session ${activeSessionId} is still active. Skipping automatic checks but keeping session running.`);
            console.log(`[DEBUG checkAccount] @${handle} - Exiting early: disabled in DB but active (total time: ${Date.now() - checkStartTime}ms)`);
            return;
        }
        
        // Check for session end cooldown (60-120s) to avoid reconnecting to lingering TikTok rooms
        if (monitorStatus.lastSessionEndTime) {
            const lastEndTime = new Date(monitorStatus.lastSessionEndTime);
            const timeSinceEnd = Date.now() - lastEndTime.getTime();
            
            if (timeSinceEnd < SESSION_END_COOLDOWN_MS) {
                const remainingCooldown = Math.ceil((SESSION_END_COOLDOWN_MS - timeSinceEnd) / 1000);
                console.log(`[DEBUG checkAccount] @${handle} - In session end cooldown (${remainingCooldown}s remaining). Skipping check to avoid lingering room reconnection.`);
                
                // Schedule next check after cooldown expires
                const waitMs = SESSION_END_COOLDOWN_MS - timeSinceEnd + 1000; // Add 1s buffer
                scheduleNextCheck(handle, waitMs);
                console.log(`[DEBUG checkAccount] @${handle} - Exiting early: session end cooldown (total time: ${Date.now() - checkStartTime}ms)`);
                return;
            }
        }
        
        // If there's an active live session, verify it's still valid before doing a new check
        // This prevents race conditions where checkIfLive might fail temporarily while the session is actually active
        if (monitorStatus.currentLiveSessionId) {
            // Check if the session is actually still active in liveConnectorService
            const isActuallyMonitoring = liveConnectorService.isMonitoring(handle);
            
            if (isActuallyMonitoring) {
                // Session is still active - just update lastCheckedAt and schedule next check
                // Removed verbose log - only log if needed for debugging
                
                await updateNested('monitored.json', handle, {
                    lastCheckedAt: new Date().toISOString(),
                    enabled: monitorStatus.enabled,
                    currentLiveSessionId: monitorStatus.currentLiveSessionId,
                    lastLiveTime: new Date().toISOString()
                });
                
                // Emit Socket.IO event
                if (ioInstance) {
                    ioInstance.emit('monitoringStatusChanged', {
                        handle,
                        isLive: true
                    });
                }
                
                // Schedule next check (online - use settings)
                const intervals = await settingsService.getPollingIntervals();
                scheduleNextCheck(handle, intervals.onlineMs);
                return; // Skip the checkIfLive call since we know it's live
            } else {
                // Session ID exists but monitoring is not active - this might be stale data
                // Verify with checkIfLive to see if they're actually live
                console.log(`[@${handle}] Session ID ${monitorStatus.currentLiveSessionId} exists but monitoring not active, verifying...`);
            }
        }
        
        // Update last checked time
        await updateNested('monitored.json', handle, {
            lastCheckedAt: new Date().toISOString(),
            enabled: monitorStatus.enabled,
            currentLiveSessionId: monitorStatus.currentLiveSessionId
        });
        
        // Check if live - pass previous roomId to detect reuse
        const previousRoomId = monitorStatus.currentLiveSessionId ? 
            await (async () => {
                try {
                    // Try to get roomId from current session if exists
                    const session = await read(`live_sessions/${handle}/${monitorStatus.currentLiveSessionId}.json`).catch(() => null);
                    return session?.roomId || null;
                } catch {
                    return null;
                }
            })() : null;

        console.log(`[DEBUG checkAccount] @${handle} - About to call checkIfLive. Current state:`, {
            enabled: monitorStatus.enabled,
            currentLiveSessionId: monitorStatus.currentLiveSessionId,
            previousRoomId,
            isActuallyMonitoring: isActuallyMonitoring,
            activeSessionId: activeSessionId,
            lastCheckedAt: monitorStatus.lastCheckedAt
        });
        const liveStatus = await checkIfLive(handle, previousRoomId);
        console.log(`[DEBUG checkAccount] @${handle} - checkIfLive returned:`, JSON.stringify(liveStatus));
        
        // Check if device was blocked
        if (liveStatus.blocked) {
            console.warn(`[Poller] ⚠️ @${handle} - Device/IP blocked by TikTok.`);
            
            // Check if quick retry is enabled and we haven't exceeded attempts
            const quickRetrySettings = await settingsService.getQuickRetrySettings();
            const currentRetryCount = quickRetryAttempts.get(handle) || 0;
            
            if (quickRetrySettings.enabled && currentRetryCount < quickRetrySettings.attempts) {
                // Quick retry - try again after interval
                const nextRetryCount = currentRetryCount + 1;
                quickRetryAttempts.set(handle, nextRetryCount);
                const retryIntervalMs = quickRetrySettings.intervalMinutes * 60 * 1000;
                
                console.log(`[Poller] Quick retry ${nextRetryCount}/${quickRetrySettings.attempts} for @${handle} in ${quickRetrySettings.intervalMinutes} minutes`);
                
                scheduleNextCheck(handle, retryIntervalMs);
                return;
            } else {
                // Quick retry exhausted or disabled - proceed with normal block handling
                if (quickRetrySettings.enabled && currentRetryCount >= quickRetrySettings.attempts) {
                    console.warn(`[Poller] Quick retry exhausted for @${handle} (${currentRetryCount} attempts). Entering cooldown.`);
                    quickRetryAttempts.delete(handle); // Reset retry counter
                }
                
                // Record block in block tracker (will trigger cooldown)
                await blockTrackerService.recordBlock(handle, {
                    type: 'DEVICE_BLOCKED',
                    source: 'pollerService',
                    timestamp: new Date().toISOString()
                });
                
                // Stop monitoring if enabled
                const stopOnBlock = await settingsService.shouldStopMonitoringOnBlock();
                if (stopOnBlock && monitorStatus.currentLiveSessionId) {
                    try {
                        await liveConnectorService.stopMonitoring(handle, ioInstance);
                    } catch (err) {
                        console.error(`Error stopping monitoring for blocked account @${handle}:`, err);
                    }
                }
                
                // Schedule next check after cooldown (only if auto-cooldown enabled)
                const autoCooldownEnabled = await settingsService.isAutoCooldownEnabled();
                if (autoCooldownEnabled) {
                    const blockDetails = blockTrackerService.getBlockDetails(handle);
                    const cooldownMs = (blockDetails?.cooldownHours || 1) * 60 * 60 * 1000;
                    scheduleNextCheck(handle, cooldownMs);
                    
                    // Schedule recovery test
                    const recoverySettings = await settingsService.getRecoveryTestSettings();
                    if (recoverySettings.enabled) {
                        scheduleRecoveryTest(handle);
                    }
                }
                
                return;
            }
        }
        
        // Connection successful - clear quick retry counter if it exists
        if (quickRetryAttempts.has(handle)) {
            quickRetryAttempts.delete(handle);
            console.log(`[Poller] ✓ @${handle} - Connection successful after retry. Cleared retry counter.`);
        }
        
        // If we got here and weren't blocked, clear any existing block (recovery)
        if (blockTrackerService.getActiveBlocks().find(b => b.handle === handle && !b.dismissed)) {
            await blockTrackerService.clearBlock(handle);
            console.log(`[Poller] ✓ @${handle} - Block cleared, connection recovered!`);
            
            // Clear recovery test interval
            const recoveryInterval = recoveryTestIntervals.get(handle);
            if (recoveryInterval) {
                clearInterval(recoveryInterval);
                recoveryTestIntervals.delete(handle);
            }
        }
        
        if (liveStatus.isLive) {
            // Check if monitoring is actually active
            const isActuallyMonitoring = liveConnectorService.isMonitoring(handle);
            console.log(`[DEBUG checkAccount] @${handle} - checkIfLive says LIVE. Verifying monitoring state:`, {
                isActuallyMonitoring,
                enabled: monitorStatus.enabled,
                currentLiveSessionId: monitorStatus.currentLiveSessionId,
                roomId: liveStatus.roomId
            });
            
            if (!isActuallyMonitoring && monitorStatus.enabled) {
                // Not monitoring yet, or sessionId exists but monitoring not active - start monitoring
                console.log(`[@${handle}] is LIVE! Starting monitoring...`);
                await liveConnectorService.startMonitoring(handle, liveStatus.roomId, ioInstance);
                
                // Get updated status after starting monitoring
                const updatedMonitored = await read('monitored.json');
                const updatedStatus = updatedMonitored[handle] || monitorStatus;
                
                // Update lastLiveTime and lastCheckedAt
                await updateNested('monitored.json', handle, {
                    lastLiveTime: new Date().toISOString(),
                    lastCheckedAt: new Date().toISOString(),
                    enabled: monitorStatus.enabled,
                    currentLiveSessionId: updatedStatus.currentLiveSessionId
                });
            } else if (!monitorStatus.enabled) {
                // Account is live but monitoring is disabled - just update lastLiveTime without starting monitoring
                console.log(`[@${handle}] is live but monitoring is disabled. Updating lastLiveTime only.`);
                await updateNested('monitored.json', handle, {
                    lastLiveTime: new Date().toISOString(),
                    lastCheckedAt: new Date().toISOString(),
                    enabled: monitorStatus.enabled,
                    currentLiveSessionId: null
                });
            } else if (isActuallyMonitoring) {
                // Already monitoring, update lastLiveTime
                await updateNested('monitored.json', handle, {
                    lastLiveTime: new Date().toISOString(),
                    lastCheckedAt: new Date().toISOString(),
                    enabled: monitorStatus.enabled,
                    currentLiveSessionId: monitorStatus.currentLiveSessionId
                });
            }
            
            // Emit Socket.IO event
            if (ioInstance) {
                ioInstance.emit('monitoringStatusChanged', {
                    handle,
                    isLive: true
                });
            }
            
            // Schedule next check (online - use settings)
            const intervals = await settingsService.getPollingIntervals();
            scheduleNextCheck(handle, intervals.onlineMs);
            console.log(`[DEBUG checkAccount] @${handle} - ✓ Check complete: LIVE, next check in ${intervals.onlineMs / 1000}s (total time: ${Date.now() - checkStartTime}ms)`);
        } else {
            // Not live according to checkIfLive
            console.log(`[DEBUG checkAccount] @${handle} - checkIfLive says NOT LIVE. Current state:`, {
                currentLiveSessionId: monitorStatus.currentLiveSessionId,
                enabled: monitorStatus.enabled,
                error: liveStatus.error,
                errorName: liveStatus.errorName,
                blocked: liveStatus.blocked
            });
            
            if (monitorStatus.currentLiveSessionId) {
                // Verify if session is still actually active before ending it
                // This prevents race conditions where checkIfLive might fail temporarily
                const isActuallyMonitoring = liveConnectorService.isMonitoring(handle);
                const activeSessionId = liveConnectorService.getActiveSessionId(handle);
                
                console.log(`[DEBUG checkAccount] @${handle} - Session ID exists. Verifying actual state:`, {
                    currentLiveSessionId: monitorStatus.currentLiveSessionId,
                    isActuallyMonitoring,
                    activeSessionId,
                    match: activeSessionId === monitorStatus.currentLiveSessionId
                });
                
                if (isActuallyMonitoring) {
                    // Session is still active but checkIfLive returned false
                    // This could be a temporary error - don't close the active session
                    console.warn(`[DEBUG checkAccount] @${handle} - ⚠️ FALSE NEGATIVE DETECTED! checkIfLive returned false but session ${monitorStatus.currentLiveSessionId} is still active. Keeping session open.`);
                    console.warn(`[DEBUG checkAccount] @${handle} - This is likely a false negative from checkIfLive. Error was: ${liveStatus.error || 'unknown'}`);
                    
                    // Update lastCheckedAt but keep session active
                    await updateNested('monitored.json', handle, {
                        lastCheckedAt: new Date().toISOString(),
                        enabled: monitorStatus.enabled,
                        currentLiveSessionId: monitorStatus.currentLiveSessionId
                    });
                    
                    // Schedule next check soon (online interval) to verify again
                    const intervals = await settingsService.getPollingIntervals();
                    scheduleNextCheck(handle, intervals.onlineMs);
                    return; // Don't close the session
                }
                
                // Session ID exists but monitoring is not active - session might have ended
                console.log(`[@${handle}] is no longer live, ending session ${monitorStatus.currentLiveSessionId}`);
                await liveConnectorService.stopMonitoring(handle, ioInstance);
                
                // Hard-clear currentLiveSessionId and set lastSessionEndTime for cooldown
                // Update monitored.json with hard-clear of session ID
                const session = await read(`live_sessions/${handle}/${monitorStatus.currentLiveSessionId}.json`).catch(() => null);
                const now = new Date().toISOString();
                if (session && session.endTime) {
                    await updateNested('monitored.json', handle, {
                        currentLiveSessionId: null, // Hard-clear - never leave stale session IDs
                        lastLiveTime: session.endTime,
                        lastSessionEndTime: now, // Set cooldown timestamp
                        lastCheckedAt: now,
                        enabled: monitorStatus.enabled
                    });
                } else {
                    await updateNested('monitored.json', handle, {
                        currentLiveSessionId: null, // Hard-clear - never leave stale session IDs
                        lastSessionEndTime: now, // Set cooldown timestamp
                        lastCheckedAt: now,
                        enabled: monitorStatus.enabled
                    });
                }
                
                console.log(`[DEBUG checkAccount] @${handle} - Session ended. Cooldown set for ${SESSION_END_COOLDOWN_MS / 1000}s to avoid lingering room reconnection.`);
            }
            
            // Emit Socket.IO event
            if (ioInstance) {
                ioInstance.emit('monitoringStatusChanged', {
                    handle,
                    isLive: false
                });
            }
            
            // Schedule next check (offline - use settings)
            const intervals = await settingsService.getPollingIntervals();
            scheduleNextCheck(handle, intervals.offlineMs);
            console.log(`[DEBUG checkAccount] @${handle} - ✓ Check complete: NOT LIVE, next check in ${intervals.offlineMs / 1000 / 60}min (total time: ${Date.now() - checkStartTime}ms)`);
        }
        console.log(`[DEBUG checkAccount] @${handle} ========== Check completed successfully ==========`);
    } catch (error) {
        console.error(`[DEBUG checkAccount] @${handle} - ✗ ERROR during check:`, error);
        console.error(`[DEBUG checkAccount] @${handle} - Error stack:`, error.stack);
        // On error, schedule next check (offline interval)
        const intervals = await settingsService.getPollingIntervals();
        scheduleNextCheck(handle, intervals.offlineMs);
        console.log(`[DEBUG checkAccount] @${handle} - Scheduled next check after error in ${intervals.offlineMs / 1000 / 60}min (total time: ${Date.now() - checkStartTime}ms)`);
    }
}

/**
 * Schedule next check for an account
 */
function scheduleNextCheck(handle, intervalMs) {
    // Clear existing interval for this account
    const existingInterval = accountPollIntervals.get(handle);
    if (existingInterval) {
        clearTimeout(existingInterval);
    }
    
    // Schedule next check
    const timeoutId = setTimeout(() => {
        accountPollIntervals.delete(handle);
        checkAccount(handle);
    }, intervalMs);
    
    accountPollIntervals.set(handle, timeoutId);
}

/**
 * Schedule automatic recovery test for a blocked account
 */
async function scheduleRecoveryTest(handle) {
    // Clear existing recovery test if any
    const existingInterval = recoveryTestIntervals.get(handle);
    if (existingInterval) {
        clearInterval(existingInterval);
    }
    
    // Get recovery test settings
    const recoverySettings = await settingsService.getRecoveryTestSettings();
    if (!recoverySettings.enabled) {
        return; // Recovery testing disabled
    }
    
    // Test recovery after configured delay
    const testDelayMs = recoverySettings.delayHours * 60 * 60 * 1000;
    
    const intervalId = setTimeout(async () => {
        await testBlockRecovery(handle);
        recoveryTestIntervals.delete(handle);
    }, testDelayMs);
    
    recoveryTestIntervals.set(handle, intervalId);
}

/**
 * Test if block has been lifted for an account
 */
async function testBlockRecovery(handle) {
    await blockTrackerService.initialize();
    
    const block = blockTrackerService.getActiveBlocks().find(b => b.handle === handle && !b.dismissed);
    if (!block) {
        // No active block, recovery test not needed
        return;
    }
    
    const blockTimestamp = new Date(block.timestamp);
    const now = new Date();
    const hoursInCooldown = (now - blockTimestamp) / (1000 * 60 * 60);
    
    // Get recovery settings for delay check
    const recoverySettings = await settingsService.getRecoveryTestSettings();
    const minDelayHours = recoverySettings.delayHours;
    
    // Only test after minimum delay
    if (hoursInCooldown < minDelayHours) {
        // Reschedule for later
        await scheduleRecoveryTest(handle);
        return;
    }
    
    console.log(`[Block Recovery Test] Testing @${handle} - Block age: ${hoursInCooldown.toFixed(1)}h`);
    
    try {
        const liveStatus = await checkIfLive(handle);
        
        if (!liveStatus.blocked && liveStatus.isLive !== undefined) {
            // Connection succeeded - block appears to be lifted
            await blockTrackerService.clearBlock(handle);
            console.log(`[Block Recovery Test] ✓ @${handle} - Block appears to be lifted! Connection successful.`);
            
            // Resume normal polling
            const monitored = await read('monitored.json');
            if (monitored[handle]?.enabled) {
                // Schedule immediate check
                scheduleNextCheck(handle, 5000); // Check in 5 seconds
            }
        } else {
            // Still blocked or error - keep in cooldown
            console.log(`[Block Recovery Test] @${handle} - Still blocked, extending cooldown`);
            // Recovery test will be rescheduled on next checkAccount call if still in cooldown
        }
    } catch (error) {
        console.error(`[Block Recovery Test] Error testing @${handle}:`, error);
        // On error, assume still blocked - will be tested again later
    }
}

/**
 * Poll all monitored accounts and start monitoring if they go live
 */
async function pollMonitoredAccounts() {
    try {
        await blockTrackerService.initialize();
        const monitored = await read('monitored.json');
        
        const enabledAccounts = Object.keys(monitored).filter(handle => {
            return monitored[handle] && monitored[handle].enabled;
        });
        
        // Filter out accounts in cooldown
        const accountsToCheck = enabledAccounts.filter(handle => {
            return !blockTrackerService.isInCooldown(handle);
        });
        
        const accountsInCooldown = enabledAccounts.filter(handle => {
            return blockTrackerService.isInCooldown(handle);
        });
        
        if (accountsInCooldown.length > 0) {
            console.log(`[Poller] ${accountsInCooldown.length} account(s) in cooldown: ${accountsInCooldown.join(', ')}`);
        }
        
        console.log(`[Poller] Checking ${accountsToCheck.length} monitored accounts (${enabledAccounts.length - accountsToCheck.length} in cooldown)...`);
        
        // Check all non-cooldown accounts in parallel
        await Promise.all(accountsToCheck.map(handle => checkAccount(handle)));
    } catch (error) {
        console.error('Error in poller service:', error);
    }
}

/**
 * Start the polling service
 */
function start() {
    console.log('[Poller] Starting poller service...');
    
    // Poll all accounts immediately
    pollMonitoredAccounts();
}

/**
 * Stop the polling service
 */
function stop() {
    // Clear all account-specific intervals
    for (const [handle, timeoutId] of accountPollIntervals.entries()) {
        clearTimeout(timeoutId);
    }
    accountPollIntervals.clear();
    console.log('[Poller] Poller service stopped');
}

/**
 * Clear poller interval for a specific handle (used when account is deleted)
 */
function clearAccountInterval(handle) {
    const existingInterval = accountPollIntervals.get(handle);
    if (existingInterval) {
        clearTimeout(existingInterval);
        accountPollIntervals.delete(handle);
        console.log(`[Poller] Cleared polling interval for @${handle}`);
    }
    
    // Also clear recovery test interval if any
    const recoveryInterval = recoveryTestIntervals.get(handle);
    if (recoveryInterval) {
        clearInterval(recoveryInterval);
        recoveryTestIntervals.delete(handle);
        console.log(`[Poller] Cleared recovery test interval for @${handle}`);
    }
}

module.exports = {
    start,
    stop,
    pollMonitoredAccounts,
    checkIfLive,
    setIo,
    clearAccountInterval,
    checkAccount
};
