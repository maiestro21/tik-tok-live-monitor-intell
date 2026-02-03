const fs = require('fs');
const path = require('path');

/**
 * Cleanup script to remove all JSON files from database/ directory
 * after migration to PostgreSQL is complete
 */
async function cleanupJsonFiles() {
    const databaseDir = path.join(__dirname, '..', 'database');
    
    if (!fs.existsSync(databaseDir)) {
        console.log('❌ Database directory does not exist');
        return;
    }
    
    console.log('🧹 Starting cleanup of JSON files...\n');
    
    let totalDeleted = 0;
    let totalErrors = 0;
    
    // List of directories/files to clean
    const itemsToClean = [
        'alerts.json',
        'anti_blocking_settings.json',
        'console_logs.json',
        'monitored.json',
        'tiktok_accounts.json',
        'tiktok_blocks.json',
        'trigger_words.json',
        'users.json',
        'events',
        'live_sessions',
        'stats_history',
        'account_history'
    ];
    
    for (const item of itemsToClean) {
        const itemPath = path.join(databaseDir, item);
        
        try {
            if (!fs.existsSync(itemPath)) {
                console.log(`⏭️  Skipping ${item} (does not exist)`);
                continue;
            }
            
            const stat = fs.statSync(itemPath);
            
            if (stat.isFile()) {
                // Delete file
                fs.unlinkSync(itemPath);
                console.log(`✓ Deleted file: ${item}`);
                totalDeleted++;
            } else if (stat.isDirectory()) {
                // Delete directory recursively
                const deleted = deleteDirectory(itemPath);
                if (deleted.count > 0) {
                    console.log(`✓ Deleted directory: ${item} (${deleted.count} files)`);
                    totalDeleted += deleted.count;
                } else {
                    console.log(`⏭️  Skipped empty directory: ${item}`);
                }
                totalErrors += deleted.errors;
            }
        } catch (error) {
            console.error(`❌ Error deleting ${item}: ${error.message}`);
            totalErrors++;
        }
    }
    
    console.log(`\n✅ Cleanup complete!`);
    console.log(`   Deleted: ${totalDeleted} files`);
    if (totalErrors > 0) {
        console.log(`   Errors: ${totalErrors}`);
    }
}

function deleteDirectory(dirPath) {
    let count = 0;
    let errors = 0;
    
    try {
        const files = fs.readdirSync(dirPath);
        
        for (const file of files) {
            const filePath = path.join(dirPath, file);
            
            try {
                const stat = fs.statSync(filePath);
                
                if (stat.isFile()) {
                    fs.unlinkSync(filePath);
                    count++;
                } else if (stat.isDirectory()) {
                    const result = deleteDirectory(filePath);
                    count += result.count;
                    errors += result.errors;
                }
            } catch (error) {
                console.error(`  ❌ Error deleting ${filePath}: ${error.message}`);
                errors++;
            }
        }
        
        // Remove empty directory
        try {
            fs.rmdirSync(dirPath);
        } catch (error) {
            // Directory might not be empty or might have been deleted already
            if (error.code !== 'ENOTEMPTY' && error.code !== 'ENOENT') {
                throw error;
            }
        }
    } catch (error) {
        console.error(`  ❌ Error reading directory ${dirPath}: ${error.message}`);
        errors++;
    }
    
    return { count, errors };
}

// Run cleanup
cleanupJsonFiles().then(() => {
    console.log('\n🎉 All done!');
    process.exit(0);
}).catch((error) => {
    console.error('\n❌ Cleanup failed:', error);
    process.exit(1);
});
