const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcrypt');

// Read credentials from db.txt (local PostgreSQL configuration)
const dbTxtPath = path.join(__dirname, '../db.txt');
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
}

// Map db.txt keys to PostgreSQL config
const dbName = dbConfig.database || dbConfig.databse || process.env.DB_DATABASE || process.env.DB_NAME || 'tiktok_monitor';

async function resetDatabase() {
    const adminPool = new Pool({
        host: dbConfig.server || dbConfig.host || process.env.DB_HOST || 'localhost',
        port: parseInt(dbConfig.port || process.env.DB_PORT || '5432'),
        user: dbConfig.user || dbConfig.username || process.env.DB_USERNAME || process.env.DB_USER || 'postgres',
        password: dbConfig.password || process.env.DB_PASSWORD || '',
        database: 'postgres', // Connect to default postgres database first
        connectionTimeoutMillis: 10000,
    });

    let adminClient = null;
    let appClient = null;

    try {
        console.log('╔════════════════════════════════════════════════════════════╗');
        console.log('║         TikTok Monitor - Database Reset Script            ║');
        console.log('╚════════════════════════════════════════════════════════════╝');
        console.log('');
        console.log(`[Reset] Target database: ${dbName}`);
        console.log('');

        adminClient = await adminPool.connect();
        console.log('[Reset] ✓ Connected to PostgreSQL server');

        // Check if database exists
        const dbCheck = await adminClient.query(
            'SELECT 1 FROM pg_database WHERE datname = $1',
            [dbName]
        );

        if (dbCheck.rows.length > 0) {
            console.log(`[Reset] Database '${dbName}' exists. Dropping...`);
            
            // Terminate all connections to the database before dropping
            // This is necessary because PostgreSQL won't drop a database with active connections
            console.log('[Reset] Terminating active connections...');
            await adminClient.query(`
                SELECT pg_terminate_backend(pg_stat_activity.pid)
                FROM pg_stat_activity
                WHERE pg_stat_activity.datname = $1
                AND pid <> pg_backend_pid()
            `, [dbName]);
            
            // Wait a bit for connections to close
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            // Drop the database
            await adminClient.query(`DROP DATABASE IF EXISTS ${dbName}`);
            console.log(`[Reset] ✓ Database '${dbName}' dropped successfully`);
        } else {
            console.log(`[Reset] Database '${dbName}' does not exist (nothing to drop)`);
        }

        // Create the database
        console.log(`[Reset] Creating database '${dbName}'...`);
        await adminClient.query(`CREATE DATABASE ${dbName}`);
        console.log(`[Reset] ✓ Database '${dbName}' created successfully`);

        adminClient.release();

        // Now connect to the target database and initialize schema
        const appPool = new Pool({
            host: dbConfig.server || dbConfig.host || process.env.DB_HOST || 'localhost',
            port: parseInt(dbConfig.port || process.env.DB_PORT || '5432'),
            user: dbConfig.user || dbConfig.username || process.env.DB_USERNAME || process.env.DB_USER || 'postgres',
            password: dbConfig.password || process.env.DB_PASSWORD || '',
            database: dbName,
            connectionTimeoutMillis: 10000,
        });

        appClient = await appPool.connect();
        console.log(`[Reset] ✓ Connected to database '${dbName}'`);

        // Read and execute init-database.sql
        console.log('[Reset] Initializing schema...');
        const sqlPath = path.join(__dirname, 'init-database.sql');
        const sqlContent = fs.readFileSync(sqlPath, 'utf8');
        
        try {
            await appClient.query(sqlContent);
            console.log('[Reset] ✓ Schema initialized successfully');
        } catch (error) {
            // Ignore "already exists" errors for IF NOT EXISTS statements
            if (!error.message.includes('already exists') && 
                error.code !== '42P07' && // duplicate_table
                error.code !== '42710' && // duplicate_object
                error.code !== '42P16') { // invalid table definition
                throw error;
            }
            console.log(`[Reset] (warning: ${error.message.split('\n')[0]})`);
        }

        // Create admin user
        console.log('[Reset] Creating admin user...');
        const userCheck = await appClient.query(
            'SELECT id FROM users WHERE username = $1',
            ['admin']
        );

        if (userCheck.rows.length === 0) {
            const hashedPassword = await bcrypt.hash('admin', 10);
            await appClient.query(
                'INSERT INTO users (id, username, password_hash) VALUES (uuid_generate_v4(), $1, $2)',
                ['admin', hashedPassword]
            );
            console.log('[Reset] ✓ Admin user created');
            console.log('[Reset]   Username: admin');
            console.log('[Reset]   Password: admin');
            console.log('[Reset]   ⚠ Please change the password after first login');
        } else {
            console.log('[Reset] ✓ Admin user already exists');
        }

        appClient.release();
        await appPool.end();
        await adminPool.end();

        console.log('');
        console.log('╔════════════════════════════════════════════════════════════╗');
        console.log('║              ✓ Database Reset Completed!                  ║');
        console.log('╚════════════════════════════════════════════════════════════╝');
        console.log('');
        console.log(`Database '${dbName}' has been completely reset and reinitialized.`);
        console.log('All tables, indexes, and default data have been created.');
        console.log('');

    } catch (error) {
        console.error('');
        console.error('╔════════════════════════════════════════════════════════════╗');
        console.error('║              ✗ Database Reset Failed!                    ║');
        console.error('╚════════════════════════════════════════════════════════════╝');
        console.error('');
        console.error('Error:', error.message);
        if (error.stack) {
            console.error('');
            console.error('Stack trace:');
            console.error(error.stack);
        }
        
        if (adminClient) {
            adminClient.release();
        }
        if (appClient) {
            appClient.release();
        }
        
        process.exit(1);
    }
}

// Run reset
resetDatabase();
