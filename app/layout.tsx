import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Project Octopus",
  description: "Workspace inwestycji, dokumentacji i Octopus Brain."
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
