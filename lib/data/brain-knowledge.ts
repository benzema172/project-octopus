import "server-only";

import { createServiceSupabaseClient } from "@/lib/supabase/service";

type SourceRow = {
  id: string;
  document_id: string | null;
  page_number: number | null;
  section_label: string | null;
  quote: string | null;
};

type FactRow = {
  id: string;
  fact_type: string;
  value_text: string | null;
  confidence: number | null;
  source_reference_id: string | null;
  updated_at: string;
};

type FindingRow = {
  id: string;
  severity: string;
  title: string;
  description: string | null;
  source_reference_id: string | null;
  created_at: string;
};

type MaterialRow = {
  id: string;
  name: string;
  installation: string | null;
  specification: string | null;
  source_reference_id: string | null;
};

type DeviceRow = {
  id: string;
  name: string;
  installation: string | null;
  parameters: Record<string, unknown> | null;
  source_reference_id: string | null;
};

type RunRow = {
  id: string;
  status: string;
  model: string | null;
  output: Record<string, unknown> | null;
  error: string | null;
  created_at: string;
};

export type BrainSource = {
  documentName: string;
  pageNumber: number | null;
  sectionLabel: string | null;
  quote: string | null;
};

export type BrainKnowledge = {
  facts: Array<FactRow & { source: BrainSource | null }>;
  findings: Array<FindingRow & { source: BrainSource | null }>;
  materials: Array<MaterialRow & { source: BrainSource | null }>;
  devices: Array<DeviceRow & { source: BrainSource | null }>;
  runs: RunRow[];
};

export async function getBrainKnowledge(projectId: string): Promise<BrainKnowledge> {
  const supabase = createServiceSupabaseClient();
  const [factsResult, findingsResult, materialsResult, devicesResult, runsResult] = await Promise.all([
    supabase.from("project_facts").select("id,fact_type,value_text,confidence,source_reference_id,updated_at").eq("project_id", projectId).order("updated_at", { ascending: false }).limit(80).returns<FactRow[]>(),
    supabase.from("ai_findings").select("id,severity,title,description,source_reference_id,created_at").eq("project_id", projectId).order("created_at", { ascending: false }).limit(40).returns<FindingRow[]>(),
    supabase.from("materials").select("id,name,installation,specification,source_reference_id").eq("project_id", projectId).order("updated_at", { ascending: false }).limit(60).returns<MaterialRow[]>(),
    supabase.from("devices").select("id,name,installation,parameters,source_reference_id").eq("project_id", projectId).order("updated_at", { ascending: false }).limit(60).returns<DeviceRow[]>(),
    supabase.from("ai_runs").select("id,status,model,output,error,created_at").eq("project_id", projectId).order("created_at", { ascending: false }).limit(20).returns<RunRow[]>()
  ]);

  const firstError = factsResult.error ?? findingsResult.error ?? materialsResult.error ?? devicesResult.error ?? runsResult.error;
  if (firstError) throw new Error(`Nie udało się pobrać wiedzy Brain: ${firstError.message}`);

  const facts = factsResult.data ?? [];
  const findings = findingsResult.data ?? [];
  const materials = materialsResult.data ?? [];
  const devices = devicesResult.data ?? [];
  const sourceIds = Array.from(new Set([
    ...facts.map((item) => item.source_reference_id),
    ...findings.map((item) => item.source_reference_id),
    ...materials.map((item) => item.source_reference_id),
    ...devices.map((item) => item.source_reference_id)
  ].filter((value): value is string => Boolean(value))));

  const sourceMap = new Map<string, BrainSource>();

  if (sourceIds.length) {
    const { data: sources, error: sourceError } = await supabase
      .from("source_references")
      .select("id,document_id,page_number,section_label,quote")
      .in("id", sourceIds)
      .returns<SourceRow[]>();
    if (sourceError) throw new Error(`Nie udało się pobrać źródeł Brain: ${sourceError.message}`);

    const documentIds = Array.from(new Set((sources ?? []).map((item) => item.document_id).filter((value): value is string => Boolean(value))));
    const documentNames = new Map<string, string>();

    if (documentIds.length) {
      const { data: docs } = await supabase.from("documents").select("id,name").in("id", documentIds).returns<Array<{ id: string; name: string }>>();
      for (const doc of docs ?? []) documentNames.set(doc.id, doc.name);
    }

    for (const source of sources ?? []) {
      sourceMap.set(source.id, {
        documentName: source.document_id ? documentNames.get(source.document_id) ?? "Dokument" : "Dokument",
        pageNumber: source.page_number,
        sectionLabel: source.section_label,
        quote: source.quote
      });
    }
  }

  const withSource = <T extends { source_reference_id: string | null }>(items: T[]) => items.map((item) => ({
    ...item,
    source: item.source_reference_id ? sourceMap.get(item.source_reference_id) ?? null : null
  }));

  return {
    facts: withSource(facts),
    findings: withSource(findings),
    materials: withSource(materials),
    devices: withSource(devices),
    runs: runsResult.data ?? []
  };
}
