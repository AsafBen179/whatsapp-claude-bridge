const { v4: uuidv4 } = require('uuid');
const database = require('../database');

/**
 * Repository for Claude Code session data access
 */
class SessionRepository {
  /**
   * Create a new session
   */
  create(projectId, pid = null) {
    const db = database.getDb();
    const id = uuidv4();

    const stmt = db.prepare(`
      INSERT INTO sessions (id, project_id, pid, status, started_at, last_activity)
      VALUES (?, ?, ?, 'starting', strftime('%s', 'now'), strftime('%s', 'now'))
    `);

    stmt.run(id, projectId, pid);
    return this.findById(id);
  }

  /**
   * Find session by ID
   */
  findById(id) {
    const db = database.getDb();
    const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id);
    return row ? this.parseSession(row) : null;
  }

  /**
   * Find active session for a project
   */
  findActiveByProject(projectId) {
    const db = database.getDb();
    const row = db.prepare(`
      SELECT * FROM sessions
      WHERE project_id = ? AND status IN ('starting', 'active', 'waiting_permission', 'waiting_oauth')
      ORDER BY started_at DESC
      LIMIT 1
    `).get(projectId);
    return row ? this.parseSession(row) : null;
  }

  /**
   * Get all active sessions
   */
  findAllActive() {
    const db = database.getDb();
    const rows = db.prepare(`
      SELECT s.*, p.name as project_name
      FROM sessions s
      LEFT JOIN projects p ON s.project_id = p.id
      WHERE s.status IN ('starting', 'active', 'waiting_permission', 'waiting_oauth')
      ORDER BY s.started_at DESC
    `).all();
    return rows.map(row => ({
      ...this.parseSession(row),
      projectName: row.project_name
    }));
  }

  /**
   * Update session status
   */
  updateStatus(id, status, errorMessage = null) {
    const db = database.getDb();
    const stmt = db.prepare(`
      UPDATE sessions
      SET status = ?, error_message = ?, last_activity = strftime('%s', 'now')
      WHERE id = ?
    `);
    stmt.run(status, errorMessage, id);
    return this.findById(id);
  }

  /**
   * Update session PID
   */
  updatePid(id, pid) {
    const db = database.getDb();
    const stmt = db.prepare(`
      UPDATE sessions
      SET pid = ?, last_activity = strftime('%s', 'now')
      WHERE id = ?
    `);
    stmt.run(pid, id);
    return this.findById(id);
  }

  /**
   * Update last activity timestamp
   */
  touch(id) {
    const db = database.getDb();
    const stmt = db.prepare(`
      UPDATE sessions
      SET last_activity = strftime('%s', 'now')
      WHERE id = ?
    `);
    stmt.run(id);
  }

  /**
   * Find stale sessions (no activity for given seconds)
   */
  findStale(maxIdleSeconds = 3600) {
    const db = database.getDb();
    const cutoff = Math.floor(Date.now() / 1000) - maxIdleSeconds;

    const rows = db.prepare(`
      SELECT * FROM sessions
      WHERE status IN ('active', 'waiting_permission')
      AND last_activity < ?
    `).all(cutoff);

    return rows.map(row => this.parseSession(row));
  }

  /**
   * End session
   */
  endSession(id, status = 'completed', errorMessage = null) {
    return this.updateStatus(id, status, errorMessage);
  }

  /**
   * Get session history for a project
   */
  getHistory(projectId, limit = 10) {
    const db = database.getDb();
    const rows = db.prepare(`
      SELECT * FROM sessions
      WHERE project_id = ?
      ORDER BY started_at DESC
      LIMIT ?
    `).all(projectId, limit);
    return rows.map(row => this.parseSession(row));
  }

  /**
   * Parse database row to session object
   */
  parseSession(row) {
    return {
      id: row.id,
      projectId: row.project_id,
      pid: row.pid,
      status: row.status,
      startedAt: row.started_at ? new Date(row.started_at * 1000) : null,
      lastActivity: row.last_activity ? new Date(row.last_activity * 1000) : null,
      errorMessage: row.error_message
    };
  }
}

module.exports = new SessionRepository();
