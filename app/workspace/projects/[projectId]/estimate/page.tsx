import { redirect } from "next/navigation";

export default async function LegacyEstimatePage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  redirect(`/workspace/projects/${projectId}/cost-estimate`);
}
