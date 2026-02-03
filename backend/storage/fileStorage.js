const fs = require('fs').promises;
const path = require('path');

const DB_DIR = path.join(__dirname, '../../database');

/**
 * Ensure database directory exists
 */
async function ensureDir(dirPath) {
    try {
        await fs.access(dirPath);
    } catch {
        await fs.mkdir(dirPath, { recursive: true });
    }
}

/**
 * Read JSON file with retry logic for corrupted files
 */
async function read(filePath, retries = 3) {
    const fullPath = path.join(DB_DIR, filePath);
    
    for (let attempt = 0; attempt < retries; attempt++) {
        try {
            await ensureDir(path.dirname(fullPath));
            let data;
            try {
                data = await fs.readFile(fullPath, 'utf8');
            } catch (readError) {
                // File doesn't exist - return appropriate default
                if (readError.code === 'ENOENT') {
                    // Determine default based on filename patterns
                    if (filePath.includes('.json') && !filePath.includes('account_history')) {
                        // For object-based JSON files (monitored.json, etc.)
                        if (filePath === 'monitored.json' || filePath === 'tiktok_blocks.json' || filePath === 'anti_blocking_settings.json') {
                            const defaultValue = {};
                            await write(filePath, defaultValue);
                            return defaultValue;
                        }
                        // For array-based JSON files (tiktok_accounts.json, alerts.json, etc.)
                        const defaultValue = [];
                        await write(filePath, defaultValue);
                        return defaultValue;
                    }
                    // For other files, return empty object
                    const defaultValue = {};
                    await write(filePath, defaultValue);
                    return defaultValue;
                }
                throw readError;
            }
            
            // Check if file is empty or only whitespace
            const trimmed = data.trim();
            if (!trimmed || trimmed.length === 0) {
                // File is empty - return appropriate default
                if (filePath === 'monitored.json' || filePath === 'tiktok_blocks.json' || filePath === 'anti_blocking_settings.json') {
                    const defaultValue = {};
                    await write(filePath, defaultValue);
                    return defaultValue;
                }
                // For array-based files (tiktok_accounts.json, alerts.json, etc.)
                const defaultValue = [];
                await write(filePath, defaultValue);
                return defaultValue;
            }
            
            // Try to parse JSON
            try {
                return JSON.parse(data);
            } catch (parseError) {
                // If JSON is corrupted and this is not the last attempt, wait and retry
                if (attempt < retries - 1) {
                    await new Promise(resolve => setTimeout(resolve, 50 * (attempt + 1)));
                    continue;
                }
                
                // Last attempt failed - try to fix corrupted JSON by extracting valid part
                console.warn(`JSON parse error in ${filePath}, attempting recovery...`);
                
                // Try to find the last valid JSON object/array
                const trimmed = data.trim();
                if (trimmed.startsWith('[')) {
                    // More robust recovery: find the first complete array by counting brackets
                    let bracketCount = 0;
                    let validEnd = -1;
                    
                    for (let i = 0; i < trimmed.length; i++) {
                        if (trimmed[i] === '[') bracketCount++;
                        if (trimmed[i] === ']') {
                            bracketCount--;
                            if (bracketCount === 0) {
                                validEnd = i;
                                break; // Found the first complete array
                            }
                        }
                    }
                    
                    if (validEnd > 0) {
                        const recovered = trimmed.substring(0, validEnd + 1);
                        try {
                            const parsed = JSON.parse(recovered);
                            // Write back the recovered data
                            await write(filePath, parsed);
                            console.log(`Successfully recovered ${filePath}, saved ${parsed.length || Object.keys(parsed).length} items`);
                            return parsed;
                        } catch (recoveryError) {
                            console.error(`Recovery failed for ${filePath}:`, recoveryError.message);
                        }
                    }
                    
                    // Last resort: try to extract valid JSON objects from the array
                    try {
                        const match = trimmed.match(/^\[[\s\S]*?\]/);
                        if (match) {
                            const parsed = JSON.parse(match[0]);
                            await write(filePath, parsed);
                            console.log(`Recovered using regex for ${filePath}`);
                            return parsed;
                        }
                    } catch {}
                    
                    // Return empty array if recovery fails
                    console.warn(`Could not recover ${filePath}, returning empty array`);
                    await write(filePath, []); // Fix the corrupted file
                    return [];
                } else if (trimmed.startsWith('{')) {
                    // Try to find first complete object
                    let braceCount = 0;
                    let validEnd = -1;
                    
                    for (let i = 0; i < trimmed.length; i++) {
                        if (trimmed[i] === '{') braceCount++;
                        if (trimmed[i] === '}') {
                            braceCount--;
                            if (braceCount === 0) {
                                validEnd = i;
                                break;
                            }
                        }
                    }
                    
                    if (validEnd > 0) {
                        const recovered = trimmed.substring(0, validEnd + 1);
                        try {
                            const parsed = JSON.parse(recovered);
                            await write(filePath, parsed);
                            return parsed;
                        } catch {}
                    }
                    
                    // Return empty object if recovery fails
                    await write(filePath, {});
                    return {};
                } else {
                    // File doesn't start with [ or { - likely corrupted or invalid
                    // Determine default based on file type
                    console.warn(`Could not parse ${filePath} (invalid JSON format - doesn't start with [ or {), returning default value`);
                    if (filePath === 'monitored.json' || filePath === 'tiktok_blocks.json' || filePath === 'anti_blocking_settings.json') {
                        await write(filePath, {});
                        return {};
                    }
                    // For array-based files (tiktok_accounts.json, alerts.json, etc.)
                    await write(filePath, []);
                    return [];
                }
            }
        } catch (error) {
            if (error.code === 'ENOENT') {
                // File doesn't exist - return appropriate default and create file
                console.log(`File ${filePath} does not exist, creating with default value`);
                if (filePath === 'monitored.json' || filePath === 'tiktok_blocks.json' || filePath === 'anti_blocking_settings.json') {
                    const defaultValue = {};
                    await write(filePath, defaultValue);
                    return defaultValue;
                }
                // For array-based JSON files (tiktok_accounts.json, alerts.json, etc.)
                const defaultValue = [];
                await write(filePath, defaultValue);
                return defaultValue;
            }
            
            // If not last attempt, wait and retry
            if (attempt < retries - 1) {
                await new Promise(resolve => setTimeout(resolve, 50 * (attempt + 1)));
                continue;
            }
            
            throw error;
        }
    }
}

/**
 * Write JSON file atomically using temporary file with locking
 * @param {string} filePath - Path to the file
 * @param {*} data - Data to write
 * @param {number} retries - Number of retry attempts
 * @param {boolean} skipLock - If true, skip acquiring lock (used when already locked by caller)
 */
async function write(filePath, data, retries = 5, skipLock = false) {
    const fullPath = path.join(DB_DIR, filePath);
    await ensureDir(path.dirname(fullPath));
    
    for (let attempt = 0; attempt < retries; attempt++) {
        let releaseLock = null;
        if (!skipLock) {
            releaseLock = await acquireLock(filePath);
        }
        
        try {
            // Write to temporary file first, then rename (atomic operation on most systems)
            const tempPath = fullPath + '.tmp';
            
            try {
                const jsonString = JSON.stringify(data, null, 2);
                await fs.writeFile(tempPath, jsonString, 'utf8');
                
                // Verify the written file is valid JSON
                const verifyData = await fs.readFile(tempPath, 'utf8');
                JSON.parse(verifyData);
                
                // Atomic rename with retry logic for Windows EPERM errors
                let renameSuccess = false;
                for (let renameAttempt = 0; renameAttempt < 3; renameAttempt++) {
                    try {
                        await fs.rename(tempPath, fullPath);
                        renameSuccess = true;
                        break;
                    } catch (renameError) {
                        if (renameError.code === 'EPERM' && renameAttempt < 2) {
                            // Windows file lock issue, wait and retry
                            await new Promise(resolve => setTimeout(resolve, 50 * (renameAttempt + 1)));
                            continue;
                        }
                        throw renameError;
                    }
                }
                
                if (!renameSuccess) {
                    throw new Error('Failed to rename temp file after retries');
                }
                
                if (releaseLock) {
                    releaseLock();
                }
                return; // Success
            } catch (error) {
                // Clean up temp file on error
                try {
                    await fs.unlink(tempPath);
                } catch {}
                throw error;
            }
        } catch (error) {
            if (releaseLock) {
                releaseLock();
            }
            
            // If not last attempt, wait and retry
            if (attempt < retries - 1 && (error.code === 'EPERM' || error.code === 'EACCES')) {
                await new Promise(resolve => setTimeout(resolve, 50 * (attempt + 1)));
                continue;
            }
            
            throw error;
        }
    }
}

// Simple file locking mechanism using a Map
const fileLocks = new Map();

/**
 * Acquire a lock for a file path
 */
async function acquireLock(filePath) {
    const lockKey = path.join(DB_DIR, filePath);
    
    // Wait if file is locked
    while (fileLocks.has(lockKey)) {
        await new Promise(resolve => setTimeout(resolve, 10));
    }
    
    // Create lock promise
    let resolveLock;
    const lockPromise = new Promise(resolve => { resolveLock = resolve; });
    fileLocks.set(lockKey, resolveLock);
    
    return () => {
        fileLocks.delete(lockKey);
        resolveLock();
    };
}

/**
 * Append to JSON array file with locking
 */
async function append(filePath, item, retries = 5) {
    const fullPath = path.join(DB_DIR, filePath);
    
    for (let attempt = 0; attempt < retries; attempt++) {
        const releaseLock = await acquireLock(filePath);
        
        try {
            // Read current data
            let data;
            try {
                data = await read(filePath);
            } catch (readError) {
                // If file doesn't exist or is corrupted, start with empty array
                if (readError.code === 'ENOENT' || readError instanceof SyntaxError) {
                    data = [];
                } else {
                    throw readError;
                }
            }
            
            if (!Array.isArray(data)) {
                console.error(`[FileStorage] File ${filePath} is not an array, got:`, typeof data, Array.isArray(data), data);
                throw new Error(`File ${filePath} is not an array`);
            }
            
            // Append item
            data.push(item);
            
            // Write back - skip lock since we already have it
            await write(filePath, data, 5, true);
            
            // Verify write succeeded - skip lock since we already have it
            const verifyData = await read(filePath);
            if (!Array.isArray(verifyData) || verifyData.length !== data.length) {
                console.error(`[FileStorage] ❌ Write verification failed for ${filePath}: expected ${data.length} items, got ${Array.isArray(verifyData) ? verifyData.length : 'non-array'}`);
                throw new Error(`Write verification failed for ${filePath}: expected ${data.length} items, got ${Array.isArray(verifyData) ? verifyData.length : 'non-array'}`);
            }
            
            releaseLock();
            return;
        } catch (error) {
            releaseLock();
            
            // If it's a JSON error and not the last attempt, retry
            if ((error instanceof SyntaxError || error.message.includes('JSON')) && attempt < retries - 1) {
                await new Promise(resolve => setTimeout(resolve, 50 * (attempt + 1)));
                continue;
            }
            
            // Log error for debugging
            if (attempt === retries - 1) {
                console.error(`Failed to append to ${filePath} after ${retries} attempts:`, error.message);
            }
            
            throw error;
        }
    }
}

/**
 * Update item in JSON array by ID field
 */
async function update(filePath, id, updates) {
    const data = await read(filePath);
    if (!Array.isArray(data)) {
        throw new Error(`File ${filePath} is not an array`);
    }
    const index = data.findIndex(item => item.id === id);
    if (index === -1) {
        throw new Error(`Item with id ${id} not found in ${filePath}`);
    }
    data[index] = { ...data[index], ...updates };
    await write(filePath, data);
    return data[index];
}

/**
 * Delete item from JSON array by ID field
 */
async function deleteById(filePath, id) {
    const data = await read(filePath);
    if (!Array.isArray(data)) {
        throw new Error(`File ${filePath} is not an array`);
    }
    const index = data.findIndex(item => item.id === id);
    if (index === -1) {
        throw new Error(`Item with id ${id} not found in ${filePath}`);
    }
    data.splice(index, 1);
    await write(filePath, data);
}

/**
 * Find item in JSON array by field value
 */
async function findBy(filePath, field, value) {
    const data = await read(filePath);
    if (!Array.isArray(data)) {
        throw new Error(`File ${filePath} is not an array`);
    }
    return data.find(item => item[field] === value);
}

/**
 * Find all items in JSON array matching criteria
 */
async function findWhere(filePath, criteria) {
    const data = await read(filePath);
    if (!Array.isArray(data)) {
        throw new Error(`File ${filePath} is not an array`);
    }
    return data.filter(item => {
        return Object.keys(criteria).every(key => item[key] === criteria[key]);
    });
}

/**
 * Update nested object property (for monitored.json structure)
 */
async function updateNested(filePath, key, updates) {
    const data = await read(filePath);
    if (typeof data !== 'object' || Array.isArray(data)) {
        throw new Error(`File ${filePath} must be an object`);
    }
    data[key] = { ...(data[key] || {}), ...updates };
    await write(filePath, data);
    return data[key];
}

/**
 * Delete nested object property
 */
async function deleteNested(filePath, key) {
    const data = await read(filePath);
    if (typeof data !== 'object' || Array.isArray(data)) {
        throw new Error(`File ${filePath} must be an object`);
    }
    delete data[key];
    await write(filePath, data);
}

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
    DB_DIR
};
