#!/usr/bin/env node

/**
 * Test AWS RDS Connection Script
 * 
 * Tests the connection to AWS RDS using credentials from aws.txt
 * This verifies that the application can connect to AWS RDS
 */

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

// Read AWS credentials from aws.txt
function readAwsConfig() {
    const awsTxtPath = path.join(__dirname, '../aws.txt');
    
    if (!fs.existsSync(awsTxtPath)) {
        throw new Error('aws.txt file not found!');
    }
    
    const content = fs.readFileSync(awsTxtPath, 'utf8');
    const lines = content.split('\n');
    const config = {};
    
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        
        const [key, ...valueParts] = trimmed.split('=');
        const value = valueParts.join('=').trim();
        
        if (key && value) {
            const normalizedKey = key.replace('DB_', '').toLowerCase();
            config[normalizedKey] = value;
        }
    }
    
    // Determine database name
    let dbName = config.database || 'tiktok_monitor';
    if (dbName === 'postgres' || dbName === 'localhost' || dbName === '127.0.0.1') {
        dbName = 'tiktok_monitor';
    }
    
    return {
        host: config.host || config.server,
        port: parseInt(config.port || '5432'),
        user: config.username || config.user,
        password: config.password,
        database: dbName,
        ssl: {
            rejectUnauthorized: false // AWS RDS uses self-signed certificates
        }
    };
}

async function testConnection() {
    console.log('Testing AWS RDS connection...\n');
    
    try {
        const config = readAwsConfig();
        
        console.log('Configuration:');
        console.log(`  Host: ${config.host}`);
        console.log(`  Port: ${config.port}`);
        console.log(`  User: ${config.user}`);
        console.log(`  Database: ${config.database}`);
        console.log(`  SSL: Enabled\n`);
        
        const pool = new Pool(config);
        
        // Test basic connection
        console.log('Testing connection...');
        const client = await pool.connect();
        const result = await client.query('SELECT NOW() as current_time, version() as version');
        client.release();
        
        console.log('✅ Connection successful!');
        console.log(`  Current time: ${result.rows[0].current_time}`);
        console.log(`  PostgreSQL version: ${result.rows[0].version.split(',')[0]}\n`);
        
        // Test database exists and has tables
        console.log('Checking database structure...');
        const tablesResult = await client.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public' 
            ORDER BY table_name
        `);
        
        if (tablesResult.rows.length > 0) {
            console.log(`✅ Found ${tablesResult.rows.length} tables:`);
            tablesResult.rows.forEach(row => {
                console.log(`  - ${row.table_name}`);
            });
        } else {
            console.log('⚠️  No tables found in database');
        }
        
        await pool.end();
        console.log('\n✅ All tests passed!');
        process.exit(0);
        
    } catch (error) {
        console.error('\n❌ Connection failed!');
        console.error(`Error: ${error.message}`);
        console.error('\nTroubleshooting:');
        console.error('  1. Check if aws.txt exists and has correct credentials');
        console.error('  2. Verify AWS RDS instance is running');
        console.error('  3. Check security group allows connections from your IP');
        console.error('  4. Verify database name is correct (should be tiktok_monitor)');
        process.exit(1);
    }
}

testConnection();
