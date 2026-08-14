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
  leave_request: "hr",
  timesheet: "hr",
  warehouse: "warehouse",
  stock_item: "warehouse",
  stock_movement: "warehouse",
  ai_warehouse_import: "warehouse",
  stock_movement_approve: "warehouse",
  vehicle: "fleet",
  fuel_entry: "fleet",
  service_order: "fleet",
  vehicle_document: "fleet",
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

async function assignSourceDocumentToProject(documentId: string, projectId: string | null) {
  if (!projectId) return;
  const supabase = createServiceSupabaseClient();
  await Promise.all([
    supabase.from("documents").update({ project_id: projectId }).eq("id", documentId),
    supabase.from("document_versions").update({ project_id: projectId }).eq("document_id", documentId),
    supabase.from("document_extractions").update({ project_id: projectId }).eq("document_id", documentId),
    supabase.from("document_intakes").update({ proposed_project_id: projectId }).eq("document_id", documentId)
  ]);
}

async function createReportSnapshot(workspaceId: string, userId: string, payload: Record<string, unknown>) {
  const supabase = createServiceSupabaseClient();
  const definitionId = await requireOwnedId("report_definitions", payload.definitionId, workspaceId, "Definicja raportu");
  const { data: definition } = await supabase.from("report_definitions").select("id,name,report_type,project_id,definition").eq("id", definitionId).single();
  const projectId = definition?.project_id ? String(definition.project_id) : null;
  const periodStart = date(payload.periodStart);
  const periodEnd = date(payload.periodEnd);
  const [projects, documents, employees, vehicles, stockItems, invoices, commitments, openAi] = await Promise.all([
    supabase.from("projects").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId),
    supabase.from("documents").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId).is("deleted_at", null),
    supabase.from("employees").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId).eq("status", "active"),
    supabase.from("vehicles").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId).eq("status", "active"),
    supabase.from("stock_items").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId).eq("active", true),
    supabase.from("invoices").select("direction,gross_amount,paid_amount,status").eq("workspace_id", workspaceId),
    supabase.from("commitments").select("amount,status").eq("workspace_id", workspaceId).in("status", ["open", "approved"]),
    supabase.from("document_intakes").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId).in("status", ["queued", "review", "error"])
  ]);
  const invoiceRows = invoices.data ?? [];
  const sale = invoiceRows.filter((row) => row.direction === "sale").reduce((sum, row) => sum + Number(row.gross_amount ?? 0), 0);
  const purchase = invoiceRows.filter((row) => row.direction === "purchase").reduce((sum, row) => sum + Number(row.gross_amount ?? 0), 0);
  const paid = invoiceRows.reduce((sum, row) => sum + Number(row.paid_amount ?? 0), 0);
  const committed = (commitments.data ?? []).reduce((sum, row) => sum + Number(row.amount ?? 0), 0);
  const snapshot = {
    period: { start: periodStart, end: periodEnd },
    portfolio: { projects: projects.count ?? 0, documents: documents.count ?? 0 },
    resources: { employees: employees.count ?? 0, vehicles: vehicles.count ?? 0, stock_items: stockItems.count ?? 0 },
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
      summary: `Wynik brutto okresu: ${sale - purchase} PLN. Otwarte zobowiązania: ${committed} PLN.`,
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
  if (!await hasDomainAccess({ workspaceId: workspace.id, userId: user.id, domain, level: "write", projectId: text(body.payload.projectId, "inwestycja") })) {
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
      const net = amount(p.netAmount, "netto");
      const tax = amount(p.taxAmount, "VAT");
      const gross = amount(p.grossAmount, "brutto", true);
      const { data, error } = await supabase.from("invoices").insert({ workspace_id: workspace.id, counterparty_id: counterpartyId, invoice_number: text(p.invoiceNumber, "numer faktury", true), direction: text(p.direction, "kierunek", true), issue_date: date(p.issueDate), due_date: date(p.dueDate), net_amount: net, tax_amount: tax, gross_amount: gross, status: p.direction === "sale" ? "issued" : "received" }).select("id").single<{ id: string }>();
      if (error) throw error; id = data.id;
    } else if (body.entity === "payment") {
      const invoiceId = await requireOwnedId("invoices", p.invoiceId, workspace.id, "Faktura");
      const paymentAmount = amount(p.amount, "kwota płatności", true);
      const { data: invoice } = await supabase.from("invoices").select("gross_amount,paid_amount").eq("id", invoiceId).single();
      const { data, error } = await supabase.from("payments").insert({ workspace_id: workspace.id, invoice_id: invoiceId, payment_date: date(p.paymentDate) ?? new Date().toISOString().slice(0, 10), amount: paymentAmount, bank_reference: text(p.bankReference, "referencja") }).select("id").single<{ id: string }>();
      if (error) throw error;
      const paidAmount = Number(invoice?.paid_amount ?? 0) + paymentAmount;
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
      await assignSourceDocumentToProject(source.documentId, projectId);
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
    } else if (body.entity === "leave_request") {
      const employeeId = await requireOwnedId("employees", p.employeeId, workspace.id, "Pracownik");
      const { data, error } = await supabase.from("leave_requests").insert({ workspace_id: workspace.id, employee_id: employeeId, leave_type: text(p.leaveType, "rodzaj urlopu") ?? "annual", date_from: date(p.dateFrom), date_to: date(p.dateTo), days: amount(p.days, "liczba dni", true), status: "pending" }).select("id").single<{ id: string }>();
      if (error) throw error; id = data.id;
    } else if (body.entity === "timesheet") {
      const employeeId = await requireOwnedId("employees", p.employeeId, workspace.id, "Pracownik");
      const projectId = p.projectId ? await requireOwnedId("projects", p.projectId, workspace.id, "Inwestycja") : null;
      const { data, error } = await supabase.from("timesheets").insert({ workspace_id: workspace.id, employee_id: employeeId, project_id: projectId, work_date: date(p.workDate) ?? new Date().toISOString().slice(0, 10), hours: amount(p.hours, "liczba godzin", true), overtime_hours: amount(p.overtimeHours, "nadgodziny"), status: "submitted" }).select("id").single<{ id: string }>();
      if (error) throw error; id = data.id;
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
      const { data: movement, error } = await supabase.from("stock_movements").insert({ workspace_id: workspace.id, project_id: projectId, warehouse_id: warehouseId, target_warehouse_id: targetWarehouseId, movement_type: text(p.movementType, "typ ruchu", true), document_number: text(p.documentNumber, "numer dokumentu"), movement_date: date(p.movementDate) ?? new Date().toISOString().slice(0, 10), status: "approved", approved_by: user.id, approved_at: new Date().toISOString() }).select("id").single<{ id: string }>();
      if (error || !movement) throw error ?? new Error("Nie utworzono ruchu.");
      const { error: lineError } = await supabase.from("stock_movement_lines").insert({ workspace_id: workspace.id, movement_id: movement.id, stock_item_id: stockItemId, quantity: amount(p.quantity, "ilość", true), unit_cost: amount(p.unitCost, "koszt jednostkowy") || null });
      if (lineError) { await supabase.from("stock_movements").delete().eq("id", movement.id); throw lineError; }
      id = movement.id;
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
      await assignSourceDocumentToProject(source.documentId, projectId);
      id = movement.id;
    } else if (body.entity === "stock_movement_approve") {
      const movementId = await requireOwnedId("stock_movements", p.movementId, workspace.id, "Ruch magazynowy");
      const { count } = await supabase.from("stock_movement_lines").select("id", { count: "exact", head: true }).eq("workspace_id", workspace.id).eq("movement_id", movementId);
      if (!count) throw new Error("Nie można zatwierdzić ruchu bez pozycji.");
      const { error } = await supabase.from("stock_movements").update({ status: "approved", approved_by: user.id, approved_at: new Date().toISOString() }).eq("id", movementId).eq("workspace_id", workspace.id);
      if (error) throw error;
      id = movementId;
    } else if (body.entity === "vehicle") {
      const { data, error } = await supabase.from("vehicles").insert({ workspace_id: workspace.id, registration_number: text(p.registrationNumber, "numer rejestracyjny", true)?.toUpperCase(), vin: text(p.vin, "VIN"), vehicle_type: text(p.vehicleType, "typ pojazdu", true), make: text(p.make, "marka"), model: text(p.model, "model"), production_year: amount(p.productionYear, "rok produkcji") || null, ownership_type: text(p.ownershipType, "forma własności"), current_mileage: amount(p.currentMileage, "przebieg") || null, status: "active" }).select("id").single<{ id: string }>();
      if (error) throw error; id = data.id;
    } else if (body.entity === "fuel_entry") {
      const vehicleId = await requireOwnedId("vehicles", p.vehicleId, workspace.id, "Pojazd");
      const projectId = p.projectId ? await requireOwnedId("projects", p.projectId, workspace.id, "Inwestycja") : null;
      const { data, error } = await supabase.from("fuel_entries").insert({ workspace_id: workspace.id, vehicle_id: vehicleId, project_id: projectId, fueled_at: text(p.fueledAt, "data tankowania") ?? new Date().toISOString(), liters: amount(p.liters, "litry", true), gross_amount: amount(p.grossAmount, "koszt", true), mileage: amount(p.mileage, "przebieg") || null }).select("id").single<{ id: string }>();
      if (error) throw error; id = data.id;
    } else if (body.entity === "service_order") {
      const vehicleId = await requireOwnedId("vehicles", p.vehicleId, workspace.id, "Pojazd");
      const { data, error } = await supabase.from("service_orders").insert({ workspace_id: workspace.id, vehicle_id: vehicleId, service_type: text(p.serviceType, "rodzaj serwisu", true), opened_at: date(p.openedAt) ?? new Date().toISOString().slice(0, 10), next_due_date: date(p.nextDueDate), next_due_mileage: amount(p.nextDueMileage, "następny przebieg") || null, cost: amount(p.cost, "koszt") || null, status: "open" }).select("id").single<{ id: string }>();
      if (error) throw error; id = data.id;
    } else if (body.entity === "vehicle_document") {
      const vehicleId = await requireOwnedId("vehicles", p.vehicleId, workspace.id, "Pojazd");
      const { data, error } = await supabase.from("vehicle_documents").insert({ workspace_id: workspace.id, vehicle_id: vehicleId, document_type: text(p.documentType, "rodzaj dokumentu", true), number: text(p.number, "numer"), valid_from: date(p.validFrom), valid_until: date(p.validUntil), status: "valid" }).select("id").single<{ id: string }>();
      if (error) throw error; id = data.id;
    } else if (body.entity === "report_definition") {
      const projectId = p.projectId ? await requireOwnedId("projects", p.projectId, workspace.id, "Inwestycja") : null;
      const { data, error } = await supabase.from("report_definitions").insert({ workspace_id: workspace.id, project_id: projectId, name: text(p.name, "nazwa raportu", true), report_type: text(p.reportType, "typ raportu", true), definition: { sections: ["portfolio", "finance", "resources", "documents", "ai"], created_from: "ui" }, schedule_rule: text(p.scheduleRule, "cykl"), created_by: user.id }).select("id").single<{ id: string }>();
      if (error) throw error; id = data.id;
    } else if (body.entity === "report_generate") {
      id = await createReportSnapshot(workspace.id, user.id, p);
    }

    if (!id) throw new Error("Operacja nie utworzyła rekordu.");
    await supabase.from("audit_events").insert({ workspace_id: workspace.id, actor_id: user.id, event_type: `${body.entity}.created`, entity_type: body.entity, entity_id: id, after_value: p });
    return NextResponse.json({ ok: true, id });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Nie udało się zapisać rekordu.";
    return NextResponse.json({ error: message }, { status: 422 });
  }
}
