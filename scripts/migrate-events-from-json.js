const fs = require('fs');
const path = require('path');
const { query, pool } = require('../backend/config/database');
const { jsonToRow } = require('../backend/storage/dbStorage');

// We need to import jsonToRow, but it's not exported. Let's recreate it here
function jsonToRowForEvents(data) {
    return {
        id: data.id || require('uuid').v4(),
        session_id: data.sessionId || data.session_id,
        type: data.type,
        timestamp: data.timestamp,
        user_data: data.user || data.user_data,
        event_data: data.data || data.event_data,
        location: data.location
    };
}

(async () => {
    try {
        const eventsDir = path.join(__dirname, '..', 'database', 'events');
        
        if (!fs.existsSync(eventsDir)) {
            console.log('Events directory does not exist');
            process.exit(0);
        }
        
        const files = fs.readdirSync(eventsDir).filter(f => f.endsWith('.json') && !f.endsWith('.tmp'));
        
        console.log(`Found ${files.length} event files to migrate\n`);
        
        let totalMigrated = 0;
        let totalSkipped = 0;
        
        for (const file of files) {
            const sessionId = file.replace('.json', '');
            const filePath = path.join(eventsDir, file);
            
            try {
                // Check if events already exist in DB
                const existingResult = await query(
                    'SELECT COUNT(*) as count FROM events WHERE session_id = $1',
                    [sessionId]
                );
                
                const existingCount = parseInt(existingResult.rows[0].count);
                
                if (existingCount > 0) {
                    console.log(`⏭️  Skipping ${sessionId.substring(0, 8)}... (already has ${existingCount} events in DB)`);
                    totalSkipped++;
                    continue;
                }
                
                // Read JSON file
                const fileContent = fs.readFileSync(filePath, 'utf8');
                let events;
                
                try {
                    events = JSON.parse(fileContent);
                } catch (parseError) {
                    console.log(`⚠️  Skipping ${sessionId.substring(0, 8)}... (invalid JSON)`);
                    totalSkipped++;
                    continue;
                }
                
                if (!Array.isArray(events) || events.length === 0) {
                    console.log(`⏭️  Skipping ${sessionId.substring(0, 8)}... (empty or not an array)`);
                    totalSkipped++;
                    continue;
                }
                
                // Check if session exists in DB
                const sessionResult = await query(
                    'SELECT id FROM live_sessions WHERE id = $1',
                    [sessionId]
                );
                
                if (sessionResult.rows.length === 0) {
                    console.log(`⚠️  Skipping ${sessionId.substring(0, 8)}... (session not found in DB)`);
                    totalSkipped++;
                    continue;
                }
                
                // Migrate events to DB
                const client = await pool.connect();
                try {
                    await client.query('BEGIN');
                    
                    let inserted = 0;
                    for (const event of events) {
                        try {
                            const row = jsonToRowForEvents(event);
                            await client.query(
                                `INSERT INTO events (id, session_id, type, timestamp, user_data, event_data, location)
                                 VALUES ($1, $2, $3, $4, $5, $6, $7)
                                 ON CONFLICT (id) DO NOTHING`,
                                [
                                    row.id,
                                    row.session_id,
                                    row.type,
                                    row.timestamp,
                                    JSON.stringify(row.user_data),
                                    JSON.stringify(row.event_data),
                                    row.location ? JSON.stringify(row.location) : null
                                ]
                            );
                            inserted++;
                        } catch (err) {
                            // Skip duplicate or invalid events
                            if (!err.message.includes('duplicate key')) {
                                console.error(`  Error inserting event: ${err.message}`);
                            }
                        }
                    }
                    
                    await client.query('COMMIT');
                    console.log(`✓ Migrated ${sessionId.substring(0, 8)}... (${inserted}/${events.length} events)`);
                    totalMigrated += inserted;
                } catch (error) {
                    await client.query('ROLLBACK');
                    console.error(`❌ Error migrating ${sessionId.substring(0, 8)}...: ${error.message}`);
                } finally {
                    client.release();
                }
                
            } catch (error) {
                console.error(`❌ Error processing ${file}: ${error.message}`);
            }
        }
        
        console.log(`\n✅ Migration complete!`);
        console.log(`   Migrated: ${totalMigrated} events`);
        console.log(`   Skipped: ${totalSkipped} files`);
        
        process.exit(0);
    } catch (error) {
        console.error('❌ Migration error:', error);
        process.exit(1);
    }
})();
