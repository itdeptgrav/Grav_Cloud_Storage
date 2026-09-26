# Chunked upload API

Uploads larger than a proxy's per-request body limit (Cloudflare Free/Pro caps a
request body at ~100 MB) are sent as a sequence of **chunks**, each its own HTTP
request. Progress is persisted server-side, so an upload continues from the last
**accepted** chunk after a failed chunk, a dropped connection, a page reload or a
server restart.

Engine: `lib/chunkedUploads.js` · UI client: `lib/uploadClient.js` ·
tests: `scripts/test-chunked-uploads.mjs`.

## Endpoints

| Plane | Path | Auth |
|---|---|---|
| Dashboard (browser) | `/api/dashboard/projects/:projectId/files/chunk` | session cookie; every `POST` is CSRF-checked (same-origin) |
| API (server-to-server) | `/api/v1/files/chunk` | `Authorization: Bearer gsk_…` with scope `files:write` |

`POST ?op=begin | append | complete | abort` · `GET ?op=status | list`

A session is bound to its **project** and to the **exact identity that began it** —
the signed-in user (dashboard) or the API key (API plane). Any other user, key or
project gets `UPLOAD_SESSION_FORBIDDEN`, even with a valid `uploadId`. An inactive
project gets `PROJECT_DISABLED` on every op (both planes).

## Checksums

* **Per chunk** — `x-chunk-sha256`: lowercase hex SHA-256 of that chunk's bytes.
  Required on every `append`.
* **Manifest** — `manifestSha256` at `complete`: SHA-256 of the concatenated
  lowercase-hex chunk hashes, in order (`sha256(h0 + h1 + … + hN-1)`).
* **Full file** (optional, recommended for API clients) — `sha256` at `begin` or
  `complete`: the source file's SHA-256.

At `complete` the server re-reads the whole temp file from disk and recomputes
every chunk hash and the full-file SHA-256. The file is committed only if the
recomputed chunk hashes equal the accepted ones, the manifest matches, and (if
given) the full-file SHA-256 matches. The stored `checksumSha256` is always the
true full-file SHA-256.

> Why a manifest for browsers: browsers can only hash a whole buffer natively.
> A pure-JS incremental SHA-256 runs ~57 MB/s on the reference machine versus
> ~530 MB/s native, which would cap local/LAN uploads. Native per-chunk hashes
> plus the server's from-disk verification detect any corrupted byte at full speed.

## begin

`POST ?op=begin` — JSON body:

```json
{ "filename": "Movie.mkv", "size": 1932735283, "mimeType": "video/x-matroska",
  "chunkSize": 83886080, "sha256": "…optional…" }
```

* `size` (bytes, required) and `filename` (required).
* `chunkSize` optional — may only be **smaller** than the server's
  `CHUNK_SIZE_BYTES` (default 80 MiB, hard ceiling 90 MiB), minimum 1 MiB.

`201` → session:

```json
{ "uploadId": "up_…", "fileName": "Movie.mkv", "declaredSize": 1932735283,
  "chunkSize": 83886080, "totalChunks": 24, "nextIndex": 0, "bytesReceived": 0,
  "chunkHashes": [], "status": "active", "expiresAt": "…" }
```

Refused with `STORAGE_QUOTA_EXCEEDED`, `INSUFFICIENT_STORAGE`, `FILE_TOO_LARGE`,
`TOO_MANY_CONCURRENT_TRANSFERS` (the session holds an upload slot from begin until
complete/abort/expiry, in the same pool as single-shot uploads).

## append

`POST ?op=append&uploadId=up_…&index=N` — body: the raw bytes of chunk `N`
(`Content-Type: application/octet-stream`), header `x-chunk-sha256`.

Chunk `N` covers bytes `[N·chunkSize, min((N+1)·chunkSize, size))`; every chunk
but the last is exactly `chunkSize` bytes.

`200` → `{ "uploadId", "index", "accepted": true, "alreadyAccepted": false,
"nextIndex", "totalChunks", "bytesReceived", "declaredSize", "expiresAt" }`

| Situation | Result | Session |
|---|---|---|
| `N == nextIndex`, bytes match hash | `200 accepted` | advances |
| `N < nextIndex`, same hash (a retry of an accepted chunk) | `200 alreadyAccepted: true` — nothing written | unchanged |
| `N < nextIndex`, different hash | `409 CHUNK_CONFLICT` | unchanged |
| `N > nextIndex` | `409 BAD_CHUNK_INDEX`, `details.expected` | unchanged |
| hash mismatch | `422 CHUNK_CHECKSUM_MISMATCH` | unchanged — retry chunk `N` |
| wrong length | `400 CHUNK_SIZE_MISMATCH` | unchanged |
| body stopped arriving (network / abort) | `400 CHUNK_INTERRUPTED` | unchanged |
| another attempt at `N` still streaming | `409 CHUNK_IN_PROGRESS` | unchanged — retry shortly |
| disk below `MIN_FREE_DISK_BYTES` (checked every chunk) | `507 INSUFFICIENT_STORAGE` | unchanged |
| storage write/sync error | `503 STORAGE_UNAVAILABLE` | unchanged |

Before writing chunk `N` the temp file is truncated to exactly the bytes of chunks
`0…N-1`, so a partial attempt can never leak into the file. A chunk is `fsync`'d
before it is acknowledged.

## status / list

`GET ?op=status&uploadId=up_…` → the session object above (never the temp path).
`GET ?op=list` → `{ "sessions": [ … ] }` — this identity's live sessions in the project.

## complete

`POST ?op=complete&uploadId=up_…` — JSON `{ "manifestSha256": "…", "sha256": "…optional…" }`.

`201` → `{ "file": { …FileObject meta… }, "fileId": "file_…" }`.
Idempotent: calling it again after success returns `200` with
`alreadyCompleted: true` and the same `fileId`.

| Situation | Result | Session |
|---|---|---|
| not every byte accepted yet | `422 SIZE_MISMATCH` (+ `details.nextIndex`) | stays active — keep uploading |
| quota would be exceeded | `507 STORAGE_QUOTA_EXCEEDED` | stays active — raise quota, complete again |
| checksum mismatch (chunks / manifest / full) | `422 CHECKSUM_MISMATCH` | failed — temp deleted, nothing stored |
| temp data missing | `409 UPLOAD_DATA_MISSING` | failed |
| temp data unreadable (transient) | `503 STORAGE_UNAVAILABLE` | stays active — retry complete |
| promote/quota race/metadata failure | the finalize error (`STORAGE_QUOTA_EXCEEDED` / `STORAGE_UNAVAILABLE`) | failed — bytes removed, quota rolled back |
| complete already running | `409 UPLOAD_FINALIZING` | — |

The file appears in listings only after a successful complete.

## abort

`POST ?op=abort&uploadId=up_…` → `{ "uploadId", "status": "aborted", "aborted": true }`.
Deletes the temp data and frees the slot. Idempotent.

## Lifetime & cleanup

* Idle expiry: `CHUNK_SESSION_IDLE_TTL_MINUTES` (default 360) after the last
  accepted chunk. Expired sessions answer `410 UPLOAD_SESSION_EXPIRED`.
* `npm run storage:chunks` (also part of `npm run maintenance`, and the
  **Chunked uploads** button on Admin → Maintenance) expires idle sessions,
  recovers finalizes interrupted by a crash, and deletes orphaned temp files
  older than `CHUNK_ORPHAN_MIN_AGE_MINUTES` that no live session references. It
  never deletes a live session's data. Schedule it like the other maintenance
  commands (cron / Task Scheduler).
* Finished session records are deleted by a MongoDB TTL index after
  `CHUNK_SESSION_RETENTION_DAYS` (default 7).
* Temp data lives in `<storage>/tmp/chunked/` — separate from single-shot
  `tmp/*.part`, whose age-based cleaner therefore can't touch a paused upload.

## Error codes

`UPLOAD_SESSION_NOT_FOUND` 404 · `UPLOAD_SESSION_FORBIDDEN` 403 ·
`UPLOAD_SESSION_EXPIRED` 410 · `UPLOAD_SESSION_CLOSED` 409 · `UPLOAD_FINALIZING` 409 ·
`BAD_CHUNK_INDEX` 409 · `CHUNK_IN_PROGRESS` 409 · `CHUNK_CONFLICT` 409 ·
`CHUNK_SIZE_MISMATCH` 400 · `CHUNK_INTERRUPTED` 400 · `CHUNK_CHECKSUM_MISMATCH` 422 ·
`SIZE_MISMATCH` 422 · `CHECKSUM_MISMATCH` 422 · `UPLOAD_DATA_MISSING` 409 ·
`PROJECT_DISABLED` 403 · `STORAGE_QUOTA_EXCEEDED` 507 · `INSUFFICIENT_STORAGE` 507 ·
`TOO_MANY_CONCURRENT_TRANSFERS` 429 · `STORAGE_UNAVAILABLE` 503.
