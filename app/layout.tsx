import type { Metadata } from "next";
import { AppReleaseBadge } from "@/components/app-release-badge";
import "./globals.css";
import "./octopus-app.css";
import "./octopus-1-release.css";
import "./release-badge.css";

export const metadata: Metadata = {
  title: "Project Octopus",
  description: "System operacyjny firmy, inwestycji, dokumentacji i OctopusAI."
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pl">
      <body>
        {children}
        <AppReleaseBadge />
      </body>
    </html>
  );
}
