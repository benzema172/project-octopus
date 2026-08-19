import { NextResponse } from "next/server";
import { getRequestUser } from "@/lib/auth";
import { hasDomainAccess } from "@/lib/authorization";
import { getWorkspaceForUser } from "@/lib/data/workspace";
import { parseLocalizedNumber } from "@/lib/numbers/parse-localized-number";
import { createServiceSupabaseClient } from "@/lib/supabase/service";

export const runtime = "nodejs";

type Body={workspaceId?:string;entity?:string;payload?:Record<string,unknown>};
const clean=(value:unknown)=>typeof value==="string"?value.trim():"";
const nullable=(value:unknown)=>clean(value)||null;
const date=(value:unknown)=>/^\d{4}-\d{2}-\d{2}$/.test(clean(value))?clean(value):null;

async function ownedId(table:string,id:unknown,workspaceId:string,label:string){const value=clean(id);if(!value)throw new Error(`Uzupełnij pole: ${label}.`);const{data,error}=await createServiceSupabaseClient().from(table).select("id").eq("workspace_id",workspaceId).eq("id",value).maybeSingle<{id:string}>();if(error||!data)throw new Error(`${label} nie należy do aktywnej firmy.`);return value;}

async function loadBusinessDocument(workspaceId:string,documentIdValue:unknown){
 const documentId=await ownedId("documents",documentIdValue,workspaceId,"Dokument źródłowy");
 const{data,error}=await createServiceSupabaseClient().from("document_extractions").select("payload,status").eq("workspace_id",workspaceId).eq("document_id",documentId).eq("extraction_type","document_context").neq("status","rejected").order("created_at",{ascending:false}).limit(1).maybeSingle<{payload:Record<string,unknown>;status:string}>();
 if(error||!data)throw new Error("Dokument nie ma gotowego odczytu AI.");const business=data.payload?.businessDocument;if(!business||typeof business!=="object")throw new Error("AI nie odczytało danych handlowych dokumentu.");return{documentId,business:business as Record<string,unknown>};
}

export async function POST(request:Request){
 const user=await getRequestUser(request);if(!user)return NextResponse.json({error:"Brak aktywnej sesji."},{status:401});
 let body:Body;try{body=await request.json() as Body;}catch{return NextResponse.json({error:"Nieprawidłowe dane formularza."},{status:400});}
 if(!body.workspaceId||!body.entity||!body.payload)return NextResponse.json({error:"Brakuje firmy, operacji lub danych."},{status:400});
 if(!["ai_warehouse_import","reservation","stock_movement_destination","stock_movement_approve"].includes(body.entity))return NextResponse.json({error:"Ta operacja nie jest obsługiwana przez atomowy moduł magazynu."},{status:400});
 const workspace=await getWorkspaceForUser(user,body.workspaceId);if(!workspace)return NextResponse.json({error:"Brak dostępu do firmy."},{status:403});
 const p=body.payload;const projectId=nullable(p.projectId);
 const level=body.entity==="stock_movement_approve"?"approve":"write";
 if(!await hasDomainAccess({workspaceId:workspace.id,userId:user.id,domain:"warehouse",level,projectId}))return NextResponse.json({error:"Brak uprawnienia do tej operacji Magazynu."},{status:403});
 const db=createServiceSupabaseClient();
 try{
   if(body.entity==="stock_movement_destination"){
     const movementId=await ownedId("stock_movements",p.movementId,workspace.id,"Ruch magazynowy");
     const destinationMode=clean(p.destinationMode);
     const targetProject=destinationMode==="direct_project"?await ownedId("projects",p.projectId,workspace.id,"Inwestycja"):null;
     const{data,error}=await db.rpc("set_stock_movement_destination_atomic",{p_workspace_id:workspace.id,p_movement_id:movementId,p_destination_mode:destinationMode,p_project_id:targetProject,p_actor_id:user.id});
     if(error)throw new Error(error.message);return NextResponse.json({ok:true,id:String(data),destinationMode});
   }
   if(body.entity==="stock_movement_approve"){
     const movementId=await ownedId("stock_movements",p.movementId,workspace.id,"Ruch magazynowy");
     const{data,error}=await db.rpc("approve_stock_movement_atomic",{p_workspace_id:workspace.id,p_movement_id:movementId,p_actor_id:user.id});
     if(error)throw new Error(error.message);return NextResponse.json({ok:true,id:String(data)});
   }
   if(body.entity==="reservation"){
     const verifiedProject=await ownedId("projects",p.projectId,workspace.id,"Inwestycja");const warehouseId=await ownedId("warehouses",p.warehouseId,workspace.id,"Magazyn");const stockItemId=await ownedId("stock_items",p.stockItemId,workspace.id,"Kartoteka");
     const{data,error}=await db.rpc("create_reservation_atomic",{p_workspace_id:workspace.id,p_project_id:verifiedProject,p_warehouse_id:warehouseId,p_stock_item_id:stockItemId,p_quantity:parseLocalizedNumber(p.quantity),p_required_at:date(p.requiredAt),p_actor_id:user.id}).single<{result_id:string}>();
     if(error||!data)throw new Error(error?.message??"Nie udało się atomowo utworzyć rezerwacji.");return NextResponse.json({ok:true,id:data.result_id});
   }
   const source=await loadBusinessDocument(workspace.id,p.documentId);const verifiedProject=projectId?await ownedId("projects",projectId,workspace.id,"Inwestycja"):null;const warehouseId=p.warehouseId?await ownedId("warehouses",p.warehouseId,workspace.id,"Magazyn"):null;
   const lines=Array.isArray(source.business.lines)?source.business.lines.filter(line=>line&&typeof line==="object"):[];if(!lines.length)throw new Error("AI nie odczytało pozycji materiałowych. Sprawdź dokument lub dodaj ruch ręcznie.");
   const{data,error}=await db.rpc("import_ai_warehouse_document_atomic",{p_workspace_id:workspace.id,p_project_id:verifiedProject,p_warehouse_id:warehouseId,p_source_document_id:source.documentId,p_document_number:nullable(source.business.documentNumber),p_movement_date:date(source.business.issueDate),p_lines:lines,p_actor_id:user.id});
   if(error||!data)throw new Error(error?.message??"Nie udało się atomowo zaczytać dokumentu magazynowego.");return NextResponse.json({ok:true,id:String(data)});
 }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Nie udało się zapisać rekordu magazynowego."},{status:422});}
}