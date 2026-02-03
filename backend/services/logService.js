const fs = require('fs').promises;
const path = require('path');
const { write: fileWrite, read: fileRead, append: fileAppend } = require('../storage/dbStorage');

const LOG_FILE = 'console_logs.json';
const MAX_LOGS = 1000; // Keep last 1000 logs

/**
 * Log service for capturing and storing console logs
 */
class LogService {
    constructor() {
        this.logs = [];
        this.isInitialized = false;
    }

    /**
     * Initialize log service
     */
    async initialize() {
        try {
            const logs = await fileRead(LOG_FILE);
            if (Array.isArray(logs)) {
                this.logs = logs;
            }
        } catch (error) {
            // File doesn't exist, start fresh
            this.logs = [];
        }
        this.isInitialized = true;
    }

    /**
     * Add a log entry
     */
    async log(level, message, metadata = {}) {
        if (!this.isInitialized) {
            await this.initialize();
        }

        const logEntry = {
            id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            timestamp: new Date().toISOString(),
            level, // 'info', 'warn', 'error', 'debug'
            message,
            metadata
        };

        // Add to front of array (newest first)
        this.logs.unshift(logEntry);

        // Keep only last MAX_LOGS entries
        if (this.logs.length > MAX_LOGS) {
            this.logs = this.logs.slice(0, MAX_LOGS);
        }

        // Write to database asynchronously (don't block)
        // For PostgreSQL, append is sufficient - no need to rewrite all logs
        fileAppend(LOG_FILE, logEntry).catch(err => {
            // Only log if not a duplicate key error (which is expected)
            if (!err.message || !err.message.includes('duplicate key')) {
                console.error('Error appending log to database:', err);
            }
        });
        
        // Note: We don't call writeLogs() after each log entry for PostgreSQL
        // because append() is sufficient and more efficient
        // writeLogs() is only used for clearing logs or bulk operations

        // Don't output to console here - console methods are overridden in server.js
        // to capture logs, and we don't want infinite loops

        return logEntry;
    }

    /**
     * Write logs to file/database
     */
    async writeLogs() {
        try {
            // For database storage, we can write all logs at once
            // Database will handle it efficiently with the LIMIT in read()
            await fileWrite(LOG_FILE, this.logs);
        } catch (error) {
            console.error('Error writing logs:', error);
        }
    }

    /**
     * Get logs with optional filters
     */
    async getLogs(filters = {}) {
        if (!this.isInitialized) {
            await this.initialize();
        }

        let filteredLogs = [...this.logs];

        // Filter by level
        if (filters.level) {
            filteredLogs = filteredLogs.filter(log => log.level === filters.level);
        }

        // Filter by search term
        if (filters.search) {
            const searchLower = filters.search.toLowerCase();
            filteredLogs = filteredLogs.filter(log => 
                log.message.toLowerCase().includes(searchLower) ||
                JSON.stringify(log.metadata).toLowerCase().includes(searchLower)
            );
        }

        // Limit results
        const limit = filters.limit || 500;
        filteredLogs = filteredLogs.slice(0, limit);

        return filteredLogs;
    }

    /**
     * Clear logs
     */
    async clearLogs() {
        this.logs = [];
        await this.writeLogs();
    }

    /**
     * Log info
     */
    async info(message, metadata) {
        return this.log('info', message, metadata);
    }

    /**
     * Log warning
     */
    async warn(message, metadata) {
        return this.log('warn', message, metadata);
    }

    /**
     * Log error
     */
    async error(message, metadata) {
        return this.log('error', message, metadata);
    }

    /**
     * Log debug
     */
    async debug(message, metadata) {
        return this.log('debug', message, metadata);
    }
}

// Create singleton instance
const logService = new LogService();

module.exports = logService;
