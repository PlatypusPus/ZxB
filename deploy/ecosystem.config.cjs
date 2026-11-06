// pm2 process for the VPS: pm2 start deploy/ecosystem.config.cjs && pm2 save
// One worker on purpose: the live auction keeps its WebSocket clients and bid timer in this process.
const path = require('path')
module.exports = {
  apps: [{
    name: 'zxb',
    cwd: path.join(__dirname, '..', 'backend'),
    script: path.join(process.env.HOME, '.local', 'bin', 'uv'),
    args: 'run --no-sync --env-file ../.env uvicorn app.main:app --host 127.0.0.1 --port 8030 --workers 1 --proxy-headers --forwarded-allow-ips 127.0.0.1',
    interpreter: 'none',
    exp_backoff_restart_delay: 2000,
    max_memory_restart: '600M',
  }],
}
