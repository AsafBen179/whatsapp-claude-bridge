const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const logger = require('../utils/logger');
const eventBus = require('../core/EventBus');

/**
 * Execute Claude Code CLI with real-time progress tracking
 * Each command runs in its own process for reliability
 */
class CmdExecutor {
  constructor() {
    this.sessions = new Map(); // sessionId -> session info
    this.progressCallbacks = new Map(); // sessionId -> callback function
  }

  /**
   * Register a progress callback for a session
   */
  onProgress(sessionId, callback) {
    this.progressCallbacks.set(sessionId, callback);
  }

  /**
   * Remove progress callback
   */
  offProgress(sessionId) {
    this.progressCallbacks.delete(sessionId);
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
   * Send command to Claude
   * @param {string} sessionId - Session ID
   * @param {string} command - Command to send
   * @param {object} options - Optional settings (mcpConfig, etc.)
   */
  async sendCommand(sessionId, command, options = {}) {
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
    // --output-format stream-json --verbose enables real-time streaming output
    const claudeArgs = [
      '-p', command,
      '--dangerously-skip-permissions',
      '--output-format', 'stream-json',
      '--verbose'
    ];

    // Add MCP config if provided (e.g., for Playwright)
    if (options.mcpConfig) {
      claudeArgs.push('--mcp-config', options.mcpConfig);
    }

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
      let finalResult = '';  // Extracted from stream-json result message
      let jsonBuffer = '';   // Buffer for incomplete JSON lines

      // Progress tracking state
      const progress = {
        startTime: Date.now(),
        currentTool: null,
        currentAction: null,
        toolsUsed: [],
        turnCount: 0,
        lastSentTime: 0,
        lastSentAction: null,  // Track last sent action description
        backgroundNotified: false  // Track if we sent "running in background" message
      };

      // Timing constants
      const PROGRESS_CHECK_INTERVAL_MS = 10 * 1000;  // Check every 10 seconds
      const MIN_TIME_BETWEEN_UPDATES_MS = 3 * 60 * 1000;  // 3 minutes between same-state updates
      const BACKGROUND_THRESHOLD_MS = 10 * 60 * 1000;  // 10 minutes -> background mode

      const progressCallback = this.progressCallbacks.get(sessionId);

      const sendProgressUpdate = (force = false) => {
        if (!progressCallback) return;

        const now = Date.now();
        const elapsed = Math.floor((now - progress.startTime) / 1000);
        const timeSinceLastUpdate = now - progress.lastSentTime;

        // After 10 minutes, send background notification once and stop progress updates
        if (elapsed * 1000 >= BACKGROUND_THRESHOLD_MS) {
          if (!progress.backgroundNotified) {
            progress.backgroundNotified = true;
            progressCallback({
              sessionId,
              elapsed,
              message: `⏳ *Task running in background*\n\nThis task is taking longer than expected.\nI'll notify you when it's complete.\n\n🔄 Turn ${progress.turnCount} | ⏱️ ${this.formatElapsed(elapsed)}`,
              isBackgroundNotification: true
            });
          }
          return; // Stop sending progress updates
        }

        // Check if action description changed
        const actionChanged = progress.currentAction !== progress.lastSentAction;

        // Only send update if:
        // 1. Action changed (force or natural change), OR
        // 2. 3 minutes passed since last update
        if (!force && !actionChanged && timeSinceLastUpdate < MIN_TIME_BETWEEN_UPDATES_MS) {
          return; // Skip this update
        }

        // Update tracking
        progress.lastSentTime = now;
        progress.lastSentAction = progress.currentAction;

        const progressMsg = this.formatProgressMessage(progress, elapsed);

        progressCallback({
          sessionId,
          elapsed,
          message: progressMsg,
          tool: progress.currentTool,
          action: progress.currentAction,
          turnCount: progress.turnCount,
          toolsUsed: progress.toolsUsed
        });
      };

      const progressInterval = setInterval(() => {
        sendProgressUpdate(false);
      }, PROGRESS_CHECK_INTERVAL_MS);

      // Spawn Claude directly (works better than cmd.exe or PowerShell wrappers)
      const claudePath = process.env.CLAUDE_PATH || 'C:\\Users\\asaf1\\.local\\bin\\claude.exe';

      // Set environment variables for Claude CLI to find credentials when running as service
      const claudeEnv = {
        ...process.env,
        USERPROFILE: process.env.CLAUDE_USER_PROFILE || 'C:\\Users\\asaf1',
        HOME: process.env.CLAUDE_USER_PROFILE || 'C:\\Users\\asaf1',
        CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR || 'C:\\Users\\asaf1\\.claude'
      };

      logger.debug('Spawning Claude directly', {
        sessionId,
        claudePath,
        args: claudeArgs.slice(0, 3),
        cwd: sessionInfo.projectPath
      });

      const proc = spawn(claudePath, claudeArgs, {
        cwd: sessionInfo.projectPath,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
        env: claudeEnv
      });

      sessionInfo.currentProcess = proc;

      // Close stdin immediately to prevent blocking on input prompts
      proc.stdin.end();

      // Helper function to kill process on Windows
      const killProcess = (reason) => {
        logger.warn(`Killing Claude process: ${reason}`, { sessionId, pid: proc.pid });
        if (process.platform === 'win32') {
          spawn('taskkill', ['/PID', proc.pid.toString(), '/T', '/F'], { windowsHide: true });
        } else {
          proc.kill('SIGTERM');
        }
        sessionInfo.status = 'ready';
        sessionInfo.currentProcess = null;
      };

      // Absolute timeout after 10 minutes (complex tasks like cloning/building take time)
      const absoluteTimeout = setTimeout(() => {
        killProcess('Absolute timeout after 10 minutes');
        reject(new Error('Command timeout after 10 minutes'));
      }, 10 * 60 * 1000);

      // Idle timeout - kill if no output for 3 minutes (stream-json provides frequent updates)
      const IDLE_TIMEOUT_MS = 3 * 60 * 1000;
      let lastOutputTime = Date.now();

      const idleCheckInterval = setInterval(() => {
        const idleTime = Date.now() - lastOutputTime;
        if (idleTime > IDLE_TIMEOUT_MS) {
          clearInterval(idleCheckInterval);
          clearTimeout(absoluteTimeout);
          killProcess(`Idle timeout - no output for ${Math.round(idleTime / 1000)}s`);
          reject(new Error('Claude appears stuck - no output for 3 minutes'));
        }
      }, 10 * 1000); // Check every 10 seconds

      proc.stdout.on('data', (data) => {
        const chunk = data.toString();
        stdout += chunk;
        sessionInfo.lastActivity = Date.now();
        lastOutputTime = Date.now(); // Reset idle timer

        // Parse streaming JSON output
        jsonBuffer += chunk;
        const lines = jsonBuffer.split('\n');
        jsonBuffer = lines.pop(); // Keep incomplete line in buffer

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const json = JSON.parse(line);

            // Log message type for debugging
            logger.debug('Claude stream message', {
              sessionId,
              type: json.type,
              subtype: json.subtype
            });

            // Track progress from stream messages
            if (json.type === 'assistant' && json.message?.content) {
              progress.turnCount++;
              // Check for tool use
              const toolUse = json.message.content.find(c => c.type === 'tool_use');
              if (toolUse) {
                const prevAction = progress.currentAction;
                progress.currentTool = toolUse.name;
                progress.currentAction = toolUse.input?.description || toolUse.input?.command || toolUse.input?.pattern || 'working...';
                if (!progress.toolsUsed.includes(toolUse.name)) {
                  progress.toolsUsed.push(toolUse.name);
                }
                // Send update if action description changed
                if (prevAction !== progress.currentAction) {
                  sendProgressUpdate(false);  // Let sendProgressUpdate decide based on timing
                }
              }
            }

            // Track tool results
            if (json.type === 'user' && json.message?.content) {
              const toolResult = json.message.content.find(c => c.type === 'tool_result');
              if (toolResult) {
                progress.lastToolResult = toolResult.content?.substring(0, 100);
              }
            }

            // Extract final result from result message
            if (json.type === 'result' && json.result) {
              finalResult = json.result;
              logger.info('Claude result extracted', {
                sessionId,
                resultLength: finalResult.length
              });
            }

            // Emit progress event with parsed data
            eventBus.emitEvent(eventBus.constructor.Events.SESSION_OUTPUT, {
              sessionId,
              messageType: json.type,
              output: json.result || JSON.stringify(json).substring(0, 200),
              timestamp: Date.now()
            });
          } catch (e) {
            // Not valid JSON, just log raw output
            logger.debug('Claude raw output', { sessionId, line: line.substring(0, 100) });
          }
        }
      });

      proc.stderr.on('data', (data) => {
        const chunk = data.toString();
        stderr += chunk;
        logger.debug('Claude stderr', { sessionId, stderr: chunk.substring(0, 200) });
      });

      proc.on('error', (error) => {
        clearTimeout(absoluteTimeout);
        clearInterval(idleCheckInterval);
        clearInterval(progressInterval);
        this.offProgress(sessionId);
        sessionInfo.status = 'error';
        sessionInfo.currentProcess = null;
        logger.error('Claude process error', { sessionId, error: error.message });
        reject(error);
      });

      proc.on('close', (code) => {
        clearTimeout(absoluteTimeout);
        clearInterval(idleCheckInterval);
        clearInterval(progressInterval);
        this.offProgress(sessionId);
        sessionInfo.status = 'ready';
        sessionInfo.currentProcess = null;

        // Use finalResult (extracted from stream-json) or fall back to raw stdout
        const output = finalResult || stdout;
        sessionInfo.lastOutput = output;

        logger.info('Claude command completed', {
          sessionId,
          exitCode: code,
          outputLength: output.length,
          rawOutputLength: stdout.length,
          commandNumber: sessionInfo.commandCount
        });

        if (code === 0 || code === null) {
          eventBus.emitEvent(eventBus.constructor.Events.SESSION_COMPLETED, {
            sessionId,
            output: output
          });

          resolve({
            success: true,
            output: output,
            stderr: stderr,
            exitCode: code
          });
        } else {
          logger.warn('Claude exited with error code', { sessionId, code, stderr });
          resolve({
            success: false,
            output: output,
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
      if (process.platform === 'win32') {
        spawn('taskkill', ['/PID', sessionInfo.currentProcess.pid.toString(), '/T', '/F'], { windowsHide: true });
      } else {
        sessionInfo.currentProcess.kill('SIGTERM');
      }
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

  /**
   * Format a creative progress message based on current state
   */
  formatProgressMessage(progress, elapsedSeconds) {
    const toolEmojis = {
      'Bash': '⚡',
      'Read': '📖',
      'Edit': '✏️',
      'Write': '📝',
      'Glob': '🔍',
      'Grep': '🔎',
      'Task': '🤖',
      'WebFetch': '🌐',
      'WebSearch': '🔍',
      'TodoWrite': '📋'
    };

    const toolVerbs = {
      'Bash': 'Running command',
      'Read': 'Reading file',
      'Edit': 'Editing code',
      'Write': 'Writing file',
      'Glob': 'Searching files',
      'Grep': 'Searching content',
      'Task': 'Spawning agent',
      'WebFetch': 'Fetching URL',
      'WebSearch': 'Searching web',
      'TodoWrite': 'Updating tasks'
    };

    const elapsed = this.formatElapsed(elapsedSeconds);
    const emoji = toolEmojis[progress.currentTool] || '🔄';
    const verb = toolVerbs[progress.currentTool] || 'Working';

    let msg = `${emoji} *Claude is working...*\n`;
    msg += `⏱️ ${elapsed}\n`;
    msg += `🔄 Turn ${progress.turnCount}\n\n`;

    if (progress.currentTool) {
      msg += `*Current:* ${verb}\n`;
      if (progress.currentAction) {
        // Truncate and clean the action
        let action = progress.currentAction.substring(0, 80);
        if (progress.currentAction.length > 80) action += '...';
        msg += `\`${action}\`\n`;
      }
    }

    if (progress.toolsUsed.length > 0) {
      const tools = progress.toolsUsed.map(t => toolEmojis[t] || '🔧').join(' ');
      msg += `\n*Tools used:* ${tools}`;
    }

    return msg;
  }

  /**
   * Format elapsed time nicely
   */
  formatElapsed(seconds) {
    if (seconds < 60) return `${seconds}s`;
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}m ${secs}s`;
  }
}

module.exports = new CmdExecutor();
