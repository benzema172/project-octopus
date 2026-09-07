import { NextResponse } from "next/server";
import { getRequestUser } from "@/lib/auth";
import { hasDomainAccess } from "@/lib/authorization";
import { getWorkspaceForUser } from "@/lib/data/workspace";
import { JsonBodyError, readJsonBody } from "@/lib/http/json-body";
import { parseLocalizedNumber } from "@/lib/numbers/parse-localized-number";
import { createServiceSupabaseClient } from "@/lib/supabase/service";

export const runtime = "nodejs";

type Body = {
  workspaceId?: string;
  name?: string;
  itemType?: string;
  warehouseId?: string;
  serialNumber?: string;
  assetTag?: string;
  purchaseDate?: string;
  purchasePrice?: string | number;
  warrantyUntil?: string;
  condition?: string;
  notes?: string;
};

type EquipmentItem = {
  id: string;
  name: string;
  item_type: string;
  serial_tracking: boolean;
};

const clean = (value: unknown) => typeof value === "string" ? value.trim() : "";
const nullable = (value: unknown) => clean(value) || null;
const validDate = (value: unknown) => /^\d{4}-\d{2}-\d{2}$/.test(clean(value)) ? clean(value) : null;
const normalizedName = (value: unknown) => clean(value).toLocaleLowerCase("pl").replace(/\s+/g, " ");

async function optionalOwnedWarehouse(id: unknown, workspaceId: string) {
  const value = clean(id);
  if (!value) return null;
  const db = createServiceSupabaseClient();
  const { data, error } = await db.from("warehouses").select("id").eq("workspace_id", workspaceId).eq("id", value).maybeSingle<{ id: string }>();
  if (error || !data) throw new Error("Wybrany magazyn nie należy do aktywnej firmy.");
  return value;
}

export async function POST(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: "Brak aktywnej sesji." }, { status: 401 });

  let body: Body;
  try {
    body = await readJsonBody<Body>(request);
  } catch (error) {
    if (error instanceof JsonBodyError) return NextResponse.json({ error: error.message }, { status: error.status });
    throw error;
  }

  if (!body.workspaceId) return NextResponse.json({ error: "Brakuje aktywnej firmy." }, { status: 400 });
  const workspace = await getWorkspaceForUser(user, body.workspaceId);
  if (!workspace) return NextResponse.json({ error: "Brak dostępu do firmy." }, { status: 403 });
  if (!await hasDomainAccess({ workspaceId: workspace.id, userId: user.id, domain: "warehouse", level: "write" })) {
    return NextResponse.json({ error: "Brak uprawnienia do zapisu sprzętu." }, { status: 403 });
  }

  const name = clean(body.name);
  const serialNumber = clean(body.serialNumber);
  const itemType = new Set(["equipment", "device", "tool"]).has(clean(body.itemType)) ? clean(body.itemType) : "equipment";
  if (name.length < 2) return NextResponse.json({ error: "Podaj nazwę sprzętu." }, { status: 422 });
  if (!serialNumber) return NextResponse.json({ error: "Numer seryjny jest wymagany." }, { status: 422 });

  const db = createServiceSupabaseClient();
  try {
    const warehouseId = await optionalOwnedWarehouse(body.warehouseId, workspace.id);
    const { data: catalog, error: catalogError } = await db.from("stock_items")
      .select("id,name,item_type,serial_tracking")
      .eq("workspace_id", workspace.id)
      .eq("active", true)
      .in("item_type", ["equipment", "device", "tool"])
      .limit(5000)
      .returns<EquipmentItem[]>();
    if (catalogError) throw new Error(catalogError.message);

    const key = normalizedName(name);
    let item = (catalog ?? []).find((row) => normalizedName(row.name) === key && row.item_type === itemType)
      ?? (catalog ?? []).find((row) => normalizedName(row.name) === key)
      ?? null;
    let createdCatalog = false;

    if (!item) {
      const { data: created, error: createError } = await db.from("stock_items").insert({
        workspace_id: workspace.id,
        name,
        item_type: itemType,
        unit: "szt.",
        category: "Sprzęt",
        minimum_stock: 0,
        optimal_stock: 0,
        serial_tracking: true,
        active: true
      }).select("id,name,item_type,serial_tracking").single<EquipmentItem>();
      if (createError || !created) throw new Error(createError?.message ?? "Nie udało się utworzyć kartoteki sprzętu.");
      item = created;
      createdCatalog = true;
    } else if (!item.serial_tracking) {
      const { error: trackingError } = await db.from("stock_items")
        .update({ serial_tracking: true, updated_at: new Date().toISOString() })
        .eq("workspace_id", workspace.id)
        .eq("id", item.id);
      if (trackingError) throw new Error(trackingError.message);
    }

    const purchasePrice = body.purchasePrice === undefined || body.purchasePrice === null || body.purchasePrice === ""
      ? null
      : parseLocalizedNumber(body.purchasePrice);
    if (purchasePrice !== null && purchasePrice < 0) throw new Error("Cena zakupu nie może być ujemna.");

    const { data, error } = await db.rpc("create_stock_instance_atomic", {
      p_workspace_id: workspace.id,
      p_stock_item_id: item.id,
      p_warehouse_id: warehouseId,
      p_serial_number: serialNumber,
      p_asset_tag: nullable(body.assetTag),
      p_purchase_date: validDate(body.purchaseDate),
      p_purchase_price: purchasePrice,
      p_warranty_until: validDate(body.warrantyUntil),
      p_condition: nullable(body.condition),
      p_notes: nullable(body.notes),
      p_actor_id: user.id
    });
    if (error) throw new Error(error.message);

    return NextResponse.json({ ok: true, id: String(data), stockItemId: item.id, createdCatalog });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Nie udało się zarejestrować sprzętu." }, { status: 422 });
  }
}
