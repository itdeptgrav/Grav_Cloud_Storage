# Grav Storage

Self-hosted, API-key-authenticated **object storage** for the GRAV platform — a
private mix of Google-Drive-style file management, Cloudinary-style asset
storage, and S3/R2-style object APIs. File bytes live on our own disk; other
GRAV projects talk to it only over HTTP with an API key and store the returned
`fileId`.

Built with Next.js (App Router, Node runtime), MongoDB and a local disk backend.
Uploads and downloads **stream** end to end — a ~900 MB transfer never sits in
memory (verified: ~38 MB peak RSS for a 900 MB round-trip).

> **Full developer documentation is in the app at [`/docs`](http://localhost:4000/docs)** —
> quick start, authentication, the complete HTTP API, the SDK reference, errors,
> examples (Node/cURL/PowerShell), deployment, backup/restore and maintenance.

## Architecture

```
Application code:   D:\GRAV_Project\grav-storage   (this repo)
Actual file bytes:  D:\GravStorage\data            (outside the repo; tmp/ + trash/ are siblings)
Metadata:           MongoDB (local, database: grav_storage)
Served on:          http://localhost:4000
```

Applications never learn a physical path — they store an opaque `fileId` and
fetch by it. There are **two authentication planes over one storage engine**:

| Plane | Path | Auth | For |
|---|---|---|---|
| **Machine** | `/api/v1/*` | `Authorization: Bearer gsk_…` | Your backends / the SDK |
| **Dashboard** | this web app | session cookie | Humans managing projects, keys, files |

## Prerequisites

- **Node.js** 18+ (tested on v22).
- **MongoDB** running locally on `:27017` — a **separate** `grav_storage`
  database, never the CMS/Atlas one.

## Quick start (development)

```bash
cd D:\GRAV_Project\grav-storage
npm install
copy .env.example .env      # then edit values (see below)
npm run check:mongo         # verify the database connection
npm run dev                 # http://localhost:4000
```

Then open the app, complete the one-time super-admin setup (or set the bootstrap
admin in `.env`), create a **project**, mint an **API key**, and try it from the
**Playground** or the project's **Documentation** tab.

## Using it from another app

```bash
npm install file:../grav-storage/packages/grav-storage-sdk
```

```js
import { GravStorage } from "@grav/storage-sdk";

const storage = new GravStorage({
  baseUrl: process.env.GRAV_STORAGE_URL,     // http://localhost:4000
  apiKey: process.env.GRAV_STORAGE_API_KEY,  // gsk_live_… — SERVER-SIDE ONLY
});

const file = await storage.files.upload("./invoice.pdf");
// save file.fileId in YOUR database (never a filesystem path)
await storage.files.download(file.fileId, "./out.pdf");
```

> **Security:** the API key is a server-side secret. Never ship it to the browser
> or a `NEXT_PUBLIC_*` variable. Browser → your backend → Grav Storage. The API
> sets no permissive CORS, so it cannot be called cross-origin from front-end
> code by design.

## Configuration (`.env`)

`.env` is git-ignored; only `.env.example` (a blank, grouped, fully-commented
template) is tracked. Key variables:

| Variable | Purpose |
|---|---|
| `MONGODB_URI` | Local metadata DB (`mongodb://localhost:27017/grav_storage`) |
| `STORAGE_ROOT` | Where file bytes live, **outside** this repo (`D:\GravStorage\data`) |
| `ALLOW_SIGNUP` | `true`/`false` — public self-service registration |
| `BOOTSTRAP_ADMIN_EMAIL` / `BOOTSTRAP_ADMIN_PASSWORD` | First-run super-admin seed (used once; change the password after first login) |
| `JWT_SECRET` | Session signing secret — set a long random value in production |
| `KEY_HASH_PEPPER` | Optional server-side pepper mixed into API-key hashing |
| `MAX_UPLOAD_SIZE_BYTES` | Max upload size (default 2 GiB) |
| `TRASH_RETENTION_DAYS` / `TMP_MAX_AGE_HOURS` | Retention windows for trash and interrupted uploads |
| `API_RATE_LIMIT_*` / `AUTH_RATE_LIMIT_*` | Fixed-window rate limits |
| `MAX_CONCURRENT_UPLOADS/DOWNLOADS_PER_PROJECT` | Concurrency caps |
| `MIN_FREE_DISK_BYTES` | Free-disk floor for new uploads (0 = disabled) |

See `.env.example` for the complete, commented list.

## Project layout

```
app/                     Next.js App Router
  api/v1/                machine plane (Bearer API key) — files, meta, download, usage, keyinfo
  api/dashboard/         session plane (cookie) — project-scoped file ops
  api/{auth,projects,keys,admin,setup,health}/   accounts, projects, keys, admin, health
  (app)/                 signed-in dashboard: dashboard, projects/[id], playground, admin/*
  docs/                  public documentation center
lib/                     storage engine (fileIngest, fileHttp, uploadStream, storage/*),
                         auth, services, config, http, csrf, limits, maintenance
packages/grav-storage-sdk/   the official Node.js client (@grav/storage-sdk)
scripts/                 check-mongo, storage-maintenance (integrity/reconcile/cleanup/purge)
```

## Security model (summary)

- **API keys** — `gsk_{live|test}_…`; the raw secret is shown once, never stored
  or logged (only a prefix + salted hash). Least-privilege scopes
  (`files:read/write/list/delete`); rotate/revoke supported.
- **Sessions** — bcrypt passwords, signed httpOnly cookie; every API route
  re-checks auth against the DB (a disabled account can't ride an old cookie).
- **CSRF** — enforced at the route layer on session mutations (same-origin
  `Origin`/`Referer`); the Bearer API plane is exempt (no CSRF vector).
- **Isolation** — a project's keys only ever see that project's files; quotas
  are enforced atomically (concurrent uploads can't race past a quota).
- **Integrity** — SHA-256 computed during every upload and returned; the admin
  integrity checker is report-only and never deletes or repairs automatically.

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Dev server on :4000 |
| `npm run build` / `npm start` | Production build / start (:4000) |
| `npm run check:mongo` | Verify the MongoDB connection |
| `npm run storage:integrity` | Report metadata/object drift (read-only) |
| `npm run storage:reconcile` | Report per-project counter drift |
| `npm run storage:cleanup` | Remove stale `*.part` temp files |
| `npm run storage:purge-trash` | Purge trashed files past retention |
| `npm run maintenance` | Run all maintenance tasks |

## Health

`GET /api/health` → `{ status, checks: { api, database, storage } }` — public and
minimal (no paths, versions or disk figures). 200 healthy, 503 degraded.

## Deployment

Production deployment (Windows host, Cloudflare Tunnel, MongoDB, `D:\GravStorage`),
plus backup/restore and maintenance, is documented in the app at
[`/docs` → Operations](http://localhost:4000/docs#deploy).
