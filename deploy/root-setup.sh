#!/usr/bin/env bash
# One-time steps that need root. Run on the VPS:  sudo bash ~/shovin/zxb/deploy/root-setup.sh
# 1. Postgres role + database "zxb" (password is read from ../.env, DB_PASSWORD=...)
# 2. Caddy site block for zxb.shov.in -> 127.0.0.1:8030 (HTTPS certificate is automatic)
set -euo pipefail
cd "$(dirname "$0")/.."
PW=$(grep '^DB_PASSWORD=' .env | cut -d= -f2-)
[ -n "$PW" ] || { echo "DB_PASSWORD missing from .env"; exit 1; }

sudo -u postgres psql -v ON_ERROR_STOP=1 -v pw="$PW" <<'SQL'
SELECT format('CREATE ROLE zxb LOGIN PASSWORD %L', :'pw') WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'zxb')\gexec
SELECT 'CREATE DATABASE zxb OWNER zxb' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'zxb')\gexec
SQL

if ! grep -q '^zxb.shov.in' /etc/caddy/Caddyfile; then
  cp /etc/caddy/Caddyfile "/etc/caddy/Caddyfile.bak-zxb-$(date +%Y%m%d%H%M%S)"
  cat >> /etc/caddy/Caddyfile <<'CADDY'

zxb.shov.in {
    encode gzip
    request_body {
        max_size 8MB
    }
    reverse_proxy 127.0.0.1:8030
}
CADDY
fi
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
systemctl reload caddy
echo "Done. Postgres role/db zxb ready; Caddy serving zxb.shov.in."
