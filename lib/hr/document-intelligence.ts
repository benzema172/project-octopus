import "server-only";

import { countPolishWorkingDays } from "@/lib/hr/polish-work-calendar";
import { createServiceSupabaseClient } from "@/lib/supabase/service";

type Row = Record<string, unknown>;

type EmployeeRow = {
  id: string;
  employee_number: string | null;
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;
};

type ExtractionRow = {
  payload: Record<string, unknown> | null;
  confidence: number | null;
};

export type HrDocumentIntakeResult = {
  attempted: true;
  matched: boolean;
  employeeId?: string;
  employeeName?: string;
  confidence?: number;
  documentType?: string;
  employeeDocumentId?: string;
  reason?: string;
  leaveRequest?: {
    detected: boolean;
    created: boolean;
    id?: string;
    leaveType?: string;
    dateFrom?: string;
    dateTo?: string;
    days?: number;
    reason?: string;
  };
};

function normalize(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[łŁ]/g, "l")
    .toLowerCase()
    .replace(/[^a-z0-9@.+-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function compactDigits(value: unknown) {
  return String(value ?? "").replace(/\D+/g, "");
}

function employeeName(employee: EmployeeRow) {
  return `${employee.first_name} ${employee.last_name}`.trim();
}

function factRows(payload: Record<string, unknown>) {
  return Array.isArray(payload.facts)
    ? payload.facts.filter((item): item is Row => Boolean(item) && typeof item === "object" && !Array.isArray(item))
    : [];
}

function parseDate(value: unknown): string | null {
  const raw = String(value ?? "").trim();
  const iso = raw.match(/\b(20\d{2})[-/.](0?[1-9]|1[0-2])[-/.](0?[1-9]|[12]\d|3[01])\b/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
  const pl = raw.match(/\b(0?[1-9]|[12]\d|3[01])[.\-/](0?[1-9]|1[0-2])[.\-/](20\d{2})\b/);
  if (pl) return `${pl[3]}-${pl[2].padStart(2, "0")}-${pl[1].padStart(2, "0")}`;
  return null;
}

function findFactDate(payload: Record<string, unknown>, kind: "from" | "to") {
  const keys = kind === "from"
    ? ["leave_from", "leave date from", "date_from", "data od", "urlop od", "okres od", "od dnia"]
    : ["leave_to", "leave date to", "date_to", "data do", "urlop do", "okres do", "do dnia"];
  for (const fact of factRows(payload)) {
    const descriptor = normalize(`${fact.type ?? ""} ${fact.label ?? ""}`);
    if (!keys.some((key) => descriptor.includes(normalize(key)))) continue;
    const parsed = parseDate(fact.value);
    if (parsed) return parsed;
  }
  return null;
}

function extractLeaveDates(payload: Record<string, unknown>, rawContent: string) {
  let dateFrom = findFactDate(payload, "from");
  let dateTo = findFactDate(payload, "to");
  if (dateFrom && dateTo) return { dateFrom, dateTo, confidence: 0.98 };

  const pair = rawContent.match(/(?:od|from)\s*(\d{1,2}[.\-/]\d{1,2}[.\-/]20\d{2}|20\d{2}[-/.]\d{1,2}[-/.]\d{1,2})[^\d]{0,24}(?:do|to|[-–—])\s*(\d{1,2}[.\-/]\d{1,2}[.\-/]20\d{2}|20\d{2}[-/.]\d{1,2}[-/.]\d{1,2})/i);
  if (pair) {
    dateFrom = parseDate(pair[1]);
    dateTo = parseDate(pair[2]);
    if (dateFrom && dateTo) return { dateFrom, dateTo, confidence: 0.94 };
  }

  const dates = Array.from(rawContent.matchAll(/\b(?:20\d{2}[-/.](?:0?[1-9]|1[0-2])[-/.](?:0?[1-9]|[12]\d|3[01])|(?:0?[1-9]|[12]\d|3[01])[.\-/](?:0?[1-9]|1[0-2])[.\-/]20\d{2})\b/g))
    .map((match) => parseDate(match[0]))
    .filter((value): value is string => Boolean(value));
  const unique = [...new Set(dates)].sort();
  if (unique.length === 2) return { dateFrom: unique[0], dateTo: unique[1], confidence: 0.72 };
  return { dateFrom: null, dateTo: null, confidence: 0 };
}

function classifyLeaveType(content: string) {
  if (content.includes("na zadanie") || content.includes("na żądanie")) return "on_demand";
  if (content.includes("okolicznosci")) return "circumstantial";
  if (content.includes("rehabilit")) return "rehabilitation";
  if (content.includes("opiekun") || content.includes("opieku")) return "care";
  if (content.includes("szkoleni")) return "training";
  if (content.includes("bezplat")) return "unpaid";
  return "annual";
}

function classifyDocument(payload: Record<string, unknown>, content: string) {
  const subcategory = normalize(payload.subcategory);
  const leave = subcategory.includes("leave") || subcategory.includes("urlop") || content.includes("wniosek o urlop") || content.includes("wniosek urlopowy");
  if (leave) return { type: "Wniosek urlopowy", leave: true };
  if (content.includes("aneks") && (content.includes("umow") || content.includes("zatrudn"))) return { type: "Aneks do umowy", leave: false };
  if (content.includes("umow") || content.includes("employment contract") || content.includes("zatrudnien")) return { type: "Umowa o pracę / zatrudnienie", leave: false };
  if (content.includes("badani") || content.includes("lekarsk") || content.includes("medycz")) return { type: "Badanie medyczne", leave: false };
  if (content.includes("bhp") || content.includes("bezpieczenstwo i higiena pracy")) return { type: "BHP", leave: false };
  if (content.includes("sep")) return { type: "SEP", leave: false };
  if (content.includes("f gaz") || content.includes("fgaz") || content.includes("f-gaz")) return { type: "F-Gazy", leave: false };
  if (content.includes("udt")) return { type: "UDT", leave: false };
  if (content.includes("uprawnieni") || content.includes("kwalifikac") || content.includes("certyfikat") || content.includes("swiadectw")) return { type: "Uprawnienie / certyfikat", leave: false };
  if (content.includes("szkoleni")) return { type: "Szkolenie pracownika", leave: false };
  return { type: "Inny dokument HR", leave: false };
}

function scoreEmployee(employee: EmployeeRow, normalizedContent: string, rawDigits: string) {
  const fullName = normalize(employeeName(employee));
  const reverseName = normalize(`${employee.last_name} ${employee.first_name}`);
  const firstName = normalize(employee.first_name);
  const lastName = normalize(employee.last_name);
  const employeeNumber = normalize(employee.employee_number);
  const email = normalize(employee.email);
  const phone = compactDigits(employee.phone);

  let score = 0;
  let reason = "";
  if (employeeNumber && normalizedContent.includes(employeeNumber)) { score = 1; reason = "numer pracownika"; }
  if (fullName && normalizedContent.includes(fullName) && score < 0.99) { score = 0.99; reason = "pełne imię i nazwisko"; }
  if (reverseName && normalizedContent.includes(reverseName) && score < 0.97) { score = 0.97; reason = "nazwisko i imię"; }
  if (email && normalizedContent.includes(email) && score < 0.98) { score = 0.98; reason = "adres e-mail"; }
  if (phone.length >= 7 && rawDigits.includes(phone) && score < 0.96) { score = 0.96; reason = "numer telefonu"; }
  if (firstName.length >= 3 && lastName.length >= 3 && normalizedContent.includes(firstName) && normalizedContent.includes(lastName) && score < 0.93) { score = 0.93; reason = "imię i nazwisko rozdzielone w treści"; }
  if (lastName.length >= 3 && normalizedContent.includes(lastName) && score < 0.78) { score = 0.78; reason = "unikalne nazwisko"; }
  return { employee, score, reason };
}

async function audit(input: { workspaceId: string; actorId?: string | null; eventType: string; entityType: string; entityId: string; value: unknown }) {
  const db = createServiceSupabaseClient();
  const { error } = await db.from("audit_events").insert({
    workspace_id: input.workspaceId,
    actor_id: input.actorId ?? null,
    actor_type: input.actorId ? "user" : "system",
    event_type: input.eventType,
    entity_type: input.entityType,
    entity_id: input.entityId,
    after_value: input.value
  });
  if (error) console.error("[hr-document-intelligence] audit failed", error.message);
}

export async function processHrDocumentIntake(input: {
  workspaceId: string;
  documentId: string;
  actorId?: string | null;
}): Promise<HrDocumentIntakeResult> {
  const db = createServiceSupabaseClient();
  const [{ data: document, error: documentError }, { data: extraction, error: extractionError }, { data: employees, error: employeesError }] = await Promise.all([
    db.from("documents").select("id,name,category").eq("workspace_id", input.workspaceId).eq("id", input.documentId).maybeSingle<{ id: string; name: string; category: string | null }>(),
    db.from("document_extractions").select("payload,confidence").eq("workspace_id", input.workspaceId).eq("document_id", input.documentId).eq("extraction_type", "document_context").order("created_at", { ascending: false }).limit(1).maybeSingle<ExtractionRow>(),
    db.from("employees").select("id,employee_number,first_name,last_name,email,phone").eq("workspace_id", input.workspaceId).eq("status", "active").returns<EmployeeRow[]>()
  ]);

  if (documentError || !document) return { attempted: true, matched: false, reason: "Nie znaleziono dokumentu w aktywnej firmie." };
  if (extractionError || !extraction?.payload) return { attempted: true, matched: false, reason: "OCR/Brain nie przygotował jeszcze danych dokumentu." };
  if (employeesError || !employees?.length) return { attempted: true, matched: false, reason: "Brak aktywnych pracowników do dopasowania." };

  const payload = extraction.payload;
  const rawContent = `${document.name} ${JSON.stringify(payload)}`;
  const normalizedContent = normalize(rawContent);
  const rawDigits = compactDigits(rawContent);
  const ranked = employees.map((employee) => scoreEmployee(employee, normalizedContent, rawDigits)).sort((a, b) => b.score - a.score);
  const top = ranked[0];
  const second = ranked[1];
  if (!top || top.score < 0.78) return { attempted: true, matched: false, reason: "Nie znaleziono danych pozwalających przypisać dokument do pracownika." };
  if (second && second.score >= top.score - 0.04) return { attempted: true, matched: false, reason: "Dokument pasuje do więcej niż jednego pracownika — wymaga wskazania osoby." };

  const classified = classifyDocument(payload, normalizedContent);
  const confidence = Math.max(top.score, Math.min(1, Number(extraction.confidence ?? 0)));
  const explanation = `Automatycznie dopasowano dokument do ${employeeName(top.employee)} na podstawie: ${top.reason}. Rozpoznany typ: ${classified.type}.`;

  const { data: existingLink } = await db.from("employee_documents")
    .select("id")
    .eq("workspace_id", input.workspaceId)
    .eq("employee_id", top.employee.id)
    .eq("document_id", input.documentId)
    .maybeSingle<{ id: string }>();

  let employeeDocumentId = existingLink?.id;
  if (!employeeDocumentId) {
    const { data: link, error: linkError } = await db.from("employee_documents").insert({
      workspace_id: input.workspaceId,
      employee_id: top.employee.id,
      document_id: input.documentId,
      document_type: classified.type,
      source: "ai_suggestion",
      ai_confidence: confidence,
      ai_explanation: explanation,
      created_by: input.actorId ?? null
    }).select("id").single<{ id: string }>();
    if (linkError || !link) throw linkError ?? new Error("Nie udało się automatycznie powiązać dokumentu z pracownikiem.");
    employeeDocumentId = link.id;
    await audit({ workspaceId: input.workspaceId, actorId: input.actorId, eventType: "hr.employee_document_auto_assigned", entityType: "employee_document", entityId: link.id, value: { employeeId: top.employee.id, documentId: input.documentId, documentType: classified.type, confidence, reason: top.reason } });
  }

  const result: HrDocumentIntakeResult = {
    attempted: true,
    matched: true,
    employeeId: top.employee.id,
    employeeName: employeeName(top.employee),
    confidence,
    documentType: classified.type,
    employeeDocumentId
  };

  if (!classified.leave) return result;

  const dates = extractLeaveDates(payload, rawContent);
  const leaveType = classifyLeaveType(normalizedContent);
  if (!dates.dateFrom || !dates.dateTo) {
    result.leaveRequest = { detected: true, created: false, leaveType, reason: "Rozpoznano wniosek urlopowy, ale nie udało się jednoznacznie odczytać obu dat." };
    return result;
  }
  if (dates.dateTo < dates.dateFrom) {
    result.leaveRequest = { detected: true, created: false, leaveType, dateFrom: dates.dateFrom, dateTo: dates.dateTo, reason: "Daty urlopu wymagają weryfikacji." };
    return result;
  }
  if (top.score < 0.9 || dates.confidence < 0.9) {
    result.leaveRequest = { detected: true, created: false, leaveType, dateFrom: dates.dateFrom, dateTo: dates.dateTo, reason: "Wniosek przypisano do pracownika, ale daty lub osoba wymagają potwierdzenia przed utworzeniem wpisu urlopowego." };
    return result;
  }

  const days = countPolishWorkingDays(dates.dateFrom, dates.dateTo);
  if (days <= 0) {
    result.leaveRequest = { detected: true, created: false, leaveType, dateFrom: dates.dateFrom, dateTo: dates.dateTo, reason: "W rozpoznanym zakresie nie ma dni roboczych." };
    return result;
  }

  const { data: existingLeave } = await db.from("leave_requests")
    .select("id")
    .eq("workspace_id", input.workspaceId)
    .eq("employee_id", top.employee.id)
    .eq("leave_type", leaveType)
    .eq("date_from", dates.dateFrom)
    .eq("date_to", dates.dateTo)
    .limit(1)
    .maybeSingle<{ id: string }>();

  if (existingLeave) {
    result.leaveRequest = { detected: true, created: false, id: existingLeave.id, leaveType, dateFrom: dates.dateFrom, dateTo: dates.dateTo, days, reason: "Taki wniosek urlopowy już istnieje." };
    return result;
  }

  const { data: leave, error: leaveError } = await db.from("leave_requests").insert({
    workspace_id: input.workspaceId,
    employee_id: top.employee.id,
    leave_type: leaveType,
    date_from: dates.dateFrom,
    date_to: dates.dateTo,
    days,
    status: "pending"
  }).select("id").single<{ id: string }>();
  if (leaveError || !leave) throw leaveError ?? new Error("Nie udało się utworzyć wniosku urlopowego z OCR.");

  result.leaveRequest = { detected: true, created: true, id: leave.id, leaveType, dateFrom: dates.dateFrom, dateTo: dates.dateTo, days };
  await audit({ workspaceId: input.workspaceId, actorId: input.actorId, eventType: "hr.leave_created_from_document", entityType: "leave_request", entityId: leave.id, value: { employeeId: top.employee.id, documentId: input.documentId, leaveType, dateFrom: dates.dateFrom, dateTo: dates.dateTo, days, confidence } });
  return result;
}
