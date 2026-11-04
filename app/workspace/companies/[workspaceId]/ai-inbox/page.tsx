import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { notFound } from "next/navigation";
import { DomainAccessDenied } from "@/components/access/domain-access-denied";
import { AiInbox } from "@/components/brain/ai-inbox";
import { BrainLearningDashboard } from "@/components/brain/brain-learning-dashboard";
import { getBrainLearningSnapshot } from "@/lib/data/brain-learning";
import { requireCurrentUser } from "@/lib/auth";
import {
  domainAccessPolicyAllows,
  domainForDocumentCategory,
  hasDomainAccess,
  loadDomainAccessPolicy,
  type Domain
} from "@/lib/authorization";
import { listAiInbox } from "@/lib/data/operations";
import { listProjectsForWorkspace } from "@/lib/data/projects";
import { getWorkspaceForUser } from "@/lib/data/workspace";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ workspaceId: string }> };

export default async function CompanyAiInboxPage({ params }: Props) {
  const { workspaceId } = await params;
  const user = await requireCurrentUser();
  const workspace = await getWorkspaceForUser(user, workspaceId);
  if (!workspace) notFound();

  if (!await hasDomainAccess({ workspaceId: workspace.id, userId: user.id, domain: "investments", level: "read" })) {
    return <DomainAccessDenied workspaceId={workspace.id} area="Skrzynka AI" />;
  }

  const [allItems, accessPolicy, projects, brainSnapshot] = await Promise.all([
    listAiInbox(workspace.id).catch((error) => {
      console.error("Project Octopus: AI inbox fallback", error);
      return [];
    }),
    loadDomainAccessPolicy({ workspaceId: workspace.id, userId: user.id }),
    listProjectsForWorkspace(user, workspace.id),
    getBrainLearningSnapshot(workspace.id).catch(error=>{
      console.error("Project Octopus Brain monitoring fallback",error);
      return null;
    })
  ]);

  const items = allItems.flatMap((item) => {
    const domain: Domain = item.entityType === "template_version"
      ? "templates"
      : item.entityType === "knowledge_entry"
        ? "reports"
        : item.entityType === "document"
          ? domainForDocumentCategory(item.category)
          : "investments";
    if (!domainAccessPolicyAllows(accessPolicy, { domain, level: "read", projectId: item.projectId })) return [];
    return [{
      ...item,
      canWrite: domainAccessPolicyAllows(accessPolicy, { domain, level: "write", projectId: item.projectId }),
      canApprove: domainAccessPolicyAllows(accessPolicy, { domain, level: "approve", projectId: item.projectId })
    }];
  });
  const reviewCount = items.filter((item) => item.status === "review").length;
  const errorCount = items.filter((item) => item.status === "error").length;
  const processingCount = items.filter((item) => ["new", "processing"].includes(item.status)).length;
  const readyCount = items.filter((item) => item.status === "ready").length;
  const awaitingCount = reviewCount + errorCount + processingCount;

  return (
    <main className="co-page co-ai-control-center" data-ai-control-center="1">
      <header className="co-page-heading co-page-heading--compact">
        <div>
          <p className="co-kicker">Octopus Brain</p>
          <h1>Centrum kontroli AI</h1>
          <p>Nadzór nad automatyzacją. Pokazujemy tu tylko sprawy wymagające interwencji; faktury przypisujesz w Dokumentach.</p>
        </div>
        <div className="co-heading-actions">
          <strong className="co-count-badge">{awaitingCount} spraw wymagających uwagi</strong>
          <Link href={`/workspace/companies/${workspace.id}/documents?tab=review`} className="co-text-link">Dokumenty do weryfikacji →</Link>
        </div>
      </header>

      <section className="co-ai-control-stats" aria-label="Stan kontroli AI">
        <article><span>Decyzje AI</span><strong>{reviewCount}</strong><small>Sprawy oczekujące na ocenę</small></article>
        <article><span>Błędy</span><strong>{errorCount}</strong><small>Można ponowić analizę</small></article>
        <article><span>Przetwarzanie</span><strong>{processingCount}</strong><small>Nowe i w toku</small></article>
        <article><span>Przetworzone</span><strong>{readyCount}</strong><small>Historia dostępna poniżej</small></article>
      </section>

      {brainSnapshot ? <BrainLearningDashboard workspaceId={workspace.id} snapshot={brainSnapshot}
        canApproveResearch={domainAccessPolicyAllows(accessPolicy,{domain:"reports",level:"approve"})}
        canRefresh={domainAccessPolicyAllows(accessPolicy,{domain:"settings",level:"admin"})}/> : null}

      <section className="co-section co-section--compact">
        <div className="co-section-heading">
          <div><p className="co-kicker">Nadzór AI</p><h2>Wymagają Twojej uwagi</h2></div>
          <Link href={`/workspace/companies/${workspace.id}/documents?upload=1`} className="co-text-link">Dodaj dokument →</Link>
        </div>
        {errorCount > 0 ? <p className="form-message form-message--error"><AlertTriangle size={15}/> {errorCount} błędów wymaga sprawdzenia lub ponowienia.</p> : null}
        <AiInbox controlCenter items={items} workspaceId={workspace.id} currentUserId={user.id}
          projects={projects.map(project=>({id:project.id,name:project.name}))}/>
      </section>
    </main>
  );
}
