const express = require('express');
const router = express.Router();
const { authenticateUser } = require('../utils/auth');
const { findBy } = require('../storage/dbStorage');

/**
 * POST /api/auth/login
 * Authenticate user and create session
 */
router.post('/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        
        if (!username || !password) {
            return res.status(400).json({ error: 'Username and password are required' });
        }
        
        const user = await authenticateUser(username, password);
        if (!user) {
            return res.status(401).json({ error: 'Invalid username or password' });
        }
        
        req.session.userId = user.id;
        req.session.username = user.username;
        
        // Get the original URL to redirect back to, or default to dashboard
        const returnTo = req.session.returnTo || '/dashboard';
        delete req.session.returnTo; // Clear it after use
        
        res.json({
            message: 'Login successful',
            user: {
                id: user.id,
                username: user.username
            },
            redirect: returnTo
        });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * POST /api/auth/logout
 * Destroy session
 */
router.post('/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            return res.status(500).json({ error: 'Failed to logout' });
        }
        res.clearCookie('connect.sid');
        res.json({ message: 'Logout successful' });
    });
});

/**
 * GET /api/auth/me
 * Get current user info
 */
router.get('/me', async (req, res) => {
    try {
        if (!req.session.userId) {
            return res.status(401).json({ error: 'Not authenticated' });
        }
        
        const user = await findBy('users.json', 'id', req.session.userId);
        if (!user) {
            req.session.destroy();
            return res.status(401).json({ error: 'User not found' });
        }
        
        // Return user without password
        const { password, ...userWithoutPassword } = user;
        res.json(userWithoutPassword);
    } catch (error) {
        console.error('Get me error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
