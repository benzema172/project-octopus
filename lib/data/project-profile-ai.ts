import "server-only";

import { EMPTY_PROJECT_PROFILE } from "@/lib/data/project-profile";
import { createServiceSupabaseClient } from "@/lib/supabase/service";
import type { ProjectProfile, ProjectSummary } from "@/lib/types";

export type ProjectProfileAiFact = {
  type: string;
  label: string;
  value: string;
  unit?: string;
  confidence: number;
  locator?: string;
  quote?: string;
};

type AiSource = {
  value: string;
  confidence: number;
  documentId: string;
  documentVersionId: string;
  label: string;
  locator: string;
  quote: string;
  updatedAt: string;
};

type AiSourcesPayload = { fields?: Partial<Record<keyof ProjectProfile, AiSource>> };

type ProjectProfileFactRow = { value_json: unknown };

const PROFILE_FACT_TYPE = "project_profile";
const AI_SOURCES_FACT_TYPE = "project_profile_ai_sources";
const MIN_AI_CONFIDENCE = 0.72;

const FIELD_ALIASES: Partial<Record<keyof ProjectProfile, string[]>> = {
  projectName: ["project_name", "investment_name", "nazwa_inwestycji", "nazwa_projektu", "nazwa_zadania", "pelna_nazwa_inwestycji"],
  projectType: ["project_type", "investment_type", "rodzaj_inwestycji", "typ_inwestycji"],
  description: ["project_description", "investment_description", "opis_inwestycji"],
  street: ["street", "project_street", "ulica", "ulica_i_numer", "adres_realizacji"],
  postalCode: ["postal_code", "kod_pocztowy"],
  city: ["city", "project_city", "miejscowosc", "miejscowosc_inwestycji"],
  municipality: ["municipality", "gmina"],
  county: ["county", "powiat"],
  voivodeship: ["voivodeship", "province", "wojewodztwo"],
  plotNumbers: ["plot_numbers", "plots", "numery_dzialek", "dzialki", "dzialka"],
  buildingPermit: ["building_permit", "permit", "pozwolenie_na_budowe", "pozwolenie", "zgloszenie_budowy"],
  contractNumber: ["contract_number", "agreement_number", "numer_umowy", "nr_umowy", "numer_kontraktu", "nr_kontraktu"],
  contractDate: ["contract_date", "agreement_date", "data_umowy", "data_kontraktu"],
  startDate: ["start_date", "commencement_date", "data_rozpoczecia", "termin_rozpoczecia"],
  completionDate: ["completion_date", "end_date", "data_zakonczenia", "termin_zakonczenia", "termin_realizacji"],
  warrantyEndDate: ["warranty_end_date", "warranty_date", "koniec_gwarancji", "termin_gwarancji"],
  contractValue: ["contract_value", "agreement_value", "wartosc_umowy", "wartosc_kontraktu", "wynagrodzenie_umowne"],
  currency: ["currency", "waluta"],
  fundingSource: ["funding_source", "source_of_funding", "zrodlo_finansowania", "dofinansowanie"],
  contractScope: ["contract_scope", "scope_of_work", "zakres_kontraktowy", "zakres_umowy", "przedmiot_umowy"],
  investorName: ["investor_name", "client_name", "zamawiajacy", "inwestor", "nazwa_inwestora"],
  investorAddress: ["investor_address", "client_address", "adres_inwestora", "adres_zamawiajacego"],
  investorTaxId: ["investor_tax_id", "investor_nip", "client_tax_id", "nip_inwestora", "nip_zamawiajacego"],
  investorRepresentative: ["investor_representative", "client_representative", "przedstawiciel_inwestora", "przedstawiciel_zamawiajacego"],
  investorEmail: ["investor_email", "client_email", "email_inwestora", "email_zamawiajacego"],
  investorPhone: ["investor_phone", "client_phone", "telefon_inwestora", "telefon_zamawiajacego"],
  generalContractorName: ["general_contractor_name", "contractor_name", "generalny_wykonawca", "wykonawca", "nazwa_wykonawcy"],
  generalContractorAddress: ["general_contractor_address", "contractor_address", "adres_wykonawcy"],
  generalContractorTaxId: ["general_contractor_tax_id", "contractor_tax_id", "contractor_nip", "nip_wykonawcy"],
  generalContractorRepresentative: ["general_contractor_representative", "contractor_representative", "przedstawiciel_wykonawcy"],
  designerName: ["designer_name", "design_company", "jednostka_projektowa", "projektant", "biuro_projektowe"],
  designerAddress: ["designer_address", "design_company_address", "adres_projektanta", "adres_jednostki_projektowej"],
  contractEngineerName: ["contract_engineer_name", "contract_engineer", "inzynier_kontraktu", "zarzadzajacy_kontraktem"],
  supervisionInspectorName: ["supervision_inspector_name", "supervision_inspector", "inspektor_nadzoru", "inspektor"],
  supervisionInspectorBranch: ["supervision_inspector_branch", "inspector_branch", "branza_inspektora"],
  supervisionInspectorEmail: ["supervision_inspector_email", "inspector_email", "email_inspektora"],
  supervisionInspectorPhone: ["supervision_inspector_phone", "inspector_phone", "telefon_inspektora"],
  siteManagerName: ["site_manager_name", "site_manager", "kierownik_budowy"],
  siteManagerEmail: ["site_manager_email", "email_kierownika_budowy"],
  siteManagerPhone: ["site_manager_phone", "telefon_kierownika_budowy"],
  sanitaryWorksManagerName: ["sanitary_works_manager_name", "sanitary_manager", "kierownik_robot_sanitarnych", "kierownik_sanitarny"],
  sanitaryWorksManagerEmail: ["sanitary_works_manager_email", "sanitary_manager_email", "email_kierownika_sanitarnego"],
  sanitaryWorksManagerPhone: ["sanitary_works_manager_phone", "sanitary_manager_phone", "telefon_kierownika_sanitarnego"],
  electricalWorksManagerName: ["electrical_works_manager_name", "electrical_manager", "kierownik_robot_elektrycznych", "kierownik_elektryczny"],
  electricalWorksManagerEmail: ["electrical_works_manager_email", "electrical_manager_email", "email_kierownika_elektrycznego"],
  electricalWorksManagerPhone: ["electrical_works_manager_phone", "electrical_manager_phone", "telefon_kierownika_elektrycznego"]
};

const DATE_FIELDS = new Set<keyof ProjectProfile>(["contractDate", "startDate", "completionDate", "warrantyEndDate"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeToken(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function normalizeDate(value: string) {
  const raw = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const match = raw.match(/\b(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4})\b/);
  if (!match) return "";
  const [, day, month, year] = match;
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

function normalizeValue(field: keyof ProjectProfile, value: string) {
  const trimmed = value.trim().replace(/\s+/g, " ");
  if (!trimmed || ["brak", "brak danych", "nie podano", "n/d", "nie dotyczy"].includes(trimmed.toLowerCase())) return "";
  if (DATE_FIELDS.has(field)) return normalizeDate(trimmed);
  if (field === "currency") {
    const currency = trimmed.toUpperCase().match(/\b(PLN|EUR|USD|GBP|CHF|CZK|SEK|NOK|DKK)\b/)?.[1];
    return currency ?? trimmed.slice(0, 8).toUpperCase();
  }
  return trimmed.slice(0, 12000);
}

export function projectProfileFieldFromAiFact(fact: Pick<ProjectProfileAiFact, "type" | "label">): keyof ProjectProfile | null {
  const type = normalizeToken(fact.type || "");
  const label = normalizeToken(fact.label || "");
  for (const [field, aliases] of Object.entries(FIELD_ALIASES) as Array<[keyof ProjectProfile, string[]]>) {
    if (aliases.some((alias) => type === alias || label === alias)) return field;
  }
  return null;
}

function normalizeProfile(value: unknown, project: ProjectSummary): ProjectProfile {
  const source = isRecord(value) ? value : {};
  const profile = { ...EMPTY_PROJECT_PROFILE };
  for (const key of Object.keys(profile) as Array<keyof ProjectProfile>) {
    if (typeof source[key] === "string") profile[key] = source[key];
  }
  profile.projectName ||= project.name;
  profile.description ||= project.description ?? "";
  profile.status ||= project.status;
  profile.city ||= project.location ?? "";
  profile.investorName ||= project.investor_name ?? "";
  profile.generalContractorName ||= project.general_contractor ?? "";
  profile.currency ||= "PLN";
  return profile;
}

function parseAiSources(value: unknown): Partial<Record<keyof ProjectProfile, AiSource>> {
  if (!isRecord(value) || !isRecord(value.fields)) return {};
  return value.fields as Partial<Record<keyof ProjectProfile, AiSource>>;
}

function isProjectSeedValue(field: keyof ProjectProfile, value: string, project: ProjectSummary) {
  const normalized = value.trim();
  if (!normalized) return true;
  if (field === "projectName") return normalized === project.name.trim();
  if (field === "city") return normalized === (project.location ?? "").trim();
  if (field === "investorName") return normalized === (project.investor_name ?? "").trim();
  if (field === "generalContractorName") return normalized === (project.general_contractor ?? "").trim();
  if (field === "currency") return normalized === "PLN";
  return false;
}

export async function syncProjectProfileFromAiFacts(input: {
  project: ProjectSummary;
  facts: ProjectProfileAiFact[];
  documentId: string;
  documentVersionId: string;
  userId?: string | null;
}) {
  const supabase = createServiceSupabaseClient();
  const [{ data: profileRow, error: profileError }, { data: sourceRow, error: sourceError }] = await Promise.all([
    supabase.from("project_facts").select("value_json").eq("project_id", input.project.id).eq("fact_type", PROFILE_FACT_TYPE).order("updated_at", { ascending: false }).limit(1).maybeSingle<ProjectProfileFactRow>(),
    supabase.from("project_facts").select("value_json").eq("project_id", input.project.id).eq("fact_type", AI_SOURCES_FACT_TYPE).order("updated_at", { ascending: false }).limit(1).maybeSingle<ProjectProfileFactRow>()
  ]);
  if (profileError) throw new Error(`Nie udało się odczytać Karty inwestycji przed synchronizacją AI: ${profileError.message}`);
  if (sourceError) throw new Error(`Nie udało się odczytać źródeł pól AI: ${sourceError.message}`);

  const profile = normalizeProfile(profileRow?.value_json, input.project);
  const aiSources = parseAiSources(sourceRow?.value_json);
  const candidates = new Map<keyof ProjectProfile, { value: string; fact: ProjectProfileAiFact }>();

  for (const fact of input.facts) {
    const field = projectProfileFieldFromAiFact(fact);
    if (!field || field === "status" || field === "shortName" || field === "notes") continue;
    if (!Number.isFinite(fact.confidence) || fact.confidence < MIN_AI_CONFIDENCE) continue;
    const value = normalizeValue(field, fact.value);
    if (!value) continue;
    const existing = candidates.get(field);
    if (!existing || fact.confidence > existing.fact.confidence) candidates.set(field, { value, fact });
  }

  const updatedFields: Array<keyof ProjectProfile> = [];
  const protectedFields: Array<keyof ProjectProfile> = [];
  const now = new Date().toISOString();

  for (const [field, candidate] of candidates) {
    const current = profile[field].trim();
    const previousAi = aiSources[field];
    const currentStillAiOwned = Boolean(previousAi && current === previousAi.value.trim());
    const manualOverride = Boolean(previousAi && current !== previousAi.value.trim());
    if (manualOverride) {
      protectedFields.push(field);
      continue;
    }

    const canReplace = !current || isProjectSeedValue(field, current, input.project) || (currentStillAiOwned && candidate.fact.confidence >= (previousAi?.confidence ?? 0));
    if (!canReplace || current === candidate.value) continue;

    profile[field] = candidate.value;
    aiSources[field] = {
      value: candidate.value,
      confidence: candidate.fact.confidence,
      documentId: input.documentId,
      documentVersionId: input.documentVersionId,
      label: candidate.fact.label,
      locator: candidate.fact.locator ?? "",
      quote: candidate.fact.quote ?? "",
      updatedAt: now
    };
    updatedFields.push(field);
  }

  if (updatedFields.length > 0) {
    const { error: saveError } = await supabase.rpc("save_project_profile_atomic", {
      p_workspace_id: input.project.workspace_id,
      p_project_id: input.project.id,
      p_profile: profile,
      p_actor_id: input.userId ?? null
    });
    if (saveError) throw new Error(`Nie udało się zapisać pól Karty inwestycji rozpoznanych przez AI: ${saveError.message}`);

    await supabase.from("project_facts").delete().eq("project_id", input.project.id).eq("fact_type", AI_SOURCES_FACT_TYPE);
    const { error: sourceSaveError } = await supabase.from("project_facts").insert({
      project_id: input.project.id,
      fact_type: AI_SOURCES_FACT_TYPE,
      value_text: `${Object.keys(aiSources).length} pól zasilonych przez AI`,
      value_json: { fields: aiSources } satisfies AiSourcesPayload,
      confidence: 1
    });
    if (sourceSaveError) throw new Error(`Karta została uzupełniona, ale nie udało się zapisać metadanych źródeł AI: ${sourceSaveError.message}`);
  }

  return {
    recognizedFields: Array.from(candidates.keys()),
    updatedFields,
    protectedFields,
    confidenceThreshold: MIN_AI_CONFIDENCE
  };
}
