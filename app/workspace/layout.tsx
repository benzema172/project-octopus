import { requireCurrentUser } from "@/lib/auth";
import "../octopus-app.css";
import "../octopus-1-release.css";
import "../company-switcher-refinement.css";
import "../ux-system.css";
import "../workspace-experience.css";
import "../finance-compact.css";
import "../layout-density-audit.css";
import "../layout-density-project-audit.css";
import "../global-section-rhythm.css";
import "../company-sidebar-compact.css";

export const dynamic = "force-dynamic";

export default async function WorkspaceLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  await requireCurrentUser();

  return (
    <div className="octopus-app-light">
      <a className="ux-skip-link" href="#main-content">Przejdź do głównej treści</a>
      {children}
    </div>
  );
}
