import { randomUUID } from "node:crypto";
import { asId, ensureRow, findOne, type Db, type SeedInput } from "@/lib/demo/wysoka-seed-shared";

export async function seedFinance(db: Db, input: SeedInput, documentIds: Map<string, string>, boq: Map<string, string>, wbs: Map<string, string>) {
  let created = 0;
  const counterparties = [
    ["HVAC System Demo Sp. z o.o.", "7810000001", "supplier"],
    ["Sanit-Pol Test Sp. z o.o.", "7810000002", "supplier"],
    ["Izolacje Demo S.A.", "7810000003", "supplier"],
    ["Serwis Budowa Test", "7810000004", "subcontractor"],
    ["Inwestor Wysoka — DEMO", "7810000005", "client"],
    ["Stacja Paliw Demo", "7810000006", "supplier"]
  ] as const;
  const cp = new Map<string, string>();
  for (const [name, taxId, role] of counterparties) {
    const result = await ensureRow(db, "counterparties", { workspace_id: input.workspaceId, name }, { tax_id: taxId, role, contact: { email: `test+${taxId}@example.invalid` }, active: true });
    if (result.created) created += 1;
    cp.set(name, asId(result.row));
  }

  const invoices = [
    ["FV/TEST/08/001", "HVAC System Demo Sp. z o.o.", "purchase", "2026-08-01", "2026-08-31", 50000, 11500, 61500, 30000, "partially_paid", true, "TEST-006"],
    ["FV/TEST/08/002", "Sanit-Pol Test Sp. z o.o.", "purchase", "2026-08-03", "2026-08-17", 20000, 4600, 24600, 24600, "paid", true, "TEST-001"],
    ["FV/TEST/08/003", "Izolacje Demo S.A.", "purchase", "2026-07-20", "2026-08-10", 8000, 1840, 9840, 0, "overdue", true, "TEST-011"],
    ["FV/TEST/08/004", "Serwis Budowa Test", "purchase", "2026-08-05", "2026-09-04", 30000, 6900, 36900, 0, "received", true, "TEST-005"],
    ["FV/TEST/S/003", "Inwestor Wysoka — DEMO", "sale", "2026-08-10", "2026-08-24", 150000, 34500, 184500, 100000, "partially_paid", true, "TEST-001"],
    ["FV/TEST/08/005", "Stacja Paliw Demo", "purchase", "2026-08-12", "2026-08-26", 2000, 460, 2460, 0, "received", true, "TEST-003"],
    ["FV/TEST/07/021", "Sanit-Pol Test Sp. z o.o.", "purchase", "2026-07-12", "2026-07-26", 12500, 2875, 15375, 15375, "paid", true, "TEST-002"],
    ["FV/TEST/08/006", "HVAC System Demo Sp. z o.o.", "purchase", "2026-08-15", "2026-09-14", 18000, 4140, 22140, 0, "received", true, "TEST-004"]
  ] as const;
  for (const [invoiceNumber, cpName, direction, issueDate, dueDate, net, tax, gross, paid, status, projectLinked, boqNumber] of invoices) {
    const counterpartyId = cp.get(cpName)!;
    const invoiceDoc = invoiceNumber === "FV/TEST/08/001" ? documentIds.get("[TEST] Faktura zakupowa FV-TEST-001 - Wysoka.txt") ?? null : null;
    const result = await ensureRow(db, "invoices", { workspace_id: input.workspaceId, direction, invoice_number: invoiceNumber, counterparty_id: counterpartyId }, {
      document_id: invoiceDoc, issue_date: issueDate, sale_date: issueDate, due_date: dueDate, currency: "PLN",
      net_amount: net, tax_amount: tax, gross_amount: gross, paid_amount: paid, status
    });
    if (result.created) created += 1;
    const invoiceId = asId(result.row);
    const line = await ensureRow(db, "invoice_lines", { workspace_id: input.workspaceId, invoice_id: invoiceId, line_number: 1 }, {
      description: `Pozycja testowa ${boqNumber}`, quantity: 1, unit: "kpl.", unit_price: net,
      net_amount: net, tax_rate: 23, gross_amount: gross
    });
    if (line.created) created += 1;
    if (paid > 0) {
      const payment = await ensureRow(db, "payments", { workspace_id: input.workspaceId, invoice_id: invoiceId, bank_reference: `TEST-${invoiceNumber}` }, {
        payment_date: issueDate, amount: paid, currency: "PLN", status: "confirmed"
      });
      if (payment.created) created += 1;
    }
    if (projectLinked) {
      const allocation = await ensureRow(db, "financial_allocations", { workspace_id: input.workspaceId, source_type: "invoice", source_id: invoiceId, project_id: input.projectId }, {
        source_line_id: asId(line.row), boq_item_id: boq.get(boqNumber) ?? null,
        wbs_node_id: wbs.get(boqNumber === "TEST-006" ? "TEST-04" : boqNumber === "TEST-002" ? "TEST-02" : "TEST-03") ?? null,
        cost_code: `DEMO-${boqNumber}`, amount: direction === "sale" ? 0 : gross, allocation_percent: 100, status: "approved"
      });
      if (allocation.created) created += 1;
    }
  }

  const commitments = [
    ["[TEST] Dostawa centrali NW-1 — II rata", 31500, "2026-09-15", "open", "HVAC System Demo Sp. z o.o."],
    ["[TEST] Izolacje kanałów — etap 1", 17200, "2026-09-30", "open", "Izolacje Demo S.A."],
    ["[TEST] Podwykonawstwo wentylacja", 28000, "2026-09-20", "open", "Serwis Budowa Test"],
    ["[TEST] Armatura kotłowni", 14600, "2026-08-28", "overdue", "Sanit-Pol Test Sp. z o.o."]
  ] as const;
  for (const [description, amount, expectedDate, status, cpName] of commitments) {
    const result = await ensureRow(db, "commitments", { workspace_id: input.workspaceId, project_id: input.projectId, description }, {
      counterparty_id: cp.get(cpName) ?? null, source_type: "demo_seed", source_id: randomUUID(), amount, expected_date: expectedDate, status
    });
    if (result.created) created += 1;
  }

  if (!await findOne(db, "budgets", { workspace_id: input.workspaceId, project_id: input.projectId, name: "Budżet testowy — Wysoka" })) {
    const budget = await db.rpc("create_budget_version_atomic", {
      p_workspace_id: input.workspaceId, p_project_id: input.projectId, p_name: "Budżet testowy — Wysoka",
      p_total_revenue: 690000, p_total_cost: 468000, p_actor_id: input.actorId
    });
    if (budget.error) throw new Error(`Seed budżetu: ${budget.error.message}`);
    created += 1;
  }

  return created;
}
