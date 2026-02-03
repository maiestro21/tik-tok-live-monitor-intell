const bcrypt = require('bcrypt');
const { v4: uuidv4 } = require('uuid');
const { findBy, append, read } = require('../storage/dbStorage');

/**
 * Hash a password
 */
async function hashPassword(password) {
    const saltRounds = 10;
    return await bcrypt.hash(password, saltRounds);
}

/**
 * Compare password with hash
 */
async function comparePassword(password, hash) {
    return await bcrypt.compare(password, hash);
}

/**
 * Authenticate user
 */
async function authenticateUser(username, password) {
    const user = await findBy('users.json', 'username', username);
    
    if (!user) {
        return null;
    }
    
    const isValid = await comparePassword(password, user.password);
    if (!isValid) {
        return null;
    }
    
    // Return user without password
    const { password: _, ...userWithoutPassword } = user;
    return userWithoutPassword;
}

/**
 * Create new user
 */
async function createUser(username, password) {
    // Check if user exists
    const existing = await findBy('users.json', 'username', username);
    if (existing) {
        throw new Error('Username already exists');
    }
    
    const hashedPassword = await hashPassword(password);
    const user = {
        id: uuidv4(),
        username,
        password: hashedPassword,
        createdAt: new Date().toISOString()
    };
    
    await append('users.json', user);
    
    // Return user without password
    const { password: _, ...userWithoutPassword } = user;
    return userWithoutPassword;
}

/**
 * Middleware to check authentication
 * Redirects to login for view routes, returns 401 for API routes
 */
function requireAuth(req, res, next) {
    if (req.session && req.session.userId) {
        next();
    } else {
        // Check if this is an API request or view request
        const isApiRequest = req.path.startsWith('/api') || req.headers.accept?.includes('application/json');
        
        if (isApiRequest) {
            // API request - return 401 JSON
            res.status(401).json({ error: 'Authentication required' });
        } else {
            // View request - redirect to login
            // Store the original URL to redirect back after login
            req.session.returnTo = req.originalUrl || req.url;
            res.redirect('/login');
        }
    }
}

module.exports = {
    hashPassword,
    comparePassword,
    authenticateUser,
    createUser,
    requireAuth
};
