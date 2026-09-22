// lib/storage/provider.js
// The storage provider abstraction. All business/API code goes through the
// provider returned here and NEVER touches fs directly — so swapping the
// backend later (S3 / R2 / Synology) is a config change, not a rewrite.
//
// Phase 0 exposes the local provider. Phase 2 adds the streaming surface
// (beginWrite / commit / openRead / stat / exists / remove) to the interface.

import local from "@/lib/storage/localProvider";
import config from "@/lib/config";

export function getStorageProvider() {
  switch (config.storageProvider) {
    case "local":
    default:
      return local;
    // case "s3":  return s3;      // Phase 5+
    // case "r2":  return r2;      // Phase 5+
  }
}

export default getStorageProvider;
