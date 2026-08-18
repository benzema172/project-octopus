import { requireCurrentUser } from "@/lib/auth";
import "../company-selector-refinement.css";
import "../company-switcher-refinement.css";
import "../investments-refinement.css";

export const dynamic = "force-dynamic";

export default async function WorkspaceLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  await requireCurrentUser();

  return (
    <div className="octopus-app-light">
      {children}
    </div>
  );
}
