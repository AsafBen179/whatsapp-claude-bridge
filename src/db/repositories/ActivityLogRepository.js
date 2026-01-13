const { v4: uuidv4 } = require('uuid');
const database = require('../database');

/**
 * Repository for activity log data access
 */
class ActivityLogRepository {
  /**
   * Log an activity
   */
  log(eventType, description, options = {}) {
    const db = database.getDb();
    const id = uuidv4();

    const stmt = db.prepare(`
      INSERT INTO activity_log (id, project_id, session_id, event_type, description, metadata_json)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      options.projectId || null,
      options.sessionId || null,
      eventType,
      description,
      options.metadata ? JSON.stringify(options.metadata) : null
    );

    return id;
  }

  /**
   * Log message received
   */
  logMessageReceived(projectId, senderPhone, messageType) {
    return this.log('message_received', `Message from ${senderPhone}`, {
      projectId,
      metadata: { senderPhone, messageType }
    });
  }

  /**
   * Log command started
   */
  logCommandStarted(projectId, sessionId, command) {
    return this.log('command_started', `Command: ${command.substring(0, 100)}`, {
      projectId,
      sessionId,
      metadata: { commandPreview: command.substring(0, 200) }
    });
  }

  /**
   * Log command completed
   */
  logCommandCompleted(projectId, sessionId, durationMs) {
    return this.log('command_completed', `Completed in ${durationMs}ms`, {
      projectId,
      sessionId,
      metadata: { durationMs }
    });
  }

  /**
   * Log permission requested
   */
  logPermissionRequested(projectId, sessionId, operation) {
    return this.log('permission_requested', `Permission: ${operation}`, {
      projectId,
      sessionId,
      metadata: { operation }
    });
  }

  /**
   * Log permission response
   */
  logPermissionResponse(projectId, sessionId, approved, responderPhone) {
    const status = approved ? 'approved' : 'rejected';
    return this.log('permission_response', `Permission ${status} by ${responderPhone}`, {
      projectId,
      sessionId,
      metadata: { approved, responderPhone }
    });
  }

  /**
   * Log auto-approval
   */
  logAutoApproval(projectId, sessionId, operation, rule) {
    return this.log('auto_approved', `Auto-approved: ${operation}`, {
      projectId,
      sessionId,
      metadata: { operation, rule }
    });
  }

  /**
   * Log session started
   */
  logSessionStarted(projectId, sessionId) {
    return this.log('session_started', 'Claude Code session started', {
      projectId,
      sessionId
    });
  }

  /**
   * Log session ended
   */
  logSessionEnded(projectId, sessionId, reason) {
    return this.log('session_ended', `Session ended: ${reason}`, {
      projectId,
      sessionId,
      metadata: { reason }
    });
  }

  /**
   * Log OAuth event
   */
  logOAuthEvent(projectId, sessionId, eventType) {
    return this.log('oauth_event', `OAuth: ${eventType}`, {
      projectId,
      sessionId,
      metadata: { eventType }
    });
  }

  /**
   * Log error
   */
  logError(eventType, errorMessage, options = {}) {
    return this.log(`error_${eventType}`, errorMessage, {
      projectId: options.projectId,
      sessionId: options.sessionId,
      metadata: { error: errorMessage, ...options.metadata }
    });
  }

  /**
   * Get recent logs for a project
   */
  getByProject(projectId, limit = 50) {
    const db = database.getDb();
    const rows = db.prepare(`
      SELECT * FROM activity_log
      WHERE project_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `).all(projectId, limit);
    return rows.map(row => this.parseLog(row));
  }

  /**
   * Get recent logs for a session
   */
  getBySession(sessionId, limit = 50) {
    const db = database.getDb();
    const rows = db.prepare(`
      SELECT * FROM activity_log
      WHERE session_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `).all(sessionId, limit);
    return rows.map(row => this.parseLog(row));
  }

  /**
   * Get recent logs system-wide
   */
  getRecent(limit = 100) {
    const db = database.getDb();
    const rows = db.prepare(`
      SELECT al.*, p.name as project_name
      FROM activity_log al
      LEFT JOIN projects p ON al.project_id = p.id
      ORDER BY al.created_at DESC
      LIMIT ?
    `).all(limit);
    return rows.map(row => ({
      ...this.parseLog(row),
      projectName: row.project_name
    }));
  }

  /**
   * Get logs by event type
   */
  getByEventType(eventType, limit = 50) {
    const db = database.getDb();
    const rows = db.prepare(`
      SELECT * FROM activity_log
      WHERE event_type = ?
      ORDER BY created_at DESC
      LIMIT ?
    `).all(eventType, limit);
    return rows.map(row => this.parseLog(row));
  }

  /**
   * Search logs
   */
  search(query, options = {}) {
    const db = database.getDb();
    let sql = `
      SELECT * FROM activity_log
      WHERE (description LIKE ? OR event_type LIKE ?)
    `;
    const params = [`%${query}%`, `%${query}%`];

    if (options.projectId) {
      sql += ' AND project_id = ?';
      params.push(options.projectId);
    }

    if (options.eventType) {
      sql += ' AND event_type = ?';
      params.push(options.eventType);
    }

    sql += ' ORDER BY created_at DESC LIMIT ?';
    params.push(options.limit || 50);

    const rows = db.prepare(sql).all(...params);
    return rows.map(row => this.parseLog(row));
  }

  /**
   * Cleanup old logs
   */
  cleanup(daysToKeep = 30) {
    const db = database.getDb();
    const cutoff = Math.floor(Date.now() / 1000) - (daysToKeep * 24 * 60 * 60);

    const stmt = db.prepare(`
      DELETE FROM activity_log
      WHERE created_at < ?
    `);
    const result = stmt.run(cutoff);
    return result.changes;
  }

  /**
   * Parse database row to log object
   */
  parseLog(row) {
    return {
      id: row.id,
      projectId: row.project_id,
      sessionId: row.session_id,
      eventType: row.event_type,
      description: row.description,
      metadata: row.metadata_json ? JSON.parse(row.metadata_json) : null,
      createdAt: new Date(row.created_at * 1000)
    };
  }
}

module.exports = new ActivityLogRepository();
