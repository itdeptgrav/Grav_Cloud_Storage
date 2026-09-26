// lib/sha256.js
// Incremental SHA-256 (FIPS 180-4) in plain JS, with a SERIALIZABLE state.
//
// Why not SubtleCrypto: crypto.subtle.digest() needs the whole input at once and
// cannot hash a multi-GB file incrementally, and its state cannot be saved. The
// chunked uploader feeds this hasher one chunk at a time and persists
// exportState() after every accepted chunk, so a page refresh can resume hashing
// exactly where it stopped. Used in the browser; verified against Node crypto in
// scripts/test-chunked-uploads.mjs.
//
// Performance notes: every partial sum is truncated with |0 pairwise so V8 keeps
// the arithmetic in int32 (a sum that overflows int32 silently falls back to
// float math, ~4x slower), and hashBlocks() walks many blocks per call.

const K = new Int32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);
const H0 = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];

// Hash every complete 64-byte block of p[pos, pos+len). Returns the new pos.
function hashBlocks(w, v, p, pos, len) {
  let a, b, c, d, e, f, g, h, u, i, j, t1, t2;
  while (len >= 64) {
    a = v[0]; b = v[1]; c = v[2]; d = v[3]; e = v[4]; f = v[5]; g = v[6]; h = v[7];
    for (i = 0; i < 16; i++) {
      j = pos + i * 4;
      w[i] = (p[j] << 24) | (p[j + 1] << 16) | (p[j + 2] << 8) | p[j + 3];
    }
    for (i = 16; i < 64; i++) {
      u = w[i - 2];
      t1 = ((u >>> 17) | (u << 15)) ^ ((u >>> 19) | (u << 13)) ^ (u >>> 10);
      u = w[i - 15];
      t2 = ((u >>> 7) | (u << 25)) ^ ((u >>> 18) | (u << 14)) ^ (u >>> 3);
      w[i] = (((t1 + w[i - 7]) | 0) + ((t2 + w[i - 16]) | 0)) | 0;
    }
    for (i = 0; i < 64; i++) {
      t1 = (((((((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7))) + ((e & f) ^ (~e & g))) | 0) +
        ((h + ((K[i] + w[i]) | 0)) | 0)) | 0);
      t2 = ((((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10))) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
      h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    v[0] = (v[0] + a) | 0; v[1] = (v[1] + b) | 0; v[2] = (v[2] + c) | 0; v[3] = (v[3] + d) | 0;
    v[4] = (v[4] + e) | 0; v[5] = (v[5] + f) | 0; v[6] = (v[6] + g) | 0; v[7] = (v[7] + h) | 0;
    pos += 64;
    len -= 64;
  }
  return pos;
}

export class Sha256 {
  constructor(state) {
    this.h = new Int32Array(8);
    this.w = new Int32Array(64);
    this.buf = new Uint8Array(64); // pending partial block
    this.bufLen = 0;
    this.total = 0; // bytes hashed so far (safe up to 2^53)
    if (state) this.importState(state);
    else this.h.set(H0);
  }

  /** Feed bytes (Uint8Array, Buffer or ArrayBuffer). Returns this. */
  update(data) {
    // A PLAIN Uint8Array view, never a Buffer subclass: keeps element access monomorphic.
    const bytes = ArrayBuffer.isView(data) ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : new Uint8Array(data);
    const n = bytes.length;
    let i = 0;
    this.total += n;
    if (this.bufLen > 0) {
      const take = Math.min(64 - this.bufLen, n);
      this.buf.set(bytes.subarray(0, take), this.bufLen);
      this.bufLen += take;
      i = take;
      if (this.bufLen === 64) {
        hashBlocks(this.w, this.h, this.buf, 0, 64);
        this.bufLen = 0;
      }
    }
    if (n - i >= 64) i = hashBlocks(this.w, this.h, bytes, i, n - i);
    if (i < n) {
      this.buf.set(bytes.subarray(i), 0);
      this.bufLen = n - i;
    }
    return this;
  }

  /** Digest of everything fed so far, as lowercase hex. Does NOT disturb this hasher. */
  hex() {
    const c = new Sha256(this.exportState());
    const bitLenHi = Math.floor((c.total * 8) / 0x100000000);
    const bitLenLo = (c.total * 8) >>> 0;
    const pad = new Uint8Array((c.bufLen < 56 ? 56 : 120) - c.bufLen + 8);
    pad[0] = 0x80;
    const p = pad.length;
    pad[p - 8] = bitLenHi >>> 24; pad[p - 7] = bitLenHi >>> 16; pad[p - 6] = bitLenHi >>> 8; pad[p - 5] = bitLenHi;
    pad[p - 4] = bitLenLo >>> 24; pad[p - 3] = bitLenLo >>> 16; pad[p - 2] = bitLenLo >>> 8; pad[p - 1] = bitLenLo;
    c.update(pad);
    let out = "";
    for (let i = 0; i < 8; i++) out += (c.h[i] >>> 0).toString(16).padStart(8, "0");
    return out;
  }

  /** Plain-JSON state: safe to keep in localStorage (it holds no secret). */
  exportState() {
    return {
      h: Array.from(this.h, (v) => v >>> 0),
      buf: Array.from(this.buf.subarray(0, this.bufLen)),
      total: this.total,
    };
  }

  importState(s) {
    if (!s || !Array.isArray(s.h) || s.h.length !== 8 || !Array.isArray(s.buf) || s.buf.length > 63 || !Number.isFinite(s.total)) {
      throw new Error("Invalid SHA-256 state");
    }
    this.h.set(s.h.map((v) => v | 0));
    this.buf.fill(0);
    this.buf.set(s.buf, 0);
    this.bufLen = s.buf.length;
    this.total = s.total;
  }
}

export function sha256Hex(data) {
  return new Sha256().update(data).hex();
}
