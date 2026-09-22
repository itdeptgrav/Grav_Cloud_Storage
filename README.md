# Grav Storage

Self-hosted, API-key-authenticated object storage for the GRAV platform — a
private combination of Google-Drive-style file management, Cloudinary-style
asset storage, and S3/R2-style object APIs. File bytes live on our own disk;
other GRAV projects talk to it only over HTTP with an API key.

> **Status: Phase 0 (scaffold).** Auth, projects, API keys and the storage API
> are built in later phases. This README grows with each phase; full developer
> documentation ships in Phase 5 at `/docs`.

## Architecture (at a glance)

```
Application code:   D:\GRAV_Project\grav-storage   (this repo)
Actual file bytes:  D:\GravStorage\data            (outside the repo)
Metadata:           MongoDB (local, database: grav_storage)
```

Applications never learn a physical path — they store a `fileId` and fetch by it.

## Prerequisites

- **Node.js** 20+ (tested on v22).
- **MongoDB** running locally on `:27017` (a separate `grav_storage` database —
  never the CMS/Atlas one).

## Setup

```bash
cd D:\GRAV_Project\grav-storage
npm install
copy .env.example .env      # then edit values
npm run check:mongo         # verify the database connection
npm run dev                 # http://localhost:4000
```

## Configuration (`.env`)

| Variable | Purpose |
|---|---|
| `PORT` | HTTP port (default 4000) |
| `MONGODB_URI` | Local metadata DB, e.g. `mongodb://localhost:27017/grav_storage` |
| `STORAGE_ROOT` | Where file bytes live, **outside** this repo (e.g. `D:\GravStorage\data`) |
| `ALLOW_SIGNUP` | `true`/`false` — public self-service registration |
| `BOOTSTRAP_ADMIN_EMAIL` / `BOOTSTRAP_ADMIN_PASSWORD` | First-run super-admin seed (used once) |
| `JWT_SECRET` | Session signing secret (Phase 1) |
| `LOG_RETENTION_DAYS` | Request-log retention (default 30) |

Never commit `.env`. Only `.env.example` (blank template) is tracked.

## Health

`GET /api/health` → `{ status, checks: { api, database, storage } }` — public and
minimal (no paths, versions or disk figures).

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start the dev server on :4000 |
| `npm run build` / `npm start` | Production build / start |
| `npm run check:mongo` | Verify the MongoDB connection |
