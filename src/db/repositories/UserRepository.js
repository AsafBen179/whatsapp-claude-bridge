const { v4: uuidv4 } = require('uuid');
const database = require('../database');

/**
 * Repository for authorized users data access
 */
class UserRepository {
  /**
   * Create a new authorized user
   */
  create(phoneNumber, projectId = null, role = 'user', displayName = null) {
    const db = database.getDb();
    const id = uuidv4();

    const stmt = db.prepare(`
      INSERT INTO authorized_users (id, phone_number, display_name, project_id, role)
      VALUES (?, ?, ?, ?, ?)
    `);

    stmt.run(id, phoneNumber, displayName, projectId, role);
    return this.findById(id);
  }

  /**
   * Find user by ID
   */
  findById(id) {
    const db = database.getDb();
    const row = db.prepare('SELECT * FROM authorized_users WHERE id = ?').get(id);
    return row ? this.parseUser(row) : null;
  }

  /**
   * Find user by phone number (returns first match)
   */
  findByPhone(phoneNumber) {
    const db = database.getDb();
    const normalized = phoneNumber.replace(/\D/g, '');
    const row = db.prepare(`
      SELECT * FROM authorized_users
      WHERE phone_number LIKE ? AND is_active = 1
    `).get(`%${normalized}%`);
    return row ? this.parseUser(row) : null;
  }

  /**
   * Find all users for a project
   */
  findByProject(projectId) {
    const db = database.getDb();
    const rows = db.prepare(`
      SELECT * FROM authorized_users
      WHERE project_id = ? AND is_active = 1
      ORDER BY role, phone_number
    `).all(projectId);
    return rows.map(row => this.parseUser(row));
  }

  /**
   * Find users with a specific role
   */
  findByRole(role, projectId = null) {
    const db = database.getDb();
    let query = 'SELECT * FROM authorized_users WHERE role = ? AND is_active = 1';
    const params = [role];

    if (projectId) {
      query += ' AND project_id = ?';
      params.push(projectId);
    }

    const rows = db.prepare(query).all(...params);
    return rows.map(row => this.parseUser(row));
  }

  /**
   * Check if user is authorized for a project
   */
  isAuthorized(phoneNumber, projectId) {
    const db = database.getDb();
    const normalized = phoneNumber.replace(/\D/g, '');

    // Check project-specific authorization
    const projectUser = db.prepare(`
      SELECT * FROM authorized_users
      WHERE phone_number LIKE ? AND project_id = ? AND is_active = 1
    `).get(`%${normalized}%`, projectId);

    if (projectUser) return true;

    // Check global authorization (project_id IS NULL)
    const globalUser = db.prepare(`
      SELECT * FROM authorized_users
      WHERE phone_number LIKE ? AND project_id IS NULL AND is_active = 1
    `).get(`%${normalized}%`);

    return !!globalUser;
  }

  /**
   * Get user role for a project
   */
  getRole(phoneNumber, projectId) {
    const db = database.getDb();
    const normalized = phoneNumber.replace(/\D/g, '');

    // Check project-specific role first
    const projectUser = db.prepare(`
      SELECT role FROM authorized_users
      WHERE phone_number LIKE ? AND project_id = ? AND is_active = 1
    `).get(`%${normalized}%`, projectId);

    if (projectUser) return projectUser.role;

    // Check global role
    const globalUser = db.prepare(`
      SELECT role FROM authorized_users
      WHERE phone_number LIKE ? AND project_id IS NULL AND is_active = 1
    `).get(`%${normalized}%`);

    return globalUser ? globalUser.role : null;
  }

  /**
   * Update user
   */
  update(id, updates) {
    const db = database.getDb();
    const fields = [];
    const values = [];

    if (updates.displayName !== undefined) {
      fields.push('display_name = ?');
      values.push(updates.displayName);
    }
    if (updates.role !== undefined) {
      fields.push('role = ?');
      values.push(updates.role);
    }
    if (updates.projectId !== undefined) {
      fields.push('project_id = ?');
      values.push(updates.projectId);
    }
    if (updates.isActive !== undefined) {
      fields.push('is_active = ?');
      values.push(updates.isActive ? 1 : 0);
    }

    if (fields.length === 0) return this.findById(id);

    values.push(id);
    const stmt = db.prepare(`UPDATE authorized_users SET ${fields.join(', ')} WHERE id = ?`);
    stmt.run(...values);

    return this.findById(id);
  }

  /**
   * Delete user (soft delete)
   */
  delete(id) {
    return this.update(id, { isActive: false });
  }

  /**
   * Parse database row to user object
   */
  parseUser(row) {
    return {
      id: row.id,
      phoneNumber: row.phone_number,
      displayName: row.display_name,
      projectId: row.project_id,
      role: row.role,
      createdAt: new Date(row.created_at * 1000),
      isActive: row.is_active === 1
    };
  }
}

module.exports = new UserRepository();
