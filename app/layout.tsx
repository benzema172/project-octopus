import type { Metadata } from "next";
import { AppReleaseBadge } from "@/components/app-release-badge";
import { CompanyActionDockController } from "@/components/company/company-action-dock-controller";
import "./globals.css";
import "./octopus-app.css";
import "./company-selector-refinement.css";
import "./company-switcher-refinement.css";
import "./investments-refinement.css";
import "./project-workspace-v2.css";
import "./project-dashboard-combined.css";
import "./project-dashboard-compact.css";
import "./project-dashboard-layout-refinement.css";
import "./project-intake.css";
import "./project-navigation-refinement.css";
import "./project-modules-operational.css";
import "./brain-knowledge.css";
import "./octopus-1-release.css";
import "./release-badge.css";
import "./company-actions-compact.css";

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
        <CompanyActionDockController />
        <AppReleaseBadge />
      </body>
    </html>
  );
}
