#!/usr/bin/env node

/**
 * AWS RDS Migration Script
 * 
 * This script:
 * 1. Tests AWS RDS credentials from aws.txt
 * 2. Creates the database if it doesn't exist
 * 3. Creates all tables and indexes
 * 4. Migrates all data from local database to AWS RDS
 */

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

// Colors for console output
const colors = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    green: '\x1b[32m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    cyan: '\x1b[36m'
};

function log(message, color = 'reset') {
    console.log(`${colors[color]}${message}${colors.reset}`);
}

function error(message) {
    log(`❌ ${message}`, 'red');
}

function success(message) {
    log(`✅ ${message}`, 'green');
}

function info(message) {
    log(`ℹ️  ${message}`, 'cyan');
}

function warning(message) {
    log(`⚠️  ${message}`, 'yellow');
}

// Read AWS credentials from aws.txt
function readAwsConfig() {
    const awsTxtPath = path.join(__dirname, '../aws.txt');
    
    if (!fs.existsSync(awsTxtPath)) {
        throw new Error('aws.txt file not found! Please create it with AWS RDS credentials.');
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
            // Normalize key names
            const normalizedKey = key.replace('DB_', '').toLowerCase();
            config[normalizedKey] = value;
        }
    }
    
    // Map to expected format
    // Note: DB_DATABASE in aws.txt might be 'postgres' (default RDS database)
    // We'll use that for initial connection, then create 'tiktok_monitor' if needed
    return {
        host: config.host || config.server,
        port: parseInt(config.port || '5432'),
        user: config.username || config.user,
        password: config.password,
        database: config.database || 'postgres', // Default to 'postgres' for initial connection
        // AWS RDS requires SSL connections
        ssl: {
            rejectUnauthorized: false // AWS RDS uses self-signed certificates
        }
    };
}

// Read local database config from db.txt
function readLocalConfig() {
    const dbTxtPath = path.join(__dirname, '../db.txt');
    
    if (!fs.existsSync(dbTxtPath)) {
        throw new Error('db.txt file not found! Cannot read local database config.');
    }
    
    const content = fs.readFileSync(dbTxtPath, 'utf8');
    const lines = content.split('\n');
    const config = {};
    
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        
        const [key, value] = trimmed.split('=').map(s => s.trim());
        if (key && value) {
            config[key] = value;
        }
    }
    
    const dbName = config.database || config.databse || 'tiktok_monitor';
    const finalDbName = (dbName === 'localhost' || dbName === '127.0.0.1') ? 'tiktok_monitor' : dbName;
    
    return {
        host: config.server || config.host || 'localhost',
        port: parseInt(config.port || '5432'),
        user: config.user || 'postgres',
        password: config.password || '',
        database: finalDbName
    };
}

// Check if config is for AWS RDS
function isAwsRds(config) {
    const host = config.host || config.server || '';
    return host.includes('rds.amazonaws.com') || host.includes('amazonaws.com');
}

// Test connection
async function testConnection(config, dbName = null, isAws = false) {
    const testConfig = { ...config };
    if (dbName) {
        testConfig.database = dbName;
    }
    
    // Only enable SSL for AWS RDS connections
    if (isAws && !testConfig.ssl) {
        testConfig.ssl = {
            rejectUnauthorized: false
        };
    }
    
    const pool = new Pool(testConfig);
    
    try {
        const client = await pool.connect();
        await client.query('SELECT NOW()');
        client.release();
        await pool.end();
        return true;
    } catch (err) {
        await pool.end();
        throw err;
    }
}

// Create database if it doesn't exist
async function createDatabaseIfNotExists(config, targetDbName) {
    info(`Checking if database '${targetDbName}' exists...`);
    
    // Connect to default 'postgres' database
    const poolConfig = {
        host: config.host,
        port: config.port,
        user: config.user,
        password: config.password,
        database: 'postgres' // Connect to default database
    };
    
    // Only enable SSL for AWS RDS
    if (isAwsRds(config)) {
        poolConfig.ssl = {
            rejectUnauthorized: false
        };
    }
    
    const adminPool = new Pool(poolConfig);
    
    try {
        // Check if database exists
        const result = await adminPool.query(
            "SELECT 1 FROM pg_database WHERE datname = $1",
            [targetDbName]
        );
        
        if (result.rows.length > 0) {
            success(`Database '${targetDbName}' already exists.`);
            await adminPool.end();
            return false; // Database already exists
        }
        
        // Create database
        info(`Creating database '${targetDbName}'...`);
        await adminPool.query(`CREATE DATABASE ${targetDbName}`);
        success(`Database '${targetDbName}' created successfully.`);
        await adminPool.end();
        return true; // Database was created
    } catch (err) {
        await adminPool.end();
        throw err;
    }
}

// Execute SQL file
async function executeSqlFile(pool, filePath) {
    info(`Executing SQL file: ${path.basename(filePath)}...`);
    
    const sql = fs.readFileSync(filePath, 'utf8');
    
    // Better approach: execute the entire SQL file at once
    // PostgreSQL can handle multiple statements separated by semicolons
    try {
        await pool.query(sql);
        success(`SQL file executed successfully.`);
    } catch (err) {
        // If full execution fails, try executing statement by statement
        // but handle dollar-quoted strings properly
        warning(`Full SQL execution failed, trying statement by statement: ${err.message.substring(0, 100)}`);
        
        // Remove comments and split intelligently
        let cleanedSql = sql
            .split('\n')
            .filter(line => !line.trim().startsWith('--'))
            .join('\n');
        
        // Split by semicolon, but preserve dollar-quoted blocks
        const statements = [];
        let currentStatement = '';
        let inDollarQuote = false;
        let dollarTag = '';
        let i = 0;
        
        while (i < cleanedSql.length) {
            const char = cleanedSql[i];
            const nextChars = cleanedSql.substring(i, i + 2);
            
            // Check for dollar-quoted string start: $tag$ or $$
            if (!inDollarQuote && char === '$') {
                const dollarMatch = cleanedSql.substring(i).match(/^\$([^$]*)\$/);
                if (dollarMatch) {
                    dollarTag = dollarMatch[0];
                    inDollarQuote = true;
                    currentStatement += dollarTag;
                    i += dollarTag.length;
                    continue;
                }
            }
            
            // Check for dollar-quoted string end
            if (inDollarQuote && cleanedSql.substring(i).startsWith(dollarTag)) {
                currentStatement += dollarTag;
                i += dollarTag.length;
                inDollarQuote = false;
                dollarTag = '';
                continue;
            }
            
            // Check for semicolon (only if not in dollar quote)
            if (!inDollarQuote && char === ';') {
                const stmt = currentStatement.trim();
                if (stmt.length > 0) {
                    statements.push(stmt);
                }
                currentStatement = '';
                i++;
                continue;
            }
            
            currentStatement += char;
            i++;
        }
        
        // Add last statement if any
        if (currentStatement.trim().length > 0) {
            statements.push(currentStatement.trim());
        }
        
        // Execute statements
        for (const statement of statements) {
            if (statement.trim() && !statement.trim().startsWith('--')) {
                try {
                    await pool.query(statement);
                } catch (err) {
                    // Some statements might fail if they already exist (CREATE IF NOT EXISTS)
                    if (!err.message.includes('already exists') && 
                        !err.message.includes('duplicate') &&
                        !err.message.includes('ON CONFLICT') &&
                        !err.message.includes('does not exist')) {
                        warning(`Statement warning: ${err.message.substring(0, 100)}`);
                    }
                }
            }
        }
        
        success(`SQL file executed successfully.`);
    }
}

// Migrate data from local to AWS
async function migrateData(localPool, awsPool) {
    info('Starting data migration...');
    
    const tables = [
        'users',
        'tiktok_accounts',
        'monitored',
        'live_sessions',
        'events',
        'stats_history',
        'alerts',
        'trigger_words',
        'anti_blocking_settings',
        'tiktok_blocks',
        'account_history',
        'console_logs'
    ];
    
    for (const table of tables) {
        try {
            info(`Migrating table: ${table}...`);
            
            // Read from local
            const localResult = await localPool.query(`SELECT * FROM ${table}`);
            const rows = localResult.rows;
            
            if (rows.length === 0) {
                info(`  Table ${table} is empty, skipping.`);
                continue;
            }
            
            info(`  Found ${rows.length} rows to migrate.`);
            
            // Insert into AWS (with conflict handling)
            let inserted = 0;
            let skipped = 0;
            
            for (const row of rows) {
                try {
                    // Build INSERT statement dynamically
                    const columns = Object.keys(row).filter(k => row[k] !== undefined);
                    const values = columns.map((_, i) => `$${i + 1}`);
                    const columnNames = columns.map(c => `"${c}"`).join(', ');
                    
                    // For tables with unique constraints, use ON CONFLICT
                    let conflictClause = '';
                    if (table === 'users') {
                        conflictClause = ' ON CONFLICT (username) DO NOTHING';
                    } else if (table === 'tiktok_accounts') {
                        conflictClause = ' ON CONFLICT (handle) DO NOTHING';
                    } else if (table === 'trigger_words') {
                        // For trigger_words, check manually since unique index is on LOWER(word)
                        try {
                            const checkResult = await awsPool.query(
                                'SELECT id FROM trigger_words WHERE LOWER(word) = LOWER($1) AND case_sensitive = $2',
                                [row.word, row.case_sensitive]
                            );
                            if (checkResult.rows.length > 0) {
                                skipped++;
                                continue; // Skip this row
                            }
                            // No conflict, proceed with insert (no conflictClause needed)
                        } catch (checkErr) {
                            // If check fails, try insert anyway
                        }
                    } else if (table === 'anti_blocking_settings') {
                        conflictClause = ' ON CONFLICT (id) DO UPDATE SET settings = EXCLUDED.settings';
                    } else if (table === 'monitored' || table === 'tiktok_blocks') {
                        conflictClause = ' ON CONFLICT (handle) DO NOTHING';
                    } else if (table === 'alerts' || table === 'live_sessions' || table === 'events' || 
                               table === 'stats_history' || table === 'account_history' || table === 'console_logs') {
                        conflictClause = ' ON CONFLICT (id) DO NOTHING';
                    }
                    
                    const insertSql = `
                        INSERT INTO ${table} (${columnNames})
                        VALUES (${values.join(', ')})
                        ${conflictClause}
                    `;
                    
                    const rowValues = columns.map(col => row[col]);
                    await awsPool.query(insertSql, rowValues);
                    inserted++;
                } catch (err) {
                    if (err.code === '23505' || err.message.includes('duplicate') || err.message.includes('unique')) {
                        skipped++;
                    } else {
                        warning(`  Error inserting row into ${table}: ${err.message}`);
                    }
                }
            }
            
            success(`  ${table}: ${inserted} inserted, ${skipped} skipped (duplicates)`);
        } catch (err) {
            error(`Failed to migrate table ${table}: ${err.message}`);
            // Continue with other tables
        }
    }
    
    success('Data migration completed!');
}

// Main migration function
async function main() {
    log('\n' + '='.repeat(60), 'bright');
    log('AWS RDS Migration Script', 'bright');
    log('='.repeat(60) + '\n', 'bright');
    
    let awsConfig, localConfig;
    let awsPool, localPool;
    
    try {
        // Step 1: Read configurations
        info('Step 1: Reading configurations...');
        awsConfig = readAwsConfig();
        localConfig = readLocalConfig();
        
        // Determine target database name
        // If DB_DATABASE is 'postgres' (default RDS database), create 'tiktok_monitor'
        // Otherwise use the specified database name
        const targetDbName = (awsConfig.database === 'postgres' || !awsConfig.database) 
            ? 'tiktok_monitor' 
            : awsConfig.database;
        
        success('Configurations loaded successfully.');
        info(`  AWS Host: ${awsConfig.host}`);
        info(`  AWS Database: ${targetDbName}`);
        info(`  Local Host: ${localConfig.host}`);
        info(`  Local Database: ${localConfig.database}\n`);
        
        // Step 2: Test AWS connection
        info('Step 2: Testing AWS RDS connection...');
        await testConnection(awsConfig, 'postgres', true); // true = is AWS
        success('AWS RDS connection successful!\n');
        
        // Step 3: Test local connection
        info('Step 3: Testing local database connection...');
        await testConnection(localConfig, null, false); // false = is not AWS
        success('Local database connection successful!\n');
        
        // Step 4: Create database if needed
        info('Step 4: Ensuring target database exists...');
        await createDatabaseIfNotExists(awsConfig, targetDbName);
        log('');
        
        // Step 5: Create pools for migration
        info('Step 5: Establishing database connections...');
        awsConfig.database = targetDbName;
        // Ensure SSL is set for AWS RDS only
        if (isAwsRds(awsConfig) && !awsConfig.ssl) {
            awsConfig.ssl = {
                rejectUnauthorized: false
            };
        }
        awsPool = new Pool(awsConfig);
        // Local pool doesn't need SSL
        localPool = new Pool(localConfig);
        
        // Test connections
        await awsPool.query('SELECT NOW()');
        await localPool.query('SELECT NOW()');
        success('Database connections established.\n');
        
        // Step 6: Create tables
        info('Step 6: Creating tables and indexes...');
        const sqlFilePath = path.join(__dirname, 'init-database.sql');
        await executeSqlFile(awsPool, sqlFilePath);
        log('');
        
        // Step 7: Migrate data
        info('Step 7: Migrating data from local to AWS RDS...');
        await migrateData(localPool, awsPool);
        log('');
        
        // Step 8: Verify migration
        info('Step 8: Verifying migration...');
        const tables = ['users', 'tiktok_accounts', 'monitored', 'live_sessions', 'events', 'alerts', 'trigger_words'];
        
        for (const table of tables) {
            const localCount = await localPool.query(`SELECT COUNT(*) as count FROM ${table}`);
            const awsCount = await awsPool.query(`SELECT COUNT(*) as count FROM ${table}`);
            
            const localNum = parseInt(localCount.rows[0].count);
            const awsNum = parseInt(awsCount.rows[0].count);
            
            if (localNum === awsNum) {
                success(`  ${table}: ${awsNum} rows (matches local)`);
            } else {
                warning(`  ${table}: ${awsNum} rows (local has ${localNum})`);
            }
        }
        log('');
        
        // Cleanup
        await awsPool.end();
        await localPool.end();
        
        log('='.repeat(60), 'bright');
        success('Migration completed successfully!', 'bright');
        log('='.repeat(60) + '\n', 'bright');
        
        info('Next steps:');
        info('1. Update your application to use AWS RDS credentials from aws.txt');
        info('2. Test the application with the new database');
        info('3. Once verified, you can shut down the local database\n');
        
    } catch (err) {
        error(`Migration failed: ${err.message}`);
        console.error(err);
        
        // Cleanup on error
        if (awsPool) await awsPool.end().catch(() => {});
        if (localPool) await localPool.end().catch(() => {});
        
        process.exit(1);
    }
}

// Run migration
if (require.main === module) {
    main().catch(err => {
        error(`Fatal error: ${err.message}`);
        console.error(err);
        process.exit(1);
    });
}

module.exports = { main };
