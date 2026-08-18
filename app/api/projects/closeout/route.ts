import { NextResponse } from "next/server";
import { getRequestUser } from "@/lib/auth";
import { hasDomainAccess } from "@/lib/authorization";
import { getProjectForUser } from "@/lib/data/projects";
import { createServiceSupabaseClient } from "@/lib/supabase/service";

export const runtime = "nodejs";

type Body = { projectId?: string; action?: "set_requirement" | "generate" | "approve"; requirementId?: string; complete?: boolean; documentId?: string | null; outputId?: string };

function ascii(value: unknown) {
  return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[łŁ]/g, "l").replace(/[^\x20-\x7E]/g, " ");
}
function pdfEscape(value: string) { return value.replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)"); }
function makePdf(snapshot: Record<string, unknown>, title: string) {
  const project = snapshot.project && typeof snapshot.project === "object" ? snapshot.project as Record<string, unknown> : {};
  const requirements = Array.isArray(snapshot.requirements) ? snapshot.requirements as Array<Record<string, unknown>> : [];
  const lines = [
    title,
    `Inwestycja: ${ascii(project.name)}`,
    `Inwestor: ${ascii(project.investor)}`,
    `Lokalizacja: ${ascii(project.location)}`,
    `Kompletnosc: ${ascii(snapshot.completenessPercent)}% (${ascii(snapshot.complete)}/${ascii(snapshot.required)})`,
    "",
    "CHECKLISTA ZAMKNIECIA:"
  ];
  for (const item of requirements.slice(0, 28)) lines.push(`[${item.status === "complete" ? "OK" : "BRAK"}] ${ascii(item.category)} - ${ascii(item.title)}`);
  if (requirements.length > 28) lines.push(`... oraz ${requirements.length - 28} kolejnych pozycji w manifeście JSON.`);
  const streamLines = lines.map((line, index) => `${index === 0 ? "72 770 Td" : `0 -${index === 1 ? 28 : 18} Td`} (${pdfEscape(line)}) Tj`).join("\n");
  const stream = `BT /F1 11 Tf\n${streamLines}\nET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"
  ];
  let pdf = "%PDF-1.4\n"; const offsets=[0];
  objects.forEach((object,index)=>{offsets.push(Buffer.byteLength(pdf));pdf+=`${index+1} 0 obj\n${object}\nendobj\n`;});
  const xref=Buffer.byteLength(pdf);pdf+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`;
  for(let i=1;i<=objects.length;i+=1)pdf+=`${String(offsets[i]).padStart(10,"0")} 00000 n \n`;
  pdf+=`trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf,"binary");
}

async function context(request: Request, projectId: string, level: "read" | "write") {
  const user = await getRequestUser(request); if (!user) throw new Error("AUTH");
  const project = await getProjectForUser(user, projectId); if (!project) throw new Error("ACCESS");
  if (!await hasDomainAccess({ workspaceId: project.workspace_id, userId: user.id, domain: "investments", level, projectId: project.id })) throw new Error("ACCESS");
  return { user, project };
}

export async function POST(request: Request) {
  let body: Body; try { body=await request.json() as Body; } catch { return NextResponse.json({error:"Nieprawidłowe dane."},{status:400}); }
  if(!body.projectId||!body.action)return NextResponse.json({error:"Brakuje inwestycji lub operacji."},{status:400});
  try {
    const {user,project}=await context(request,body.projectId,"write"); const db=createServiceSupabaseClient();
    if(body.action==="set_requirement"){
      if(!body.requirementId)throw new Error("Brakuje pozycji closeout.");
      const {data,error}=await db.rpc("set_closeout_requirement_atomic",{p_workspace_id:project.workspace_id,p_project_id:project.id,p_requirement_id:body.requirementId,p_complete:body.complete===true,p_document_id:body.documentId||null,p_actor_id:user.id}).single<{result_id:string;result_status:string}>();
      if(error||!data)throw new Error(error?.message??"Nie zapisano pozycji."); return NextResponse.json({ok:true,id:data.result_id,status:data.result_status});
    }
    if(body.action==="generate"){
      const {data,error}=await db.rpc("generate_closeout_output_atomic",{p_workspace_id:project.workspace_id,p_project_id:project.id,p_actor_id:user.id}).single<{result_id:string;result_version:number;result_status:string}>();
      if(error||!data)throw new Error(error?.message??"Nie wygenerowano paczki."); return NextResponse.json({ok:true,id:data.result_id,version:data.result_version,status:data.result_status});
    }
    if(!body.outputId)throw new Error("Brakuje wyniku do zatwierdzenia.");
    const {data,error}=await db.rpc("approve_project_output_atomic",{p_workspace_id:project.workspace_id,p_project_id:project.id,p_output_id:body.outputId,p_actor_id:user.id}).single<{result_id:string;result_status:string}>();
    if(error||!data)throw new Error(error?.message??"Nie zatwierdzono paczki."); return NextResponse.json({ok:true,id:data.result_id,status:data.result_status});
  } catch(error){const message=error instanceof Error?error.message:String(error);if(message==="AUTH")return NextResponse.json({error:"Brak aktywnej sesji."},{status:401});if(message==="ACCESS")return NextResponse.json({error:"Brak dostępu."},{status:403});return NextResponse.json({error:message},{status:400});}
}

export async function GET(request: Request) {
  const url=new URL(request.url);const projectId=url.searchParams.get("projectId");const outputId=url.searchParams.get("outputId");const format=url.searchParams.get("format")??"pdf";
  if(!projectId||!outputId)return NextResponse.json({error:"Brakuje inwestycji lub wyniku."},{status:400});
  try{
    const {project}=await context(request,projectId,"read");const {data,error}=await createServiceSupabaseClient().from("project_outputs").select("id,title,version_number,status,snapshot").eq("workspace_id",project.workspace_id).eq("project_id",project.id).eq("id",outputId).single();
    if(error||!data)throw new Error(error?.message??"Nie znaleziono wyniku.");
    const safeName=`closeout-${project.id}-v${data.version_number}`;
    if(format==="json")return new Response(JSON.stringify(data.snapshot,null,2),{headers:{"Content-Type":"application/json; charset=utf-8","Content-Disposition":`attachment; filename="${safeName}.json"`}});
    const pdf=makePdf(data.snapshot as Record<string,unknown>,`${data.title} v${data.version_number} [${data.status}]`);
    return new Response(pdf,{headers:{"Content-Type":"application/pdf","Content-Disposition":`attachment; filename="${safeName}.pdf"`,`Cache-Control`:`private, no-store`}});
  }catch(error){const message=error instanceof Error?error.message:String(error);if(message==="AUTH")return NextResponse.json({error:"Brak aktywnej sesji."},{status:401});if(message==="ACCESS")return NextResponse.json({error:"Brak dostępu."},{status:403});return NextResponse.json({error:message},{status:404});}
}
