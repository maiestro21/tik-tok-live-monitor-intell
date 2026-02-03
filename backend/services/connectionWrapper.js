const { WebcastPushConnection } = require('tiktok-live-connector');
const { EventEmitter } = require('events');
const logService = require('./logService');
const blockTrackerService = require('./blockTrackerService');

/**
 * TikTok LIVE connection wrapper with advanced reconnect functionality and error handling
 */
class TikTokConnectionWrapper extends EventEmitter {
    constructor(uniqueId, options, enableLog) {
        super();

        this.uniqueId = uniqueId;
        this.enableLog = enableLog;

        // Connection State
        this.clientDisconnected = false;
        this.reconnectEnabled = true;
        this.reconnectCount = 0;
        this.reconnectWaitMs = 1000;
        this.maxReconnectAttempts = 5;

        this.connection = new WebcastPushConnection(uniqueId, options);

        this.connection.on('streamEnd', () => {
            this.log(`streamEnd event received, giving up connection`);
            this.reconnectEnabled = false;
            this.emit('streamEnd');
        })

        this.connection.on('disconnected', () => {
            this.log(`TikTok connection disconnected`);
            this.scheduleReconnect();
        });

        this.connection.on('error', (err) => {
            const errorMessage = err?.exception?.toString() || err?.info || String(err);
            
            // Check if it's a device blocked error
            const isDeviceBlocked = errorMessage.includes('DEVICE_BLOCKED') || 
                                   errorMessage.includes('handshake-status: 415');
            const isNoWSUpgrade = errorMessage.includes('NoWSUpgradeError') ||
                                 errorMessage.includes('does not offer a websocket upgrade');
            
            if (isDeviceBlocked || isNoWSUpgrade) {
                this.log(`Device/IP blocked by TikTok detected in error event. ${isDeviceBlocked ? 'DEVICE_BLOCKED (415)' : 'No websocket upgrade available'}`);
                this.reconnectEnabled = false; // Stop reconnection attempts
                
                // Log to log service
                logService.error(`TikTok block detected for @${this.uniqueId}`, {
                    type: isDeviceBlocked ? 'DEVICE_BLOCKED' : 'NoWSUpgrade',
                    error: err
                }).catch(console.error);
                
                // Record block in block tracker
                blockTrackerService.initialize().then(() => {
                    blockTrackerService.recordBlock(this.uniqueId, {
                        type: isDeviceBlocked ? 'DEVICE_BLOCKED' : 'NoWSUpgrade',
                        error: err
                    }).catch(console.error);
                });
                
                this.emit('blocked', {
                    error: err,
                    message: 'Device/IP blocked by TikTok. Cannot connect to live stream.',
                    canRetry: false
                });
            } else {
                this.log(`Error event triggered: ${err.info}, ${err.exception}`);
                
                // Log error to log service
                logService.error(`Connection error for @${this.uniqueId}`, {
                    error: err
                }).catch(console.error);
            }
            
            // Log error but don't crash
            console.error(`[TikTok Connection Error] @${this.uniqueId}:`, err);
        })
    }

    connect(isReconnect) {
        return this.connection.connect().then((state) => {
            this.log(`${isReconnect ? 'Reconnected' : 'Connected'} to roomId ${state.roomId}, websocket: ${state.upgradedToWebsocket}`);

            // Reset reconnect vars
            this.reconnectCount = 0;
            this.reconnectWaitMs = 1000;

            // Client disconnected while establishing connection => drop connection
            if (this.clientDisconnected) {
                this.connection.disconnect();
                return state;
            }

            // Notify client
            if (!isReconnect) {
                this.emit('connected', state);
            }

            return state;
        }).catch((err) => {
            const errorMessage = err?.message || err?.toString() || String(err);
            const errorInfo = err?.info || '';
            
            // Check if it's a device blocked or websocket upgrade error
            const isDeviceBlocked = errorMessage.includes('DEVICE_BLOCKED') || 
                                   errorInfo.includes('DEVICE_BLOCKED') ||
                                   errorMessage.includes('handshake-status: 415');
            const isNoWSUpgrade = errorMessage.includes('NoWSUpgradeError') ||
                                 errorMessage.includes('does not offer a websocket upgrade');
            
            if (isDeviceBlocked || isNoWSUpgrade) {
                // Device/IP is blocked by TikTok - don't retry
                this.log(`Device/IP blocked by TikTok. ${isDeviceBlocked ? 'DEVICE_BLOCKED (415)' : 'No websocket upgrade available'}. Giving up connection.`);
                this.reconnectEnabled = false; // Don't try to reconnect if blocked
                
                // Log to log service
                logService.error(`TikTok block detected for @${this.uniqueId}`, {
                    type: isDeviceBlocked ? 'DEVICE_BLOCKED' : 'NoWSUpgrade',
                    error: err
                }).catch(console.error);
                
                // Record block in block tracker
                blockTrackerService.initialize().then(() => {
                    blockTrackerService.recordBlock(this.uniqueId, {
                        type: isDeviceBlocked ? 'DEVICE_BLOCKED' : 'NoWSUpgrade',
                        error: err
                    }).catch(console.error);
                });
                
                // Emit a specific error event
                this.emit('blocked', {
                    error: err,
                    message: 'Device/IP blocked by TikTok. Cannot connect to live stream.',
                    canRetry: false
                });
                
                // Also emit disconnected with specific message
                this.emit('disconnected', `Device blocked by TikTok. ${isNoWSUpgrade ? 'Try using sessionId for request polling.' : 'Connection not allowed.'}`);
                
                // Don't throw - handle gracefully
                return Promise.reject(new Error(`Device blocked by TikTok: ${errorMessage}`));
            }

            this.log(`${isReconnect ? 'Reconnect' : 'Connection'} failed, ${errorMessage}`);

            if (isReconnect) {
                // Schedule the next reconnect attempt for non-blocked errors
                this.scheduleReconnect(err);
            } else {
                // Notify client
                this.emit('disconnected', errorMessage);
            }
            throw err;
        })
    }

    scheduleReconnect(reason) {
        if (!this.reconnectEnabled) {
            return;
        }

        if (this.reconnectCount >= this.maxReconnectAttempts) {
            this.log(`Give up connection, max reconnect attempts exceeded`);
            this.emit('disconnected', `Connection lost. ${reason}`);
            return;
        }

        this.log(`Try reconnect in ${this.reconnectWaitMs}ms`);

        setTimeout(() => {
            if (!this.reconnectEnabled || this.reconnectCount >= this.maxReconnectAttempts) {
                return;
            }

            this.reconnectCount += 1;
            this.reconnectWaitMs *= 2;
            this.connect(true);
        }, this.reconnectWaitMs)
    }

    disconnect() {
        this.log(`Client connection disconnected`);

        this.clientDisconnected = true;
        this.reconnectEnabled = false;

        if (this.connection.getState().isConnected) {
            this.connection.disconnect();
        }
    }

    log(logString) {
        if (this.enableLog) {
            console.log(`WRAPPER @${this.uniqueId}: ${logString}`);
        }
    }
}

module.exports = {
    TikTokConnectionWrapper
};
