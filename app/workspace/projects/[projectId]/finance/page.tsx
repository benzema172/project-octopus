import { notFound } from "next/navigation";
import { WalletCards } from "lucide-react";
import { DomainAccessDenied } from "@/components/access/domain-access-denied";
import { ProjectCompactShell } from "@/components/projects/project-compact-module-page";
import { ProjectFinanceDashboard } from "@/components/projects/project-finance-dashboard";
import { ExecutionLayerNotice } from "@/components/system/execution-layer-notice";
import { requireCurrentUser } from "@/lib/auth";
import { hasDomainAccess } from "@/lib/authorization";
import { isExecutionLayerSchemaReady } from "@/lib/data/operations";
import { getProjectFinanceData } from "@/lib/data/project-finance";
import { getProjectProfile } from "@/lib/data/project-profile";
import { getProjectForUser } from "@/lib/data/projects";
import { parseLocalizedNumber } from "@/lib/numbers/parse-localized-number";
import "../../../../project-finance-dashboard.css";

export const dynamic = "force-dynamic";
type Props = { params: Promise<{ projectId: string }> };

export default async function ProjectFinancePage({ params }: Props) {
  const { projectId } = await params;
  const user = await requireCurrentUser();
  const project = await getProjectForUser(user, projectId);
  if (!project) notFound();

  const [canRead, canWrite, schemaReady, profile] = await Promise.all([
    hasDomainAccess({ workspaceId: project.workspace_id, userId: user.id, domain: "finance", level: "read", projectId: project.id }),
    hasDomainAccess({ workspaceId: project.workspace_id, userId: user.id, domain: "finance", level: "write", projectId: project.id }),
    isExecutionLayerSchemaReady(),
    getProjectProfile(project)
  ]);
  if (!canRead) return <DomainAccessDenied workspaceId={project.workspace_id} area="Finanse inwestycji" />;

  if (!schemaReady) {
    return (
      <ProjectCompactShell icon={WalletCards} kicker="Finanse" title="Finanse inwestycji" description="Umowa · BOQ/WBS · przerób · koszty · płatności · prognoza" status="Oczekiwanie na dane">
        <ExecutionLayerNotice />
      </ProjectCompactShell>
    );
  }

  const contractValue = parseLocalizedNumber(profile.contractValue);
  let data = null;
  try {
    data = await getProjectFinanceData({
      workspaceId: project.workspace_id,
      projectId: project.id,
      profileContractValue: contractValue > 0 ? contractValue : null
    });
  } catch (error) {
    console.error("Project Octopus: investment finance dashboard unavailable", {
      projectId: project.id,
      message: error instanceof Error ? error.message : String(error)
    });
  }
  if (data) return <ProjectFinanceDashboard projectId={project.id} currency={profile.currency || "PLN"} canWrite={canWrite} data={data} />;
  return (
    <ProjectCompactShell icon={WalletCards} kicker="Finanse" title="Finanse inwestycji" description="Umowa · BOQ/WBS · przerób · koszty · płatności · prognoza" status="Błąd danych">
      <section className="pf-data-error" role="alert">
        <strong>Nie udało się pobrać aktualnego podsumowania.</strong>
        <span>Odśwież widok. Jeśli problem pozostanie, sprawdź połączenie z bazą danych.</span>
      </section>
    </ProjectCompactShell>
  );
}
