const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const logger = require('../utils/logger');
const eventBus = require('../core/EventBus');

/**
 * Execute Claude Code CLI using cmd.exe /c
 * Each command runs in its own process for reliability
 */
class CmdExecutor {
  constructor() {
    this.sessions = new Map(); // sessionId -> session info
  }

  /**
   * Create a new session (stores metadata, no process yet)
   */
  async createSession(sessionId, projectPath) {
    logger.info('Creating session', { sessionId, projectPath });

    // Ensure project folder exists
    await this.ensureDirectory(projectPath);

    const sessionInfo = {
      sessionId,
      claudeSessionId: uuidv4(), // Claude's internal session ID for --resume
      projectPath,
      status: 'ready',
      commandCount: 0,
      createdAt: Date.now(),
      lastActivity: Date.now(),
      lastOutput: '',
      currentProcess: null
    };

    this.sessions.set(sessionId, sessionInfo);

    eventBus.emitEvent(eventBus.constructor.Events.SESSION_STARTED, {
      sessionId,
      projectPath
    });

    logger.info('Session created', {
      sessionId,
      claudeSessionId: sessionInfo.claudeSessionId
    });

    return sessionInfo;
  }

  /**
   * Send command to Claude using cmd.exe /c
   */
  async sendCommand(sessionId, command) {
    const sessionInfo = this.sessions.get(sessionId);
    if (!sessionInfo) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    const isFirstCommand = sessionInfo.commandCount === 0;
    sessionInfo.commandCount++;
    sessionInfo.lastActivity = Date.now();
    sessionInfo.status = 'running';

    // Build Claude arguments
    // --dangerously-skip-permissions bypasses the "trust this folder" prompt
    const claudeArgs = ['-p', command, '--dangerously-skip-permissions'];

    // Use --session-id for first command, --resume for subsequent
    if (isFirstCommand) {
      claudeArgs.push('--session-id', sessionInfo.claudeSessionId);
      logger.info('Starting new Claude session', {
        sessionId,
        claudeSessionId: sessionInfo.claudeSessionId,
        command: command.substring(0, 100)
      });
    } else {
      claudeArgs.push('--resume', sessionInfo.claudeSessionId);
      logger.info('Resuming Claude session', {
        sessionId,
        claudeSessionId: sessionInfo.claudeSessionId,
        commandNumber: sessionInfo.commandCount,
        command: command.substring(0, 100)
      });
    }

    logger.command(sessionInfo.projectPath, command);

    return new Promise((resolve, reject) => {
      let stdout = '';
      let stderr = '';

      // Use cmd.exe /c to run claude command
      const args = ['/c', 'claude', ...claudeArgs];

      const proc = spawn('cmd.exe', args, {
        cwd: sessionInfo.projectPath,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true
      });

      sessionInfo.currentProcess = proc;

      // Close stdin immediately to prevent blocking on input prompts
      proc.stdin.end();

      // Timeout after 5 minutes
      const timeout = setTimeout(() => {
        logger.warn('Command timeout', { sessionId });
        proc.kill('SIGTERM');
        sessionInfo.status = 'ready';
        sessionInfo.currentProcess = null;
        reject(new Error('Command timeout after 5 minutes'));
      }, 5 * 60 * 1000);

      proc.stdout.on('data', (data) => {
        const chunk = data.toString();
        stdout += chunk;
        sessionInfo.lastActivity = Date.now();

        logger.debug('Claude output chunk', {
          sessionId,
          chunkLength: chunk.length
        });

        // Emit progress event
        eventBus.emitEvent(eventBus.constructor.Events.SESSION_OUTPUT, {
          sessionId,
          output: chunk,
          timestamp: Date.now()
        });
      });

      proc.stderr.on('data', (data) => {
        const chunk = data.toString();
        stderr += chunk;
        logger.debug('Claude stderr', { sessionId, stderr: chunk.substring(0, 200) });
      });

      proc.on('error', (error) => {
        clearTimeout(timeout);
        sessionInfo.status = 'error';
        sessionInfo.currentProcess = null;
        logger.error('Claude process error', { sessionId, error: error.message });
        reject(error);
      });

      proc.on('close', (code) => {
        clearTimeout(timeout);
        sessionInfo.status = 'ready';
        sessionInfo.lastOutput = stdout;
        sessionInfo.currentProcess = null;

        logger.info('Claude command completed', {
          sessionId,
          exitCode: code,
          outputLength: stdout.length,
          commandNumber: sessionInfo.commandCount
        });

        if (code === 0 || code === null) {
          eventBus.emitEvent(eventBus.constructor.Events.SESSION_COMPLETED, {
            sessionId,
            output: stdout
          });

          resolve({
            success: true,
            output: stdout,
            stderr: stderr,
            exitCode: code
          });
        } else {
          logger.warn('Claude exited with error code', { sessionId, code, stderr });
          resolve({
            success: false,
            output: stdout,
            stderr: stderr,
            exitCode: code
          });
        }
      });
    });
  }

  /**
   * Check if session exists
   */
  hasSession(sessionId) {
    const session = this.sessions.get(sessionId);
    return session && session.status !== 'terminated';
  }

  /**
   * Check if session has conversation history
   */
  hasConversationHistory(sessionId) {
    const session = this.sessions.get(sessionId);
    return session && session.commandCount > 0;
  }

  /**
   * Get session info
   */
  getSession(sessionId) {
    return this.sessions.get(sessionId);
  }

  /**
   * Get session status
   */
  getSessionStatus(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return { exists: false, status: 'none' };
    }
    return {
      exists: true,
      sessionId,
      claudeSessionId: session.claudeSessionId,
      status: session.status,
      commandCount: session.commandCount,
      lastActivity: session.lastActivity,
      uptime: Date.now() - session.createdAt
    };
  }

  /**
   * Get all sessions
   */
  getAllSessions() {
    return Array.from(this.sessions.values());
  }

  /**
   * Terminate session
   */
  async terminateSession(sessionId) {
    const sessionInfo = this.sessions.get(sessionId);
    if (!sessionInfo) return false;

    logger.info('Terminating session', { sessionId });

    // Kill current process if running
    if (sessionInfo.currentProcess && !sessionInfo.currentProcess.killed) {
      sessionInfo.currentProcess.kill('SIGTERM');
    }

    sessionInfo.status = 'terminated';

    eventBus.emitEvent(eventBus.constructor.Events.SESSION_TERMINATED, {
      sessionId
    });

    this.sessions.delete(sessionId);
    return true;
  }

  /**
   * Terminate all sessions
   */
  async terminateAll() {
    const sessionIds = Array.from(this.sessions.keys());
    for (const sessionId of sessionIds) {
      await this.terminateSession(sessionId);
    }
  }

  /**
   * Ensure directory exists
   */
  async ensureDirectory(dirPath) {
    try {
      await fs.promises.mkdir(dirPath, { recursive: true });
    } catch (error) {
      if (error.code !== 'EEXIST') {
        throw error;
      }
    }
  }

  /**
   * Get statistics
   */
  getStats() {
    const sessions = this.getAllSessions();
    return {
      total: sessions.length,
      ready: sessions.filter(s => s.status === 'ready').length,
      running: sessions.filter(s => s.status === 'running').length,
      withHistory: sessions.filter(s => s.commandCount > 0).length
    };
  }
}

module.exports = new CmdExecutor();
