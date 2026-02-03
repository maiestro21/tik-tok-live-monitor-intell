const { query } = require('../backend/config/database');

(async () => {
    try {
        // Get all ended sessions
        const sessionsResult = await query(
            `SELECT id, handle, status, start_time, end_time 
             FROM live_sessions 
             WHERE status = 'ended' 
             ORDER BY end_time DESC 
             LIMIT 10`
        );
        
        console.log(`Found ${sessionsResult.rows.length} ended sessions\n`);
        
        for (const session of sessionsResult.rows) {
            const eventCountResult = await query(
                'SELECT COUNT(*) as count FROM events WHERE session_id = $1',
                [session.id]
            );
            
            const eventCount = parseInt(eventCountResult.rows[0].count);
            const hasEvents = eventCount > 0;
            
            console.log(`Session: ${session.id.substring(0, 8)}...`);
            console.log(`  Handle: @${session.handle}`);
            console.log(`  Status: ${session.status}`);
            console.log(`  Events in DB: ${eventCount}`);
            console.log(`  ${hasEvents ? '✓' : '✗'} Has events: ${hasEvents}`);
            console.log('');
        }
        
        process.exit(0);
    } catch (error) {
        console.error('❌ Error:', error.message);
        process.exit(1);
    }
})();
