import { NextResponse } from "next/server";
import { getRequestUser } from "@/lib/auth";
import { domainForDocumentCategory, hasDomainAccess } from "@/lib/authorization";
import { getWorkspaceForUser } from "@/lib/data/workspace";
import { createServiceSupabaseClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RequestBody = {
  workspaceId?: string;
  documentId?: string;
  name?: string;
  expectedUpdatedAt?: string;
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i;

function error(message: string, status: number) {
  return NextResponse.json({error:message},{status,headers:{"Cache-Control":"no-store"}});
}

/**
 * Change the human-visible archive label only; do not rewrite the original
 * R2 file, change document classification, or mutate any posted financial
 * records. Content replacement uses the existing versioned R2 upload flow.
 */
export async function PATCH(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return error("Zaloguj się, aby edytować dokumenty.",401);
  let body: RequestBody;
  try { body = await request.json() as RequestBody; }
  catch { return error("Nieprawidłowe dane dokumentu.",400); }
  if (!UUID.test(body.workspaceId??"") || !UUID.test(body.documentId??""))
    return error("Nieprawidłowy identyfikator firmy lub dokumentu.",400);
  if (typeof body.name !== "string")
    return error("Podaj nazwę dokumentu.",400);
  const name=body.name.trim().replace(/\s+/g," ");
  if (name.length<2 || name.length>160 || /[\u0000-\u001f\u007f]/.test(name))
    return error("Nazwa powinna mieć od 2 do 160 znaków i nie zawierać znaków sterujących.",400);
  const workspace=await getWorkspaceForUser(user,body.workspaceId!);
  if (!workspace) return error("Brak dostępu do firmy.",403);
  const db=createServiceSupabaseClient();
  const {data:source,error:readError}=await db.from("documents")
    .select("id,name,title,category,project_id,updated_at,deleted_at")
    .eq("id",body.documentId!).eq("workspace_id",workspace.id)
    .maybeSingle<{id:string;name:string|null;title:string;category:string|null;project_id:string|null;updated_at:string;deleted_at:string|null}>();
  if (readError) return error("Nie udało się odczytać dokumentu.",500);
  if (!source) return error("Nie znaleziono dokumentu w tej firmie.",404);
  if (source.deleted_at) return error("Dokument jest w koszu. Najpierw go przywróć.",409);
  if (!await hasDomainAccess({
    workspaceId:workspace.id,userId:user.id,
    domain:domainForDocumentCategory(source.category),
    level:"write",projectId:source.project_id
  })) return error("Brak uprawnienia do edycji tego dokumentu.",403);
  if (body.expectedUpdatedAt && source.updated_at !== body.expectedUpdatedAt)
    return error("Dokument zmienił się od ostatniego odświeżenia. Odśwież widok i spróbuj ponownie.",409);
  if ((source.name || source.title) === name)
    return NextResponse.json({ok:true,name,unchanged:true},{headers:{"Cache-Control":"no-store"}});
  const {data:updated,error:updateError}=await db.from("documents")
    .update({name,title:name,updated_at:new Date().toISOString()})
    .eq("id",source.id).eq("workspace_id",workspace.id)
    .eq("updated_at",source.updated_at).is("deleted_at",null)
    .select("id,name").maybeSingle<{id:string;name:string}>();
  if (updateError) {
    const msg=String(updateError.message??"").toLowerCase();
    return error(msg.includes("tylko do odczytu")||msg.includes("archiw")?
      "Nie można edytować dokumentu w zamkniętej inwestycji.":
      "Nie udało się zapisać nazwy dokumentu.",409);
  }
  if (!updated) return error("Dokument został zmieniony równocześnie. Odśwież widok.",409);

  const {error:auditError}=await db.from("audit_events").insert({
    workspace_id:workspace.id,
    project_id:source.project_id,
    actor_id:user.id,
    actor_type:"user",
    event_type:"document.archive_name_changed",
    entity_type:"document",
    entity_id:source.id,
    before_value:{name:source.name??source.title},
    after_value:{name}
  });
  if (auditError) console.error("[document-metadata] Audit write failed",auditError.code);
  return NextResponse.json({ok:true,name:updated.name},{headers:{"Cache-Control":"no-store"}});
}
