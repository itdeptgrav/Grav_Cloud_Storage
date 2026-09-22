# @grav/storage-sdk

Official Node.js client for **Grav Storage**. Thin wrapper over the `/api/v1`
HTTP API — streaming uploads/downloads, JSON metadata, and a typed error class.

> **Security:** the API key is a **server-side secret**. Never put it in browser
> JavaScript, `NEXT_PUBLIC_*`, or a public repo. Browser → your backend → Grav
> Storage. See the security note below.

## Install

Local/monorepo usage (this repo):

```bash
npm install file:../grav-storage/packages/grav-storage-sdk
# or copy the folder and `npm install ./grav-storage-sdk`
```

Requires **Node 18+** (uses the global `fetch` and `node:http`/`https`).

## Configure

```js
import { GravStorage } from "@grav/storage-sdk";

const storage = new GravStorage({
  baseUrl: process.env.GRAV_STORAGE_URL,   // e.g. http://localhost:4000
  apiKey: process.env.GRAV_STORAGE_API_KEY, // gsk_live_… (server-side only)
});
```

## Usage

```js
// Upload (streams — a path, a Readable, or a Buffer)
const file = await storage.files.upload("./invoice.pdf");
// → { fileId, name, mimeType, sizeBytes, checksumSha256, createdAt }
// Save file.fileId in YOUR database — NOT a filesystem path.

// Metadata
const meta = await storage.files.meta(file.fileId);

// List (paginated, project-scoped)
const { files, total } = await storage.files.list({ limit: 50, search: "invoice" });

// Download to disk (streams)
await storage.files.download(file.fileId, "./out.pdf");

// Byte range (video seeking, partial reads)
const { stream, status } = await storage.files.get(file.fileId, { range: "bytes=0-1048575" });
stream.pipe(process.stdout); // status === 206

// Project usage
const usage = await storage.usage(); // { currentStorageBytes, fileCount, quotaBytes, … }

// Delete (moves to trash)
await storage.files.delete(file.fileId);
```

## Streaming from an incoming request (e.g. an Express/Next backend)

```js
// req is a Node Readable (the incoming upload). Nothing is buffered in memory.
const file = await storage.files.upload(req, { name: originalName, size: contentLength });
res.json({ fileId: file.fileId });
```

## Errors

```js
import { GravStorageError } from "@grav/storage-sdk";
try {
  await storage.files.meta("file_does_not_exist");
} catch (e) {
  if (e instanceof GravStorageError) {
    console.error(e.code, e.status, e.message, e.requestId);
    // e.g. FILE_NOT_FOUND 404 "File not found." <X-Request-ID>
  }
}
```

`GravStorageError` exposes the server's stable `code`, HTTP `status`, `message`,
and `requestId` (the `X-Request-ID` response header) for log correlation.

## Security

- The key grants access to the whole project. Keep it on the server.
- Do **not** do `NEXT_PUBLIC_GRAV_STORAGE_API_KEY=…` or use the key in client JS.
- Use least-privilege scopes (`files:read`, `files:write`, `files:list`,
  `files:delete`) and separate `live` / `test` keys.
