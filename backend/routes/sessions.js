const express = require('express');
const router = express.Router();
const { requireAuth } = require('../utils/auth');
const { query } = require('../config/database');

// All routes require authentication
router.use(requireAuth);

const SESSION_VALID_DAYS = 30;

/**
 * GET /api/sessions
 * Return current session status (no raw sessionId exposed)
 */
router.get('/', async (req, res) => {
    try {
        const result = await query(
            'SELECT session_id, valid_until, updated_at FROM tiktok_session WHERE id = 1'
        );
        
        const row = result.rows[0];
        const hasSession = !!(row && row.session_id);
        const validUntil = row?.valid_until ? new Date(row.valid_until) : null;
        const updatedAt = row?.updated_at ? new Date(row.updated_at) : null;
        const isValid = hasSession && validUntil && validUntil > new Date();
        
        res.json({
            hasSession,
            validUntil: validUntil ? validUntil.toISOString() : null,
            updatedAt: updatedAt ? updatedAt.toISOString() : null,
            isValid
        });
    } catch (error) {
        console.error('Get session status error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * POST /api/sessions/import
 * Accept JSON array of cookies (EditThisCookie, Cookie-Editor format), extract sessionid and tt-target-idc
 */
router.post('/import', async (req, res) => {
    try {
        let cookies = req.body;
        if (!Array.isArray(cookies)) {
            if (cookies && Array.isArray(cookies.cookies)) {
                cookies = cookies.cookies;
            } else {
                return res.status(400).json({ error: 'JSON invalid or missing sessionid cookie' });
            }
        }

        const sessionCookie = cookies.find(c => c && (c.name === 'sessionid' || c.name === 'sessionid_ss'));
        if (!sessionCookie || !sessionCookie.value) {
            return res.status(400).json({ error: 'JSON invalid or missing sessionid cookie' });
        }

        const sessionId = sessionCookie.value;
        const ttCookie = cookies.find(c => c && c.name === 'tt-target-idc');
        const ttTargetIdc = ttCookie && ttCookie.value ? ttCookie.value : null;

        let validUntil;
        if (sessionCookie.expirationDate && typeof sessionCookie.expirationDate === 'number') {
            validUntil = new Date(sessionCookie.expirationDate * 1000);
        } else {
            validUntil = new Date();
            validUntil.setDate(validUntil.getDate() + SESSION_VALID_DAYS);
        }

        await query(
            `INSERT INTO tiktok_session (id, session_id, tt_target_idc, valid_until, updated_at)
             VALUES (1, $1, $2, $3, NOW())
             ON CONFLICT (id) DO UPDATE SET
                session_id = EXCLUDED.session_id,
                tt_target_idc = EXCLUDED.tt_target_idc,
                valid_until = EXCLUDED.valid_until,
                updated_at = EXCLUDED.updated_at`,
            [sessionId, ttTargetIdc, validUntil.toISOString()]
        );

        res.json({
            success: true,
            validUntil: validUntil.toISOString(),
            message: 'Session imported successfully.'
        });
    } catch (error) {
        console.error('Session import error:', error);
        res.status(500).json({
            error: error.message || 'Failed to import session.'
        });
    }
});

module.exports = router;
