const https = require('https');
const { v4: uuidv4 } = require('uuid');
const { read, write, append } = require('../storage/dbStorage');

/**
 * Fetch TikTok user profile by handle using web scraping approach
 * This is a basic implementation - in production you might want to use a more robust solution
 */
async function fetchUserProfile(handle) {
    try {
        // Remove @ if present
        const cleanHandle = handle.replace('@', '');
        
        // TikTok's user API endpoint (unofficial)
        // Note: This may break if TikTok changes their API structure
        const url = `https://www.tiktok.com/@${cleanHandle}`;
        
        // Fetch the page HTML
        const html = await fetchPage(url);
        
        // Parse user data from the page
        // TikTok embeds user data in a script tag with type="application/json"
        const userData = parseUserDataFromHTML(html);
        
        if (!userData) {
            throw new Error(`Could not fetch profile data for @${cleanHandle}`);
        }
        
        // Extract all relevant information
        const createTime = userData.createTime ? (typeof userData.createTime === 'string' ? parseInt(userData.createTime) : userData.createTime) : null;
        const uniqueIdModifyTime = userData.uniqueIdModifyTime ? (typeof userData.uniqueIdModifyTime === 'string' ? parseInt(userData.uniqueIdModifyTime) : userData.uniqueIdModifyTime) : null;
        const nickNameModifyTime = userData.nickNameModifyTime ? (typeof userData.nickNameModifyTime === 'string' ? parseInt(userData.nickNameModifyTime) : userData.nickNameModifyTime) : null;
        
        return {
            handle: cleanHandle,
            // Basic info
            id: userData.id || null,
            uniqueId: userData.uniqueId || cleanHandle,
            nickname: userData.nickname || cleanHandle,
            signature: userData.signature || userData.bio || '',
            bio: userData.signature || userData.bio || '', // Keep bio for backward compatibility
            profilePictureUrl: userData.avatarLarger || userData.avatarMedium || userData.avatarThumb || '',
            // Status
            verified: userData.verified || userData.secret || false,
            secret: userData.secret || userData.verified || false,
            privateAccount: userData.privateAccount || false,
            // Location & Language
            language: userData.language || null,
            region: userData.region || null,
            // Account info
            secUid: userData.secUid || null,
            // Statistics
            followerCount: userData.followerCount || 0,
            followingCount: userData.followingCount || 0,
            videoCount: userData.videoCount || 0,
            heartCount: userData.heartCount || userData.likeCount || 0,
            diggCount: userData.diggCount || 0,
            friendCount: userData.friendCount || 0,
            // Timestamps (convert from Unix timestamp to ISO string)
            creationDate: createTime ? new Date(createTime * 1000).toISOString() : null,
            createTime: createTime,
            uniqueIdModifyTime: uniqueIdModifyTime ? new Date(uniqueIdModifyTime * 1000).toISOString() : null,
            uniqueIdModifyTimeUnix: uniqueIdModifyTime,
            nickNameModifyTime: nickNameModifyTime ? new Date(nickNameModifyTime * 1000).toISOString() : null,
            nickNameModifyTimeUnix: nickNameModifyTime
        };
    } catch (error) {
        console.error('Error fetching TikTok profile:', error);
        throw new Error(`Failed to fetch profile for @${handle}: ${error.message}`);
    }
}

/**
 * Fetch HTML page content
 */
function fetchPage(url) {
    return new Promise((resolve, reject) => {
        // Add query parameters similar to bash script
        const urlObj = new URL(url);
        if (!urlObj.searchParams.has('isUniqueId')) {
            urlObj.searchParams.set('isUniqueId', 'true');
            urlObj.searchParams.set('isSecured', 'true');
        }
        const finalUrl = urlObj.toString();
        
        https.get(finalUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.5',
                'Accept-Encoding': 'gzip, deflate, br',
                'Connection': 'keep-alive',
                'Upgrade-Insecure-Requests': '1'
            }
        }, (res) => {
            let data = '';
            
            // Handle different encodings
            let stream = res;
            if (res.headers['content-encoding'] === 'gzip') {
                const zlib = require('zlib');
                stream = res.pipe(zlib.createGunzip());
            } else if (res.headers['content-encoding'] === 'br') {
                const zlib = require('zlib');
                stream = res.pipe(zlib.createBrotliDecompress());
            } else if (res.headers['content-encoding'] === 'deflate') {
                const zlib = require('zlib');
                stream = res.pipe(zlib.createInflate());
            }
            
            stream.on('data', (chunk) => {
                data += chunk.toString();
            });
            
            stream.on('end', () => {
                resolve(data);
            });
            
            stream.on('error', (err) => {
                reject(err);
            });
        }).on('error', (err) => {
            reject(err);
        });
    });
}

/**
 * Parse user data from TikTok HTML page using regex extraction (similar to bash script)
 */
function parseUserDataFromHTML(html) {
    try {
        // First, try to parse from JSON script tags (more reliable)
        const scriptMatch = html.match(/<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application\/json">(.*?)<\/script>/s);
        if (scriptMatch && scriptMatch[1]) {
            try {
                const data = JSON.parse(scriptMatch[1]);
                const userData = extractUserFromData(data);
                if (userData && (userData.id || userData.uniqueId)) {
                    return userData;
                }
            } catch (e) {
                // JSON parse failed, try regex extraction
            }
        }
        
        // Fallback: Use regex extraction similar to bash script
        // This method extracts fields directly from HTML using regex patterns
        function extract(pattern, transform = (v) => v) {
            const match = html.match(pattern);
            if (match && match[1]) {
                try {
                    return transform(match[1]);
                } catch (e) {
                    return null;
                }
            }
            return null;
        }
        
        const userData = {};
        
        // Extract basic fields using regex (similar to bash script)
        const idMatch = html.match(/"id":"(\d+)"/);
        if (idMatch) userData.id = idMatch[1];
        
        const uniqueIdMatch = html.match(/"uniqueId":"([^"]+)"/);
        if (uniqueIdMatch) userData.uniqueId = uniqueIdMatch[1];
        
        const nicknameMatch = html.match(/"nickname":"([^"]+)"/);
        if (nicknameMatch) userData.nickname = nicknameMatch[1];
        
        const avatarMatch = html.match(/"avatarLarger":"([^"]+)"/);
        if (avatarMatch) userData.avatarLarger = avatarMatch[1].replace(/\\u002F/g, '/');
        
        const signatureMatch = html.match(/"signature":"([^"]+)"/);
        if (signatureMatch) userData.signature = signatureMatch[1];
        
        // Extract boolean fields
        const privateMatch = html.match(/"privateAccount":(true|false)/);
        if (privateMatch) userData.privateAccount = privateMatch[1] === 'true';
        
        const secretMatch = html.match(/"secret":(true|false)/);
        if (secretMatch) userData.secret = secretMatch[1] === 'true';
        
        const verifiedMatch = html.match(/"verified":(true|false)/);
        if (verifiedMatch) userData.verified = verifiedMatch[1] === 'true';
        
        // Extract numeric fields
        const followerMatch = html.match(/"followerCount":(\d+)/);
        if (followerMatch) userData.followerCount = parseInt(followerMatch[1]);
        
        const followingMatch = html.match(/"followingCount":(\d+)/);
        if (followingMatch) userData.followingCount = parseInt(followingMatch[1]);
        
        const videoMatch = html.match(/"videoCount":(\d+)/);
        if (videoMatch) userData.videoCount = parseInt(videoMatch[1]);
        
        const heartMatch = html.match(/"heartCount":(\d+)/);
        if (heartMatch) userData.heartCount = parseInt(heartMatch[1]);
        
        const diggMatch = html.match(/"diggCount":(\d+)/);
        if (diggMatch) userData.diggCount = parseInt(diggMatch[1]);
        
        const friendMatch = html.match(/"friendCount":(\d+)/);
        if (friendMatch) userData.friendCount = parseInt(friendMatch[1]);
        
        // Extract timestamp fields
        const createTimeMatch = html.match(/"createTime":(\d+)/);
        if (createTimeMatch) userData.createTime = parseInt(createTimeMatch[1]);
        
        const uniqueIdModifyMatch = html.match(/"uniqueIdModifyTime":(\d+)/);
        if (uniqueIdModifyMatch) userData.uniqueIdModifyTime = parseInt(uniqueIdModifyMatch[1]);
        
        const nickNameModifyMatch = html.match(/"nickNameModifyTime":(\d+)/);
        if (nickNameModifyMatch) userData.nickNameModifyTime = parseInt(nickNameModifyMatch[1]);
        
        // Extract other fields
        const languageMatch = html.match(/"language":"([^"]+)"/);
        if (languageMatch) userData.language = languageMatch[1];
        
        const regionMatch = html.match(/"region":"([^"]+)"/);
        if (regionMatch) userData.region = regionMatch[1];
        
        const secUidMatch = html.match(/"secUid":"([^"]+)"/);
        if (secUidMatch) userData.secUid = secUidMatch[1];
        
        // If we got at least id or uniqueId, return the data
        if (userData.id || userData.uniqueId) {
            return userData;
        }
        
        // Last resort: Try JSON parsing from all script tags
        const jsonMatches = html.match(/<script[^>]*type="application\/json"[^>]*>(.*?)<\/script>/gs);
        if (jsonMatches) {
            for (const match of jsonMatches) {
                try {
                    const jsonContent = match.match(/>([\s\S]*?)</);
                    if (jsonContent && jsonContent[1]) {
                        const data = JSON.parse(jsonContent[1]);
                        const extracted = extractUserFromData(data);
                        if (extracted && (extracted.id || extracted.uniqueId)) {
                            return extracted;
                        }
                    }
                } catch (e) {
                    // Continue searching
                }
            }
        }
        
        return null;
    } catch (error) {
        console.error('Error parsing HTML:', error);
        return null;
    }
}

/**
 * Extract user data from TikTok's nested data structure
 */
function extractUserFromData(data) {
    // Try different possible paths in the data structure
    const paths = [
        ['defaultScope', 'webapp.user-detail', 'userInfo', 'user'],
        ['__DEFAULT_SCOPE__', 'webapp.user-detail', 'userInfo', 'user'],
        ['props', 'pageProps', 'userInfo'],
        ['userInfo'],
        ['user']
    ];
    
    for (const path of paths) {
        let current = data;
        let found = true;
        
        for (const key of path) {
            if (current && typeof current === 'object' && key in current) {
                current = current[key];
            } else {
                found = false;
                break;
            }
        }
        
        if (found && current && typeof current === 'object') {
            // Check if this looks like user data
            if (current.id || current.uniqueId || current.nickname) {
                return current;
            }
        }
    }
    
    // Deep search for user-like objects
    return deepSearchUserData(data);
}

/**
 * Deep search for user data structure
 */
function deepSearchUserData(obj, depth = 0) {
    if (depth > 5) return null; // Prevent infinite recursion
    
    if (typeof obj !== 'object' || obj === null) return null;
    
    // Check if current object looks like user data
    if (obj.uniqueId || (obj.id && obj.nickname)) {
        return obj;
    }
    
    // Recursively search
    for (const key in obj) {
        if (obj.hasOwnProperty(key)) {
            const result = deepSearchUserData(obj[key], depth + 1);
            if (result) return result;
        }
    }
    
    return null;
}

/**
 * Compare two user profiles and detect changes
 */
function detectChanges(oldProfile, newProfile) {
    const changes = [];
    const fields = [
        'handle',
        'id',
        'uniqueId',
        'nickname',
        'signature',
        'bio',
        'profilePictureUrl',
        'verified',
        'secret',
        'privateAccount',
        'language',
        'region',
        'secUid',
        'followerCount',
        'followingCount',
        'videoCount',
        'heartCount',
        'diggCount',
        'friendCount',
        'creationDate',
        'uniqueIdModifyTime',
        'nickNameModifyTime'
    ];
    
    for (const field of fields) {
        // Skip if field doesn't exist in either profile
        if (oldProfile[field] === undefined && newProfile[field] === undefined) {
            continue;
        }
        
        const oldVal = oldProfile[field] !== undefined ? oldProfile[field] : null;
        const newVal = newProfile[field] !== undefined ? newProfile[field] : null;
        
        // Compare values (handle null/undefined)
        if (String(oldVal || '') !== String(newVal || '')) {
            changes.push({
                field,
                oldValue: oldVal,
                newValue: newVal
            });
        }
    }
    
    return changes;
}

/**
 * Store account history change
 */
async function storeAccountHistory(handle, changes, source = 'sync') {
    const historyFile = `account_history/${handle}.json`;
    let history = [];
    
    try {
        const historyData = await read(historyFile);
        // Ensure it's an array
        if (Array.isArray(historyData)) {
            history = historyData;
        } else if (historyData && typeof historyData === 'object') {
            // If it's an object (not array), start fresh
            history = [];
        } else {
            history = [];
        }
    } catch (error) {
        // File doesn't exist yet, start with empty array
        history = [];
    }
    
    // Ensure history is an array before pushing
    if (!Array.isArray(history)) {
        history = [];
    }
    
    for (const change of changes) {
        history.push({
            id: uuidv4(),
            handle: handle, // Include handle for database storage
            timestamp: new Date().toISOString(),
            field: change.field,
            oldValue: String(change.oldValue || ''),
            newValue: String(change.newValue || ''),
            source
        });
    }
    
    await write(historyFile, history);
}

/**
 * Fetch user videos and extract activity patterns
 * Returns frequency analysis by day of week and hour of day
 */
async function fetchUserActivity(handle) {
    try {
        const cleanHandle = handle.replace('@', '');
        const url = `https://www.tiktok.com/@${cleanHandle}`;
        
        console.log(`[Activity] Fetching activity for @${cleanHandle}...`);
        const html = await fetchPage(url);
        console.log(`[Activity] HTML length: ${html.length} characters`);
        
        const videos = parseVideosFromHTML(html);
        console.log(`[Activity] Parsed ${videos.length} videos from HTML`);
        
        if (!videos || videos.length === 0) {
            console.warn(`[Activity] No videos found for @${cleanHandle}`);
            // Try alternative extraction methods
            const alternativeVideos = tryAlternativeExtraction(html);
            if (alternativeVideos.length > 0) {
                console.log(`[Activity] Alternative extraction found ${alternativeVideos.length} videos`);
                return analyzeActivity(alternativeVideos);
            }
            
            return {
                totalVideos: 0,
                videos: [],
                frequency: {
                    byDay: {},
                    byHour: {},
                    patterns: {
                        mostActiveDay: null,
                        mostActiveHour: null,
                        averagePerDay: 0,
                        averagePerHour: 0
                    }
                }
            };
        }
        
        return analyzeActivity(videos);
    } catch (error) {
        console.error('Error fetching user activity:', error);
        throw new Error(`Failed to fetch activity for @${handle}: ${error.message}`);
    }
}

/**
 * Analyze activity frequency from videos array
 */
function analyzeActivity(videos) {
    // Analyze frequency
    const byDay = {};
    const byHour = {};
    
    videos.forEach(video => {
        if (video.createTime) {
            const date = new Date(video.createTime * 1000);
            const dayOfWeek = date.toLocaleDateString('en-US', { weekday: 'long' });
            const hour = date.getHours();
            
            byDay[dayOfWeek] = (byDay[dayOfWeek] || 0) + 1;
            byHour[hour] = (byHour[hour] || 0) + 1;
        }
    });
    
    // Calculate patterns
    const mostActiveDay = Object.keys(byDay).length > 0 
        ? Object.keys(byDay).reduce((a, b) => byDay[a] > byDay[b] ? a : b) 
        : null;
    const mostActiveHour = Object.keys(byHour).length > 0
        ? Object.keys(byHour).reduce((a, b) => byHour[a] > byHour[b] ? a : b)
        : null;
    const averagePerDay = videos.length / 7;
    const averagePerHour = videos.length / 24;
    
    return {
        totalVideos: videos.length,
        videos: videos.slice(0, 100), // Limit display to first 100, but use all for analysis
        frequency: {
            byDay,
            byHour,
            patterns: {
                mostActiveDay,
                mostActiveHour: mostActiveHour ? parseInt(mostActiveHour) : null,
                averagePerDay: Math.round(averagePerDay * 100) / 100,
                averagePerHour: Math.round(averagePerHour * 100) / 100
            }
        }
    };
}

/**
 * Try alternative extraction methods when standard methods fail
 */
function tryAlternativeExtraction(html) {
    const videos = [];
    const seenIds = new Set();
    
    console.log('[Activity] Trying alternative extraction methods...');
    
    // Method: Look for any numeric ID followed by createTime in close proximity
    // This catches videos even if they're in different structures
    const proximityPattern = /"id":"(\d{15,})"[^}]{0,2000}?"createTime":(\d{10,})/gs;
    let match;
    while ((match = proximityPattern.exec(html)) !== null) {
        const id = match[1];
        const createTime = parseInt(match[2]);
        if (id && createTime && createTime > 946684800 && createTime < 4102444800 && !seenIds.has(id)) {
            seenIds.add(id);
            videos.push({ id, createTime });
        }
    }
    
    // Method: Look for createTime followed by id
    const reversePattern = /"createTime":(\d{10,})[^}]{0,2000}?"id":"(\d{15,})"/gs;
    while ((match = reversePattern.exec(html)) !== null) {
        const createTime = parseInt(match[1]);
        const id = match[2];
        if (id && createTime && createTime > 946684800 && createTime < 4102444800 && !seenIds.has(id)) {
            seenIds.add(id);
            videos.push({ id, createTime });
        }
    }
    
    // Method: Extract from any JSON-like structure with video data
    // Look for patterns like: "videoId":"123","publishTime":1234567890
    const videoIdPatterns = [
        /"videoId":"(\d{15,})"[^}]{0,2000}?"publishTime":(\d{10,})/g,
        /"awemeId":"(\d{15,})"[^}]{0,2000}?"createTime":(\d{10,})/g,
        /"itemId":"(\d{15,})"[^}]{0,2000}?"createTime":(\d{10,})/g
    ];
    
    for (const pattern of videoIdPatterns) {
        while ((match = pattern.exec(html)) !== null) {
            const id = match[1];
            const createTime = parseInt(match[2]);
            if (id && createTime && createTime > 946684800 && createTime < 4102444800 && !seenIds.has(id)) {
                seenIds.add(id);
                videos.push({ id, createTime });
            }
        }
    }
    
    console.log(`[Activity] Alternative extraction found ${videos.length} videos`);
    return videos;
}

/**
 * Parse videos from TikTok HTML page
 */
function parseVideosFromHTML(html) {
    try {
        const videos = [];
        const seenIds = new Set();
        
        // Method 1: Try to extract from JSON script tags (most reliable)
        const scriptMatch = html.match(/<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application\/json">(.*?)<\/script>/s);
        if (scriptMatch && scriptMatch[1]) {
            try {
                const data = JSON.parse(scriptMatch[1]);
                const extractedVideos = extractVideosFromData(data);
                if (extractedVideos && extractedVideos.length > 0) {
                    // Add all extracted videos
                    for (const video of extractedVideos) {
                        if (video.id && video.createTime && !seenIds.has(video.id)) {
                            seenIds.add(video.id);
                            videos.push(video);
                        }
                    }
                }
            } catch (e) {
                console.warn('[Activity] Failed to parse JSON script tag:', e.message);
            }
        }
        
        // Method 2: Extract all video objects from HTML using regex patterns
        // Look for video objects in various formats - be more flexible with spacing
        const videoPatterns = [
            // Pattern 1: {"id":"123","createTime":1234567890} (exact match)
            /\{"id"\s*:\s*"(\d{10,})"\s*,\s*"createTime"\s*:\s*(\d{10,})/g,
            // Pattern 2: "id":"123","createTime":1234567890 (without outer braces)
            /"id"\s*:\s*"(\d{10,})"\s*,\s*"createTime"\s*:\s*(\d{10,})/g,
            // Pattern 3: With any characters between (more flexible)
            /"id"\s*:\s*"(\d{10,})"[^}]{0,500}?"createTime"\s*:\s*(\d{10,})/g,
            // Pattern 4: Reverse order
            /"createTime"\s*:\s*(\d{10,})[^}]{0,500}?"id"\s*:\s*"(\d{10,})"/g,
            // Pattern 5: Single quotes
            /'id'\s*:\s*'(\d{10,})'\s*,\s*'createTime'\s*:\s*'(\d{10,})'/g
        ];
        
        for (const pattern of videoPatterns) {
            const matches = html.matchAll(pattern);
            for (const match of matches) {
                const id = match[1] || match[2];
                const createTime = parseInt(match[2] || match[1]);
                
                // Validate: createTime should be a reasonable Unix timestamp (after 2000, before 2100)
                // ID should be at least 10 digits (TikTok video IDs are long)
                if (id && id.length >= 10 && createTime && createTime > 946684800 && createTime < 4102444800 && !seenIds.has(id)) {
                    seenIds.add(id);
                    videos.push({
                        id: id,
                        createTime: createTime
                    });
                }
            }
        }
        
        console.log(`[Activity] After regex patterns: ${videos.length} videos found`);
        
        // Method 3: Extract from itemList array structure
        // Look for itemList arrays with multiple videos - use non-greedy matching
        // NOTE: All patterns must have 'g' flag for matchAll()
        const itemListPatterns = [
            /"itemList"\s*:\s*\[(.*?)\]/gs,
            /itemList\s*:\s*\[(.*?)\]/gs,
            /"videoList"\s*:\s*\[(.*?)\]/gs,
            /"items"\s*:\s*\[(.*?)\]/gs
        ];
        
        for (const pattern of itemListPatterns) {
            const matches = html.matchAll(pattern);
            for (const match of matches) {
                const itemListContent = match[1];
                if (itemListContent && itemListContent.length > 10) {
                    // Extract all video objects from the array - be flexible with format
                    const videoPatterns = [
                        /\{"id"\s*:\s*"(\d{10,})"\s*,\s*"createTime"\s*:\s*(\d{10,})/g,
                        /"id"\s*:\s*"(\d{10,})"[^}]{0,500}?"createTime"\s*:\s*(\d{10,})/g
                    ];
                    
                    for (const videoPattern of videoPatterns) {
                        const videoMatches = itemListContent.matchAll(videoPattern);
                        for (const videoMatch of videoMatches) {
                            const id = videoMatch[1];
                            const createTime = parseInt(videoMatch[2]);
                            if (id && id.length >= 10 && createTime && createTime > 946684800 && createTime < 4102444800 && !seenIds.has(id)) {
                                seenIds.add(id);
                                videos.push({
                                    id: id,
                                    createTime: createTime
                                });
                            }
                        }
                    }
                }
            }
        }
        
        console.log(`[Activity] After itemList extraction: ${videos.length} videos found`);
        
        // Method 4: Deep search in all JSON structures
        const allJsonMatches = html.matchAll(/<script[^>]*type="application\/json"[^>]*>(.*?)<\/script>/gs);
        for (const jsonMatch of allJsonMatches) {
            try {
                const jsonContent = jsonMatch[1];
                if (jsonContent && jsonContent.length > 100) { // Only process substantial JSON
                    const data = JSON.parse(jsonContent);
                    const extractedVideos = extractVideosFromData(data);
                    if (extractedVideos && extractedVideos.length > 0) {
                        for (const video of extractedVideos) {
                            if (video.id && video.createTime && !seenIds.has(video.id)) {
                                seenIds.add(video.id);
                                videos.push(video);
                            }
                        }
                    }
                }
            } catch (e) {
                // Continue searching - JSON might be too large or malformed
            }
        }
        
        console.log(`[Activity] After deep JSON search: ${videos.length} videos found`);
        
        // Remove duplicates and sort by createTime (newest first)
        const uniqueVideos = [];
        const finalSeenIds = new Set();
        
        for (const video of videos) {
            if (video.id && video.createTime && !finalSeenIds.has(video.id)) {
                finalSeenIds.add(video.id);
                uniqueVideos.push(video);
            }
        }
        
        const sorted = uniqueVideos.sort((a, b) => b.createTime - a.createTime);
        console.log(`[Activity] Extracted ${sorted.length} unique videos from HTML`);
        
        // If we got very few videos, try a more aggressive extraction
        if (sorted.length < 10) {
            console.log(`[Activity] Low video count (${sorted.length}), trying aggressive extraction...`);
            const aggressiveVideos = aggressiveVideoExtraction(html);
            console.log(`[Activity] Aggressive extraction found ${aggressiveVideos.length} additional videos`);
            for (const video of aggressiveVideos) {
                if (video.id && video.createTime && !finalSeenIds.has(video.id)) {
                    finalSeenIds.add(video.id);
                    sorted.push(video);
                }
            }
            sorted.sort((a, b) => b.createTime - a.createTime);
            console.log(`[Activity] After aggressive extraction: ${sorted.length} total videos`);
        }
        
        return sorted;
    } catch (error) {
        console.error('Error parsing videos from HTML:', error);
        return [];
    }
}

/**
 * Aggressive video extraction using multiple regex patterns
 */
function aggressiveVideoExtraction(html) {
    const videos = [];
    const seenIds = new Set();
    
    // Try to find all video-like objects with createTime
    // Pattern: any object with id and createTime fields
    // NOTE: All patterns must have 'g' flag for matchAll()
    const patterns = [
        // Standard format: {"id":"123","createTime":1234567890}
        /\{"id"\s*:\s*"(\d{10,})"\s*,\s*"createTime"\s*:\s*(\d{10,})/g,
        // With more fields between
        /"id"\s*:\s*"(\d{10,})"[^}]{0,500}?"createTime"\s*:\s*(\d{10,})/g,
        // Reverse order
        /"createTime"\s*:\s*(\d{10,})[^}]{0,500}?"id"\s*:\s*"(\d{10,})"/g,
        // In arrays
        /\[[^\]]*?"id"\s*:\s*"(\d{10,})"[^\]]*?"createTime"\s*:\s*(\d{10,})[^\]]*?\]/g
    ];
    
    console.log('[Activity] Starting aggressive extraction...');
    
    for (let i = 0; i < patterns.length; i++) {
        const pattern = patterns[i];
        let count = 0;
        const matches = html.matchAll(pattern);
        for (const match of matches) {
            const id = match[1] || match[2];
            const createTime = parseInt(match[2] || match[1]);
            
            if (id && id.length >= 10 && createTime && createTime > 946684800 && createTime < 4102444800 && !seenIds.has(id)) {
                seenIds.add(id);
                videos.push({
                    id: String(id),
                    createTime: createTime
                });
                count++;
            }
        }
        if (count > 0) {
            console.log(`[Activity] Aggressive pattern ${i + 1} found ${count} videos`);
        }
    }
    
    console.log(`[Activity] Aggressive extraction total: ${videos.length} unique videos`);
    return videos;
}

/**
 * Extract videos from TikTok's nested data structure
 * Recursively searches for video arrays in the data structure
 */
function extractVideosFromData(data, depth = 0, maxDepth = 10) {
    const videos = [];
    
    if (depth > maxDepth || !data || typeof data !== 'object') {
        return videos;
    }
    
    // Try different possible paths first
    const paths = [
        ['defaultScope', 'webapp.user-detail', 'userInfo', 'user', 'itemList'],
        ['__DEFAULT_SCOPE__', 'webapp.user-detail', 'userInfo', 'user', 'itemList'],
        ['props', 'pageProps', 'userInfo', 'itemList'],
        ['defaultScope', 'webapp.user-detail', 'userInfo', 'user', 'videoList'],
        ['__DEFAULT_SCOPE__', 'webapp.user-detail', 'userInfo', 'user', 'videoList'],
        ['itemList'],
        ['videoList'],
        ['videos'],
        ['items']
    ];
    
    for (const path of paths) {
        let current = data;
        let found = true;
        
        for (const key of path) {
            if (current && typeof current === 'object' && key in current) {
                current = current[key];
            } else {
                found = false;
                break;
            }
        }
        
        if (found && Array.isArray(current)) {
            for (const item of current) {
                if (item && typeof item === 'object') {
                    // Try to extract id and createTime from various possible field names
                    const id = item.id || item.videoId || item.awemeId || item.itemId;
                    const createTime = item.createTime || item.create_time || item.timestamp || item.publishTime;
                    
                    if (id && createTime) {
                        const time = typeof createTime === 'string' ? parseInt(createTime) : createTime;
                        // Validate timestamp
                        if (time > 946684800 && time < 4102444800) {
                            videos.push({
                                id: String(id),
                                createTime: time
                            });
                        }
                    }
                }
            }
            if (videos.length > 0) {
                return videos;
            }
        }
    }
    
    // Deep recursive search for arrays that might contain video objects
    if (Array.isArray(data)) {
        for (const item of data) {
            if (item && typeof item === 'object') {
                // Check if this item looks like a video
                const id = item.id || item.videoId || item.awemeId;
                const createTime = item.createTime || item.create_time || item.timestamp;
                
                if (id && createTime) {
                    const time = typeof createTime === 'string' ? parseInt(createTime) : createTime;
                    if (time > 946684800 && time < 4102444800) {
                        videos.push({
                            id: String(id),
                            createTime: time
                        });
                    }
                }
                
                // Recursively search nested objects
                const nested = extractVideosFromData(item, depth + 1, maxDepth);
                videos.push(...nested);
            }
        }
    } else if (typeof data === 'object' && data !== null) {
        // Recursively search object properties
        for (const key in data) {
            if (data.hasOwnProperty(key) && depth < maxDepth) {
                const nested = extractVideosFromData(data[key], depth + 1, maxDepth);
                videos.push(...nested);
            }
        }
    }
    
    return videos;
}

module.exports = {
    fetchUserProfile,
    fetchUserActivity,
    detectChanges,
    storeAccountHistory
};
