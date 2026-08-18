import { NextResponse } from "next/server";
import { getRequestUser } from "@/lib/auth";
import { hasDomainAccess, type Domain } from "@/lib/authorization";
import { getWorkspaceForUser } from "@/lib/data/workspace";
import { parseLocalizedNumber } from "@/lib/numbers/parse-localized-number";
import { createServiceSupabaseClient } from "@/lib/supabase/service";

export const runtime = "nodejs";

type Body = {
  workspaceId?: string;
  entity?: string;
  payload?: Record<string, unknown>;
};

const ENTITY_DOMAINS: Record<string, Domain> = {
  counterparty: "finance",
  invoice: "finance",
  payment: "finance",
  commitment: "finance",
  ai_invoice_import: "finance",
  employee: "hr",
  qualification: "hr",
  medical_exam: "hr",
  leave_request: "hr",
  leave_decision: "hr",
  timesheet: "hr",
  timesheet_decision: "hr",
  employee_status: "hr",
  warehouse: "warehouse",
  stock_item: "warehouse",
  stock_movement: "warehouse",
  ai_warehouse_import: "warehouse",
  stock_movement_approve: "warehouse",
  reservation: "warehouse",
  vehicle: "fleet",
  fuel_entry: "fleet",
  trip: "fleet",
  service_order: "fleet",
  service_close: "fleet",
  vehicle_document: "fleet",
  damage_case: "fleet",
  vehicle_status: "fleet",
  report_definition: "reports",
  report_generate: "reports"
};

function text(value: unknown, label: string, required = false) {
  const result = typeof value === "string" ? value.trim() : "";
  if (required && !result) throw new Error(`Uzupełnij pole: ${label}.`);
  return result || null;
}

function amount(value: unknown, label: string, required = false) {
  const result = parseLocalizedNumber(value);
  if (required && result <= 0) throw new Error(`Podaj prawidłową wartość: ${label}.`);
  return result;
}

function date(value: unknown) {
  const result = text(value, "data");
  return result && /^\d{4}-\d{2}-\d{2}$/.test(result) ? result : null;
}

async function requireOwnedId(table: string, id: unknown, workspaceId: string, label: string) {
  const normalized = text(id, label, true)!;
  const { data, error } = await createServiceSupabaseClient()
    .from(table)
    .select("id")
    .eq("id", normalized)
    .eq("workspace_id", workspaceId)
    .maybeSingle<{ id: string }>();
  if (error || !data) throw new Error(`${label} nie należy do aktywnej firmy.`);
  return normalized;
}

async function loadAiBusinessDocument(workspaceId: string, documentIdValue: unknown) {
  const documentId = await requireOwnedId("documents", documentIdValue, workspaceId, "Dokument źródłowy");
  const { data, error } = await createServiceSupabaseClient()
    .from("document_extractions")
    .select("id,project_id,payload,confidence,status")
    .eq("workspace_id", workspaceId)
    .eq("document_id", documentId)
    .eq("extraction_type", "document_context")
    .neq("status", "rejected")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string; project_id: string | null; payload: Record<string, unknown>; confidence: number | null; status: string }>();
  if (error || !data) throw new Error("Dokument nie ma gotowego odczytu AI.");
  const business = data.payload?.businessDocument;
  if (!business || typeof business !== "object") throw new Error("AI nie odczytało danych handlowych dokumentu.");
  return { documentId, extraction: data, business: business as Record<string, unknown> };
}

async function assignSourceDocumentToProject(workspaceId: string, documentId: string, projectId: string | null, actorId: string) {
  if (!projectId) return;
  const { error } = await createServiceSupabaseClient().rpc("assign_document_to_project_atomic", {
    p_workspace_id: workspaceId,
    p_document_id: documentId,
    p_project_id: projectId,
    p_actor_id: actorId
  });
  if (error) throw new Error(`Nie udało się atomowo przypisać dokumentu do inwestycji: ${error.message}`);
}

async function createReportSnapshot(workspaceId: string, userId: string, payload: Record<string, unknown>) {
  const supabase = createServiceSupabaseClient();
  const definitionId = await requireOwnedId("report_definitions", payload.definitionId, workspaceId, "Definicja raportu");
  const { data: definition } = await supabase.from("report_definitions").select("id,name,report_type,project_id,definition").eq("id", definitionId).single();
  const projectId = definition?.project_id ? String(definition.project_id) : null;
  const periodStart = date(payload.periodStart);
  const periodEnd = date(payload.periodEnd);
  if (periodStart && periodEnd && periodStart > periodEnd) throw new Error("Początek okresu raportu nie może być późniejszy niż koniec.");
  const [projects, documents, employees, vehicles, stockItems, invoices, commitments, openAi, allocations, assignments, vehicleAllocations, materialEvents] = await Promise.all([
    supabase.from("projects").select("id,status").eq("workspace_id", workspaceId),
    supabase.from("documents").select("id,project_id,created_at").eq("workspace_id", workspaceId).is("deleted_at", null),
    supabase.from("employees").select("id,status").eq("workspace_id", workspaceId),
    supabase.from("vehicles").select("id,status").eq("workspace_id", workspaceId),
    supabase.from("stock_items").select("id,active").eq("workspace_id", workspaceId),
    supabase.from("invoices").select("id,direction,issue_date,gross_amount,paid_amount,status").eq("workspace_id", workspaceId),
    supabase.from("commitments").select("project_id,amount,expected_date,status").eq("workspace_id", workspaceId).in("status", ["open", "approved"]),
    supabase.from("document_intakes").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId).in("status", ["queued", "review", "error"]),
    supabase.from("financial_allocations").select("source_id,project_id,status").eq("workspace_id", workspaceId).eq("source_type", "invoice").eq("status", "approved"),
    supabase.from("assignments").select("employee_id,project_id,date_from,date_to").eq("workspace_id", workspaceId),
    supabase.from("vehicle_allocations").select("vehicle_id,project_id").eq("workspace_id", workspaceId),
    supabase.from("material_chain_events").select("stock_item_id,project_id,occurred_at").eq("workspace_id", workspaceId)
  ]);
  const inPeriod = (value: unknown) => {
    if (!value) return true;
    const normalized = String(value).slice(0, 10);
    return (!periodStart || normalized >= periodStart) && (!periodEnd || normalized <= periodEnd);
  };
  const overlapsPeriod = (from: unknown, to: unknown) => {
    const start = from ? String(from).slice(0, 10) : null;
    const end = to ? String(to).slice(0, 10) : null;
    return (!periodEnd || !start || start <= periodEnd) && (!periodStart || !end || end >= periodStart);
  };
  const projectInvoiceIds = projectId
    ? new Set((allocations.data ?? []).filter((row) => row.project_id === projectId).map((row) => String(row.source_id)))
    : null;
  const invoiceRows = (invoices.data ?? []).filter((row) => inPeriod(row.issue_date) && (!projectInvoiceIds || projectInvoiceIds.has(String(row.id))));
  const sale = invoiceRows.filter((row) => row.direction === "sale").reduce((sum, row) => sum + Number(row.gross_amount ?? 0), 0);
  const purchase = invoiceRows.filter((row) => row.direction === "purchase").reduce((sum, row) => sum + Number(row.gross_amount ?? 0), 0);
  const paid = invoiceRows.reduce((sum, row) => sum + Number(row.paid_amount ?? 0), 0);
  const committed = (commitments.data ?? [])
    .filter((row) => (!projectId || row.project_id === projectId) && inPeriod(row.expected_date))
    .reduce((sum, row) => sum + Number(row.amount ?? 0), 0);
  const assignedEmployees = projectId ? new Set((assignments.data ?? []).filter((row) => row.project_id === projectId && overlapsPeriod(row.date_from, row.date_to)).map((row) => String(row.employee_id))) : null;
  const assignedVehicles = projectId ? new Set((vehicleAllocations.data ?? []).filter((row) => row.project_id === projectId).map((row) => String(row.vehicle_id))) : null;
  const projectStockItems = projectId ? new Set((materialEvents.data ?? []).filter((row) => row.project_id === projectId && inPeriod(row.occurred_at)).map((row) => row.stock_item_id).filter(Boolean).map(String)) : null;
  const projectRows = (projects.data ?? []).filter((row) => !projectId || row.id === projectId);
  const documentRows = (documents.data ?? []).filter((row) => (!projectId || row.project_id === projectId) && inPeriod(row.created_at));
  const employeeRows = (employees.data ?? []).filter((row) => row.status === "active" && (!assignedEmployees || assignedEmployees.has(String(row.id))));
  const vehicleRows = (vehicles.data ?? []).filter((row) => row.status === "active" && (!assignedVehicles || assignedVehicles.has(String(row.id))));
  const stockRows = (stockItems.data ?? []).filter((row) => row.active && (!projectStockItems || projectStockItems.has(String(row.id))));
  const snapshot = {
    scope: { project_id: projectId, report_type: definition?.report_type ?? "management" },
    period: { start: periodStart, end: periodEnd },
    portfolio: { projects: projectRows.length, documents: documentRows.length },
    resources: { employees: employeeRows.length, vehicles: vehicleRows.length, stock_items: stockRows.length },
    finance: { sales_gross: sale, purchases_gross: purchase, paid, open_commitments: committed, gross_result: sale - purchase },
    ai: { pending_decisions: openAi.count ?? 0 }
  };
  const { data: run, error: runError } = await supabase.from("report_runs").insert({
    workspace_id: workspaceId,
    project_id: projectId,
    report_definition_id: definitionId,
    period_start: periodStart,
    period_end: periodEnd,
    status: "completed",
    started_at: new Date().toISOString(),
    finished_at: new Date().toISOString()
  }).select("id").single<{ id: string }>();
  if (runError || !run) throw new Error(`Nie udało się utworzyć raportu: ${runError?.message ?? "brak danych"}`);
  const { data: result, error } = await supabase.from("report_snapshots").insert({
    workspace_id: workspaceId,
    project_id: projectId,
    report_run_id: run.id,
    kpi_definitions: definition?.definition ?? {},
    data_snapshot: snapshot,
    narrative: {
      title: definition?.name ?? "Raport firmy",
      summary: `Wynik brutto dla wybranego zakresu: ${sale - purchase} PLN. Otwarte zobowiązania: ${committed} PLN.`,
      generated_by: userId
    },
    source_references: ["projects", "documents", "employees", "vehicles", "stock_items", "invoices", "commitments"],
    closed_at: new Date().toISOString()
  }).select("id").single<{ id: string }>();
  if (error || !result) throw new Error(`Nie udało się zamknąć snapshotu: ${error?.message ?? "brak danych"}`);
  return result.id;
}

export async function POST(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: "Brak aktywnej sesji." }, { status: 401 });
  let body: Body;
  try { body = await request.json() as Body; } catch { return NextResponse.json({ error: "Nieprawidłowe dane formularza." }, { status: 400 }); }
  if (!body.workspaceId || !body.entity || !body.payload) return NextResponse.json({ error: "Brakuje firmy, operacji lub danych." }, { status: 400 });
  const workspace = await getWorkspaceForUser(user, body.workspaceId);
  if (!workspace) return NextResponse.json({ error: "Brak dostępu do firmy." }, { status: 403 });
  const domain = ENTITY_DOMAINS[body.entity];
  if (!domain) return NextResponse.json({ error: "Nieobsługiwany rodzaj rekordu." }, { status: 400 });
  const approvalEntities = new Set(["leave_decision", "timesheet_decision", "stock_movement_approve"]);
  const requiredLevel = approvalEntities.has(body.entity) ? "approve" : "write";
  if (!await hasDomainAccess({ workspaceId: workspace.id, userId: user.id, domain, level: requiredLevel, projectId: text(body.payload.projectId, "inwestycja") })) {
    return NextResponse.json({ error: "Brak uprawnienia do zapisu w tym module." }, { status: 403 });
  }

  const supabase = createServiceSupabaseClient();
  const p = body.payload;
  try {
    let id: string | null = null;
    if (body.entity === "counterparty") {
      const { data, error } = await supabase.from("counterparties").insert({ workspace_id: workspace.id, name: text(p.name, "nazwa", true), tax_id: text(p.taxId, "NIP"), role: text(p.role, "rola") ?? "supplier" }).select("id").single<{ id: string }>();
      if (error) throw error; id = data.id;
    } else if (body.entity === "invoice") {
      const counterpartyId = p.counterpartyId ? await requireOwnedId("counterparties", p.counterpartyId, workspace.id, "Kontrahent") : null;
      const projectId = p.projectId ? await requireOwnedId("projects", p.projectId, workspace.id, "Inwestycja") : null;
      const net = amount(p.netAmount, "netto");
      const tax = amount(p.taxAmount, "VAT");
      const gross = amount(p.grossAmount, "brutto", true);
      const { data, error } = await supabase.from("invoices").insert({ workspace_id: workspace.id, counterparty_id: counterpartyId, invoice_number: text(p.invoiceNumber, "numer faktury", true), direction: text(p.direction, "kierunek", true), issue_date: date(p.issueDate), due_date: date(p.dueDate), net_amount: net, tax_amount: tax, gross_amount: gross, status: p.direction === "sale" ? "issued" : "received" }).select("id").single<{ id: string }>();
      if (error) throw error;
      id = data.id;
      const lineDescription = text(p.lineDescription, "opis pozycji");
      if (lineDescription) {
        const quantity = amount(p.lineQuantity, "ilość") || 1;
        const unitPrice = amount(p.lineUnitPrice, "cena jednostkowa") || net || gross;
        const { error: lineError } = await supabase.from("invoice_lines").insert({
          workspace_id: workspace.id,
          invoice_id: id,
          line_number: 1,
          description: lineDescription,
          quantity,
          unit: text(p.lineUnit, "jednostka") ?? "szt.",
          unit_price: unitPrice,
          net_amount: net,
          gross_amount: gross
        });
        if (lineError) { await supabase.from("invoices").delete().eq("id", id); throw lineError; }
      }
      if (projectId) {
        const { error: allocationError } = await supabase.from("financial_allocations").insert({
          workspace_id: workspace.id,
          project_id: projectId,
          source_type: "invoice",
          source_id: id,
          amount: net || gross,
          allocation_percent: 100,
          status: "approved"
        });
        if (allocationError) { await supabase.from("invoices").delete().eq("id", id); throw allocationError; }
      }
    } else if (body.entity === "payment") {
      const invoiceId = await requireOwnedId("invoices", p.invoiceId, workspace.id, "Faktura");
      const paymentAmount = amount(p.amount, "kwota płatności", true);
      const { data: invoice } = await supabase.from("invoices").select("gross_amount").eq("id", invoiceId).single();
      const { data, error } = await supabase.from("payments").insert({ workspace_id: workspace.id, invoice_id: invoiceId, payment_date: date(p.paymentDate) ?? new Date().toISOString().slice(0, 10), amount: paymentAmount, bank_reference: text(p.bankReference, "referencja") }).select("id").single<{ id: string }>();
      if (error) throw error;
      const { data: confirmedPayments, error: paymentSumError } = await supabase.from("payments").select("amount").eq("workspace_id", workspace.id).eq("invoice_id", invoiceId).eq("status", "confirmed");
      if (paymentSumError) throw paymentSumError;
      const paidAmount = (confirmedPayments ?? []).reduce((sum, row) => sum + Number(row.amount ?? 0), 0);
      await supabase.from("invoices").update({ paid_amount: paidAmount, status: paidAmount >= Number(invoice?.gross_amount ?? 0) ? "paid" : "partially_paid" }).eq("id", invoiceId);
      id = data.id;
    } else if (body.entity === "commitment") {
      const projectId = p.projectId ? await requireOwnedId("projects", p.projectId, workspace.id, "Inwestycja") : null;
      const { data, error } = await supabase.from("commitments").insert({ workspace_id: workspace.id, project_id: projectId, source_type: "manual", description: text(p.description, "opis", true), amount: amount(p.amount, "wartość", true), expected_date: date(p.expectedDate), status: "open" }).select("id").single<{ id: string }>();
      if (error) throw error; id = data.id;
    } else if (body.entity === "ai_invoice_import") {
      const source = await loadAiBusinessDocument(workspace.id, p.documentId);
      const { data: existing } = await supabase.from("invoices").select("id").eq("workspace_id", workspace.id).eq("document_id", source.documentId).maybeSingle<{ id: string }>();
      if (existing) throw new Error("Ta faktura została już zaczytana do Finansów.");
      const projectId = p.projectId ? await requireOwnedId("projects", p.projectId, workspace.id, "Inwestycja") : null;
      const invoiceNumber = text(source.business.documentNumber, "numer faktury", true)!;
      const direction = text(source.business.direction, "rodzaj") === "sale" ? "sale" : "purchase";
      const counterpartyName = direction === "sale"
        ? text(source.business.buyerName, "nabywca")
        : text(source.business.supplierName, "dostawca");
      const counterpartyTaxId = direction === "sale"
        ? text(source.business.buyerTaxId, "NIP nabywcy")
        : text(source.business.supplierTaxId, "NIP dostawcy");
      let counterpartyId: string | null = null;
      if (counterpartyTaxId) {
        const { data: counterparty } = await supabase.from("counterparties").select("id").eq("workspace_id", workspace.id).eq("tax_id", counterpartyTaxId).limit(1).maybeSingle<{ id: string }>();
        counterpartyId = counterparty?.id ?? null;
      }
      if (!counterpartyId && counterpartyName) {
        const { data: counterparty } = await supabase.from("counterparties").select("id").eq("workspace_id", workspace.id).ilike("name", counterpartyName).limit(1).maybeSingle<{ id: string }>();
        counterpartyId = counterparty?.id ?? null;
      }
      if (!counterpartyId && counterpartyName) {
        const { data: counterparty, error: counterpartyError } = await supabase.from("counterparties").insert({
          workspace_id: workspace.id,
          name: counterpartyName,
          tax_id: counterpartyTaxId,
          role: direction === "sale" ? "customer" : "supplier"
        }).select("id").single<{ id: string }>();
        if (counterpartyError || !counterparty) throw counterpartyError ?? new Error("Nie utworzono kontrahenta.");
        counterpartyId = counterparty.id;
      }
      const netAmount = amount(source.business.netAmount, "wartość netto");
      const taxAmount = amount(source.business.taxAmount, "VAT");
      const grossAmount = amount(source.business.grossAmount, "wartość brutto", true);
      const { data: invoice, error: invoiceError } = await supabase.from("invoices").insert({
        workspace_id: workspace.id, counterparty_id: counterpartyId, document_id: source.documentId,
        invoice_number: invoiceNumber, direction, issue_date: date(source.business.issueDate), due_date: date(source.business.dueDate),
        currency: text(source.business.currency, "waluta") ?? "PLN", net_amount: netAmount, tax_amount: taxAmount,
        gross_amount: grossAmount, status: direction === "sale" ? "issued" : "received"
      }).select("id").single<{ id: string }>();
      if (invoiceError || !invoice) throw invoiceError ?? new Error("Nie utworzono faktury.");
      const lines = Array.isArray(source.business.lines) ? source.business.lines.filter((line) => line && typeof line === "object") as Array<Record<string, unknown>> : [];
      if (lines.length) {
        const { error: linesError } = await supabase.from("invoice_lines").insert(lines.map((line, index) => ({
          workspace_id: workspace.id, invoice_id: invoice.id, line_number: index + 1,
          description: text(line.description, "opis pozycji") ?? `Pozycja ${index + 1}`,
          quantity: amount(line.quantity, "ilość") || null, unit: text(line.unit, "jednostka"),
          unit_price: amount(line.unitPrice, "cena jednostkowa") || null,
          net_amount: amount(line.netAmount, "netto"), gross_amount: amount(line.grossAmount, "brutto")
        })));
        if (linesError) { await supabase.from("invoices").delete().eq("id", invoice.id); throw linesError; }
      }
      if (projectId) {
        const { error: allocationError } = await supabase.from("financial_allocations").insert({
          workspace_id: workspace.id, project_id: projectId, source_type: "invoice", source_id: invoice.id,
          amount: netAmount || grossAmount, allocation_percent: 100, status: "approved"
        });
        if (allocationError) { await supabase.from("invoices").delete().eq("id", invoice.id); throw allocationError; }
      }
      await assignSourceDocumentToProject(workspace.id, source.documentId, projectId, user.id);
      id = invoice.id;
    } else if (body.entity === "employee") {
      const { data, error } = await supabase.from("employees").insert({ workspace_id: workspace.id, employee_number: text(p.employeeNumber, "numer pracownika"), first_name: text(p.firstName, "imię", true), last_name: text(p.lastName, "nazwisko", true), email: text(p.email, "e-mail"), phone: text(p.phone, "telefon"), hired_at: date(p.hiredAt), status: "active" }).select("id").single<{ id: string }>();
      if (error) throw error;
      id = data.id;
      if (p.position || p.employmentType || p.monthlyCost) {
        const { error: employmentError } = await supabase.from("employments").insert({ workspace_id: workspace.id, employee_id: id, employment_type: text(p.employmentType, "typ zatrudnienia") ?? "employment_contract", position: text(p.position, "stanowisko"), valid_from: date(p.hiredAt) ?? new Date().toISOString().slice(0, 10), monthly_cost: amount(p.monthlyCost, "koszt miesięczny") || null, hourly_cost: amount(p.hourlyCost, "koszt godzinowy") || null });
        if (employmentError) { await supabase.from("employees").delete().eq("id", id); throw employmentError; }
      }
    } else if (body.entity === "qualification") {
      const employeeId = await requireOwnedId("employees", p.employeeId, workspace.id, "Pracownik");
      const { data, error } = await supabase.from("qualifications").insert({ workspace_id: workspace.id, employee_id: employeeId, qualification_type: text(p.qualificationType, "rodzaj uprawnienia", true), number: text(p.number, "numer"), issued_at: date(p.issuedAt), valid_until: date(p.validUntil), status: "valid" }).select("id").single<{ id: string }>();
      if (error) throw error; id = data.id;
    } else if (body.entity === "medical_exam") {
      const employeeId = await requireOwnedId("employees", p.employeeId, workspace.id, "Pracownik");
      const result = text(p.result, "wynik") ?? "fit";
      if (!["fit", "fit_with_restrictions", "unfit"].includes(result)) throw new Error("Nieprawidłowy wynik badania.");
      const { data, error } = await supabase.from("medical_exams").insert({
        workspace_id: workspace.id,
        employee_id: employeeId,
        exam_type: text(p.examType, "rodzaj badania", true),
        examined_at: date(p.examinedAt),
        valid_until: date(p.validUntil),
        status: result === "fit" ? "valid" : result
      }).select("id").single<{ id: string }>();
      if (error) throw error; id = data.id;
    } else if (body.entity === "leave_request") {
      const employeeId = await requireOwnedId("employees", p.employeeId, workspace.id, "Pracownik");
      const from = date(p.dateFrom);
      const to = date(p.dateTo);
      if (!from || !to || from > to) throw new Error("Podaj prawidłowy zakres urlopu.");
      const { data, error } = await supabase.from("leave_requests").insert({ workspace_id: workspace.id, employee_id: employeeId, leave_type: text(p.leaveType, "rodzaj urlopu") ?? "annual", date_from: date(p.dateFrom), date_to: date(p.dateTo), days: amount(p.days, "liczba dni", true), status: "pending" }).select("id").single<{ id: string }>();
      if (error) throw error; id = data.id;
    } else if (body.entity === "leave_decision") {
      const leaveId = await requireOwnedId("leave_requests", p.leaveId, workspace.id, "Wniosek urlopowy");
      const decision = text(p.decision, "decyzja", true);
      if (!decision || !["approved", "rejected"].includes(decision)) throw new Error("Nieprawidłowa decyzja urlopowa.");
      const { error } = await supabase.from("leave_requests").update({ status: decision, approved_by: user.id }).eq("id", leaveId).eq("workspace_id", workspace.id);
      if (error) throw error; id = leaveId;
    } else if (body.entity === "timesheet") {
      const employeeId = await requireOwnedId("employees", p.employeeId, workspace.id, "Pracownik");
      const projectId = p.projectId ? await requireOwnedId("projects", p.projectId, workspace.id, "Inwestycja") : null;
      const { data, error } = await supabase.from("timesheets").insert({ workspace_id: workspace.id, employee_id: employeeId, project_id: projectId, work_date: date(p.workDate) ?? new Date().toISOString().slice(0, 10), hours: amount(p.hours, "liczba godzin", true), overtime_hours: amount(p.overtimeHours, "nadgodziny"), status: "submitted" }).select("id").single<{ id: string }>();
      if (error) throw error; id = data.id;
    } else if (body.entity === "timesheet_decision") {
      const timesheetId = await requireOwnedId("timesheets", p.timesheetId, workspace.id, "Wpis czasu pracy");
      const decision = text(p.decision, "decyzja", true);
      if (!decision || !["approved", "rejected"].includes(decision)) throw new Error("Nieprawidłowa decyzja czasu pracy.");
      const { error } = await supabase.from("timesheets").update({ status: decision, approved_by: user.id }).eq("id", timesheetId).eq("workspace_id", workspace.id);
      if (error) throw error; id = timesheetId;
    } else if (body.entity === "employee_status") {
      const employeeId = await requireOwnedId("employees", p.employeeId, workspace.id, "Pracownik");
      const status = text(p.status, "status", true);
      if (!status || !["active", "inactive", "terminated"].includes(status)) throw new Error("Nieprawidłowy status pracownika.");
      const { error } = await supabase.from("employees").update({ status, terminated_at: status === "terminated" ? date(p.terminatedAt) ?? new Date().toISOString().slice(0, 10) : null }).eq("id", employeeId).eq("workspace_id", workspace.id);
      if (error) throw error; id = employeeId;
    } else if (body.entity === "warehouse") {
      const { data, error } = await supabase.from("warehouses").insert({ workspace_id: workspace.id, name: text(p.name, "nazwa magazynu", true), location: text(p.location, "lokalizacja"), warehouse_type: text(p.warehouseType, "typ") ?? "central" }).select("id").single<{ id: string }>();
      if (error) throw error; id = data.id;
    } else if (body.entity === "stock_item") {
      const { data, error } = await supabase.from("stock_items").insert({ workspace_id: workspace.id, sku: text(p.sku, "SKU"), name: text(p.name, "nazwa kartoteki", true), item_type: text(p.itemType, "typ") ?? "material", unit: text(p.unit, "jednostka", true), minimum_stock: amount(p.minimumStock, "stan minimalny") }).select("id").single<{ id: string }>();
      if (error) throw error; id = data.id;
    } else if (body.entity === "stock_movement") {
      const warehouseId = await requireOwnedId("warehouses", p.warehouseId, workspace.id, "Magazyn");
      const stockItemId = await requireOwnedId("stock_items", p.stockItemId, workspace.id, "Kartoteka");
      const projectId = p.projectId ? await requireOwnedId("projects", p.projectId, workspace.id, "Inwestycja") : null;
      const targetWarehouseId = p.targetWarehouseId ? await requireOwnedId("warehouses", p.targetWarehouseId, workspace.id, "Magazyn docelowy") : null;
      const { data: movement, error } = await supabase.rpc("create_stock_movement_atomic", {
        p_workspace_id: workspace.id,
        p_project_id: projectId,
        p_warehouse_id: warehouseId,
        p_target_warehouse_id: targetWarehouseId,
        p_stock_item_id: stockItemId,
        p_movement_type: text(p.movementType, "typ ruchu", true),
        p_quantity: amount(p.quantity, "ilość", true),
        p_unit_cost: p.unitCost === undefined || p.unitCost === "" ? null : amount(p.unitCost, "koszt jednostkowy"),
        p_document_number: text(p.documentNumber, "numer dokumentu") ?? "",
        p_movement_date: date(p.movementDate) ?? new Date().toISOString().slice(0, 10),
        p_actor_id: user.id
      }).single<{ result_movement_id: string }>();
      if (error || !movement) throw new Error(`Nie udało się atomowo zapisać ruchu magazynowego: ${error?.message ?? "brak danych"}`);
      id = movement.result_movement_id;
    } else if (body.entity === "ai_warehouse_import") {
      const source = await loadAiBusinessDocument(workspace.id, p.documentId);
      const { data: existing } = await supabase.from("stock_movements").select("id").eq("workspace_id", workspace.id).eq("source_document_id", source.documentId).maybeSingle<{ id: string }>();
      if (existing) throw new Error("Ten dokument został już zaczytany do Magazynu.");
      const projectId = p.projectId ? await requireOwnedId("projects", p.projectId, workspace.id, "Inwestycja") : null;
      let warehouseId = p.warehouseId ? await requireOwnedId("warehouses", p.warehouseId, workspace.id, "Magazyn") : null;
      if (!warehouseId) {
        const { data: warehouse } = await supabase.from("warehouses").select("id").eq("workspace_id", workspace.id).eq("active", true).order("created_at").limit(1).maybeSingle<{ id: string }>();
        warehouseId = warehouse?.id ?? null;
      }
      if (!warehouseId) {
        const { data: warehouse, error: warehouseError } = await supabase.from("warehouses").insert({ workspace_id: workspace.id, name: "Magazyn główny", warehouse_type: "central" }).select("id").single<{ id: string }>();
        if (warehouseError || !warehouse) throw warehouseError ?? new Error("Nie utworzono magazynu głównego.");
        warehouseId = warehouse.id;
      }
      const lines = Array.isArray(source.business.lines) ? source.business.lines.filter((line) => line && typeof line === "object") as Array<Record<string, unknown>> : [];
      if (!lines.length) throw new Error("AI nie odczytało pozycji materiałowych. Sprawdź dokument lub dodaj ruch ręcznie.");
      const { data: movement, error: movementError } = await supabase.from("stock_movements").insert({
        workspace_id: workspace.id, project_id: projectId, warehouse_id: warehouseId, movement_type: "PZ",
        document_number: text(source.business.documentNumber, "numer dokumentu"), movement_date: date(source.business.issueDate) ?? new Date().toISOString().slice(0, 10),
        status: "draft", source_document_id: source.documentId
      }).select("id").single<{ id: string }>();
      if (movementError || !movement) throw movementError ?? new Error("Nie utworzono szkicu PZ.");
      const movementLines: Array<Record<string, unknown>> = [];
      for (const line of lines) {
        const sku = text(line.sku, "SKU");
        const description = text(line.description, "opis materiału") ?? "Materiał z dokumentu";
        let itemId: string | null = null;
        if (sku) {
          const { data: item } = await supabase.from("stock_items").select("id").eq("workspace_id", workspace.id).eq("sku", sku).limit(1).maybeSingle<{ id: string }>();
          itemId = item?.id ?? null;
        }
        if (!itemId) {
          const { data: item } = await supabase.from("stock_items").select("id").eq("workspace_id", workspace.id).ilike("name", description).limit(1).maybeSingle<{ id: string }>();
          itemId = item?.id ?? null;
        }
        if (!itemId) {
          const { data: item, error: itemError } = await supabase.from("stock_items").insert({
            workspace_id: workspace.id, sku, name: description, item_type: "material", unit: text(line.unit, "jednostka") ?? "szt."
          }).select("id").single<{ id: string }>();
          if (itemError || !item) { await supabase.from("stock_movements").delete().eq("id", movement.id); throw itemError ?? new Error("Nie utworzono kartoteki materiału."); }
          itemId = item.id;
        }
        movementLines.push({
          workspace_id: workspace.id, movement_id: movement.id, stock_item_id: itemId,
          quantity: amount(line.quantity, "ilość", true), unit_cost: amount(line.unitPrice, "koszt jednostkowy") || null
        });
      }
      const { error: lineError } = await supabase.from("stock_movement_lines").insert(movementLines);
      if (lineError) { await supabase.from("stock_movements").delete().eq("id", movement.id); throw lineError; }
      await assignSourceDocumentToProject(workspace.id, source.documentId, projectId, user.id);
      id = movement.id;
    } else if (body.entity === "stock_movement_approve") {
      const movementId = await requireOwnedId("stock_movements", p.movementId, workspace.id, "Ruch magazynowy");
      const { data: approvedId, error } = await supabase.rpc("approve_stock_movement_atomic", {
        p_workspace_id: workspace.id,
        p_movement_id: movementId,
        p_actor_id: user.id
      });
      if (error) throw new Error(`Nie udało się atomowo zatwierdzić ruchu magazynowego: ${error.message}`);
      id = String(approvedId ?? movementId);
    } else if (body.entity === "reservation") {
      const projectId = await requireOwnedId("projects", p.projectId, workspace.id, "Inwestycja");
      const warehouseId = await requireOwnedId("warehouses", p.warehouseId, workspace.id, "Magazyn");
      const stockItemId = await requireOwnedId("stock_items", p.stockItemId, workspace.id, "Kartoteka");
      const { data, error } = await supabase.from("reservations").insert({
        workspace_id: workspace.id,
        project_id: projectId,
        warehouse_id: warehouseId,
        stock_item_id: stockItemId,
        quantity: amount(p.quantity, "ilość", true),
        required_at: date(p.requiredAt),
        status: "open"
      }).select("id").single<{ id: string }>();
      if (error) throw error; id = data.id;
    } else if (body.entity === "vehicle") {
      const { data, error } = await supabase.from("vehicles").insert({ workspace_id: workspace.id, registration_number: text(p.registrationNumber, "numer rejestracyjny", true)?.toUpperCase(), vin: text(p.vin, "VIN"), vehicle_type: text(p.vehicleType, "typ pojazdu", true), make: text(p.make, "marka"), model: text(p.model, "model"), production_year: amount(p.productionYear, "rok produkcji") || null, ownership_type: text(p.ownershipType, "forma własności"), current_mileage: amount(p.currentMileage, "przebieg") || null, status: "active" }).select("id").single<{ id: string }>();
      if (error) throw error; id = data.id;
    } else if (body.entity === "fuel_entry") {
      const vehicleId = await requireOwnedId("vehicles", p.vehicleId, workspace.id, "Pojazd");
      const projectId = p.projectId ? await requireOwnedId("projects", p.projectId, workspace.id, "Inwestycja") : null;
      const mileage = amount(p.mileage, "przebieg") || null;
      const fueledAt = text(p.fueledAt, "data tankowania") ?? new Date().toISOString();
      const { data, error } = await supabase.from("fuel_entries").insert({ workspace_id: workspace.id, vehicle_id: vehicleId, project_id: projectId, fueled_at: fueledAt, liters: amount(p.liters, "litry", true), gross_amount: amount(p.grossAmount, "koszt", true), mileage }).select("id").single<{ id: string }>();
      if (error) throw error;
      id = data.id;
      if (mileage) {
        const { data: vehicle } = await supabase.from("vehicles").select("current_mileage").eq("id", vehicleId).single<{ current_mileage: number | null }>();
        if (mileage >= Number(vehicle?.current_mileage ?? 0)) {
          await Promise.all([
            supabase.from("vehicles").update({ current_mileage: mileage }).eq("id", vehicleId).eq("workspace_id", workspace.id),
            supabase.from("meter_readings").insert({ workspace_id: workspace.id, vehicle_id: vehicleId, reading_date: fueledAt.slice(0, 10), mileage, source: "fuel_entry" })
          ]);
        }
      }
    } else if (body.entity === "trip") {
      const vehicleId = await requireOwnedId("vehicles", p.vehicleId, workspace.id, "Pojazd");
      const projectId = p.projectId ? await requireOwnedId("projects", p.projectId, workspace.id, "Inwestycja") : null;
      const employeeId = p.employeeId ? await requireOwnedId("employees", p.employeeId, workspace.id, "Kierowca") : null;
      const { data, error } = await supabase.from("trips").insert({
        workspace_id: workspace.id,
        vehicle_id: vehicleId,
        employee_id: employeeId,
        project_id: projectId,
        started_at: text(p.startedAt, "początek przejazdu"),
        finished_at: text(p.finishedAt, "koniec przejazdu"),
        start_location: text(p.startLocation, "miejsce początkowe"),
        end_location: text(p.endLocation, "miejsce docelowe"),
        distance_km: amount(p.distanceKm, "dystans", true),
        purpose: text(p.purpose, "cel przejazdu", true)
      }).select("id").single<{ id: string }>();
      if (error) throw error; id = data.id;
    } else if (body.entity === "service_order") {
      const vehicleId = await requireOwnedId("vehicles", p.vehicleId, workspace.id, "Pojazd");
      const { data, error } = await supabase.from("service_orders").insert({ workspace_id: workspace.id, vehicle_id: vehicleId, service_type: text(p.serviceType, "rodzaj serwisu", true), opened_at: date(p.openedAt) ?? new Date().toISOString().slice(0, 10), next_due_date: date(p.nextDueDate), next_due_mileage: amount(p.nextDueMileage, "następny przebieg") || null, cost: amount(p.cost, "koszt") || null, status: "open" }).select("id").single<{ id: string }>();
      if (error) throw error; id = data.id;
    } else if (body.entity === "service_close") {
      const serviceId = await requireOwnedId("service_orders", p.serviceId, workspace.id, "Zlecenie serwisowe");
      const update: Record<string, unknown> = { status: "closed", closed_at: date(p.closedAt) ?? new Date().toISOString().slice(0, 10) };
      if (p.cost !== undefined && p.cost !== "") update.cost = amount(p.cost, "koszt") || null;
      const { error } = await supabase.from("service_orders").update(update).eq("id", serviceId).eq("workspace_id", workspace.id);
      if (error) throw error; id = serviceId;
    } else if (body.entity === "vehicle_document") {
      const vehicleId = await requireOwnedId("vehicles", p.vehicleId, workspace.id, "Pojazd");
      const { data, error } = await supabase.from("vehicle_documents").insert({ workspace_id: workspace.id, vehicle_id: vehicleId, document_type: text(p.documentType, "rodzaj dokumentu", true), number: text(p.number, "numer"), valid_from: date(p.validFrom), valid_until: date(p.validUntil), status: "valid" }).select("id").single<{ id: string }>();
      if (error) throw error; id = data.id;
    } else if (body.entity === "damage_case") {
      const vehicleId = await requireOwnedId("vehicles", p.vehicleId, workspace.id, "Pojazd");
      const employeeId = p.employeeId ? await requireOwnedId("employees", p.employeeId, workspace.id, "Kierowca") : null;
      const { data, error } = await supabase.from("damage_cases").insert({
        workspace_id: workspace.id,
        vehicle_id: vehicleId,
        employee_id: employeeId,
        occurred_at: text(p.occurredAt, "data szkody") ?? new Date().toISOString(),
        description: text(p.description, "opis szkody", true),
        cost: amount(p.cost, "koszt") || null,
        status: "reported"
      }).select("id").single<{ id: string }>();
      if (error) throw error; id = data.id;
    } else if (body.entity === "vehicle_status") {
      const vehicleId = await requireOwnedId("vehicles", p.vehicleId, workspace.id, "Pojazd");
      const status = text(p.status, "status", true);
      if (!status || !["active", "inactive", "service", "sold"].includes(status)) throw new Error("Nieprawidłowy status pojazdu.");
      const { error } = await supabase.from("vehicles").update({ status }).eq("id", vehicleId).eq("workspace_id", workspace.id);
      if (error) throw error; id = vehicleId;
    } else if (body.entity === "report_definition") {
      const projectId = p.projectId ? await requireOwnedId("projects", p.projectId, workspace.id, "Inwestycja") : null;
      const { data, error } = await supabase.from("report_definitions").insert({ workspace_id: workspace.id, project_id: projectId, name: text(p.name, "nazwa raportu", true), report_type: text(p.reportType, "typ raportu", true), definition: { sections: ["portfolio", "finance", "resources", "documents", "ai"], created_from: "ui" }, schedule_rule: text(p.scheduleRule, "cykl"), created_by: user.id }).select("id").single<{ id: string }>();
      if (error) throw error; id = data.id;
    } else if (body.entity === "report_generate") {
      id = await createReportSnapshot(workspace.id, user.id, p);
    }

    if (!id) throw new Error("Operacja nie utworzyła rekordu.");
    const eventSuffix = body.entity.endsWith("_decision") || body.entity.endsWith("_status") || body.entity.endsWith("_approve") || body.entity.endsWith("_close") ? "updated" : "created";
    await supabase.from("audit_events").insert({ workspace_id: workspace.id, actor_id: user.id, event_type: `${body.entity}.${eventSuffix}`, entity_type: body.entity, entity_id: id, after_value: p });
    return NextResponse.json({ ok: true, id });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Nie udało się zapisać rekordu.";
    return NextResponse.json({ error: message }, { status: 422 });
  }
}
