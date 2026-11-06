// One entry point for the whole stack, stdlib only.
//   node scripts/run.mjs dev        Postgres (Docker) + API on :8010 + site on :5180
//   node scripts/run.mjs test       quick checks: backend tests minus the slow bot simulations, then a frontend build
//   node scripts/run.mjs test:full  everything
import { execSync, spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const backend = join(root, 'backend'), frontend = join(root, 'frontend')
const mode = process.argv[2] || 'dev'
const run = (cmd, cwd = root) => execSync(cmd, { cwd, stdio: 'inherit' })
const read = (cmd, cwd = root) => execSync(cmd, { cwd }).toString().trim()

function setup() {
  run('docker compose up -d --wait db')
  const psql = sql => `docker compose exec -T db psql -U postgres -tAc "${sql}"`
  if (!read(psql("select 1 from pg_database where datname='zxb_test'"))) run(psql('create database zxb_test'))
  if (!existsSync(join(frontend, 'node_modules'))) run('npm install', frontend)
  if (!existsSync(join(root, '.env'))) {
    const hash = read('uv run --python 3.12 python -m app.main hash devadmin', backend)
    writeFileSync(join(root, '.env'), `SECRET_KEY=${randomBytes(32).toString('hex')}\nADMIN_EMAIL=admin@zenithxbeans.local\nADMIN_PASSWORD_HASH=${hash}\n`)
    console.log('Created .env with dev admin login admin@zenithxbeans.local / devadmin')
  }
}

function start(name, cmd, cwd) {
  const child = spawn(cmd, { cwd, shell: true })
  const tag = name === 'api' ? '\x1b[33m[api]\x1b[0m ' : '\x1b[31m[web]\x1b[0m '
  for (const stream of [child.stdout, child.stderr]) {
    stream.on('data', d => process.stdout.write(d.toString().replace(/^(?=.)/gm, tag)))
  }
  return child
}

function stopAll(children) {
  for (const c of children) {
    if (c.exitCode !== null) continue
    // Windows: kill the whole tree, or uvicorn/vite outlive the shell that started them.
    if (process.platform === 'win32') { try { execSync(`taskkill /pid ${c.pid} /T /F`, { stdio: 'ignore' }) } catch {} }
    else c.kill('SIGINT')
  }
}

const portFree = port => new Promise(ok => {
  const s = createServer().once('error', () => ok(false)).once('listening', () => s.close(() => ok(true)))
  s.listen(port, '127.0.0.1')
})

setup()
if (mode === 'dev') {
  for (const port of [8010, 5180]) {
    if (!(await portFree(port))) {
      console.error(`Port ${port} is already in use (an old dev server?). Stop it and run again.`)
      process.exit(1)
    }
  }
  const kids = [
    start('api', 'uv run --python 3.12 --env-file ../.env uvicorn app.main:app --port 8010 --host 127.0.0.1', backend),
    start('web', 'npx vite --port 5180 --strictPort --host 127.0.0.1', frontend),
  ]
  console.log('\n  Site   http://127.0.0.1:5180\n  Admin  http://127.0.0.1:5180/admin\n  Ctrl+C stops both\n')
  const quit = () => { stopAll(kids); process.exit(0) }
  process.on('SIGINT', quit); process.on('SIGTERM', quit)
  for (const k of kids) k.on('exit', code => { if (code) { console.log(`a server exited (${code}); stopping`); quit() } })
} else if (mode === 'test' || mode === 'test:full') {
  run(`uv run --python 3.12 pytest -q${mode === 'test' ? ' -m "not slow"' : ''}`, backend)
  run('npx vite build --logLevel warn', frontend)
  console.log('\nAll checks passed.')
} else {
  console.error(`Unknown mode "${mode}". Use dev, test or test:full.`)
  process.exit(1)
}
