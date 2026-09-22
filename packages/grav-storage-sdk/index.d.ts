// Type declarations for @grav/storage-sdk
import type { Readable, Writable } from "node:stream";

export interface GravStorageOptions {
  /** Base URL of the Grav Storage server, e.g. http://localhost:4000 */
  baseUrl: string;
  /** Server-side API key (gsk_live_… / gsk_test_…). NEVER expose to a browser. */
  apiKey: string;
  /** Optional per-request timeout in ms (0 = none). */
  timeoutMs?: number;
}

export interface FileMeta {
  fileId: string;
  name: string;
  mimeType: string;
  extension: string;
  sizeBytes: number;
  checksumSha256: string;
  status: "active" | "trashed" | "purged";
  uploadedByLabel?: string;
  folderPath?: string[];
  tags?: string[];
  downloads?: number;
  bytesServed?: number;
  createdAt?: string;
  updatedAt?: string;
  trashedAt?: string | null;
}

export interface UploadResult {
  fileId: string;
  name: string;
  mimeType: string;
  extension: string;
  sizeBytes: number;
  checksumSha256: string;
  createdAt: string;
}

export interface UploadOptions {
  /** Stored filename (required for Readable/Buffer; defaults to basename for a path). */
  name?: string;
  /** Claimed content type (server still resolves by extension). */
  contentType?: string;
  /** Known size in bytes; sets Content-Length (recommended for quota pre-checks). */
  size?: number;
}

export interface GetStreamResult {
  status: number;
  contentType?: string;
  contentLength?: number;
  contentRange?: string;
  acceptRanges?: string;
  requestId?: string;
  /** Node Readable of the (optionally ranged) bytes. */
  stream: Readable;
}

export interface ListParams {
  page?: number | string;
  limit?: number | string;
  search?: string;
  folder?: string;
  type?: string;
  sort?: "-createdAt" | "createdAt" | "name" | "-name" | "size" | "-size";
}
export interface ListResult {
  files: FileMeta[];
  page: number;
  limit: number;
  total: number;
  hasMore: boolean;
}

export interface UsageResult {
  currentStorageBytes: number;
  fileCount: number;
  quotaBytes: number | null;
  uploads: number;
  downloads: number;
  bytesUploaded: number;
  bytesDownloaded: number;
  requests: number;
  errors: number;
}

export class GravStorageError extends Error {
  status?: number;
  code?: string;
  requestId?: string;
}

export interface FilesApi {
  upload(source: string | Readable | Buffer, opts?: UploadOptions): Promise<UploadResult>;
  get(fileId: string, opts?: { range?: string }): Promise<GetStreamResult>;
  download(fileId: string, dest: string | Writable, opts?: { range?: string }): Promise<{ bytes: number; status: number }>;
  meta(fileId: string): Promise<FileMeta>;
  list(params?: ListParams): Promise<ListResult>;
  delete(fileId: string): Promise<{ fileId: string; status: string }>;
}

export class GravStorage {
  constructor(options: GravStorageOptions);
  baseUrl: string;
  files: FilesApi;
  usage(): Promise<UsageResult>;
}

export default GravStorage;
