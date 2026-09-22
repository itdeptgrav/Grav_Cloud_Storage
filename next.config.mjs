/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

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
