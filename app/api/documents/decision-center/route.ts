import { NextResponse } from "next/server";
import { getRequestUser } from "@/lib/auth";
import { getWorkspaceForUser } from "@/lib/data/workspace";
import { hasDomainAccess, domainForDocumentCategory } from "@/lib/authorization";
import { createServiceSupabaseClient } from "@/lib/supabase/service";
import { evaluateProjectMatch, type ProjectMatchCandidate } from "@/lib/ai/project-matcher";

export const runtime="nodejs";
export const dynamic="force-dynamic";
type Row=Record<string,unknown>;
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i;
const error=(message:string,status=400)=>NextResponse.json({error:message},{status,headers:{"Cache-Control":"no-store"}});
const str=(v:unknown)=>typeof v==="string"?v.trim():"";
const n=(v:unknown)=>typeof v==="number"?v:Number(v);
const validNum=(x:unknown)=>Number.isFinite(n(x))&&n(x)>=0;

async function context(request:Request,documentId:string,workspaceId:string,write:boolean){
 const user=await getRequestUser(request);
 if(!user)return {error:error("Zaloguj się ponownie.",401)} as const;
 if(!uuid.test(documentId)||!uuid.test(workspaceId))return {error:error("Nieprawidłowe identyfikatory.",400)} as const;
 const workspace=await getWorkspaceForUser(user,workspaceId);
 if(!workspace)return {error:error("Brak dostępu do firmy.",403)} as const;
 const db=createServiceSupabaseClient();
 const {data:document, error:documentError}=await db.from("documents")
   .select("id,workspace_id,project_id,category,review_status,ai_status,ai_confidence,current_version_id,deleted_at,name")
   .eq("id",documentId).eq("workspace_id",workspace.id).is("deleted_at",null).maybeSingle();
 if(documentError||!document)return {error:error("Dokument nie jest dostępny.",404)} as const;
 const domain=domainForDocumentCategory(document.category);
 if(!await hasDomainAccess({workspaceId:workspace.id,userId:user.id,domain,level:write?"write":"read",projectId:document.project_id}))
   return {error:error("Brak uprawnień do tego dokumentu.",403)} as const;
 return {user,workspace,db,document} as const;
}

export async function GET(request:Request){
 const url=new URL(request.url);const workspaceId=str(url.searchParams.get("workspaceId"));
 const documentId=str(url.searchParams.get("documentId"));
 const ctx=await context(request,documentId,workspaceId,false);
 if("error" in ctx)return ctx.error;
 const {db,workspace,document}=ctx;
 const [{data:invoiceRows,error:invoiceError},{data:inboxRows,error:inboxError},
   {data:classifications},{data:projects,error:projectsError}]=await Promise.all([
    db.from("invoices").select("id,invoice_number,direction,issue_date,net_amount,tax_amount,gross_amount,counterparty_id,currency,status")
     .eq("document_id",document.id).eq("workspace_id",workspace.id).limit(3),
    db.from("business_inbox_items").select("id,document_type,status,canonical_payload,payload,project_id")
     .eq("document_id",document.id).eq("workspace_id",workspace.id).order("received_at",{ascending:false}).limit(8),
    db.from("document_classifications").select("category,confidence,proposed_project_id,rationale")
     .eq("document_id",document.id).eq("workspace_id",workspace.id)
     .order("created_at",{ascending:false}).limit(1),
    db.from("projects").select("id,name,code,client_name,investor_name,location,city")
     .eq("workspace_id",workspace.id).limit(200)
 ]);
 if(invoiceError||inboxError||projectsError)return error("Nie można odczytać danych decyzji.",500);
 const projectOptions=(projects??[]).filter((p)=>uuid.test(p.id));
 // Do not give access to a project merely because another document mentions it.
 const visibleProjects=(await Promise.all(projectOptions.map(async (p)=>
   await hasDomainAccess({workspaceId:workspace.id,userId:ctx.user.id,
     domain:"investments",level:"read",projectId:p.id})?p:null))).filter((p)=>p!==null);
 const invoice=(invoiceRows??[]).find(i=>i.direction==="purchase")??invoiceRows?.[0]??null;
 const origin=(inboxRows??[]).find(i=>i.document_type==="warehouse")??null;
 const classification=classifications?.[0]??null;
 const candidates:ProjectMatchCandidate[]=visibleProjects.map(p=>({
   id:p.id,name:p.name??"",code:p.code??null,
   investorName:p.investor_name??p.client_name??null,
   location:p.location??p.city??null
 }));
 const canonical=(inboxRows??[]).find(i=>i.document_type==="invoice")?.canonical_payload as Row|undefined;
 const hint=[str(canonical?.projectCode),str(canonical?.projectName),str(canonical?.projectAddress)]
   .filter(Boolean).join(" | ");
 const match=hint?evaluateProjectMatch(hint,candidates):null;
 const matchedProjectId=match?.status==="matched"?match.project?.id??null:null;
 const classifiedProjectId=classification?.proposed_project_id &&
   visibleProjects.some(p=>p.id===classification.proposed_project_id)
    ? classification.proposed_project_id:null;
 const suggestion=document.project_id??matchedProjectId??classifiedProjectId??null;
 let lines:Array<Row>=[];
 let allocations:Array<Row>=[];
 let review:Array<Row>=[];
 if(invoice){
  const [l,a,r]=await Promise.all([
   db.from("invoice_lines").select("id,line_number,description,quantity,unit,net_amount,gross_amount,line_type,stock_item_id,normalized_material_key,supplier_sku")
    .eq("workspace_id",workspace.id).eq("invoice_id",invoice.id).order("line_number",{ascending:true}).limit(180),
   db.from("financial_allocations").select("id,source_line_id,allocation_scope,project_id,amount,allocation_source,status,cost_code")
    .eq("workspace_id",workspace.id).eq("source_type","invoice").eq("source_id",invoice.id)
    .in("status",["approved","proposed"]).limit(300),
   db.from("finance_document_reviews").select("id,review_type,status,description,title,confidence")
    .eq("workspace_id",workspace.id).eq("invoice_id",invoice.id).eq("status","open").limit(30)
  ]);
  if(l.error||a.error||r.error)return error("Błąd odczytu pozycji faktury.",500);
  lines=l.data??[];allocations=a.data??[];review=r.data??[];
 }
 const warehousePayload=(origin?.canonical_payload??origin?.payload??{}) as Row;
 const warehouseLines=Array.isArray(warehousePayload.lines)?warehousePayload.lines.slice(0,200):[];
 const {data:intents}=await db.from("document_allocation_targets_20261102")
  .select("invoice_line_id,inbox_item_id,line_index,allocation_scope,project_id,quantity,net_amount,status")
  .eq("workspace_id",workspace.id).eq("document_id",document.id).eq("status","planned").limit(200);
 return NextResponse.json({
   type:invoice?.direction==="purchase"?"purchase_invoice":origin?"warehouse_document":invoice?"sales_invoice":"other",
   document:{id:document.id,name:document.name,category:document.category,aiStatus:document.ai_status,
     aiConfidence:document.ai_confidence,reviewStatus:document.review_status,
     versionId:document.current_version_id,projectId:document.project_id},
   invoice,lines,allocations,reviews:review,
   warehouse:origin?{id:origin.id,kind:str(warehousePayload.documentType)||"Dokument magazynowy",
     lines:warehouseLines,status:origin.status}:null,
   intents:intents??[],
   projects:visibleProjects,
   aiSuggestion:{
     projectId:suggestion,
     reason:document.project_id?"Zapisane przypisanie dokumentu":matchedProjectId?match?.reason:
       classifiedProjectId?"AI wskazało inwestycję (wymaga potwierdzenia dowodów)":null,
     confidence:classification?.confidence??null,
     matchEvidence:match?.evidence??[],
     sourceHints:hint||null,
     trustworthy:Boolean(document.project_id || (matchedProjectId && match?.evidence.some(e=>["contract","code","id"].includes(e.type))))
   }
 },{headers:{"Cache-Control":"no-store"}});
}

type Part={lineId:string;scope:"project"|"inventory"|"overhead";projectId?:string|null;
  amount:number;quantity:number;costCode?:string};
type PostBody={workspaceId:string;documentId:string;mode:"invoice"|"warehouse";
 invoiceId?:string;inboxId?:string;assignments?:Part[];scope?:string;projectId?:string|null};
export async function POST(request:Request){
 let body:PostBody;
 try{body=await request.json() as PostBody;}catch{return error("Nieprawidłowy plan.",400);}
 const ctx=await context(request,str(body.documentId),str(body.workspaceId),true);
 if("error" in ctx)return ctx.error;
 const {db,document,workspace,user}=ctx;
 if(body.mode==="invoice"){
  if(!uuid.test(str(body.invoiceId))||!Array.isArray(body.assignments)
    ||body.assignments.length<1||body.assignments.length>160)return error("Nieprawidłowa lista przypisań.",400);
  if(!await hasDomainAccess({workspaceId:workspace.id,userId:user.id,domain:"finance",level:"write"}))
    return error("Brak prawa do przypisywania kosztów.",403);
  const {data:invoice}=await db.from("invoices").select("id")
    .eq("workspace_id",workspace.id).eq("document_id",document.id)
    .eq("id",body.invoiceId!).eq("direction","purchase").maybeSingle();
  if(!invoice)return error("Dokument nie jest fakturą zakupową.",409);
  const assignments=body.assignments;
  for(const part of assignments){
   if(!uuid.test(str(part.lineId))||!["project","inventory","overhead"].includes(part.scope)
      ||!validNum(part.amount)||!validNum(part.quantity)||!Number.isFinite(n(part.amount))||!Number.isFinite(n(part.quantity))
      ||(part.scope==="project"&&!uuid.test(str(part.projectId)))
      ||(part.scope!=="project"&&Boolean(part.projectId)))
     return error("Brak wartości, ilości lub prawidłowego celu.",400);
  }
  const usedProjects=[...new Set(assignments.map(p=>p.projectId).filter((x):x is string=>Boolean(x)))];
  for(const projectId of usedProjects)
   if(!await hasDomainAccess({workspaceId:workspace.id,userId:user.id,domain:"investments",level:"write",projectId}))
    return error("Nie możesz przypisać kosztu do wybranej inwestycji.",403);
  if(assignments.some(p=>p.scope==="inventory") &&
    !await hasDomainAccess({workspaceId:workspace.id,userId:user.id,domain:"warehouse",level:"write"}))
    return error("Brak prawa do magazynu.",403);
  const {data:openReviews}=await db.from("finance_document_reviews")
     .select("review_type").eq("workspace_id",workspace.id).eq("invoice_id",invoice.id)
     .eq("status","open").in("review_type",["source_conflict","duplicate_candidate"]).limit(1);
  if(openReviews?.length)return error("Najpierw rozstrzygnij niezgodność kwot lub podejrzenie duplikatu tej faktury.",409);
  const {data,error:rpcError}=await db.rpc("apply_decision_center_invoice_plan_20261102",{
    p_workspace_id:workspace.id,p_document_id:document.id,p_invoice_id:invoice.id,
    p_plan:assignments.map(p=>({lineId:p.lineId,scope:p.scope,
      projectId:p.projectId??null,amount:p.amount,quantity:p.quantity,
      costCode:str(p.costCode).slice(0,64)})),p_actor_id:user.id
  });
  if(rpcError)return error(rpcError.message,422);
  return NextResponse.json({result:data,ok:true},{headers:{"Cache-Control":"no-store"}});
 }
 if(body.mode==="warehouse"){
  if(!uuid.test(str(body.inboxId))||!["project","inventory","overhead"].includes(str(body.scope)))
    return error("Wybierz przeznaczenie dokumentu magazynowego.",400);
  if(!await hasDomainAccess({workspaceId:workspace.id,userId:user.id,domain:"warehouse",level:"write"}))
    return error("Brak prawa do magazynu.",403);
  const projectId=str(body.projectId)||null;
  if(body.scope==="project"){
    if(!projectId || !await hasDomainAccess({workspaceId:workspace.id,userId:user.id,
      domain:"investments",level:"write",projectId}))
      return error("Brak prawa do tej inwestycji.",403);
  }else if(projectId) return error("Ten cel nie wymaga inwestycji.",400);
  const {data:source}=await db.from("business_inbox_items").select("id")
    .eq("workspace_id",workspace.id).eq("document_id",document.id)
    .eq("document_type","warehouse").eq("id",body.inboxId!).maybeSingle();
  if(!source)return error("Nie znaleziono źródłowego WZ/PZ/MM.",404);
  const {data,error:rpcError}=await db.rpc("apply_decision_center_warehouse_intent_20261102",{
    p_workspace_id:workspace.id,p_document_id:document.id,p_inbox_id:source.id,
    p_scope:body.scope,p_project_id:projectId,p_actor_id:user.id
  });
  if(rpcError)return error(rpcError.message,422);
  return NextResponse.json({result:data,ok:true},{headers:{"Cache-Control":"no-store"}});
 }
 return error("Nieznana decyzja.",400);
}
