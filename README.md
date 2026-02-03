# T-intell

TikTok Live Intelligence Platform - Monitor TikTok accounts, capture live stream events, and generate alerts based on trigger words.

## Features

- **User Management**: Internal user authentication and management
- **T-Users Module**: Add TikTok accounts by handle, fetch profile metadata, track changes
- **T-Monitor Module**: Monitor TikTok accounts, automatically detect when they go live
- **Live Monitoring**: Capture all live stream events (messages, gifts, likes, joins, follows)
- **Trigger Words & Alerts**: Set up trigger words to get alerts when specific terms appear
- **Search All**: Advanced business intelligence and chat analysis with full-text search
- **OSINT**: Open-source intelligence gathering for TikTok users
- **Real-time Updates**: Socket.IO for real-time event streaming
- **Historical Data**: View past live sessions and events
- **Excel Export**: Export data to Excel format for analysis

## Prerequisites

- Node.js (v14 or higher)
- PostgreSQL (v12 or higher)
- npm or yarn

## Installation

### 1. Install PostgreSQL on Windows

1. **Download PostgreSQL:**
   - Visit https://www.postgresql.org/download/windows/
   - Download the PostgreSQL installer for Windows
   - Run the installer

2. **During Installation:**
   - Choose installation directory (default: `C:\Program Files\PostgreSQL\15`)
   - **Important:** Remember the password you set for the `postgres` superuser account
   - Port: Keep default `5432`
   - Locale: Use default or select your preference

3. **Post-Installation:**
   - PostgreSQL service should start automatically
   - You can verify it's running in Windows Services (search for "services" in Start menu, look for "postgresql-x64-15")

### 2. Create Database and User

1. **Open pgAdmin** (installed with PostgreSQL) or use `psql` command line:

   **Option A: Using pgAdmin (GUI)**
   - Open pgAdmin from Start menu
   - Connect to PostgreSQL server (use the password you set during installation)
   - Right-click on "Databases" → "Create" → "Database"
   - Database name: `tiktok_monitor`
   - Owner: `postgres` (or create a new user - see below)
   - Click "Save"

   **Option B: Using psql (Command Line)**
   ```bash
   # Open Command Prompt or PowerShell
   # Navigate to PostgreSQL bin directory (usually: C:\Program Files\PostgreSQL\15\bin)
   # Or add it to PATH
   
   psql -U postgres
   # Enter your postgres password when prompted
   ```

2. **Create Database:**
   ```sql
   CREATE DATABASE tiktok_monitor;
   ```

3. **Create User (Recommended):**
   ```sql
   CREATE USER localuser WITH PASSWORD 'localuser';
   GRANT ALL PRIVILEGES ON DATABASE tiktok_monitor TO localuser;
   \c tiktok_monitor
   GRANT ALL ON SCHEMA public TO localuser;
   ```

   **Note:** You can use different username/password, but make sure to update `db.txt` accordingly.

### 3. Configure Database Connection

1. **Create `db.txt` file** in the project root directory:
   ```
   databse=tiktok_monitor
   user=localuser
   password=localuser
   server=127.0.0.1
   port=5432
   ```

   **Important:**
   - `databse` (note: typo is intentional for compatibility) should be `tiktok_monitor`
   - `user` should match the PostgreSQL user you created (e.g., `localuser`)
   - `password` should match the password you set for that user
   - `server` should be `127.0.0.1` or `localhost` for local installation
   - `port` should be `5432` (default PostgreSQL port)

2. **Alternative:** You can also use the `postgres` superuser:
   ```
   databse=tiktok_monitor
   user=postgres
   password=YOUR_POSTGRES_PASSWORD
   server=127.0.0.1
   port=5432
   ```

### 4. Install Node.js Dependencies

```bash
npm install
```

### 5. Initialize Database

The application will automatically create all necessary tables and indexes on first startup. The database will be initialized with:
- All required tables (users, tiktok_accounts, live_sessions, events, alerts, etc.)
- Default admin user (username: `admin`, password: `admin`)

**Important:** Change the admin password after first login!

### 6. Start the Server

```bash
npm start
```

The application will:
- Connect to PostgreSQL database
- Create tables if they don't exist
- Create default admin user if it doesn't exist
- Start the web server on port 3000

### 7. Access the Application

Open your browser to `http://localhost:3000` and login with:
- Username: `admin`
- Password: `admin`

**Important:** Change the password immediately after first login!

## Default Configuration

- Server runs on port 3000 (configurable via PORT environment variable)
- Database: PostgreSQL (configured via `db.txt`)
- Database name: `tiktok_monitor`
- Session secret should be changed in production (see `backend/server.js`)

## Project Structure

```
T-intell/
├── backend/
│   ├── server.js              # Express server entry point
│   ├── config/
│   │   └── database.js        # PostgreSQL connection configuration
│   ├── routes/                # API routes
│   ├── services/              # Business logic services
│   ├── storage/               # Database storage abstraction
│   └── utils/                 # Utility functions
├── views/                     # EJS templates
├── public/                    # Static files (JS, CSS)
├── scripts/
│   ├── init-database.sql      # Database schema
│   └── init-database.js       # Database initialization script
├── db.txt                     # Database connection settings
└── package.json               # Node.js dependencies
```

## API Endpoints

### Authentication
- `POST /api/auth/login` - Login
- `POST /api/auth/logout` - Logout
- `GET /api/auth/me` - Get current user

### Users
- `GET /api/users` - List users
- `POST /api/users` - Create user
- `PUT /api/users/:id` - Update user
- `DELETE /api/users/:id` - Delete user
- `PUT /api/users/:id/password` - Change password

### TikTok Accounts
- `GET /api/tikusers` - List accounts
- `POST /api/tikusers` - Add account
- `GET /api/tikusers/:handle` - Get account
- `PUT /api/tikusers/:handle` - Update account
- `POST /api/tikusers/:handle/sync` - Sync account data
- `DELETE /api/tikusers/:handle` - Delete account
- `GET /api/tikusers/:handle/history` - Get change history

### Monitoring
- `GET /api/monitor/status` - Get monitoring status
- `PUT /api/monitor/:handle/toggle` - Toggle monitoring

### Live Sessions
- `GET /api/live/sessions` - List all sessions
- `GET /api/live/sessions/:sessionId` - Get session details
- `GET /api/live/sessions/:sessionId/events` - Get session events
- `GET /api/live/:handle/current` - Get current session
- `GET /api/live/:handle/history` - Get session history

### Alerts
- `GET /api/alerts` - List alerts (with filters)
- `GET /api/alerts/:id` - Get alert
- `PUT /api/alerts/:id/acknowledge` - Acknowledge alert
- `PUT /api/alerts/:id/resolve` - Resolve alert
- `GET /api/alerts/trigger-words` - List trigger words
- `POST /api/alerts/trigger-words` - Add trigger word
- `DELETE /api/alerts/trigger-words/:id` - Delete trigger word
- `GET /api/alerts/export/excel` - Export alerts to Excel

### Search All
- `GET /api/search-all/accounts` - Get all TikTok accounts
- `GET /api/search-all/autocomplete` - Username autocomplete
- `GET /api/search-all/search` - Search chat messages
- `GET /api/search-all/export/excel` - Export search results to Excel

### OSINT
- `POST /api/osint/search` - Search TikTok user information

## Database Schema

The application uses PostgreSQL with the following main tables:
- `users` - Application users
- `tiktok_accounts` - TikTok account metadata
- `live_sessions` - Live streaming sessions
- `events` - Live stream events (chat, gifts, likes, etc.)
- `alerts` - Triggered alerts
- `trigger_words` - Alert trigger words
- `monitored` - Monitoring status for accounts
- `stats_history` - Session statistics history
- `account_history` - Account change history
- `tiktok_blocks` - Block tracking data
- `console_logs` - Application logs

## Troubleshooting

### Database Connection Issues

1. **Check PostgreSQL is running:**
   - Open Windows Services
   - Look for "postgresql-x64-XX" service
   - Ensure it's "Running"

2. **Verify connection settings in `db.txt`:**
   - Check database name matches the one you created
   - Verify username and password are correct
   - Ensure server is `127.0.0.1` or `localhost`
   - Port should be `5432`

3. **Test connection manually:**
   ```bash
   psql -U localuser -d tiktok_monitor -h 127.0.0.1
   # Enter password when prompted
   ```

4. **Check PostgreSQL logs:**
   - Location: `C:\Program Files\PostgreSQL\15\data\log\`
   - Look for connection errors

### Database Initialization

If tables are not created automatically:
1. Stop the application
2. Run manually:
   ```bash
   node scripts/init-database.js
   ```
3. Restart the application

## Notes

- TikTok profile fetching uses web scraping - may be rate limited or break if TikTok changes their structure
- Monitoring checks every 2 minutes for live status
- All timestamps stored in ISO format (UTC)
- Socket.IO events: `liveSessionStarted`, `liveSessionEnded`, `liveEvent`, `newAlert`, `monitoringStatusChanged`
- Database is automatically initialized on first startup
- All trigger words are case-insensitive (stored in lowercase)
- Search functionality supports wildcards: `*` (any characters) and `%` (any symbol)

## Security Notes

- Change default admin password immediately after first login
- Use a dedicated PostgreSQL user (not `postgres` superuser) for production
- Set strong passwords for database users
- Consider using SSL for database connections in production
- Update session secret in `backend/server.js` for production
