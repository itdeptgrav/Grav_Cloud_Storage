import "./globals.css";
import { Toaster, ConfirmHost } from "@/components/ui";

export const metadata = {
  title: "Grav Storage",
  description: "Self-hosted, API-key-authenticated object storage for the GRAV platform.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        {children}
        <Toaster />
        <ConfirmHost />
      </body>
    </html>
  );
}
