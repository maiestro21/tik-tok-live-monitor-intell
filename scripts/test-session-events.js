const { query } = require('../backend/config/database');

(async () => {
    try {
        const sessionId = '86e862fd-9faf-4556-9abc-66c9ef14d8bb';
        
        // Check session
        const sessionResult = await query(
            'SELECT id, handle, status, start_time, end_time FROM live_sessions WHERE id = $1',
            [sessionId]
        );
        
        if (sessionResult.rows.length === 0) {
            console.log('❌ Session NOT found in DB');
            process.exit(1);
        }
        
        console.log('✓ Session found:', {
            id: sessionResult.rows[0].id,
            handle: sessionResult.rows[0].handle,
            status: sessionResult.rows[0].status,
            start_time: sessionResult.rows[0].start_time,
            end_time: sessionResult.rows[0].end_time
        });
        
        // Check events count
        const countResult = await query(
            'SELECT COUNT(*) as count FROM events WHERE session_id = $1',
            [sessionId]
        );
        
        const eventCount = parseInt(countResult.rows[0].count);
        console.log(`\n📊 Events count in DB: ${eventCount}`);
        
        if (eventCount > 0) {
            // Get sample events
            const sampleResult = await query(
                'SELECT type, timestamp FROM events WHERE session_id = $1 ORDER BY timestamp DESC LIMIT 10',
                [sessionId]
            );
            
            console.log('\n📝 Sample events (last 10):');
            sampleResult.rows.forEach((row, i) => {
                console.log(`  ${i + 1}. ${row.type} - ${row.timestamp}`);
            });
            
            // Get events by type
            const typeResult = await query(
                `SELECT type, COUNT(*) as count 
                 FROM events 
                 WHERE session_id = $1 
                 GROUP BY type 
                 ORDER BY count DESC`,
                [sessionId]
            );
            
            console.log('\n📈 Events by type:');
            typeResult.rows.forEach(row => {
                console.log(`  ${row.type}: ${row.count}`);
            });
        } else {
            console.log('\n⚠️  No events found in DB for this session!');
            console.log('   This could mean:');
            console.log('   1. Events were not migrated from JSON files');
            console.log('   2. Events were never saved to DB');
            console.log('   3. Session was created before migration');
        }
        
        process.exit(0);
    } catch (error) {
        console.error('❌ Error:', error.message);
        console.error(error.stack);
        process.exit(1);
    }
})();
