const { v4: uuid } = require('uuid');
const logger = require('../utils/logger');
const eventBus = require('../core/EventBus');
const cmdExecutor = require('./CmdExecutor');
const path = require('path');

/**
 * Manage Claude Code sessions per project
 * Uses session-based CLI commands with --session-id and --resume
 */
class SessionManager {
  constructor() {
    this.sessions = new Map(); // projectId -> sessionId
    this.config = null;
    this.sessionRepository = null;
  }

  /**
   * Initialize with configuration and repository
   */
  initialize(config, sessionRepository = null) {
    this.config = config;
    this.sessionRepository = sessionRepository;

    // Subscribe to session events
    this.setupEventListeners();

    // Start idle session cleanup
    this.startIdleCleanup();

    logger.info('SessionManager initialized');
    return this;
  }

  /**
   * Setup event listeners
   */
  setupEventListeners() {
    eventBus.subscribe(eventBus.constructor.Events.SESSION_TERMINATED, (data) => {
      this.handleSessionTerminated(data);
    });

    eventBus.subscribe(eventBus.constructor.Events.SESSION_ERROR, (data) => {
      this.handleSessionError(data);
    });
  }

  /**
   * Get or create a session for a project
   */
  async getOrCreateSession(projectId, projectName) {
    // Check if session already exists
    const existingSessionId = this.sessions.get(projectId);
    if (existingSessionId) {
      const session = cmdExecutor.getSession(existingSessionId);
      if (session && session.status !== 'terminated') {
        logger.debug('Using existing session', {
          projectId,
          sessionId: existingSessionId,
          commandCount: session.commandCount
        });
        return existingSessionId;
      }
      // Session exists but terminated, remove it
      this.sessions.delete(projectId);
    }

    // Create new session
    const sessionId = uuid();
    const projectPath = this.getProjectPath(projectName);

    logger.info('Creating new session', { projectId, projectName, sessionId, projectPath });

    eventBus.emitEvent(eventBus.constructor.Events.SESSION_STARTING, {
      sessionId,
      projectId,
      projectName
    });

    try {
      await cmdExecutor.createSession(sessionId, projectPath);
      this.sessions.set(projectId, sessionId);
      return sessionId;
    } catch (error) {
      logger.error('Failed to create session', { error: error.message, projectId });
      throw error;
    }
  }

  /**
   * Get project path from project name
   */
  getProjectPath(projectName) {
    const basePath = this.config.basePath || 'C:\\RemoteClaudeCode';
    return path.join(basePath, projectName);
  }

  /**
   * Send command to project session
   * Returns the output from Claude
   * @param {function} progressCallback - Optional callback for progress updates
   * @param {object} options - Optional settings (mcpConfig, etc.)
   */
  async sendCommand(projectId, projectName, command, progressCallback = null, options = {}) {
    const sessionId = await this.getOrCreateSession(projectId, projectName);

    // Register progress callback if provided
    if (progressCallback) {
      cmdExecutor.onProgress(sessionId, progressCallback);
    }

    const result = await cmdExecutor.sendCommand(sessionId, command, options);
    return {
      sessionId,
      ...result
    };
  }

  /**
   * Get session by project ID
   */
  getSessionByProject(projectId) {
    const sessionId = this.sessions.get(projectId);
    if (!sessionId) return null;
    return cmdExecutor.getSession(sessionId);
  }

  /**
   * Get session ID by project ID
   */
  getSessionId(projectId) {
    return this.sessions.get(projectId);
  }

  /**
   * Check if project has an active session with conversation history
   */
  hasActiveSession(projectId) {
    const sessionId = this.sessions.get(projectId);
    if (!sessionId) return false;

    return cmdExecutor.hasSession(sessionId);
  }

  /**
   * Check if project has conversation history (can use --resume)
   */
  hasConversationHistory(projectId) {
    const sessionId = this.sessions.get(projectId);
    if (!sessionId) return false;

    return cmdExecutor.hasConversationHistory(sessionId);
  }

  /**
   * Get session status for a project
   */
  getSessionStatus(projectId) {
    const sessionId = this.sessions.get(projectId);
    if (!sessionId) {
      return { exists: false, status: 'none' };
    }

    return cmdExecutor.getSessionStatus(sessionId);
  }

  /**
   * Get all active sessions
   */
  getAllSessions() {
    return cmdExecutor.getAllSessions();
  }

  /**
   * Terminate session for a project
   */
  async terminateProject(projectId) {
    const sessionId = this.sessions.get(projectId);
    if (!sessionId) return false;

    await cmdExecutor.terminateSession(sessionId);
    this.sessions.delete(projectId);

    return true;
  }

  /**
   * Terminate all sessions
   */
  async terminateAll() {
    await cmdExecutor.terminateAll();
    this.sessions.clear();
  }

  /**
   * Handle session terminated event
   */
  handleSessionTerminated(data) {
    const { sessionId } = data;

    // Find and remove project mapping
    for (const [projectId, sid] of this.sessions.entries()) {
      if (sid === sessionId) {
        this.sessions.delete(projectId);
        break;
      }
    }
  }

  /**
   * Handle session error event
   */
  handleSessionError(data) {
    const { sessionId, error } = data;
    logger.error('Session error', { sessionId, error });
  }

  /**
   * Start periodic cleanup of idle sessions
   */
  startIdleCleanup() {
    const timeout = this.config?.claudeCode?.sessionTimeout || 3600000; // Default 1 hour

    setInterval(() => {
      this.cleanupIdleSessions(timeout);
    }, 60000); // Check every minute
  }

  /**
   * Cleanup idle sessions
   */
  async cleanupIdleSessions(maxIdleTime) {
    const now = Date.now();
    const sessions = cmdExecutor.getAllSessions();

    for (const session of sessions) {
      const idleTime = now - session.lastActivity;
      if (idleTime > maxIdleTime) {
        logger.info('Cleaning up idle session', {
          sessionId: session.sessionId,
          idleTime: Math.round(idleTime / 1000 / 60) + ' minutes'
        });

        await cmdExecutor.terminateSession(session.sessionId);

        // Find and remove project mapping
        for (const [projectId, sid] of this.sessions.entries()) {
          if (sid === session.sessionId) {
            this.sessions.delete(projectId);
            break;
          }
        }
      }
    }
  }

  /**
   * Get session statistics
   */
  getStats() {
    return cmdExecutor.getStats();
  }

  /**
   * Recover sessions from database on startup
   * Note: With the new approach, sessions don't persist across restarts
   * Claude's session history is stored by Claude itself via --session-id
   */
  async recoverSessions() {
    logger.info('Session recovery completed', { count: 0 });
  }
}

module.exports = new SessionManager();
