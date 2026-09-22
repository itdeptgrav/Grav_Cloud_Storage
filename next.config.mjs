/** @type {import('next').NextConfig} */
const nextConfig = {
  // Phase 0 keeps this minimal. Phase 2 introduces a custom Node server
  // (server.js) that mounts raw streaming handlers for /api/v1/files* in front
  // of Next — so large uploads/downloads and HTTP Range never pass through
  // Next's body handling. Nothing here needs to change for that.
  reactStrictMode: true,
};

export default nextConfig;
