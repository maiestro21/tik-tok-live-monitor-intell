const { v4: uuidv4 } = require('uuid');
const { read, append } = require('../storage/dbStorage');

/**
 * Convert trigger word pattern to regex
 * Supports wildcards:
 * - * = any characters (0 or more)
 * - % = any symbol (non-alphanumeric character)
 * Always case-insensitive
 */
function patternToRegex(pattern) {
    let regexPattern = pattern;
    
    // First, replace wildcards with placeholders to protect them from escaping
    regexPattern = regexPattern.replace(/\*/g, '__WILDCARD_STAR__');
    regexPattern = regexPattern.replace(/%/g, '__WILDCARD_PERCENT__');
    
    // Escape special regex characters (.*+?^${}()[\]|\\)
    regexPattern = regexPattern.replace(/[.+?^${}()[\]|\\]/g, '\\$&');
    
    // Replace placeholders with actual regex patterns
    regexPattern = regexPattern.replace(/__WILDCARD_PERCENT__/g, '[^a-zA-Z0-9]');
    regexPattern = regexPattern.replace(/__WILDCARD_STAR__/g, '.*');
    
    // Always use 'gi' flags for global case-insensitive search
    return new RegExp(regexPattern, 'gi');
}

/**
 * Check if message matches trigger pattern
 * Always case-insensitive
 */
function matchesTrigger(message, triggerPattern) {
    // If pattern contains wildcards (* or %), use regex matching
    if (triggerPattern.includes('*') || triggerPattern.includes('%')) {
        const regex = patternToRegex(triggerPattern);
        return regex.test(message);
    }
    
    // Otherwise, use simple case-insensitive string matching
    return message.toLowerCase().includes(triggerPattern.toLowerCase());
}

/**
 * Check message against trigger words and create alert if match found
 */
async function checkAndCreateAlert(message, handle, sessionId, eventId, io) {
    try {
        const triggerWords = await read('trigger_words.json');
        if (!triggerWords || triggerWords.length === 0) {
            return null;
        }
        
        for (const trigger of triggerWords) {
            const match = matchesTrigger(message, trigger.word);
            
            if (match) {
                // Create alert with severity from trigger word
                const alert = {
                    id: uuidv4(),
                    triggerWord: trigger.word,
                    sessionId,
                    handle,
                    eventId,
                    timestamp: new Date().toISOString(),
                    severity: trigger.severity || 'medium', // Use severity from trigger word, default to medium
                    status: 'new',
                    message: message.substring(0, 500),
                    acknowledgedAt: null,
                    resolvedAt: null
                };

                await append('alerts.json', alert);

                // Emit Socket.IO event
                if (io) {
                    io.emit('newAlert', alert);
                }

                console.log(`Alert created for @${handle}: trigger word "${trigger.word}" matched`);
                
                return alert;
            }
        }

        return null;
    } catch (error) {
        console.error('Error checking trigger words:', error);
        return null;
    }
}

module.exports = {
    checkAndCreateAlert
};
