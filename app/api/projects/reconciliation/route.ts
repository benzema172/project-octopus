import { NextResponse } from "next/server";
import { getRequestUser } from "@/lib/auth";
import { hasDomainAccess } from "@/lib/authorization";
import { getProjectForUser } from "@/lib/data/projects";
import { getProjectReconciliation } from "@/lib/data/reconciliation";
import { rankMatches } from "@/lib/investments/reconciliation-matcher";
import { createServiceSupabaseClient } from "@/lib/supabase/service";

export const runtime = "nodejs";

type Body = { projectId?: string; action?: "auto_match" | "approve_link" | "reject_link"; linkId?: string };

export async function GET(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: "Brak sesji." }, { status: 401 });
  const projectId = new URL(request.url).searchParams.get("projectId")?.trim();
  if (!projectId) return NextResponse.json({ error: "Brakuje inwestycji." }, { status: 400 });
  const project = await getProjectForUser(user, projectId);
  if (!project || !await hasDomainAccess({ workspaceId: project.workspace_id,userId:user.id,domain:"investments",level:"read",projectId })) return NextResponse.json({ error:"Brak dostępu." },{status:403});
  try { return NextResponse.json(await getProjectReconciliation(project.workspace_id,project.id),{headers:{"Cache-Control":"no-store"}}); }
  catch(error){ return NextResponse.json({error:error instanceof Error?error.message:"Błąd grafu."},{status:500}); }
}

export async function POST(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: "Brak sesji." }, { status: 401 });
  let body: Body;
  try { body=await request.json() as Body; } catch { return NextResponse.json({error:"Nieprawidłowe dane."},{status:400}); }
  if(!body.projectId||!body.action) return NextResponse.json({error:"Brakuje operacji."},{status:400});
  const project=await getProjectForUser(user,body.projectId);
  if(!project||!await hasDomainAccess({workspaceId:project.workspace_id,userId:user.id,domain:"investments",level:"write",projectId:project.id})) return NextResponse.json({error:"Brak uprawnienia do uzgadniania danych."},{status:403});
  const db=createServiceSupabaseClient();
  try {
    if(body.action==="approve_link"||body.action==="reject_link"){
      if(!body.linkId) throw new Error("Brakuje powiązania.");
      const {data:link}=await db.from("entity_links").select("id,source_type,target_id").eq("id",body.linkId).eq("workspace_id",project.workspace_id).maybeSingle<{id:string;source_type:string;target_id:string}>();
      if(!link) throw new Error("Powiązanie nie należy do firmy.");
      const {data:boq}=await db.from("boq_items").select("id").eq("id",link.target_id).eq("project_id",project.id).maybeSingle();
      if(!boq) throw new Error("Powiązanie nie należy do tej inwestycji.");
      const domain=link.source_type==="invoice_line"?"finance":"warehouse";
      if(!await hasDomainAccess({workspaceId:project.workspace_id,userId:user.id,domain,level:"write",projectId:project.id})) throw new Error("Brak uprawnienia do źródłowego modułu.");
      const status=body.action==="approve_link"?"approved":"rejected";
      const {error}=await db.from("entity_links").update({status,approved_by:status==="approved"?user.id:null,approved_at:status==="approved"?new Date().toISOString():null}).eq("id",link.id);
      if(error) throw error;
      return NextResponse.json({ok:true,id:link.id,status});
    }

    const [boqResult,allocResult,stockEventsResult]=await Promise.all([
      db.from("boq_items").select("id,item_number,description,unit,cost_code").eq("workspace_id",project.workspace_id).eq("project_id",project.id).limit(2000),
      db.from("financial_allocations").select("source_id").eq("workspace_id",project.workspace_id).eq("project_id",project.id).eq("source_type","invoice").eq("status","approved").limit(1000),
      db.from("material_chain_events").select("stock_item_id").eq("workspace_id",project.workspace_id).eq("project_id",project.id).not("stock_item_id","is",null).limit(1000)
    ]);
    const boq=boqResult.data??[];
    const candidates=boq.map((row)=>({id:String(row.id),label:`${row.item_number??""} ${row.description??""}`,context:`${row.unit??""} ${row.cost_code??""}`}));
    const invoiceIds=[...new Set((allocResult.data??[]).map((row)=>String(row.source_id)))];
    const stockIds=[...new Set((stockEventsResult.data??[]).map((row)=>String(row.stock_item_id)))];
    const [linesResult,itemsResult]=await Promise.all([
      invoiceIds.length?db.from("invoice_lines").select("id,description,quantity,unit,unit_price").eq("workspace_id",project.workspace_id).in("invoice_id",invoiceIds).limit(2000):Promise.resolve({data:[],error:null}),
      stockIds.length?db.from("stock_items").select("id,sku,name,item_type,unit").eq("workspace_id",project.workspace_id).in("id",stockIds).limit(1000):Promise.resolve({data:[],error:null})
    ]);
    const proposals:Array<Record<string,unknown>>=[];
    for(const line of linesResult.data??[]){
      const best=rankMatches(`${line.description??""} ${line.quantity??""} ${line.unit??""}`,candidates,1)[0];
      if(best&&best.score>=0.22) proposals.push({workspace_id:project.workspace_id,source_type:"invoice_line",source_id:line.id,target_type:"boq_item",target_id:best.id,relation_type:"semantic_match",confidence:best.score,status:"proposed",created_by:user.id});
    }
    for(const item of itemsResult.data??[]){
      const best=rankMatches(`${item.sku??""} ${item.name??""} ${item.item_type??""} ${item.unit??""}`,candidates,1)[0];
      if(best&&best.score>=0.22) proposals.push({workspace_id:project.workspace_id,source_type:"stock_item",source_id:item.id,target_type:"boq_item",target_id:best.id,relation_type:"semantic_match",confidence:best.score,status:"proposed",created_by:user.id});
    }
    let inserted=0;
    for(const proposal of proposals){
      const {error}=await db.from("entity_links").upsert(proposal,{onConflict:"workspace_id,source_type,source_id,target_type,target_id,relation_type",ignoreDuplicates:true});
      if(!error) inserted+=1;
    }
    await db.from("audit_events").insert({workspace_id:project.workspace_id,project_id:project.id,actor_id:user.id,actor_type:"ai",event_type:"reconciliation.auto_match",entity_type:"project",entity_id:project.id,after_value:{candidates:proposals.length,processed:inserted}});
    return NextResponse.json({ok:true,candidates:proposals.length,processed:inserted});
  } catch(error){ return NextResponse.json({error:error instanceof Error?error.message:"Uzgadnianie nie powiodło się."},{status:422}); }
}
