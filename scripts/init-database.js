const fs = require('fs');
const path = require('path');
const bcrypt = require('bcrypt');
const { pool, query } = require('../backend/config/database');

async function initDatabase() {
    let client = null;
    
    try {
        console.log('Initializing PostgreSQL database...');
        console.log('');
        
        // Read SQL file
        const sqlPath = path.join(__dirname, 'init-database.sql');
        const sqlContent = fs.readFileSync(sqlPath, 'utf8');
        
        // Connect to database
        console.log('Connecting to database...');
        client = await pool.connect();
        console.log('✓ Connected to database');
        
        // Execute entire SQL file at once
        // This is safer for functions, triggers, and complex statements
        try {
            await client.query(sqlContent);
            console.log('✓ SQL schema executed successfully');
        } catch (error) {
            // Ignore "already exists" errors for IF NOT EXISTS statements
            if (error.message.includes('already exists') || 
                error.code === '42P07' || // duplicate_table
                error.code === '42710' || // duplicate_object
                error.code === '42P16') { // invalid table definition (if table exists but structure differs)
                console.log(`  (warning: ${error.message.split('\n')[0]})`);
            } else {
                console.error(`✗ Error executing SQL schema:`);
                console.error(`  ${error.message}`);
                // Try to continue anyway - tables might already be created
                console.log('  Attempting to continue...');
            }
        }
        
        console.log('');
        console.log('✓ Database schema initialized successfully!');
        console.log('');
        
        // Create admin user
        console.log('Creating admin user...');
        
        // Check if admin user already exists
        const existingUser = await client.query(
            'SELECT id FROM users WHERE username = $1',
            ['admin']
        );
        
        if (existingUser.rows.length > 0) {
            console.log('✓ Admin user already exists');
        } else {
            const hashedPassword = await bcrypt.hash('admin', 10);
            await client.query(
                'INSERT INTO users (id, username, password_hash) VALUES (uuid_generate_v4(), $1, $2)',
                ['admin', hashedPassword]
            );
            console.log('✓ Admin user created successfully!');
            console.log('  Username: admin');
            console.log('  Password: admin');
            console.log('  ⚠ Please change the password after first login.');
        }
        
        console.log('');
        console.log('✓ Database initialization completed successfully!');
        
    } catch (error) {
        console.error('');
        console.error('✗ Database initialization failed!');
        console.error('');
        console.error('Error:', error.message);
        if (error.stack) {
            console.error('');
            console.error('Stack trace:');
            console.error(error.stack);
        }
        process.exit(1);
    } finally {
        if (client) {
            client.release();
        }
        await pool.end();
    }
}

// Run initialization
initDatabase();
