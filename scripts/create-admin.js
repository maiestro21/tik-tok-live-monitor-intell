const bcrypt = require('bcrypt');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs').promises;
const path = require('path');

const DB_DIR = path.join(__dirname, '../database');

async function createAdminUser() {
    try {
        // Read existing users
        const usersPath = path.join(DB_DIR, 'users.json');
        let users = [];
        
        try {
            const data = await fs.readFile(usersPath, 'utf8');
            users = JSON.parse(data);
        } catch (error) {
            if (error.code !== 'ENOENT') {
                throw error;
            }
        }

        // Check if admin already exists
        const adminExists = users.find(u => u.username === 'admin');
        if (adminExists) {
            console.log('Admin user already exists!');
            return;
        }

        // Create admin user
        const hashedPassword = await bcrypt.hash('admin', 10);
        const adminUser = {
            id: uuidv4(),
            username: 'admin',
            password: hashedPassword,
            createdAt: new Date().toISOString()
        };

        users.push(adminUser);
        await fs.writeFile(usersPath, JSON.stringify(users, null, 2), 'utf8');

        console.log('✓ Admin user created successfully!');
        console.log('  Username: admin');
        console.log('  Password: admin');
        console.log('\nPlease change the password after first login.');
    } catch (error) {
        console.error('Error creating admin user:', error);
        process.exit(1);
    }
}

createAdminUser();
