const express = require('express');
const router = express.Router();
const { requireAuth } = require('../utils/auth');
const { fetchUserProfile, fetchUserActivity } = require('../services/tikTokMetaService');

// All routes require authentication
router.use(requireAuth);

/**
 * POST /api/osint/search
 * Search for TikTok user information
 */
router.post('/search', async (req, res) => {
    try {
        const { handle } = req.body;
        
        if (!handle || !handle.trim()) {
            return res.status(400).json({ error: 'Handle is required' });
        }
        
        // Clean handle (remove @ if present)
        const cleanHandle = handle.trim().replace('@', '');
        
        if (!cleanHandle) {
            return res.status(400).json({ error: 'Invalid handle' });
        }
        
        console.log(`[OSINT] Searching for user: @${cleanHandle}`);
        
        // Fetch user profile and activity in parallel
        const [userData, activityData] = await Promise.all([
            fetchUserProfile(cleanHandle).catch(err => {
                console.warn(`[OSINT] Failed to fetch profile: ${err.message}`);
                return null;
            }),
            fetchUserActivity(cleanHandle).catch(err => {
                console.warn(`[OSINT] Failed to fetch activity: ${err.message}`);
                return null;
            })
        ]);
        
        if (!userData) {
            return res.status(404).json({ 
                error: 'User not found or profile is private',
                details: 'Could not fetch user profile data'
            });
        }
        
        // Format response with all available information
        const osintData = {
            handle: userData.handle,
            uniqueId: userData.uniqueId,
            // Basic Information
            basic: {
                id: userData.id,
                nickname: userData.nickname,
                signature: userData.signature || userData.bio || '',
                profilePictureUrl: userData.profilePictureUrl || '',
            },
            // Account Status
            status: {
                verified: userData.verified || false,
                secret: userData.secret || false,
                privateAccount: userData.privateAccount || false,
            },
            // Location & Language
            location: {
                language: userData.language || null,
                region: userData.region || null,
            },
            // Account Identifiers
            identifiers: {
                secUid: userData.secUid || null,
                userId: userData.id || null,
            },
            // Statistics
            statistics: {
                followerCount: userData.followerCount || 0,
                followingCount: userData.followingCount || 0,
                videoCount: userData.videoCount || 0,
                heartCount: userData.heartCount || 0,
                diggCount: userData.diggCount || 0,
                friendCount: userData.friendCount || 0,
            },
            // Timestamps
            timestamps: {
                creationDate: userData.creationDate || null,
                createTime: userData.createTime || null,
                uniqueIdModifyTime: userData.uniqueIdModifyTime || null,
                uniqueIdModifyTimeUnix: userData.uniqueIdModifyTimeUnix || null,
                nickNameModifyTime: userData.nickNameModifyTime || null,
                nickNameModifyTimeUnix: userData.nickNameModifyTimeUnix || null,
            },
            // Activity Analysis
            activity: activityData || {
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
            },
            // Metadata
            metadata: {
                searchedAt: new Date().toISOString(),
                source: 'TikTok Web Scraping'
            }
        };
        
        console.log(`[OSINT] Successfully retrieved data for @${cleanHandle}`);
        if (activityData) {
            console.log(`[OSINT] Activity: ${activityData.totalVideos} videos analyzed`);
        }
        
        res.json(osintData);
    } catch (error) {
        console.error('[OSINT] Error searching user:', error);
        res.status(500).json({ 
            error: error.message || 'Failed to fetch user information',
            details: error.message
        });
    }
});

module.exports = router;
