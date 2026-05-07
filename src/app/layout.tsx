import type { Metadata } from "next";
import { AuthProvider } from "@/lib/auth/provider";
import "./globals.css";

export const metadata: Metadata = {
  title: "Decoded Coach Control Center",
  description: "Rep and manager coaching dashboards backed by Neon Postgres."
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
