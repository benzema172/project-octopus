import Link from "next/link";
import { Archive, Download, FileCheck2, FileJson2, FileSignature, FileText } from "lucide-react";
import { notFound } from "next/navigation";
import { ProjectModuleFoundation } from "@/components/projects/project-module-foundation";
import { requireCurrentUser } from "@/lib/auth";
import { listDocumentsForCategories } from "@/lib/data/documents";
import { getProjectForUser } from "@/lib/data/projects";
import { DomainAccessDenied } from "@/components/access/domain-access-denied";
import { hasDomainAccess } from "@/lib/authorization";
import { createServiceSupabaseClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";
type Props = { params: Promise<{ projectId: string }> };

export default async function ProjectOutputsPage({ params }: Props) {
  const { projectId } = await params;
  const user = await requireCurrentUser();
  const project = await getProjectForUser(user, projectId);
  if (!project) notFound();
  if (!await hasDomainAccess({ workspaceId: project.workspace_id, userId: user.id, domain: "investments", level: "read", projectId: project.id })) return <DomainAccessDenied workspaceId={project.workspace_id} area="Wyniki inwestycji" />;
  const db=createServiceSupabaseClient();
  const [documents,outputsResult,requestsResult,protocolsResult]=await Promise.all([
    listDocumentsForCategories(projectId,["wniosek","protokol"]),
    db.from("project_outputs").select("id,title,output_type,version_number,status,mime_type,generated_at,approved_at,warnings").eq("workspace_id",project.workspace_id).eq("project_id",project.id).order("generated_at",{ascending:false}),
    db.from("material_requests").select("id,title,manufacturer,product_name,model,approved_at").eq("project_id",project.id).eq("status","approved").order("approved_at",{ascending:false}),
    db.from("protocols").select("id,title,protocol_type,protocol_date,result,approved_at").eq("project_id",project.id).eq("status","approved").order("approved_at",{ascending:false})
  ]);
  const outputs=outputsResult.data??[];const approvedOutputs=outputs.filter(item=>item.status==="approved").length;

  return <ProjectModuleFoundation
    kicker="Repozytorium wyników"
    title="Gotowe dokumenty inwestycji"
    description="Rzeczywiste, wersjonowane wyniki: zatwierdzone WM i protokoły oraz paczki closeout z manifestem danych źródłowych."
    status={outputs.length||documents.length?`${outputs.length} paczek · ${documents.length} dokumentów źródłowych`:"Oczekuje na pierwsze wyniki"}
    metrics={[
      {label:"Paczki wynikowe",value:String(outputs.length),hint:"wersjonowane snapshoty"},
      {label:"Zatwierdzone paczki",value:String(approvedOutputs),hint:"gotowe do przekazania"},
      {label:"Zatwierdzone WM",value:String(requestsResult.data?.length??0),hint:"decyzja approved"},
      {label:"Zatwierdzone protokoły",value:String(protocolsResult.data?.length??0),hint:"z rzeczywistym wynikiem"}
    ]}
    documents={documents}
    intakeLabel="Dokumenty wynikowe i zatwierdzone"
    workflow={["Moduł źródłowy zapisuje rzeczywiste dane","Akceptacja zamyka obieg WM/protokołu","Closeout tworzy niezmienny snapshot wersji","PDF i manifest JSON są pobierane z konkretnej wersji wyniku"]}
    items={[
      {title:"Wnioski materiałowe",description:"Tylko wnioski po pełnym obiegu i decyzji zatwierdzającej.",icon:FileCheck2},
      {title:"Protokoły",description:"Próby i odbiory z wynikami, uczestnikami, dowodami i akceptacją.",icon:FileSignature},
      {title:"Manifesty",description:"Snapshot źródeł, checklisty i dokumentów dla każdej wersji paczki.",icon:FileText},
      {title:"Eksport końcowy",description:"Pobieralny PDF oraz pełny manifest JSON wersji closeout.",icon:Archive}
    ]}
    principle="Wynik jest wersją danych zatwierdzonych w chwili generowania. Kolejna zmiana nie nadpisuje poprzedniej paczki — tworzy nową wersję."
  >
    <section className="section-band"><div className="section-heading"><div><p className="eyebrow">Paczki</p><h2>Wersjonowane eksporty</h2></div><Link className="primary-button" href={`/workspace/projects/${project.id}/closeout`}>Przejdź do Closeout</Link></div><div className="project-live-records">{outputs.map(output=><article className="project-live-record" key={output.id}><div><strong>{output.title} · v{output.version_number}</strong><p>{output.output_type} · {output.status}</p><small>{new Intl.DateTimeFormat("pl-PL",{dateStyle:"medium",timeStyle:"short"}).format(new Date(output.generated_at))}</small></div><div><Link className="secondary-button" href={`/api/projects/closeout?projectId=${project.id}&outputId=${output.id}&format=pdf`}><Download size={14}/>PDF</Link><Link className="secondary-button" href={`/api/projects/closeout?projectId=${project.id}&outputId=${output.id}&format=json`}><FileJson2 size={14}/>JSON</Link></div></article>)}{!outputs.length?<p className="empty-copy">Brak wygenerowanych paczek. Utwórz checklistę w Closeout i wygeneruj pierwszą wersję.</p>:null}</div></section>
    <section className="section-band"><div className="section-heading"><div><p className="eyebrow">Zatwierdzone obiegi</p><h2>WM i protokoły gotowe do paczki</h2></div></div><div className="project-live-records">{(requestsResult.data??[]).map(item=><article className="project-live-record" key={`wm-${item.id}`}><div><strong>{item.title}</strong><p>{[item.manufacturer,item.product_name,item.model].filter(Boolean).join(" · ")}</p><small>Wniosek materiałowy · zatwierdzony</small></div></article>)}{(protocolsResult.data??[]).map(item=><article className="project-live-record" key={`protocol-${item.id}`}><div><strong>{item.title}</strong><p>{item.protocol_type} · {item.protocol_date??"bez daty"}</p><small>{item.result??"Zatwierdzony protokół"}</small></div></article>)}</div></section>
  </ProjectModuleFoundation>;
}
