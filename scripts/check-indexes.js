/**
 * Script to check and create missing indexes on AWS RDS
 * Run this to ensure all indexes are properly created for optimal query performance
 */

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

// Read AWS RDS credentials
const awsTxtPath = path.join(__dirname, '../aws.txt');
let dbConfig = {};

try {
    const awsTxtContent = fs.readFileSync(awsTxtPath, 'utf8');
    const lines = awsTxtContent.split('\n');
    
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        
        const [key, ...valueParts] = trimmed.split('=');
        const value = valueParts.join('=').trim();
        
        if (key && value) {
            const normalizedKey = key.replace('DB_', '').toLowerCase();
            dbConfig[normalizedKey] = value;
        }
    }
} catch (error) {
    console.error('Error reading aws.txt:', error.message);
    process.exit(1);
}

const dbName = dbConfig.database === 'postgres' ? 'tiktok_monitor' : (dbConfig.database || 'tiktok_monitor');
const host = dbConfig.host || 'localhost';
const port = parseInt(dbConfig.port || '5432');
const user = dbConfig.username || 'postgres';
const password = dbConfig.password || '';

// Check if AWS RDS
const isAwsRds = host.includes('rds.amazonaws.com') || host.includes('amazonaws.com');

const pool = new Pool({
    host,
    port,
    database: dbName,
    user,
    password,
    ssl: isAwsRds ? { rejectUnauthorized: false } : false,
    max: 5,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000
});

async function checkIndexes() {
    const client = await pool.connect();
    
    try {
        console.log('Checking indexes on events table...\n');
        
        // Check existing indexes
        const indexQuery = `
            SELECT 
                indexname,
                indexdef
            FROM pg_indexes
            WHERE tablename = 'events'
            ORDER BY indexname;
        `;
        
        const result = await client.query(indexQuery);
        console.log('Existing indexes on events table:');
        result.rows.forEach(row => {
            console.log(`  - ${row.indexname}`);
            console.log(`    ${row.indexdef}\n`);
        });
        
        // Check if critical indexes exist
        const criticalIndexes = [
            'idx_events_session_time',
            'idx_events_session_id',
            'idx_events_timestamp'
        ];
        
        const existingIndexNames = result.rows.map(r => r.indexname);
        const missingIndexes = criticalIndexes.filter(idx => !existingIndexNames.includes(idx));
        
        if (missingIndexes.length > 0) {
            console.log('⚠️  Missing critical indexes:', missingIndexes.join(', '));
            console.log('\nCreating missing indexes...\n');
            
            // Create missing indexes
            if (missingIndexes.includes('idx_events_session_time')) {
                console.log('Creating idx_events_session_time...');
                await client.query(`
                    CREATE INDEX IF NOT EXISTS idx_events_session_time 
                    ON events(session_id, timestamp DESC);
                `);
                console.log('✓ Created idx_events_session_time\n');
            }
            
            if (missingIndexes.includes('idx_events_session_id')) {
                console.log('Creating idx_events_session_id...');
                await client.query(`
                    CREATE INDEX IF NOT EXISTS idx_events_session_id 
                    ON events(session_id);
                `);
                console.log('✓ Created idx_events_session_id\n');
            }
            
            if (missingIndexes.includes('idx_events_timestamp')) {
                console.log('Creating idx_events_timestamp...');
                await client.query(`
                    CREATE INDEX IF NOT EXISTS idx_events_timestamp 
                    ON events(timestamp DESC);
                `);
                console.log('✓ Created idx_events_timestamp\n');
            }
        } else {
            console.log('✓ All critical indexes exist\n');
        }
        
        // Analyze table to update statistics
        console.log('Analyzing events table to update statistics...');
        await client.query('ANALYZE events;');
        console.log('✓ Table analyzed\n');
        
        // Check table size and row count
        const statsQuery = `
            SELECT 
                pg_size_pretty(pg_total_relation_size('events')) as total_size,
                pg_size_pretty(pg_relation_size('events')) as table_size,
                (SELECT COUNT(*) FROM events) as row_count;
        `;
        
        const stats = await client.query(statsQuery);
        console.log('Events table statistics:');
        console.log(`  Total size: ${stats.rows[0].total_size}`);
        console.log(`  Table size: ${stats.rows[0].table_size}`);
        console.log(`  Row count: ${parseInt(stats.rows[0].row_count).toLocaleString()}\n`);
        
        console.log('✅ Index check complete!');
        
    } catch (error) {
        console.error('Error checking indexes:', error);
        throw error;
    } finally {
        client.release();
    }
}

// Run check
checkIndexes()
    .then(() => {
        console.log('\nDone!');
        process.exit(0);
    })
    .catch(error => {
        console.error('Fatal error:', error);
        process.exit(1);
    })
    .finally(() => {
        pool.end();
    });
