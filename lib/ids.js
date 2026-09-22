// lib/ids.js — opaque, cryptographically strong public identifiers.
// A fileId reveals nothing about project, user, upload count or path.

import crypto from "crypto";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

export function randBase62(len) {
  const out = new Array(len);
  const bytes = crypto.randomBytes(len * 2);
  let bi = 0;
  for (let i = 0; i < len; i++) {
    let b = bytes[bi++];
    while (b >= 248) b = bi < bytes.length ? bytes[bi++] : crypto.randomBytes(1)[0]; // de-bias
    out[i] = ALPHABET[b % 62];
  }
  return out.join("");
}

export function newFileId() {
  return `file_${randBase62(24)}`;
}
