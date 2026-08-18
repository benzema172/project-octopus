from pathlib import Path


def replace_once(path: str, old: str, new: str):
    p = Path(path)
    text = p.read_text(encoding="utf-8")
    if old not in text:
        raise SystemExit(f"Missing target in {path}: {old[:120]!r}")
    p.write_text(text.replace(old, new, 1), encoding="utf-8")

records = "app/api/company/records/route.ts"
replace_once(records, '''    } else if (body.entity === "payment") {
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
''', '''    } else if (body.entity === "payment") {
      const invoiceId = await requireOwnedId("invoices", p.invoiceId, workspace.id, "Faktura");
      const { data, error } = await supabase.rpc("record_payment_atomic", {
        p_workspace_id: workspace.id,
        p_invoice_id: invoiceId,
        p_payment_date: date(p.paymentDate) ?? new Date().toISOString().slice(0, 10),
        p_amount: amount(p.amount, "kwota płatności", true),
        p_bank_reference: text(p.bankReference, "referencja") ?? "",
        p_actor_id: user.id
      }).single<{ result_payment_id: string }>();
      if (error || !data) throw new Error(`Nie udało się atomowo zapisać płatności: ${error?.message ?? "brak danych"}`);
      id = data.result_payment_id;
''')

replace_once(records, '''    } else if (body.entity === "fuel_entry") {
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
''', '''    } else if (body.entity === "fuel_entry") {
      const vehicleId = await requireOwnedId("vehicles", p.vehicleId, workspace.id, "Pojazd");
      const projectId = p.projectId ? await requireOwnedId("projects", p.projectId, workspace.id, "Inwestycja") : null;
      const mileage = amount(p.mileage, "przebieg") || null;
      const fueledAt = text(p.fueledAt, "data tankowania") ?? new Date().toISOString();
      const { data, error } = await supabase.rpc("record_fuel_entry_atomic", {
        p_workspace_id: workspace.id,
        p_vehicle_id: vehicleId,
        p_project_id: projectId,
        p_fueled_at: fueledAt,
        p_liters: amount(p.liters, "litry", true),
        p_gross_amount: amount(p.grossAmount, "koszt", true),
        p_mileage: mileage,
        p_actor_id: user.id
      }).single<{ result_fuel_entry_id: string }>();
      if (error || !data) throw new Error(`Nie udało się atomowo zapisać tankowania: ${error?.message ?? "brak danych"}`);
      id = data.result_fuel_entry_id;
''')

validator = "scripts/validate-migrations-local.mjs"
replace_once(validator, '  "supabase/migrations/20260818074000_101_stock_and_document_integrity.sql"\n];', '  "supabase/migrations/20260818074000_101_stock_and_document_integrity.sql",\n  "supabase/migrations/20260818075000_101_finance_fleet_atomicity.sql"\n];')
replace_once(validator, '    "assign_document_to_project_atomic"\n  ];', '    "assign_document_to_project_atomic",\n    "record_payment_atomic",\n    "record_fuel_entry_atomic"\n  ];')
replace_once(validator, 'if (markers.rows.length < 12) throw new Error(`Expected 0.9.1–1.0.1 schema markers, received ${markers.rows.length}.`);', 'if (markers.rows.length < 13) throw new Error(`Expected 0.9.1–1.0.1 schema markers, received ${markers.rows.length}.`);')
replace_once(validator, '''  const firstBudget = await database.query("select * from public.create_budget_version_atomic($1,$2,'Budżet',100000,70000,$3)", [workspaceId, projectId, userId]);''', '''  const invoiceId = "00000000-0000-4000-8000-000000000008";
  await database.exec(`insert into public.invoices(id,workspace_id,invoice_number,direction,gross_amount,status) values ('${invoiceId}','${workspaceId}','FV-AUDIT','purchase',1000,'received');`);
  const payment = await database.query("select * from public.record_payment_atomic($1,$2,current_date,400,'AUDIT',$3)", [workspaceId, invoiceId, userId]);
  if (!payment.rows[0]?.result_payment_id || Number(payment.rows[0]?.paid_total) !== 400 || payment.rows[0]?.invoice_status !== "partially_paid") throw new Error("Atomic payment workflow failed.");
  const paidInvoice = await database.query("select paid_amount,status from public.invoices where id=$1", [invoiceId]);
  if (Number(paidInvoice.rows[0]?.paid_amount) !== 400 || paidInvoice.rows[0]?.status !== "partially_paid") throw new Error("Payment did not update invoice atomically.");

  const vehicleId = "00000000-0000-4000-8000-000000000009";
  await database.exec(`insert into public.vehicles(id,workspace_id,registration_number,vehicle_type,status,current_mileage) values ('${vehicleId}','${workspaceId}','AUDIT01','van','active',12000);`);
  const fuel = await database.query("select * from public.record_fuel_entry_atomic($1,$2,$3,now(),42,320,12125,$4)", [workspaceId, vehicleId, projectId, userId]);
  if (!fuel.rows[0]?.result_fuel_entry_id || Number(fuel.rows[0]?.vehicle_mileage) !== 12125) throw new Error("Atomic fuel workflow failed.");
  const vehicleAfterFuel = await database.query("select current_mileage from public.vehicles where id=$1", [vehicleId]);
  const meterAfterFuel = await database.query("select count(*)::integer count from public.meter_readings where vehicle_id=$1 and mileage=12125", [vehicleId]);
  if (Number(vehicleAfterFuel.rows[0]?.current_mileage) !== 12125 || meterAfterFuel.rows[0]?.count !== 1) throw new Error("Fuel entry did not update vehicle and meter atomically.");

  const firstBudget = await database.query("select * from public.create_budget_version_atomic($1,$2,'Budżet',100000,70000,$3)", [workspaceId, projectId, userId]);''')
replace_once(validator, 'console.log("OK   company upload/assignment, manual stock integrity, atomic budget, warehouse ledger, MM, purchase order, search, anomalies and Command Center smoke tests");', 'console.log("OK   company upload/assignment, stock integrity, atomic payments/fuel, budget, warehouse ledger, MM, purchase order, search, anomalies and Command Center smoke tests");')

print("Finance/fleet atomicity patch applied")
