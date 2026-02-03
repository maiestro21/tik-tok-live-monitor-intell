const express = require('express');
const router = express.Router();
const { requireAuth, hashPassword, createUser } = require('../utils/auth');
const { read, update, deleteById, findBy } = require('../storage/dbStorage');

// All routes require authentication
router.use(requireAuth);

/**
 * GET /api/users
 * List all users
 */
router.get('/', async (req, res) => {
    try {
        const users = await read('users.json');
        // Remove passwords from response
        const usersWithoutPasswords = users.map(({ password, ...user }) => user);
        res.json(usersWithoutPasswords);
    } catch (error) {
        console.error('List users error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * POST /api/users
 * Create new user
 */
router.post('/', async (req, res) => {
    try {
        const { username, password } = req.body;
        
        if (!username || !password) {
            return res.status(400).json({ error: 'Username and password are required' });
        }
        
        const user = await createUser(username, password);
        res.status(201).json(user);
    } catch (error) {
        if (error.message === 'Username already exists') {
            return res.status(409).json({ error: error.message });
        }
        console.error('Create user error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * PUT /api/users/:id
 * Update user
 */
router.put('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { username } = req.body;
        
        const user = await findBy('users.json', 'id', id);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        
        // Check if username is taken by another user
        if (username && username !== user.username) {
            const existing = await findBy('users.json', 'username', username);
            if (existing) {
                return res.status(409).json({ error: 'Username already exists' });
            }
        }
        
        const updates = {};
        if (username) updates.username = username;
        updates.updatedAt = new Date().toISOString();
        
        await update('users.json', id, updates);
        
        const updated = await findBy('users.json', 'id', id);
        const { password, ...userWithoutPassword } = updated;
        res.json(userWithoutPassword);
    } catch (error) {
        console.error('Update user error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * DELETE /api/users/:id
 * Delete user
 */
router.delete('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        
        const user = await findBy('users.json', 'id', id);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        
        // Prevent deleting yourself
        if (id === req.session.userId) {
            return res.status(400).json({ error: 'Cannot delete your own account' });
        }
        
        await deleteById('users.json', id);
        res.json({ message: 'User deleted successfully' });
    } catch (error) {
        console.error('Delete user error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * PUT /api/users/:id/password
 * Update user password
 */
router.put('/:id/password', async (req, res) => {
    try {
        const { id } = req.params;
        const { password } = req.body;
        
        if (!password) {
            return res.status(400).json({ error: 'Password is required' });
        }
        
        const user = await findBy('users.json', 'id', id);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        
        const hashedPassword = await hashPassword(password);
        await update('users.json', id, {
            password: hashedPassword,
            updatedAt: new Date().toISOString()
        });
        
        res.json({ message: 'Password updated successfully' });
    } catch (error) {
        console.error('Update password error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
