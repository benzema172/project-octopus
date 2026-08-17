import { Archive, FileCheck2, FileSignature, FileText } from "lucide-react";
import { notFound } from "next/navigation";
import { ProjectModuleFoundation } from "@/components/projects/project-module-foundation";
import { GeneratedOutputList } from "@/components/projects/generated-output-list";
import { requireCurrentUser } from "@/lib/auth";
import { listDocumentsForCategories } from "@/lib/data/documents";
import { getProjectForUser } from "@/lib/data/projects";
import { DomainAccessDenied } from "@/components/access/domain-access-denied";
import { domainAccessPolicyAllows, domainForDocumentCategory, hasDomainAccess, loadDomainAccessPolicy } from "@/lib/authorization";
import { createServiceSupabaseClient } from "@/lib/supabase/service";
import { generationDocumentCategory } from "@/lib/templates/render-generation";

export const dynamic = "force-dynamic";
type Props = { params: Promise<{ projectId: string }> };

export default async function ProjectOutputsPage({ params }: Props) {
  const { projectId } = await params;
  const user = await requireCurrentUser();
  const project = await getProjectForUser(user, projectId);
  if (!project) notFound();
  const canRead = await hasDomainAccess({ workspaceId: project.workspace_id, userId: user.id, domain: "investments", level: "read", projectId: project.id });
  if (!canRead) return <DomainAccessDenied workspaceId={project.workspace_id} area="Wyniki inwestycji" />;
  const supabase = createServiceSupabaseClient();
  const [allDocuments, generatedResult, draftsResult, accessPolicy] = await Promise.all([
    listDocumentsForCategories(projectId, ["application", "protocol", "schedule", "report"]),
    supabase.from("generated_documents").select("id,generation_run_id,created_at,documents!inner(name,current_version_id,category)").eq("workspace_id", project.workspace_id).eq("project_id", project.id).order("created_at", { ascending: false }).limit(50),
    supabase.from("generation_runs").select("id,created_at,input_snapshot,warnings,template_versions(templates(name))").eq("workspace_id", project.workspace_id).eq("project_id", project.id).eq("status", "draft").order("created_at", { ascending: false }).limit(30),
    loadDomainAccessPolicy({ workspaceId: project.workspace_id, userId: user.id })
  ]);
  const documents = allDocuments.filter((document) => domainAccessPolicyAllows(accessPolicy, { domain: domainForDocumentCategory(document.category), level: "read", projectId: project.id }));
  const outputs = (generatedResult.data ?? []).flatMap((row) => {
    const documentValue = row.documents as unknown;
    const document = Array.isArray(documentValue) ? documentValue[0] as Record<string, unknown> : documentValue as Record<string, unknown> | null;
    const category = String(document?.category ?? "document");
    const canReadOutput = domainAccessPolicyAllows(accessPolicy, { domain: domainForDocumentCategory(category), level: "read", projectId: project.id });
    return document?.current_version_id && canReadOutput ? [{ id: String(row.id), name: String(document.name), runId: String(row.generation_run_id), versionId: String(document.current_version_id), createdAt: String(row.created_at) }] : [];
  });
  const drafts = (draftsResult.data ?? []).map((row) => {
    const versionValue = row.template_versions as unknown;
    const version = Array.isArray(versionValue) ? versionValue[0] as Record<string, unknown> : versionValue as Record<string, unknown> | null;
    const templateValue = version?.templates;
    const template = Array.isArray(templateValue) ? templateValue[0] as Record<string, unknown> : templateValue as Record<string, unknown> | null;
    const snapshot = row.input_snapshot && typeof row.input_snapshot === "object" ? row.input_snapshot as Record<string, unknown> : {};
    const category = generationDocumentCategory(snapshot.document_type);
    const canReadDraft = domainAccessPolicyAllows(accessPolicy, { domain: domainForDocumentCategory(category), level: "read", projectId: project.id });
    return canReadDraft ? { id: String(row.id), label: String(template?.name ?? "Szkic dokumentu"), createdAt: String(row.created_at), warningCount: Array.isArray(row.warnings) ? row.warnings.length : 0, canApprove: domainAccessPolicyAllows(accessPolicy, { domain: "templates", level: "approve", projectId: project.id }) && domainAccessPolicyAllows(accessPolicy, { domain: domainForDocumentCategory(category), level: "approve", projectId: project.id }) } : null;
  }).filter((draft): draft is NonNullable<typeof draft> => Boolean(draft));

  return <ProjectModuleFoundation
    kicker="Repozytorium wyników"
    title="Gotowe dokumenty inwestycji"
    description="Jedno miejsce na materiały wygenerowane, zatwierdzone lub końcowo uporządkowane w Project Octopus."
    status={outputs.length ? `${outputs.length} opublikowanych wyników` : drafts.length ? `${drafts.length} szkiców do decyzji` : "Oczekuje na pierwsze wyniki"}
    metrics={[
      { label: "Dokumenty powiązane", value: String(documents.length), hint: "wnioski, protokoły, raporty" },
      { label: "Opublikowane", value: String(outputs.length), hint: "wersjonowane pliki HTML w R2" },
      { label: "Do decyzji", value: String(drafts.length), hint: "kontrolowane szkice" }
    ]}
    documents={documents}
    intakeLabel="Dokumenty wynikowe i zatwierdzone"
    workflow={[
      "Moduł źródłowy tworzy dokument roboczy",
      "Użytkownik zatwierdza treść i dane",
      "Octopus zapisuje wersję i źródła",
      "Gotowy plik trafia do repozytorium Wyniki"
    ]}
    items={[
      { title: "Wnioski materiałowe", description: "Zatwierdzone i robocze wersje wniosków wraz z załącznikami technicznymi.", icon: FileCheck2 },
      { title: "Protokoły", description: "Próby, odbiory, roboty zanikowe i pozostałe dokumenty wykonawcze.", icon: FileSignature },
      { title: "Raporty i zestawienia", description: "Zestawienia postępu, przerobu, braków i analiz wygenerowanych przez system.", icon: FileText },
      { title: "Eksporty końcowe", description: "Wersjonowany HTML gotowy do pobrania, druku lub zapisania jako PDF.", icon: Archive }
    ]}
    principle="Wyniki nie są osobnym źródłem danych. Są efektem pracy pozostałych modułów i zawsze zachowują powiązanie z danymi oraz źródłami, z których powstały."
  ><GeneratedOutputList workspaceId={project.workspace_id} projectId={project.id} outputs={outputs} drafts={drafts} /></ProjectModuleFoundation>;
}
