const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

// Read credentials from db.txt
const dbTxtPath = path.join(__dirname, '../db.txt');
let dbConfig = {};

try {
    const dbTxtContent = fs.readFileSync(dbTxtPath, 'utf8');
    const lines = dbTxtContent.split('\n');
    
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        
        const [key, value] = trimmed.split('=').map(s => s.trim());
        if (key && value) {
            dbConfig[key] = value;
        }
    }
} catch (error) {
    console.error('Error reading db.txt:', error.message);
    process.exit(1);
}

// Map db.txt keys to PostgreSQL config
// Note: db.txt has "databse" (typo) but PostgreSQL uses "database"
// If database name is "localhost", it's likely wrong - use default "tiktok_monitor"
const dbName = dbConfig.database || dbConfig.databse || 'tiktok_monitor';
const finalDbName = (dbName === 'localhost' || dbName === '127.0.0.1') ? 'tiktok_monitor' : dbName;

const config = {
    host: dbConfig.server || dbConfig.host || 'localhost',
    port: parseInt(dbConfig.port || '5432'),
    user: dbConfig.user || 'postgres',
    password: dbConfig.password || '',
    database: finalDbName,
    max: 10, // Max pool size
    idleTimeoutMillis: 30000
};

console.log('Testing PostgreSQL connection with config:');
console.log(`  Host: ${config.host}`);
console.log(`  Port: ${config.port}`);
console.log(`  User: ${config.user}`);
console.log(`  Database: ${config.database}`);
console.log('  Password: [hidden]');
console.log('');

// First, try to connect to default database to create target database if needed
const defaultConfig = {
    ...config,
    database: 'postgres' // Connect to default database first
};

async function testConnection() {
    let defaultPool = null;
    let pool = null;
    
    try {
        // First, connect to default database
        console.log('Connecting to PostgreSQL server...');
        defaultPool = new Pool(defaultConfig);
        const defaultClient = await defaultPool.connect();
        
        console.log('✓ Connected to PostgreSQL server!');
        
        // Check if target database exists
        const dbCheck = await defaultClient.query(
            'SELECT 1 FROM pg_database WHERE datname = $1',
            [config.database]
        );
        
        if (dbCheck.rows.length === 0) {
            console.log(`Database "${config.database}" does not exist. Creating it...`);
            await defaultClient.query(`CREATE DATABASE "${config.database}"`);
            console.log(`✓ Database "${config.database}" created successfully!`);
        } else {
            console.log(`✓ Database "${config.database}" already exists.`);
        }
        
        defaultClient.release();
        await defaultPool.end();
        
        // Now connect to target database
        console.log(`Connecting to database "${config.database}"...`);
        pool = new Pool(config);
        const client = await pool.connect();
        
        console.log('✓ Connected successfully!');
        
        // Test query
        const result = await client.query('SELECT version(), current_database(), current_user');
        console.log('✓ Query executed successfully!');
        console.log('');
        console.log('Database Info:');
        console.log(`  PostgreSQL Version: ${result.rows[0].version.split(',')[0]}`);
        console.log(`  Current Database: ${result.rows[0].current_database}`);
        console.log(`  Current User: ${result.rows[0].current_user}`);
        
        client.release();
        
        await pool.end();
        console.log('');
        console.log('✓ Connection test completed successfully!');
        process.exit(0);
    } catch (error) {
        console.error('');
        console.error('✗ Connection failed!');
        console.error('');
        console.error('Error details:');
        console.error(`  Code: ${error.code || 'N/A'}`);
        console.error(`  Message: ${error.message}`);
        
        if (error.code === 'ENOTFOUND') {
            console.error('');
            console.error('Possible issues:');
            console.error('  - Hostname not found. Check if "server" in db.txt is correct.');
        } else if (error.code === 'ECONNREFUSED') {
            console.error('');
            console.error('Possible issues:');
            console.error('  - PostgreSQL server is not running');
            console.error('  - Port number is incorrect');
            console.error('  - PostgreSQL is not listening on the specified host');
        } else if (error.code === '28P01') {
            console.error('');
            console.error('Possible issues:');
            console.error('  - Username or password is incorrect');
        } else if (error.code === '3D000') {
            console.error('');
            console.error('Possible issues:');
            console.error('  - Database does not exist. Create it first with:');
            console.error(`    CREATE DATABASE "${config.database}";`);
        }
        
        if (pool) await pool.end();
        if (defaultPool) await defaultPool.end();
        process.exit(1);
    }
}

testConnection();
