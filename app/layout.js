import "./globals.css";

export const metadata = {
  title: "Grav Storage",
  description: "Self-hosted, API-key-authenticated object storage for the GRAV platform.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
