import { notFound, redirect } from "next/navigation";
import { requireCurrentUser } from "@/lib/auth";
import { getWorkspaceForUser } from "@/lib/data/workspace";

export const dynamic = "force-dynamic";

const LEGACY_AI_SECTIONS = new Set(["templates", "brain", "knowledge"]);

export default async function LegacyCompanySectionPage({
  params
}: {
  params: Promise<{ workspaceId: string; section: string }>;
}) {
  const { workspaceId, section } = await params;
  const user = await requireCurrentUser();
  const workspace = await getWorkspaceForUser(user, workspaceId);

  if (!workspace) notFound();
  if (LEGACY_AI_SECTIONS.has(section)) {
    redirect(`/workspace/companies/${workspace.id}/ai-center`);
  }

  notFound();
}
