import { NextResponse } from "next/server";
import { getRequestUser } from "@/lib/auth";
import { hasDomainAccess } from "@/lib/authorization";
import { getWorkspaceForUser } from "@/lib/data/workspace";
import { JsonBodyError, readJsonBody } from "@/lib/http/json-body";
import { parseLocalizedNumber } from "@/lib/numbers/parse-localized-number";
import { createServiceSupabaseClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type AutomaticAssignment = { id:string; plate:string; fuelType:string; date:string|null; origin:"invoice"|"receipt" };
type Input = { workspaceId?: string; reviewId?: string; vehicleId?: string; action?: "assign" | "ignore"; liters?: string | number | null; amount?: string | number | null };
type FuelReview = { id: string; invoice_id: string; invoice_line_id: string; suggested_fuel_type: string | null; suggested_liters: number | null; created_at: string };
type Invoice = { id: string; invoice_number: string | null; issue_date: string | null; sale_date: string | null; currency: string | null; counterparty_id: string | null };
type InvoiceLine = { id: string; description: string; quantity: number | null; unit: string | null; gross_amount: number | null; vehicle_id: string | null };

function uuid(value: string | undefined): value is string {
  return Boolean(value && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value));
}
function decimal(value: unknown) {
  if (value === undefined || value === null || value === "") return null;
  const n = parseLocalizedNumber(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}
async function authorize(request: Request, workspaceId: string, level: "read" | "write") {
  const user = await getRequestUser(request);
  if (!user) return { error: NextResponse.json({ error: "Brak aktywnej sesji." }, { status: 401 }) };
  const workspace = await getWorkspaceForUser(user, workspaceId);
  if (!workspace) return { error: NextResponse.json({ error: "Brak dostępu do firmy." }, { status: 403 }) };
  if (!await hasDomainAccess({ workspaceId: workspace.id, userId: user.id, domain: "fleet", level }))
    return { error: NextResponse.json({ error: "Brak uprawnień do Floty." }, { status: 403 }) };
  return { workspace, user };
}

export async function GET(request: Request) {
  const workspaceId = new URL(request.url).searchParams.get("workspaceId") ?? "";
  if (!uuid(workspaceId)) return NextResponse.json({ error: "Nieprawidłowa firma." }, { status: 400 });
  const access = await authorize(request, workspaceId, "read");
  if (access.error) return access.error;
  const db = createServiceSupabaseClient();
  const [reviewsResult, vehiclesResult, automaticInvoicesResult, automaticReceiptsResult] = await Promise.all([
    db.from("fuel_purchase_reviews")
      .select("id,invoice_id,invoice_line_id,suggested_fuel_type,suggested_liters,created_at")
      .eq("workspace_id",workspaceId).eq("status","pending")
      .order("created_at",{ascending:false}).limit(150),
    db.from("vehicles")
      .select("id,registration_number,make,model,status")
      .eq("workspace_id",workspaceId).neq("status","sold")
      .order("registration_number").limit(1500),
    db.from("fuel_purchase_reviews")
      .select("id,vehicle_id,suggested_fuel_type,resolved_at")
      .eq("workspace_id",workspaceId).eq("status","assigned").eq("assignment_mode","automatic")
      .order("resolved_at",{ascending:false}).limit(6),
    db.from("fuel_entries")
      .select("id,vehicle_id,fuel_type,fueled_at")
      .eq("workspace_id",workspaceId).like("external_transaction_id","octopus_fuel_receipt_20261030:%")
      .order("fueled_at",{ascending:false}).limit(6)
  ]);
  if (reviewsResult.error || vehiclesResult.error || automaticInvoicesResult.error || automaticReceiptsResult.error)
    return NextResponse.json({error:"Nie udało się pobrać kolejki tankowań."},{status:500});
  const vehicles=(vehiclesResult.data??[]) as Array<{id:string;registration_number:string}>;
  const byVehicle=new Map(vehicles.map(vehicle=>[vehicle.id,vehicle.registration_number]));
  const recentAutomatic:AutomaticAssignment[]=[
    ...(automaticInvoicesResult.data??[]).flatMap(row=>row.vehicle_id?[{
      id:row.id,plate:byVehicle.get(row.vehicle_id)??"Pojazd",fuelType:row.suggested_fuel_type??"Paliwo",
      date:row.resolved_at,origin:"invoice" as const
    }]:[]),
    ...(automaticReceiptsResult.data??[]).flatMap(row=>row.vehicle_id?[{
      id:row.id,plate:byVehicle.get(row.vehicle_id)??"Pojazd",fuelType:row.fuel_type??"Paliwo",
      date:row.fueled_at,origin:"receipt" as const
    }]:[])
  ].sort((a,b)=>(b.date??"").localeCompare(a.date??"")).slice(0,8);
  const reviews = (reviewsResult.data ?? []) as FuelReview[];
  const invoiceIds = [...new Set(reviews.map(row => row.invoice_id))];
  const lineIds = reviews.map(row => row.invoice_line_id);
  if (!reviews.length) return NextResponse.json({ items:[], vehicles:vehiclesResult.data ?? [], recentAutomatic }, { headers:{"Cache-Control":"no-store"} });
  const [invoicesResult,linesResult] = await Promise.all([
    db.from("invoices").select("id,invoice_number,issue_date,sale_date,currency,counterparty_id")
      .eq("workspace_id",workspaceId).in("id",invoiceIds),
    db.from("invoice_lines").select("id,description,quantity,unit,gross_amount,vehicle_id")
      .eq("workspace_id",workspaceId).in("id",lineIds)
  ]);
  if (invoicesResult.error || linesResult.error)
    return NextResponse.json({error:"Nie udało się odczytać pozycji faktur paliwowych."},{status:500});
  const invoices = (invoicesResult.data ?? []) as Invoice[];
  const lines = (linesResult.data ?? []) as InvoiceLine[];
  const counterparties = [...new Set(invoices.map(i => i.counterparty_id).filter((id):id is string=>Boolean(id)))];
  const suppliersResult = counterparties.length
    ? await db.from("counterparties").select("id,name").eq("workspace_id",workspaceId).in("id",counterparties)
    : { data:[],error:null };
  if (suppliersResult.error) return NextResponse.json({error:"Nie udało się odczytać dostawców paliwa."},{status:500});
  const invoiceById = new Map(invoices.map(i => [i.id,i]));
  const lineById = new Map(lines.map(i => [i.id,i]));
  const supplierById = new Map((suppliersResult.data ?? []).map(row => [row.id,row.name]));
  const items = reviews.flatMap(review => {
    const invoice = invoiceById.get(review.invoice_id);
    const line = lineById.get(review.invoice_line_id);
    if (!invoice || !line) return [];
    return [{
      id:review.id,invoiceId:invoice.id,invoiceNumber:invoice.invoice_number || "Bez numeru",
      date:invoice.sale_date ?? invoice.issue_date,
      station:invoice.counterparty_id ? supplierById.get(invoice.counterparty_id) ?? "Stacja paliw" : "Stacja paliw",
      currency:invoice.currency ?? "PLN",description:line.description,unit:line.unit,
      quantity:line.quantity,liters:review.suggested_liters,amount:line.gross_amount,
      fuelType:review.suggested_fuel_type ?? "Paliwo",
      suggestedVehicleId:line.vehicle_id
    }];
  });
  return NextResponse.json({ items,vehicles:vehiclesResult.data ?? [],recentAutomatic },{headers:{"Cache-Control":"no-store"}});
}

export async function POST(request: Request) {
  let input: Input;
  try { input=await readJsonBody<Input>(request); }
  catch(error) {
    if(error instanceof JsonBodyError) return NextResponse.json({error:error.message},{status:error.status});
    return NextResponse.json({error:"Nieprawidłowa treść żądania."},{status:400});
  }
  if (!uuid(input.workspaceId) || !uuid(input.reviewId) || !["assign","ignore"].includes(input.action ?? ""))
    return NextResponse.json({error:"Brakuje prawidłowych danych przypisania."},{status:400});
  const access = await authorize(request,input.workspaceId,"write");
  if(access.error) return access.error;
  if(input.action==="assign" && !uuid(input.vehicleId))
    return NextResponse.json({error:"Wybierz pojazd z firmowej Floty."},{status:400});
  const liters=decimal(input.liters);
  const amount=decimal(input.amount);
  if(input.action==="assign" && (!liters || !amount))
    return NextResponse.json({error:"Uzupełnij litry i kwotę brutto z faktury."},{status:400});
  if((liters !== null && liters>20000) || (amount !== null && amount>1000000))
    return NextResponse.json({error:"Wartości tankowania są poza dopuszczalnym zakresem."},{status:400});
  const {data,error}=await createServiceSupabaseClient().rpc("resolve_fuel_purchase_review_20261030",{
    p_workspace_id:access.workspace!.id,
    p_review_id:input.reviewId,
    p_vehicle_id:input.action==="assign"?input.vehicleId:null,
    p_liters:input.action==="assign"?liters:null,
    p_amount:input.action==="assign"?amount:null,
    p_action:input.action,
    p_actor_id:access.user!.id
  });
  if(error) return NextResponse.json({error:error.message},{status:409});
  return NextResponse.json({ok:true,id:data,status:input.action==="assign"?"assigned":"ignored"},{headers:{"Cache-Control":"no-store"}});
}
