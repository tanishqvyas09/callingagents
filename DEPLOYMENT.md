# 🚀 Deployment Guide — Lajja Calling Agent

## Server Info
| Field | Value |
|-------|-------|
| Provider | Hetzner Cloud |
| Server | CX23 — 2 vCPU, 4 GB RAM |
| IP | 91.99.201.2 |
| OS | Ubuntu 24.04 |
| App directory | `/opt/lajja` |
| Branch | `deploy` |

---

## 1. SSH Into Server

```bash
ssh root@91.99.201.2
```

> If you set up an SSH key during Hetzner setup, this works directly.
> Otherwise use the password from the Hetzner console.

---

## 2. First-Time Setup (run once after server creation)

```bash
# Install Docker
curl -fsSL https://get.docker.com | sh

# Install Nginx + Git
apt update && apt install -y nginx git

# Clone the deploy branch
cd /opt
git clone -b deploy https://YOUR_GITHUB_USERNAME:YOUR_PAT@github.com/tanishqvyas09/callingagents.git lajja
cd lajja

# Create .env with real credentials
cp .env.example .env
nano .env
# → Fill in all values (LiveKit, Supabase, Groq, Google, Vobiz)

# Build and start containers
docker compose up -d --build

# Setup Nginx reverse proxy
cp nginx.conf /etc/nginx/sites-available/lajja
sed -i 's/YOUR_DOMAIN/91.99.201.2/g' /etc/nginx/sites-available/lajja
ln -s /etc/nginx/sites-available/lajja /etc/nginx/sites-enabled/lajja
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl restart nginx
```

---

## 3. Redeploy After Code Changes (most common)

```bash
ssh root@91.99.201.2
cd /opt/lajja          # ← ALWAYS cd here first
git pull origin deploy
docker compose up -d --build
```

---

## 4. View Logs

```bash
# All services
docker compose logs -f

# Frontend only
docker compose logs -f frontend

# Agent only
docker compose logs -f agent
```

---

## 5. Check Running Containers

```bash
docker compose ps
```

---

## 6. Restart Without Rebuilding

```bash
cd /opt/lajja
docker compose restart
```

---

## 7. Stop Everything

```bash
cd /opt/lajja
docker compose down
```

---

## 8. Edit Files Directly on Server (quick hotfix)

```bash
ssh root@91.99.201.2
cd /opt/lajja

# Edit a file
nano dashboard/lib/server-utils.ts

# Rebuild just the frontend
docker compose up -d --build frontend
```

> ⚠️ Changes made directly on the server will be overwritten on next `git pull`. Always commit the fix locally and push.

---

## 9. Update .env on Server

```bash
ssh root@91.99.201.2
cd /opt/lajja
nano .env
# Save and exit (Ctrl+X → Y → Enter)
docker compose up -d   # restart with new env (no rebuild needed)
```

---

## 10. Deploy a Different / New Project

```bash
ssh root@91.99.201.2

# Clone the new project into its own folder
cd /opt
git clone -b BRANCH_NAME https://USERNAME:PAT@github.com/OWNER/REPO.git my-new-project
cd my-new-project

# Create its .env
cp .env.example .env
nano .env

# Run on a different port (edit docker-compose.yml if needed)
docker compose up -d --build
```

> Each project gets its own folder under `/opt/`. Configure Nginx to proxy different paths or ports to different projects.

---

## 11. Add HTTPS with Let's Encrypt (after domain points to server)

```bash
apt install -y certbot python3-certbot-nginx
certbot --nginx -d yourdomain.com
# Certbot auto-updates nginx.conf with SSL
systemctl reload nginx
```

---

## 12. Nginx — Reload After Config Change

```bash
nginx -t                    # test config
systemctl reload nginx      # apply without downtime
```

---

## Common Mistakes

| Mistake | Fix |
|---------|-----|
| `fatal: not a git repository` | You're in `~`. Run `cd /opt/lajja` first |
| `no configuration file provided` | Same — you ran `docker compose` from wrong directory |
| Build crash: `Missing LiveKit Credentials` | Top-level throw in lib file — make client lazy (see `server-utils.ts`) |
| `supabaseKey is required` | Same pattern — `supabase-server.ts` or `supabase.ts` top-level init |
| `.env` changes not picked up | Run `docker compose up -d` (restart), not just `docker compose restart` for env changes |
| `lajja-frontend unhealthy` | `wget` not available in alpine image — use `node -e "require('http')..."` healthcheck |

---

## Errors We Hit During First Deploy (and fixes)

### ❌ Error 1: `Missing LiveKit Credentials` at build time
**Symptom:** `Error: Failed to collect page data for /api/dispatch` during `npm run build`  
**Cause:** `dashboard/lib/server-utils.ts` had a top-level `throw new Error(...)` that fired when Next.js evaluated the module at build time (no env vars available then)  
**Fix:** Wrapped `RoomServiceClient` and `SipClient` in a lazy `getLiveKitClients()` function. Used `Proxy` for backward-compatible `roomService` / `sipClient` exports.  
**File:** `dashboard/lib/server-utils.ts`

---

### ❌ Error 2: `supabaseKey is required` at build time
**Symptom:** `Error: Failed to collect page data for /api/ngo-analyze`  
**Cause:** `supabase-server.ts` called `createClient(undefined, undefined)` at module top level — same pattern as above  
**Fix:** Lazy singleton `getSupabaseServer()` function + `Proxy` export. Same fix applied to `supabase.ts` (public client).  
**Files:** `dashboard/lib/supabase-server.ts`, `dashboard/lib/supabase.ts`

---

### ❌ Error 3: `Container lajja-frontend is unhealthy`
**Symptom:** Build succeeded but `lajja-frontend` stayed unhealthy, `lajja-agent` failed to start (depends_on healthy)  
**Cause:** Healthcheck used `wget` which is not installed in `node:20-alpine`  
**Fix:** Replaced healthcheck with a native Node.js HTTP check:
```yaml
test: ["CMD-SHELL", "node -e \"require('http').get('http://localhost:3000/', (r) => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))\""]
```
Also extended `start_period` from 30s → 60s and `retries` from 3 → 5.  
**File:** `docker-compose.yml`

---

### ⚠️ Warning: `version` attribute is obsolete
**Symptom:** `WARN: the attribute 'version' is obsolete` on every `docker compose` command  
**Impact:** None — just a warning, can be removed from `docker-compose.yml` later
