import type { Metadata } from "next";
import "./globals.css";
import "./octopus-app.css";
import "./company-selector-refinement.css";
import "./investments-refinement.css";
import "./project-workspace-v2.css";

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
      <body>{children}</body>
    </html>
  );
}
