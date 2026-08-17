import "server-only";

import { cache } from "react";
import { createServiceSupabaseClient } from "@/lib/supabase/service";
import type { ProjectProfile, ProjectSummary } from "@/lib/types";

const PROFILE_FACT_TYPE = "project_profile";

type ProjectProfileRow = { id: string; value_json: unknown };

export const EMPTY_PROJECT_PROFILE: ProjectProfile = {
  projectName: "", status: "active", shortName: "", projectType: "", description: "", street: "", postalCode: "", city: "", municipality: "", county: "", voivodeship: "", plotNumbers: "", buildingPermit: "", contractNumber: "", contractDate: "", startDate: "", completionDate: "", warrantyEndDate: "", contractValue: "", currency: "PLN", fundingSource: "", contractScope: "", investorName: "", investorAddress: "", investorTaxId: "", investorRepresentative: "", investorEmail: "", investorPhone: "", generalContractorName: "", generalContractorAddress: "", generalContractorTaxId: "", generalContractorRepresentative: "", designerName: "", designerAddress: "", contractEngineerName: "", supervisionInspectorName: "", supervisionInspectorBranch: "", supervisionInspectorEmail: "", supervisionInspectorPhone: "", siteManagerName: "", siteManagerEmail: "", siteManagerPhone: "", sanitaryWorksManagerName: "", sanitaryWorksManagerEmail: "", sanitaryWorksManagerPhone: "", electricalWorksManagerName: "", electricalWorksManagerEmail: "", electricalWorksManagerPhone: "", notes: ""
};

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }

function normalizeProfile(value: unknown, project: ProjectSummary): ProjectProfile {
  const source = isRecord(value) ? value : {};
  const normalized = { ...EMPTY_PROJECT_PROFILE };
  for (const key of Object.keys(normalized) as Array<keyof ProjectProfile>) if (typeof source[key] === "string") normalized[key] = source[key];
  normalized.description ||= project.description ?? "";
  normalized.projectName ||= project.name;
  normalized.status ||= project.status;
  normalized.investorName ||= project.investor_name ?? "";
  normalized.generalContractorName ||= project.general_contractor ?? "";
  normalized.city ||= project.location ?? "";
  return normalized;
}

export const getProjectProfile = cache(async function getProjectProfile(project: ProjectSummary): Promise<ProjectProfile> {
  const supabase = createServiceSupabaseClient();
  const { data, error } = await supabase.from("project_facts").select("id, value_json").eq("project_id", project.id).eq("fact_type", PROFILE_FACT_TYPE).order("updated_at", { ascending: false }).limit(1).maybeSingle<ProjectProfileRow>();
  if (error) throw new Error(`Nie udało się odczytać danych inwestycji: ${error.message}`);
  return normalizeProfile(data?.value_json, project);
});

export async function saveProjectProfile(project: ProjectSummary, profile: ProjectProfile) {
  const supabase = createServiceSupabaseClient();
  const { error } = await supabase.rpc("save_project_profile_atomic", {
    p_workspace_id: project.workspace_id,
    p_project_id: project.id,
    p_profile: profile,
    p_actor_id: null
  });
  if (error) throw new Error(`Nie udało się atomowo zapisać danych inwestycji: ${error.message}`);
}

export function getProjectProfileCompletion(profile: ProjectProfile) {
  const required: Array<keyof ProjectProfile> = ["projectName", "description", "city", "municipality", "contractNumber", "startDate", "completionDate", "investorName", "investorAddress", "generalContractorName", "siteManagerName", "sanitaryWorksManagerName"];
  const completed = required.filter((key) => profile[key].trim().length > 0).length;
  return Math.round((completed / required.length) * 100);
}
