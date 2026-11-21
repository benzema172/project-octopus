import { NextResponse } from "next/server";
import { getRequestUser } from "@/lib/auth";
import { getProjectForUser } from "@/lib/data/projects";
import { hasDomainAccess } from "@/lib/authorization";
import { createServiceSupabaseClient } from "@/lib/supabase/service";
import { projectSourceReview, type ReviewKind, type SourceDocument } from "@/lib/documents/project-source-review";
import { attachmentTarget } from "@/lib/documents/word-tables";

const categories = { schedule: ["estimate","schedule","specification"], materials: ["estimate","technical","application"], protocols: ["protocol","specification","technical"] };
const reply = (body: unknown,status = 200) => NextResponse.json(body,{status,headers:{"Cache-Control":"private, no-store"}});
export async function GET(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return reply({error:"Brak aktywnej sesji."},401);
  const params = new URL(request.url).searchParams;
  const projectId = params.get("projectId") ?? "", kind = params.get("kind") as ReviewKind;
  const offset = Number(params.get("offset") || 0);
  if (!Object.hasOwn(categories,kind) || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(projectId) || !Number.isSafeInteger(offset) || offset < 0) return reply({error:"Nieprawidłowe parametry."},400);
  const project = await getProjectForUser(user,projectId);
  if (!project || !await hasDomainAccess({workspaceId:project.workspace_id,userId:user.id,projectId,domain:"investments",level:"read"})) return reply({error:"Brak dostępu do inwestycji."},403);
  const workspaceId = project.workspace_id;
  const db = createServiceSupabaseClient();
  const docs: SourceDocument[] = [];
  const names = new Map<string,string[]>();

  for (let offset = 0; ; offset += 80) {
    const page = await db.from("documents").select("id,name,current_version_id,category,review_status")
      .eq("workspace_id",workspaceId).eq("project_id",projectId).is("deleted_at",null).in("category",categories[kind])
      .order("id").range(offset,offset + 79);
    if (page.error) return reply({error:"Nie udało się odczytać dokumentów."},503);
    const versions = (page.data ?? []).filter(d => d.current_version_id && !["rejected","archived"].includes(d.review_status));
    if (versions.length) {
      const extraction = await db.from("document_extractions").select("document_id,document_version_id,source:payload->constructionSource")
        .eq("workspace_id",workspaceId).eq("project_id",projectId).eq("extraction_type","document_context").eq("schema_version","document-analysis-v3")
        .in("document_version_id",versions.map(d => d.current_version_id));
      if (extraction.error) return reply({error:"Nie udało się odczytać powiązań."},503);
      for (const d of versions) {
        const key = String(d.name).toLowerCase();
        names.set(key,[...(names.get(key) ?? []), d.current_version_id]);
        const match = extraction.data?.find(e => e.document_id === d.id && e.document_version_id === d.current_version_id);
        const source = match?.source as unknown as SourceDocument["source"] | null;
        if (source?.version === 1) docs.push({ name: d.name, versionId: d.current_version_id, category: d.category, approved: d.review_status === "approved", source });
      }
    }
    if ((page.data?.length ?? 0) < 80) break;
  }

  const findings = projectSourceReview(docs,kind);
  const items = findings.slice(offset,offset + 40).map(item => ({...item,links:item.links?.map(link => {
    const target = attachmentTarget(link.target), versions = names.get(target.toLowerCase());
    return {label:link.label || target,href:/^https?:\/\//i.test(target) ? target : "",versionId:versions?.length === 1 ? versions[0] : null};
  })}));
  return reply({items,total:findings.length});
}
