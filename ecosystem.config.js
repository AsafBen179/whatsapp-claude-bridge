module.exports = {
  apps: [
    // WhatsApp API - must start first
    {
      name: 'whatsapp-api',
      script: 'npm',
      args: 'start',
      cwd: 'C:\\WhatsAppAPI',
      interpreter: 'none',
      instances: 1,
      exec_mode: 'fork',

      env: {
        NODE_ENV: 'production',
        PORT: 3000
      },

      autorestart: true,
      watch: false,
      max_restarts: 10,
      min_uptime: '10s',
      restart_delay: 4000,
      max_memory_restart: '500M',

      error_file: 'C:\\WhatsAppAPI\\logs\\pm2-error.log',
      out_file: 'C:\\WhatsAppAPI\\logs\\pm2-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true
    },

    // Bridge - depends on WhatsApp API
    {
      name: 'whatsapp-claude-bridge',
      script: 'src/index.js',
      cwd: 'C:\\RemoteClaudeCode\\whatsapp-claude-bridge',
      interpreter: 'C:\\Program Files\\nodejs\\node.exe',
      instances: 1,
      exec_mode: 'fork',

      // Wait for API to be ready
      wait_ready: true,
      listen_timeout: 30000,

      env: {
        NODE_ENV: 'production',
        PORT: 3001,
        WHATSAPP_API_URL: 'http://localhost:3000'
      },

      autorestart: true,
      watch: false,
      max_restarts: 10,
      min_uptime: '10s',
      restart_delay: 5000,
      exp_backoff_restart_delay: 100,
      max_memory_restart: '1G',

      error_file: 'C:\\RemoteClaudeCode\\whatsapp-claude-bridge\\logs\\pm2-error.log',
      out_file: 'C:\\RemoteClaudeCode\\whatsapp-claude-bridge\\logs\\pm2-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      kill_timeout: 5000
    }
  ]
};
