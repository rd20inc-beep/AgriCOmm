---
name: Production server details
description: AgriCOmm production server IP, deploy path, Docker setup, snap workarounds
type: reference
originSessionId: d3277255-c862-4e53-86a9-3b43f2750521
---
Production server: `root@69.197.139.11`
Domain: `https://agricommodities.online`
SSL: Let's Encrypt via certbot, auto-renew enabled

Deploy path: git clone at `/opt/riceflow-erp`, rsync'd to `/root/riceflow-erp` for Docker (snap Docker can't access /opt).

Docker: snap install (`/snap/bin/docker`). Must use `docker-compose` (v1 compat) from `/root/riceflow-erp/`. The `docker-compose.yml` db port 5432 must be removed after rsync because system Postgres uses that port.

Containers: `riceflow-db` (postgres:16-alpine), `riceflow-backend` (:3001), `riceflow-frontend` (:8080).

Nginx: `/etc/nginx/sites-enabled/agricommodities` proxies to `127.0.0.1:8080`.

CI/CD: GitHub Actions SSH deploy via `appleboy/ssh-action`. Secrets: `DEPLOY_HOST=69.197.139.11`, `DEPLOY_USER=root`, `DEPLOY_SSH_KEY`.

`.env` at `/root/riceflow-erp/.env`: TURNSTILE_SECRET, VITE_TURNSTILE_SITE_KEY, JWT_SECRET, CORS_ORIGIN.

Previous server 149.102.138.252 is decommissioned.
