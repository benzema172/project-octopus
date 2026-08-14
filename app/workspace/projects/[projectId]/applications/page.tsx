import { redirect } from "next/navigation";

export default async function LegacyApplicationsPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  redirect(`/workspace/projects/${projectId}/requests`);
}
