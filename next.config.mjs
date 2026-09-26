/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // Build output dir. Default .next; an isolated test instance (see
  // scripts/test-chunked-uploads.mjs) sets NEXT_DIST_DIR so it can never share
  // or clobber the dev server's cache.
  distDir: process.env.NEXT_DIST_DIR || ".next",

  // Security headers for the UI (HTML) pages. NOT applied to /api/* — the file
  // routes manage their own headers, and (crucially) the streamed /raw responses
  // must remain frameable same-origin so PDF/video preview works.
  async headers() {
    return [
      {
        source: "/((?!api/).*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          // frame-ancestors only — does not restrict scripts/styles, so Next's
          // inline runtime keeps working; prevents the dashboard being framed.
          { key: "Content-Security-Policy", value: "frame-ancestors 'self'" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;

