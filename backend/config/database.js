const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcrypt');

// Read credentials from db.txt (local PostgreSQL configuration)
const dbTxtPath = path.join(__dirname, '../../db.txt');
let dbConfig = {};

try {
    const dbTxtContent = fs.readFileSync(dbTxtPath, 'utf8');
    const lines = dbTxtContent.split('\n');
    
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        
        // Handle key=value format, supporting values with = in them
        const [key, ...valueParts] = trimmed.split('=');
        const value = valueParts.join('=').trim();
        
        if (key && value) {
            const normalizedKey = key.toLowerCase();
            dbConfig[normalizedKey] = value;
        }
    }
} catch (error) {
    console.error('[Database Config] Error reading db.txt:', error.message);
    console.error('[Database Config] Falling back to environment variables or defaults');
    // Fallback to environment variables or defaults
}

// Map db.txt keys to PostgreSQL config
// db.txt uses: server, port, user, password, database (or databse typo)
const dbName = dbConfig.database || dbConfig.databse || process.env.DB_DATABASE || process.env.DB_NAME || 'tiktok_monitor';

// Helper function to initialize database if it doesn't exist
async function initializeDatabaseIfNeeded() {
    const adminPool = new Pool({
        host: dbConfig.server || dbConfig.host || process.env.DB_HOST || 'localhost',
        port: parseInt(dbConfig.port || process.env.DB_PORT || '5432'),
        user: dbConfig.user || process.env.DB_USERNAME || process.env.DB_USER || 'postgres',
        password: dbConfig.password || process.env.DB_PASSWORD || '',
        database: 'postgres', // Connect to default postgres database first
        connectionTimeoutMillis: 10000,
    });

    let adminClient = null;
    let appClient = null;

    try {
        console.log('[Database Init] Checking if database exists...');
        adminClient = await adminPool.connect();

        // Check if database exists
        const dbCheck = await adminClient.query(
            'SELECT 1 FROM pg_database WHERE datname = $1',
            [dbName]
        );

        if (dbCheck.rows.length === 0) {
            console.log(`[Database Init] Database '${dbName}' does not exist. Creating...`);
            // Create database (must be done outside transaction)
            await adminClient.query(`CREATE DATABASE ${dbName}`);
            console.log(`[Database Init] ✓ Database '${dbName}' created successfully`);
        } else {
            console.log(`[Database Init] ✓ Database '${dbName}' already exists`);
        }

        adminClient.release();

        // Now connect to the target database and initialize schema
        const appPool = new Pool({
            host: dbConfig.server || dbConfig.host || process.env.DB_HOST || 'localhost',
            port: parseInt(dbConfig.port || process.env.DB_PORT || '5432'),
            user: dbConfig.user || process.env.DB_USERNAME || process.env.DB_USER || 'postgres',
            password: dbConfig.password || process.env.DB_PASSWORD || '',
            database: dbName,
            connectionTimeoutMillis: 10000,
        });

        appClient = await appPool.connect();

        // Check if tables exist (check for users table as indicator)
        const tableCheck = await appClient.query(`
            SELECT EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_schema = 'public' 
                AND table_name = 'users'
            )
        `);

        if (!tableCheck.rows[0].exists) {
            console.log('[Database Init] Tables do not exist. Initializing schema...');
            
            // Read and execute init-database.sql
            const sqlPath = path.join(__dirname, '../../scripts/init-database.sql');
            const sqlContent = fs.readFileSync(sqlPath, 'utf8');
            
            try {
                await appClient.query(sqlContent);
                console.log('[Database Init] ✓ Schema initialized successfully');
            } catch (error) {
                // Ignore "already exists" errors for IF NOT EXISTS statements
                if (!error.message.includes('already exists') && 
                    error.code !== '42P07' && // duplicate_table
                    error.code !== '42710' && // duplicate_object
                    error.code !== '42P16') { // invalid table definition
                    throw error;
                }
                console.log(`[Database Init] (warning: ${error.message.split('\n')[0]})`);
            }

            // Create admin user if it doesn't exist
            const userCheck = await appClient.query(
                'SELECT id FROM users WHERE username = $1',
                ['admin']
            );

            if (userCheck.rows.length === 0) {
                console.log('[Database Init] Creating admin user...');
                const hashedPassword = await bcrypt.hash('admin', 10);
                await appClient.query(
                    'INSERT INTO users (id, username, password_hash) VALUES (uuid_generate_v4(), $1, $2)',
                    ['admin', hashedPassword]
                );
                console.log('[Database Init] ✓ Admin user created');
                console.log('[Database Init]   Username: admin');
                console.log('[Database Init]   Password: admin');
                console.log('[Database Init]   ⚠ Please change the password after first login');
            } else {
                console.log('[Database Init] ✓ Admin user already exists');
            }
        } else {
            console.log('[Database Init] ✓ Schema already initialized');
            
            // Check and add missing columns (migrations)
            try {
                // Check if trigger_words table has severity column
                const severityCheck = await appClient.query(`
                    SELECT column_name 
                    FROM information_schema.columns 
                    WHERE table_name = 'trigger_words' 
                    AND column_name = 'severity'
                `);
                
                if (severityCheck.rows.length === 0) {
                    console.log('[Database Init] Adding severity column to trigger_words table...');
                    await appClient.query(`
                        ALTER TABLE trigger_words 
                        ADD COLUMN severity VARCHAR(50) NOT NULL DEFAULT 'MEDIUM' 
                        CHECK (severity IN ('LOW', 'MED', 'MEDIUM', 'HIGH'))
                    `);
                    await appClient.query(`
                        UPDATE trigger_words SET severity = 'MEDIUM' WHERE severity IS NULL
                    `);
                    console.log('[Database Init] ✓ Added severity column to trigger_words');
                }
                
                // Migrate to case-insensitive: normalize words to lowercase and update index
                try {
                    // Check if old index exists (with case_sensitive)
                    const oldIndexCheck = await appClient.query(`
                        SELECT indexname FROM pg_indexes 
                        WHERE tablename = 'trigger_words' 
                        AND indexname = 'idx_trigger_words_unique'
                    `);
                    
                    if (oldIndexCheck.rows.length > 0) {
                        // Check if index includes case_sensitive
                        const indexDef = await appClient.query(`
                            SELECT indexdef FROM pg_indexes 
                            WHERE tablename = 'trigger_words' 
                            AND indexname = 'idx_trigger_words_unique'
                        `);
                        
                        if (indexDef.rows.length > 0 && indexDef.rows[0].indexdef.includes('case_sensitive')) {
                            console.log('[Database Init] Migrating trigger_words to case-insensitive...');
                            
                            // Drop old index
                            await appClient.query(`DROP INDEX IF EXISTS idx_trigger_words_unique`);
                            
                            // Normalize all words to lowercase
                            await appClient.query(`
                                UPDATE trigger_words 
                                SET word = LOWER(word), case_sensitive = false
                            `);
                            
                            // Create new index without case_sensitive
                            await appClient.query(`
                                CREATE UNIQUE INDEX idx_trigger_words_unique 
                                ON trigger_words(LOWER(word))
                            `);
                            
                            console.log('[Database Init] ✓ Migrated trigger_words to case-insensitive');
                        }
                    } else {
                        // Index doesn't exist, create it
                        try {
                            await appClient.query(`
                                CREATE UNIQUE INDEX idx_trigger_words_unique 
                                ON trigger_words(LOWER(word))
                            `);
                            console.log('[Database Init] ✓ Created case-insensitive index for trigger_words');
                        } catch (idxError) {
                            // Index might already exist with different name, ignore
                            if (!idxError.message.includes('already exists')) {
                                throw idxError;
                            }
                        }
                    }
                } catch (migrationError) {
                    // Ignore non-critical migration errors
                    if (!migrationError.message.includes('already exists') && 
                        migrationError.code !== '42710') { // duplicate_object
                        console.warn('[Database Init] Migration warning:', migrationError.message);
                    }
                }
                
                // Check and create GIN indexes for JSONB columns (for search performance)
                try {
                    const ginIndexes = [
                        { name: 'idx_events_user_data_gin', query: 'CREATE INDEX IF NOT EXISTS idx_events_user_data_gin ON events USING GIN (user_data)' },
                        { name: 'idx_events_event_data_gin', query: 'CREATE INDEX IF NOT EXISTS idx_events_event_data_gin ON events USING GIN (event_data)' },
                        { name: 'idx_events_user_uniqueid_lower', query: 'CREATE INDEX IF NOT EXISTS idx_events_user_uniqueid_lower ON events (LOWER(user_data->>\'uniqueId\')) WHERE type = \'chat\' AND user_data->>\'uniqueId\' IS NOT NULL' }
                    ];
                    
                    for (const idx of ginIndexes) {
                        const indexCheck = await appClient.query(`
                            SELECT indexname FROM pg_indexes 
                            WHERE tablename = 'events' 
                            AND indexname = $1
                        `, [idx.name]);
                        
                        if (indexCheck.rows.length === 0) {
                            console.log(`[Database Init] Creating index ${idx.name}...`);
                            await appClient.query(idx.query);
                            console.log(`[Database Init] ✓ Created index ${idx.name}`);
                        }
                    }
                } catch (migrationError) {
                    // Ignore non-critical migration errors
                    if (!migrationError.message.includes('already exists') && 
                        migrationError.code !== '42710') { // duplicate_object
                        console.warn('[Database Init] Index migration warning:', migrationError.message);
                    }
                }

                // Check and add use_session column to tiktok_accounts
                const useSessionCheck = await appClient.query(`
                    SELECT column_name FROM information_schema.columns 
                    WHERE table_name = 'tiktok_accounts' AND column_name = 'use_session'
                `);
                if (useSessionCheck.rows.length === 0) {
                    console.log('[Database Init] Adding use_session column to tiktok_accounts...');
                    await appClient.query(`
                        ALTER TABLE tiktok_accounts ADD COLUMN use_session BOOLEAN DEFAULT FALSE
                    `);
                    console.log('[Database Init] ✓ Added use_session column');
                }

                // Check and create tiktok_session table
                const tiktokSessionCheck = await appClient.query(`
                    SELECT FROM information_schema.tables 
                    WHERE table_schema = 'public' AND table_name = 'tiktok_session'
                `);
                if (tiktokSessionCheck.rows.length === 0) {
                    console.log('[Database Init] Creating tiktok_session table...');
                    await appClient.query(`
                        CREATE TABLE tiktok_session (
                            id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
                            session_id TEXT,
                            tt_target_idc TEXT,
                            valid_until TIMESTAMPTZ,
                            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                        )
                    `);
                    await appClient.query(`
                        INSERT INTO tiktok_session (id, updated_at) VALUES (1, NOW())
                    `);
                    console.log('[Database Init] ✓ Created tiktok_session table');
                }
            } catch (migrationError) {
                // Ignore errors if column already exists or other non-critical issues
                if (!migrationError.message.includes('already exists') && 
                    migrationError.code !== '42701') { // duplicate_column
                    console.warn('[Database Init] Migration warning:', migrationError.message);
                }
            }
        }

        appClient.release();
        await appPool.end();
        await adminPool.end();

    } catch (error) {
        if (adminClient) adminClient.release();
        if (appClient) appClient.release();
        await adminPool.end();
        console.error('[Database Init] ✗ Initialization failed:', error.message);
        throw error;
    }
}

// Configure pool for local PostgreSQL
const poolConfig = {
    host: dbConfig.server || dbConfig.host || process.env.DB_HOST || 'localhost',
    port: parseInt(dbConfig.port || process.env.DB_PORT || '5432'),
    user: dbConfig.user || process.env.DB_USERNAME || process.env.DB_USER || 'postgres',
    password: dbConfig.password || process.env.DB_PASSWORD || '',
    database: dbName,
    max: parseInt(process.env.DB_POOL_MAX || '10'),
    idleTimeoutMillis: parseInt(process.env.DB_POOL_IDLE_TIMEOUT || '30000'),
    connectionTimeoutMillis: parseInt(process.env.DB_CONNECTION_TIMEOUT || '5000'),
};

// Create connection pool
const pool = new Pool(poolConfig);

// Handle pool errors
pool.on('error', (err, client) => {
    console.error('[Database Pool] Unexpected error on idle client', err);
});

// Initialize database and test connection on startup
(async () => {
    try {
        // First, ensure database exists and is initialized
        await initializeDatabaseIfNeeded();
        
        // Then test the connection
        const client = await pool.connect();
        console.log('[Database Pool] Connected to PostgreSQL database:', dbName);
        console.log('[Database Pool] Host:', poolConfig.host);
        client.release();
    } catch (err) {
        console.error('[Database Pool] Failed to connect to PostgreSQL:', err.message);
        console.error('[Database Pool] Host:', poolConfig.host);
        console.error('[Database Pool] Database:', dbName);
        // Don't exit - let the app start and retry connections
    }
})();

// Helper function for transactions
async function withTransaction(callback) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const result = await callback(client);
        await client.query('COMMIT');
        return result;
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

// Helper function for raw queries
async function query(text, params) {
    const start = Date.now();
    
    try {
        const result = await pool.query(text, params);
        const duration = Date.now() - start;
        
        // Log slow queries (over 1 second)
        if (duration > 1000) {
            console.warn(`[Database] Slow query (${duration}ms):`, text.substring(0, 100));
        }
        
        return result;
    } catch (error) {
        console.error('[Database] Query error:', error.message);
        console.error('[Database] Query:', text.substring(0, 200));
        if (params && params.length > 0) {
            console.error('[Database] Params:', params.length, 'parameters');
        }
        throw error;
    }
}

module.exports = {
    pool,
    query,
    withTransaction
};
