import "server-only";

import { createServiceSupabaseClient } from "@/lib/supabase/service";

export type BoqKnowledgeItem = {
  id: string;
  item_number: string | null;
  description: string;
  quantity: number | null;
  unit: string | null;
  unit_price: number | null;
  total_price: number | null;
};

export type MaterialKnowledgeItem = {
  id: string;
  name: string;
  installation: string | null;
  specification: string | null;
};

export type DeviceKnowledgeItem = {
  id: string;
  name: string;
  installation: string | null;
  parameters: Record<string, unknown> | null;
};

export async function getBoqKnowledge(projectId: string) {
  const supabase = createServiceSupabaseClient();
  const { data, error } = await supabase
    .from("boq_items")
    .select("id,item_number,description,quantity,unit,unit_price,total_price")
    .eq("project_id", projectId)
    .order("item_number", { ascending: true, nullsFirst: false })
    .limit(120)
    .returns<BoqKnowledgeItem[]>();

  if (error) throw new Error(`Nie udało się pobrać pozycji kosztorysu: ${error.message}`);
  return data ?? [];
}

export async function getMaterialKnowledge(projectId: string) {
  const supabase = createServiceSupabaseClient();
  const [materialsResult, devicesResult] = await Promise.all([
    supabase
      .from("materials")
      .select("id,name,installation,specification")
      .eq("project_id", projectId)
      .order("updated_at", { ascending: false })
      .limit(100)
      .returns<MaterialKnowledgeItem[]>(),
    supabase
      .from("devices")
      .select("id,name,installation,parameters")
      .eq("project_id", projectId)
      .order("updated_at", { ascending: false })
      .limit(100)
      .returns<DeviceKnowledgeItem[]>()
  ]);

  const error = materialsResult.error ?? devicesResult.error;
  if (error) throw new Error(`Nie udało się pobrać materiałów i urządzeń Brain: ${error.message}`);

  return {
    materials: materialsResult.data ?? [],
    devices: devicesResult.data ?? []
  };
}
