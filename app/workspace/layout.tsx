import { WysokaDemoBootstrap } from "@/components/demo/wysoka-demo-bootstrap";
import { requireCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function WorkspaceLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  await requireCurrentUser();

  return (
    <div className="octopus-app-light">
      <WysokaDemoBootstrap />
      {children}
    </div>
  );
}
