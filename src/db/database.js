const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

const dbPath = path.join(__dirname, '..', '..', 'data', 'bridge.db');

class DatabaseManager {
  constructor() {
    this.db = null;
    this.SQL = null;
  }

  /**
   * Initialize database connection and create tables
   */
  async initialize() {
    logger.info('Initializing database...');

    // Initialize sql.js
    this.SQL = await initSqlJs();

    // Load existing database or create new one
    if (fs.existsSync(dbPath)) {
      const fileBuffer = fs.readFileSync(dbPath);
      this.db = new this.SQL.Database(fileBuffer);
      logger.info('Loaded existing database');
    } else {
      // Ensure data directory exists
      const dataDir = path.dirname(dbPath);
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }
      this.db = new this.SQL.Database();
      logger.info('Created new database');
    }

    this.createTables();
    this.saveDatabase();

    logger.info('Database initialized successfully');
    return this;
  }

  /**
   * Save database to file
   */
  saveDatabase() {
    if (this.db) {
      const data = this.db.export();
      const buffer = Buffer.from(data);
      fs.writeFileSync(dbPath, buffer);
    }
  }

  /**
   * Create all required tables
   */
  createTables() {
    // Projects table - WhatsApp groups mapped to folders
    this.db.run(`
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        folder_path TEXT NOT NULL,
        whatsapp_group_id TEXT NOT NULL UNIQUE,
        whatsapp_group_name TEXT,
        created_at INTEGER DEFAULT (strftime('%s', 'now')),
        updated_at INTEGER DEFAULT (strftime('%s', 'now')),
        is_active INTEGER DEFAULT 1,
        config_json TEXT DEFAULT '{}'
      )
    `);

    // Authorized users table
    this.db.run(`
      CREATE TABLE IF NOT EXISTS authorized_users (
        id TEXT PRIMARY KEY,
        phone_number TEXT NOT NULL,
        display_name TEXT,
        project_id TEXT,
        role TEXT DEFAULT 'user',
        created_at INTEGER DEFAULT (strftime('%s', 'now')),
        is_active INTEGER DEFAULT 1,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      )
    `);

    // Sessions table - Active Claude Code processes
    this.db.run(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        pid INTEGER,
        status TEXT DEFAULT 'inactive',
        started_at INTEGER,
        last_activity INTEGER,
        error_message TEXT,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      )
    `);

    // Command queue table
    this.db.run(`
      CREATE TABLE IF NOT EXISTS command_queue (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        command_text TEXT NOT NULL,
        command_type TEXT DEFAULT 'command',
        sender_phone TEXT NOT NULL,
        sender_name TEXT,
        operation_type TEXT DEFAULT 'unknown',
        status TEXT DEFAULT 'pending',
        priority INTEGER DEFAULT 0,
        created_at INTEGER DEFAULT (strftime('%s', 'now')),
        started_at INTEGER,
        completed_at INTEGER,
        raw_output TEXT,
        summary TEXT,
        error_message TEXT,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      )
    `);

    // Pending approvals table
    this.db.run(`
      CREATE TABLE IF NOT EXISTS pending_approvals (
        id TEXT PRIMARY KEY,
        command_id TEXT,
        project_id TEXT NOT NULL,
        session_id TEXT,
        operation_description TEXT NOT NULL,
        approval_type TEXT DEFAULT 'command',
        raw_prompt TEXT,
        status TEXT DEFAULT 'pending',
        requested_at INTEGER DEFAULT (strftime('%s', 'now')),
        responded_at INTEGER,
        responder_phone TEXT,
        timeout_seconds INTEGER DEFAULT 120,
        whatsapp_message_id TEXT,
        FOREIGN KEY (command_id) REFERENCES command_queue(id) ON DELETE CASCADE,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE SET NULL
      )
    `);

    // Operation allowlist table (per-project overrides)
    this.db.run(`
      CREATE TABLE IF NOT EXISTS operation_allowlist (
        id TEXT PRIMARY KEY,
        project_id TEXT,
        pattern TEXT NOT NULL,
        operation_type TEXT NOT NULL,
        auto_approve INTEGER DEFAULT 0,
        description TEXT,
        created_at INTEGER DEFAULT (strftime('%s', 'now')),
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      )
    `);

    // Activity log table
    this.db.run(`
      CREATE TABLE IF NOT EXISTS activity_log (
        id TEXT PRIMARY KEY,
        project_id TEXT,
        session_id TEXT,
        event_type TEXT NOT NULL,
        description TEXT,
        metadata_json TEXT,
        created_at INTEGER DEFAULT (strftime('%s', 'now')),
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL,
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE SET NULL
      )
    `);

    // OAuth state table (for remote login)
    this.db.run(`
      CREATE TABLE IF NOT EXISTS oauth_state (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        oauth_url TEXT,
        status TEXT DEFAULT 'pending',
        created_at INTEGER DEFAULT (strftime('%s', 'now')),
        completed_at INTEGER,
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
      )
    `);

    // Create indexes
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_command_queue_project ON command_queue(project_id)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_command_queue_status ON command_queue(status)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_pending_approvals_status ON pending_approvals(status)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_id)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_activity_log_project ON activity_log(project_id)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_activity_log_created ON activity_log(created_at)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_authorized_users_phone ON authorized_users(phone_number)`);

    logger.info('Database tables created');
  }

  /**
   * Get database instance with helper methods
   */
  getDb() {
    const self = this;
    return {
      /**
       * Prepare a statement (returns wrapper with better-sqlite3-like API)
       */
      prepare(sql) {
        return {
          run(...params) {
            self.db.run(sql, params);
            self.saveDatabase();
            return { changes: self.db.getRowsModified() };
          },
          get(...params) {
            const stmt = self.db.prepare(sql);
            stmt.bind(params);
            if (stmt.step()) {
              const row = stmt.getAsObject();
              stmt.free();
              return row;
            }
            stmt.free();
            return null;
          },
          all(...params) {
            const results = [];
            const stmt = self.db.prepare(sql);
            stmt.bind(params);
            while (stmt.step()) {
              results.push(stmt.getAsObject());
            }
            stmt.free();
            return results;
          }
        };
      },
      /**
       * Execute SQL directly
       */
      exec(sql) {
        self.db.exec(sql);
        self.saveDatabase();
      },
      /**
       * Run SQL with params
       */
      run(sql, params = []) {
        self.db.run(sql, params);
        self.saveDatabase();
      }
    };
  }

  /**
   * Close database connection
   */
  close() {
    if (this.db) {
      this.saveDatabase();
      this.db.close();
      logger.info('Database connection closed');
    }
  }
}

// Export singleton instance
const databaseManager = new DatabaseManager();
module.exports = databaseManager;
