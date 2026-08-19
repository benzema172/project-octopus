import { requireCurrentUser } from "@/lib/auth";
import "../company-switcher-refinement.css";
import "../ux-system.css";

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
