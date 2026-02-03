const express = require('express');
const router = express.Router();
const { requireAuth } = require('../utils/auth');

/**
 * GET /
 * Root route - redirect to dashboard if authenticated, otherwise login
 */
router.get('/', (req, res) => {
    if (req.session.userId) {
        return res.redirect('/dashboard');
    } else {
        return res.redirect('/login');
    }
});

/**
 * GET /login
 * Login page
 */
router.get('/login', (req, res) => {
    // If already logged in, redirect to dashboard or returnTo URL
    if (req.session.userId) {
        const returnTo = req.session.returnTo || '/dashboard';
        delete req.session.returnTo;
        return res.redirect(returnTo);
    }
    res.render('login', { title: 'Login - T-intell' });
});

/**
 * GET /dashboard
 * Dashboard page (protected)
 */
router.get('/dashboard', requireAuth, async (req, res) => {
    try {
        res.render('dashboard', { 
            title: 'Dashboard - T-intell',
            currentPage: 'dashboard',
            user: {
                id: req.session.userId,
                username: req.session.username
            }
        });
    } catch (error) {
        console.error('Dashboard error:', error);
        res.status(500).render('error', { error: 'Internal server error' });
    }
});

/**
 * GET /tikusers
 * T-Users page (protected)
 */
router.get('/tikusers', requireAuth, (req, res) => {
    res.render('tikusers', { 
        title: 'T-Users - T-intell',
        currentPage: 'tikusers',
        user: {
            id: req.session.userId,
            username: req.session.username
        }
    });
});

/**
 * GET /live-view
 * Live View page (protected) - Shows currently active live sessions
 */
router.get('/live-view', requireAuth, (req, res) => {
    res.render('live-view', { 
        title: 'Live View - T-intell',
        currentPage: 'live-view',
        user: {
            id: req.session.userId,
            username: req.session.username
        }
    });
});

/**
 * GET /session-view
 * Unified session view page (protected) - Works for both live and history
 */
router.get('/session-view', requireAuth, (req, res) => {
    res.render('session-view', { 
        title: 'Session View - T-intell',
        currentPage: 'session-view',
        user: {
            id: req.session.userId,
            username: req.session.username
        }
    });
});

/**
 * GET /alerts
 * Alerts page (protected)
 */
router.get('/alerts', requireAuth, (req, res) => {
    res.render('alerts', { 
        title: 'Alerts - T-intell',
        currentPage: 'alerts',
        user: {
            id: req.session.userId,
            username: req.session.username
        }
    });
});

/**
 * GET /alerts-rules
 * Alert Rules page (protected) - Manage trigger words
 */
router.get('/alerts-rules', requireAuth, (req, res) => {
    res.render('alerts-rules', { 
        title: 'Alert Rules - T-intell',
        currentPage: 'alerts-rules',
        user: {
            id: req.session.userId,
            username: req.session.username
        }
    });
});

/**
 * GET /history
 * History page (protected)
 */
router.get('/history', requireAuth, (req, res) => {
    res.render('history', { 
        title: 'History - T-intell',
        currentPage: 'history',
        user: {
            id: req.session.userId,
            username: req.session.username
        }
    });
});

/**
 * GET /users
 * User Management page (protected)
 */
router.get('/users', requireAuth, (req, res) => {
    res.render('users', { 
        title: 'User Management - T-intell',
        currentPage: 'users',
        user: {
            id: req.session.userId,
            username: req.session.username
        }
    });
});

/**
 * GET /logs
 * Console Logs page (protected)
 */
router.get('/logs', requireAuth, (req, res) => {
    res.render('logs', { 
        title: 'Console Logs - T-intell',
        currentPage: 'logs',
        user: {
            id: req.session.userId,
            username: req.session.username
        }
    });
});

/**
 * GET /anti-blocking
 * Anti-Blocking Settings page (protected)
 */
router.get('/anti-blocking', requireAuth, (req, res) => {
    res.render('anti-blocking', { 
        title: 'Anti-Blocking Settings - T-intell',
        currentPage: 'anti-blocking',
        user: {
            id: req.session.userId,
            username: req.session.username
        }
    });
});

/**
 * GET /osint
 * OSINT page (protected) - TikTok user intelligence gathering
 */
router.get('/osint', requireAuth, (req, res) => {
    res.render('osint', { 
        title: 'OSINT - T-intell',
        currentPage: 'osint',
        user: {
            id: req.session.userId,
            username: req.session.username
        }
    });
});

/**
 * GET /search-all
 * Search All page (protected) - Business intelligence and chat analysis
 */
router.get('/search-all', requireAuth, (req, res) => {
    res.render('search-all', { 
        title: 'Search All - T-intell',
        currentPage: 'search-all',
        user: {
            id: req.session.userId,
            username: req.session.username
        }
    });
});

module.exports = router;
