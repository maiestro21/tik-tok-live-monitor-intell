const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const path = require('path');
const pollerService = require('./services/pollerService');
const liveConnectorService = require('./services/liveConnectorService');
const logService = require('./services/logService');
const blockTrackerService = require('./services/blockTrackerService');

const app = express();
const httpServer = createServer(app);

// Socket.IO setup
const io = new Server(httpServer, {
    cors: {
        origin: '*',
        methods: ['GET', 'POST'],
        credentials: true
    }
});

// Middleware
app.use(cors({
    origin: true, // Allow all origins in development
    credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(session({
    secret: 't-intell-secret-key-change-in-production',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false, httpOnly: true, maxAge: 24 * 60 * 60 * 1000 } // 24 hours
}));

// Make io available to routes and services
app.set('io', io);

// Set EJS as templating engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '../views'));

// Serve static files (JS, images)
app.use('/js', express.static(path.join(__dirname, '../public/js')));

// API Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/users', require('./routes/users'));
app.use('/api/tikusers', require('./routes/tikusers'));
app.use('/api/monitor', require('./routes/monitor'));
app.use('/api/live', require('./routes/live'));
app.use('/api/alerts', require('./routes/alerts'));
app.use('/api/logs', require('./routes/logs'));
app.use('/api/blocks', require('./routes/blocks'));
app.use('/api/anti-blocking', require('./routes/anti-blocking'));
app.use('/api/osint', require('./routes/osint'));
app.use('/api/search-all', require('./routes/search-all'));
app.use('/api/user-activity', require('./routes/user-activity'));
app.use('/api/sessions', require('./routes/sessions'));

// View Routes
app.use('/', require('./routes/views'));

// Start poller service (after io is set up)
pollerService.setIo(io);

// Store original console methods before override (will be set after logService initialization)
let originalConsoleLog, originalConsoleError, originalConsoleWarn, originalConsoleInfo;

// Verify and cleanup sessions before starting
async function initialize() {
    try {
        // Store original console methods
        originalConsoleLog = console.log.bind(console);
        originalConsoleError = console.error.bind(console);
        originalConsoleWarn = console.warn.bind(console);
        originalConsoleInfo = console.info.bind(console);
        
        // Initialize log service first
        await logService.initialize();
        
        // Override console methods to capture logs (after logService is initialized)
        let isLogging = false; // Flag to prevent infinite loops
        
        console.log = function(...args) {
            originalConsoleLog.apply(console, args);
            if (!isLogging) {
                isLogging = true;
                const message = args.map(arg => typeof arg === 'object' ? JSON.stringify(arg) : String(arg)).join(' ');
                logService.info(message, { args }).catch(() => {}).finally(() => { isLogging = false; });
            }
        };

        console.error = function(...args) {
            originalConsoleError.apply(console, args);
            if (!isLogging) {
                isLogging = true;
                const message = args.map(arg => typeof arg === 'object' ? JSON.stringify(arg) : String(arg)).join(' ');
                logService.error(message, { args }).catch(() => {}).finally(() => { isLogging = false; });
            }
        };

        console.warn = function(...args) {
            originalConsoleWarn.apply(console, args);
            if (!isLogging) {
                isLogging = true;
                const message = args.map(arg => typeof arg === 'object' ? JSON.stringify(arg) : String(arg)).join(' ');
                logService.warn(message, { args }).catch(() => {}).finally(() => { isLogging = false; });
            }
        };

        console.info = function(...args) {
            originalConsoleInfo.apply(console, args);
            if (!isLogging) {
                isLogging = true;
                const message = args.map(arg => typeof arg === 'object' ? JSON.stringify(arg) : String(arg)).join(' ');
                logService.info(message, { args }).catch(() => {}).finally(() => { isLogging = false; });
            }
        };
        
        console.log('[Startup] Initializing services...');
        
        await logService.info('Application started', { timestamp: new Date().toISOString() });
        
        // Initialize block tracker
        await blockTrackerService.initialize();
        
        // Verify and cleanup sessions
        console.log('[Startup] Verifying and cleaning up sessions...');
        await liveConnectorService.verifyAndCleanupSessions(io);
        console.log('[Startup] Session verification complete');
    } catch (error) {
        console.error('[Startup] Error during initialization:', error);
        await logService.error('Startup error', { error: error.message, stack: error.stack }).catch(() => {});
    }
    
    // Start poller service after cleanup
    pollerService.start();
}

// Start server
const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, async () => {
    console.log(`T-intell server running on http://localhost:${PORT}`);
    
    // Initialize and cleanup on startup
    await initialize();
});

// Cleanup on exit
process.on('SIGINT', () => {
    console.log('Shutting down...');
    pollerService.stop();
    process.exit(0);
});

module.exports = { app, io };
