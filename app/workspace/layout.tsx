import { AppShell } from "@/components/layout/app-shell";
import { requireCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function WorkspaceLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  const user = await requireCurrentUser();

  return <AppShell userEmail={user.email ?? "Project Octopus"}>{children}</AppShell>;
}
