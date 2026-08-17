import "server-only";

import { cache } from "react";
import { createServiceSupabaseClient } from "@/lib/supabase/service";
import type { ProjectProfile, ProjectSummary } from "@/lib/types";

const PROFILE_FACT_TYPE = "project_profile";

type ProjectProfileRow = {
  id: string;
  value_json: unknown;
};

export const EMPTY_PROJECT_PROFILE: ProjectProfile = {
  projectName: "",
  status: "active",
  shortName: "",
  projectType: "",
  description: "",
  street: "",
  postalCode: "",
  city: "",
  municipality: "",
  county: "",
  voivodeship: "",
  plotNumbers: "",
  buildingPermit: "",
  contractNumber: "",
  contractDate: "",
  startDate: "",
  completionDate: "",
  warrantyEndDate: "",
  contractValue: "",
  currency: "PLN",
  fundingSource: "",
  contractScope: "",
  investorName: "",
  investorAddress: "",
  investorTaxId: "",
  investorRepresentative: "",
  investorEmail: "",
  investorPhone: "",
  generalContractorName: "",
  generalContractorAddress: "",
  generalContractorTaxId: "",
  generalContractorRepresentative: "",
  designerName: "",
  designerAddress: "",
  contractEngineerName: "",
  supervisionInspectorName: "",
  supervisionInspectorBranch: "",
  supervisionInspectorEmail: "",
  supervisionInspectorPhone: "",
  siteManagerName: "",
  siteManagerEmail: "",
  siteManagerPhone: "",
  sanitaryWorksManagerName: "",
  sanitaryWorksManagerEmail: "",
  sanitaryWorksManagerPhone: "",
  electricalWorksManagerName: "",
  electricalWorksManagerEmail: "",
  electricalWorksManagerPhone: "",
  notes: ""
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeProfile(value: unknown, project: ProjectSummary): ProjectProfile {
  const source = isRecord(value) ? value : {};
  const normalized = { ...EMPTY_PROJECT_PROFILE };

  for (const key of Object.keys(normalized) as Array<keyof ProjectProfile>) {
    if (typeof source[key] === "string") {
      normalized[key] = source[key];
    }
  }

  normalized.description ||= project.description ?? "";
  normalized.projectName ||= project.name;
  normalized.status ||= project.status;
  normalized.investorName ||= project.investor_name ?? "";
  normalized.generalContractorName ||= project.general_contractor ?? "";
  normalized.city ||= project.location ?? "";

  return normalized;
}

export const getProjectProfile = cache(async function getProjectProfile(
  project: ProjectSummary
): Promise<ProjectProfile> {
  const supabase = createServiceSupabaseClient();
  const { data, error } = await supabase
    .from("project_facts")
    .select("id, value_json")
    .eq("project_id", project.id)
    .eq("fact_type", PROFILE_FACT_TYPE)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle<ProjectProfileRow>();

  if (error) {
    throw new Error(`Nie udało się odczytać danych inwestycji: ${error.message}`);
  }

  return normalizeProfile(data?.value_json, project);
});

export async function saveProjectProfile(project: ProjectSummary, profile: ProjectProfile, userId?: string) {
  const supabase = createServiceSupabaseClient();
  const { data: existing, error: readError } = await supabase
    .from("project_facts")
    .select("id")
    .eq("project_id", project.id)
    .eq("fact_type", PROFILE_FACT_TYPE)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string }>();

  if (readError) {
    throw new Error(`Nie udało się przygotować zapisu danych inwestycji: ${readError.message}`);
  }

  const profilePayload = {
    fact_type: PROFILE_FACT_TYPE,
    value_text: profile.shortName || project.name,
    value_json: profile,
    confidence: 1,
    status: "approved",
    approved_by: userId ?? null,
    approved_at: new Date().toISOString()
  };

  const profileResult = existing
    ? await supabase.from("project_facts").update(profilePayload).eq("id", existing.id)
    : await supabase.from("project_facts").insert({
        project_id: project.id,
        ...profilePayload
      });

  if (profileResult.error) {
    throw new Error(`Nie udało się zapisać danych inwestycji: ${profileResult.error.message}`);
  }

  const { error: projectError } = await supabase
    .from("projects")
    .update({
      name: profile.projectName,
      description: profile.description || null,
      investor_name: profile.investorName || null,
      general_contractor: profile.generalContractorName || null,
      location: profile.city || null,
      status: profile.status,
      updated_at: new Date().toISOString()
    })
    .eq("id", project.id)
    .eq("workspace_id", project.workspace_id);

  if (projectError) {
    throw new Error(`Profil zapisano, ale nie udało się odświeżyć inwestycji: ${projectError.message}`);
  }
}

export function getProjectProfileCompletion(profile: ProjectProfile) {
  const required: Array<keyof ProjectProfile> = [
    "projectName",
    "description",
    "city",
    "municipality",
    "contractNumber",
    "startDate",
    "completionDate",
    "investorName",
    "investorAddress",
    "generalContractorName",
    "siteManagerName",
    "sanitaryWorksManagerName"
  ];
  const completed = required.filter((key) => profile[key].trim().length > 0).length;

  return Math.round((completed / required.length) * 100);
}
