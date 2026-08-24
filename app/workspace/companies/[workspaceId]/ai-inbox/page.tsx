import Link from "next/link";
import { AlertTriangle, CheckCircle2, FileCheck2, RotateCcw, ShieldCheck, Sparkles } from "lucide-react";
import { notFound } from "next/navigation";
import { DomainAccessDenied } from "@/components/access/domain-access-denied";
import { AiInbox } from "@/components/brain/ai-inbox";
import { requireCurrentUser } from "@/lib/auth";
import {
  domainAccessPolicyAllows,
  domainForDocumentCategory,
  hasDomainAccess,
  loadDomainAccessPolicy,
  type Domain
} from "@/lib/authorization";
import { getProjectMatchQuality, listAiInbox } from "@/lib/data/operations";
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

  const [allItems, accessPolicy, projects] = await Promise.all([
    listAiInbox(workspace.id).catch((error) => {
      console.error("Project Octopus: AI inbox fallback", error);
      return [];
    }),
    loadDomainAccessPolicy({ workspaceId: workspace.id, userId: user.id }),
    listProjectsForWorkspace(user, workspace.id)
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
  const matchQuality = await getProjectMatchQuality(workspace.id, projects.map((project) => project.id)).catch((error) => {
    console.error("Project Octopus: matcher quality fallback", error);
    return { reviewed: 0, confirmed: 0, corrected: 0, rejected: 0, aliases: 0, precision: null, recall: null, correctionRate: null };
  });

  const reviewCount = items.filter((item) => item.status === "review").length;
  const errorCount = items.filter((item) => item.status === "error").length;
  const processingCount = items.filter((item) => ["new", "processing"].includes(item.status)).length;
  const readyCount = items.filter((item) => item.status === "ready").length;

  return (
    <main className="co-page">
      <header className="co-page-heading">
        <div>
          <p className="co-kicker">Wspólna kontrola AI</p>
          <h1>Skrzynka AI</h1>
          <p>To nie jest poczta ani chatbot. To kolejka decyzji człowieka dla rzeczy, których AI nie powinno zatwierdzić samodzielnie.</p>
        </div>
        <strong className="co-count-badge">{reviewCount} decyzji · {errorCount} błędów</strong>
      </header>

      <section className="co-metric-grid" aria-label="Stan Skrzynki AI">
        <article className="co-metric-card"><span>Wymaga decyzji</span><strong>{reviewCount}</strong><small>zatwierdź albo odrzuć propozycję AI</small></article>
        <article className="co-metric-card"><span>Błędy</span><strong>{errorCount}</strong><small>można ponowić analizę dokumentu</small></article>
        <article className="co-metric-card"><span>W toku</span><strong>{processingCount}</strong><small>nowe i przetwarzane elementy</small></article>
        <article className="co-metric-card co-metric-card--ai"><span>Gotowe</span><strong>{readyCount}</strong><small>pozycje przyjęte przez pipeline</small></article>
      </section>

      <section className="ai-quality-strip" aria-label="Jakość dopasowania inwestycji">
        <article><span>Zweryfikowane przypisania</span><strong>{matchQuality.reviewed}</strong><small>{matchQuality.confirmed} bez korekty</small></article>
        <article><span>Precision</span><strong>{matchQuality.precision == null ? "—" : `${Math.round(matchQuality.precision * 100)}%`}</strong><small>trafność propozycji oznaczonych przez użytkowników</small></article>
        <article><span>Recall</span><strong>{matchQuality.recall == null ? "—" : `${Math.round(matchQuality.recall * 100)}%`}</strong><small>wykrycie przypisań potwierdzonych korektą</small></article>
        <article><span>Pamięć matchera</span><strong>{matchQuality.aliases}</strong><small>{matchQuality.correctionRate == null ? "brak próby" : `${Math.round(matchQuality.correctionRate * 100)}% korekt`}</small></article>
      </section>

      <section className="document-principles" aria-label="Jak działa Skrzynka AI">
        <div><Sparkles size={18} /><strong>AI proponuje</strong><span>Klasyfikację dokumentu, inwestycję, zmianę, import kosztorysu albo wpis wiedzy.</span></div>
        <div><ShieldCheck size={18} /><strong>System zatrzymuje ryzyko</strong><span>Niepewna propozycja nie zmienia danych operacyjnych bez decyzji użytkownika.</span></div>
        <div><CheckCircle2 size={18} /><strong>Ty zatwierdzasz</strong><span>Po zatwierdzeniu element może zasilić właściwy moduł i stać się zaufanym źródłem.</span></div>
        <div><RotateCcw size={18} /><strong>Błąd można ponowić</strong><span>Nieudana analiza dokumentu może wrócić do kolejki bez ponownego wrzucania pliku.</span></div>
      </section>

      <section className="co-section">
        <div className="co-section-heading">
          <div><p className="co-kicker">Co trafia tutaj</p><h2>Elementy wymagające świadomej decyzji</h2></div>
        </div>
        <div className="co-settings-cards">
          <article><FileCheck2 size={21} /><div><strong>Dokumenty</strong><p>Niepewna kategoria, dopasowanie do inwestycji i dane wyciągnięte z pliku.</p></div></article>
          <article><Sparkles size={21} /><div><strong>Kosztorysy i zmiany</strong><p>Mapowanie BOQ/WBS, skutki nowych rewizji i propozycje wpływu na realizację.</p></div></article>
          <article><ShieldCheck size={21} /><div><strong>Wzory i wiedza firmy</strong><p>Nowe wzory oraz wpisy pamięci organizacji przed dopuszczeniem ich do pracy AI.</p></div></article>
        </div>
        <p className="section-lead"><strong>Zasada:</strong> jeśli AI jest wystarczająco pewne i operacja jest bezpieczna, element nie powinien zawracać Ci głowy. Skrzynka ma pokazywać przede wszystkim wyjątki, błędy i decyzje o realnym skutku.</p>
      </section>

      <section className="co-section">
        <div className="co-section-heading">
          <div><p className="co-kicker">Kolejka</p><h2>Decyzje i wyjątki</h2></div>
          <Link href={`/workspace/companies/${workspace.id}/documents?upload=1`} className="co-text-link">Dodaj dokument →</Link>
        </div>
        {errorCount > 0 ? <p className="form-message form-message--error"><AlertTriangle size={15} /> {errorCount} elementów wymaga ponowienia lub sprawdzenia przyczyny błędu.</p> : null}
        <AiInbox items={items} workspaceId={workspace.id} currentUserId={user.id} projects={projects.map((project) => ({ id: project.id, name: project.name }))} />
      </section>
    </main>
  );
}
