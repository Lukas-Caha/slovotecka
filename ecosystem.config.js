// Konfigurace pro PM2 Process Manager na Linux VPS (Ubuntu / Debian)
// Spuštění: pm2 start ecosystem.config.js
// Uložení po rebootu: pm2 save && pm2 startup

module.exports = {
  apps: [
    {
      name: 'slovo-hra',
      script: 'server.js',
      instances: 1, // Node.js server drží stav paměti v 1 procesu
      autorestart: true,
      watch: false,
      max_memory_restart: '600M',
      env: {
        NODE_ENV: 'production',
        PORT: 3000
      },
      error_file: './logs/pm2-err.log',
      out_file: './logs/pm2-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      kill_timeout: 4000
    }
  ]
};
