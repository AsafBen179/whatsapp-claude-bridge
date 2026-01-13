module.exports = {
  apps: [{
    name: 'whatsapp-claude-bridge',
    script: 'src/index.js',
    instances: 1,
    exec_mode: 'fork',
    cwd: __dirname,

    // Environment
    env: {
      NODE_ENV: 'development',
      PORT: 3001
    },
    env_production: {
      NODE_ENV: 'production',
      PORT: 3001
    },

    // Restart behavior
    autorestart: true,
    watch: false,
    max_restarts: 10,
    min_uptime: '10s',
    restart_delay: 4000,

    // Memory management
    max_memory_restart: '1G',

    // Logging
    log_file: './logs/pm2-combined.log',
    error_file: './logs/pm2-error.log',
    out_file: './logs/pm2-out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    merge_logs: true,

    // Process management
    kill_timeout: 5000,
    wait_ready: true,
    listen_timeout: 10000
  }]
};
