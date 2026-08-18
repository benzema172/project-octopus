import { asId, ensureRow, findOne, type Db, type Row, type SeedInput } from "@/lib/demo/wysoka-seed-shared";

export async function seedProjectControl(
  db: Db, input: SeedInput, wbs: Map<string, string>, boq: Map<string, string>, boqVersionId: string
) {
  let created = 0;
  const siteEvents = [
    ["[TEST] Kolizja kanału W-12 z podciągiem", "issue", "draft", "Poziom +1", "Przełożyć trasę o 18 cm po uzgodnieniu z konstrukcją."],
    ["[TEST] Odbiór bruzd pod piony", "inspection", "approved", "Klatka A", "Bruzdy wykonane zgodnie z trasą projektu."],
    ["[TEST] Dostawa centrali NW-1", "delivery", "approved", "Plac budowy", "Centrala zabezpieczona i składowana w strefie dostaw."],
    ["[TEST] Brak tulei w przejściu ppoż.", "quality", "draft", "Pom. 1.12", "Wymagane uzupełnienie przed zamknięciem szachtu."],
    ["[TEST] Uzgodnienie wysokości podejścia", "coordination", "approved", "Łazienki parter", "Ustalono oś 58 cm nad posadzką."],
    ["[TEST] Kontrola BHP rusztowania", "safety", "approved", "Strefa techniczna", "Brak uwag krytycznych."]
  ] as const;
  for (const [title, eventType, status, locationLabel, description] of siteEvents) {
    const result = await ensureRow(db, "site_events", { workspace_id: input.workspaceId, project_id: input.projectId, title }, {
      event_type: eventType, description, captured_at: "2026-08-17T09:30:00+02:00", location_label: locationLabel,
      weather_snapshot: { temperature: 23, condition: "bez opadów" }, attachments: [], ai_suggestion: { action: "sprawdź wpływ na harmonogram" },
      status, captured_by: input.actorId, approved_by: status === "approved" ? input.actorId : null,
      approved_at: status === "approved" ? "2026-08-17T11:00:00+02:00" : null
    });
    if (result.created) created += 1;
  }

  const closeout = [
    ["dtr", "[TEST] DTR urządzeń", "in_progress"],
    ["as_built", "[TEST] Rysunki powykonawcze", "missing"],
    ["protocols", "[TEST] Komplet protokołów prób", "in_progress"],
    ["training", "[TEST] Protokół szkolenia użytkownika", "missing"],
    ["warranty", "[TEST] Karty gwarancyjne", "complete"]
  ] as const;
  for (const [category, title, status] of closeout) {
    const result = await ensureRow(db, "closeout_requirements", { workspace_id: input.workspaceId, project_id: input.projectId, category, title }, {
      required: true, status, owner_id: input.actorId, due_at: "2026-11-20T12:00:00+01:00"
    });
    if (result.created) created += 1;
  }

  const changes = [
    ["TEST-ZM-01", "Przesunięcie centrali NW-1", "approved", 8200, 3],
    ["TEST-ZM-02", "Dodatkowe podejścia wodne w zapleczu", "identified", 6400, 2],
    ["TEST-ZM-03", "Zmiana izolacji przewodów chłodniczych", "review", 2900, 0]
  ] as const;
  for (const [number, title, status, valueChange, daysChange] of changes) {
    const result = await ensureRow(db, "change_orders", { workspace_id: input.workspaceId, project_id: input.projectId, number }, {
      title, description: "Kontrolowana zmiana testowa do sprawdzenia Change Radar.", status, value_change: valueChange, days_change: daysChange
    });
    if (result.created) created += 1;
  }

  const tasks = [
    ["[TEST] Zamknąć WM-03", "high", "open", "2026-08-20T12:00:00+02:00"],
    ["[TEST] Uzupełnić protokół próby c.o.", "high", "open", "2026-08-21T12:00:00+02:00"],
    ["[TEST] Zamówić przepustnice Ø250", "normal", "open", "2026-08-22T12:00:00+02:00"],
    ["[TEST] Potwierdzić termin dostawy kotła", "normal", "completed", "2026-08-16T12:00:00+02:00"],
    ["[TEST] Wyjaśnić kolizję W-12", "urgent", "open", "2026-08-19T12:00:00+02:00"],
    ["[TEST] Przygotować przerób sierpień", "normal", "open", "2026-08-29T12:00:00+02:00"]
  ] as const;
  for (const [title, priority, status, dueAt] of tasks) {
    const result = await ensureRow(db, "tasks", { workspace_id: input.workspaceId, project_id: input.projectId, title }, {
      description: "Zadanie testowe wygenerowane dla inwestycji Wysoka.", status, priority,
      source_type: "demo_seed", due_at: dueAt, completed_at: status === "completed" ? "2026-08-16T10:00:00+02:00" : null,
      created_by: input.actorId
    });
    if (result.created) created += 1;
  }

  const period = await ensureRow(db, "progress_periods", { workspace_id: input.workspaceId, project_id: input.projectId, period_start: "2026-07-01", period_end: "2026-07-31" }, {
    boq_version_id: boqVersionId, status: "accepted", submitted_at: "2026-08-03T10:00:00+02:00", accepted_at: "2026-08-05T10:00:00+02:00"
  });
  if (period.created) created += 1;
  const periodId = asId(period.row);
  const progressSpecs = [
    ["TEST-001", 130, 120], ["TEST-002", 145, 140], ["TEST-003", 90, 78], ["TEST-004", 18, 16], ["TEST-005", 86, 72]
  ] as const;
  for (const [itemNumber, executed, accepted] of progressSpecs) {
    const boqItemId = boq.get(itemNumber);
    if (!boqItemId) continue;
    const existing = await findOne(db, "progress_entries", { workspace_id: input.workspaceId, project_id: input.projectId, progress_period_id: periodId, boq_item_id: boqItemId });
    if (!existing) {
      const item = await findOne(db, "boq_items", { id: boqItemId }, "unit_price");
      const unitPrice = Number(item?.unit_price ?? 0);
      const inserted = await db.from("progress_entries").insert({
        workspace_id: input.workspaceId, project_id: input.projectId, progress_period_id: periodId, boq_item_id: boqItemId,
        quantity_executed: executed, quantity_accepted: accepted, value_executed: executed * unitPrice,
        value_accepted: accepted * unitPrice, status: "submitted",
        evidence: [{ type: "photo", label: "Zdjęcia testowe" }]
      });
      if (inserted.error) throw new Error(`Seed przerobu: ${inserted.error.message}`);
      created += 1;
    }
  }

  if (!await findOne(db, "forecast_snapshots", { workspace_id: input.workspaceId, project_id: input.projectId })) {
    const result = await db.from("forecast_snapshots").insert({
      workspace_id: input.workspaceId, project_id: input.projectId, forecast_date: "2026-08-18", status: "approved",
      forecast_finish_date: "2026-12-04", contract_value: 690000, actual_cost: 172815, committed_cost: 91300,
      estimate_to_complete: 214900, estimate_at_completion: 443300, forecast_margin: 246700,
      assumptions: ["Dane testowe", "Brak dalszych zmian zakresu", "Dostawy zgodne z harmonogramem"],
      source_snapshot: { demo: true, progress: 52 }, created_by: input.actorId
    });
    if (result.error) throw new Error(`Seed prognozy: ${result.error.message}`);
    created += 1;
  }

  const anomalySpecs = [
    ["demo:wysoka:schedule", "schedule", "critical", "[TEST] Ryzyko ścieżki krytycznej", "Dostawa centrali NW-1 może przesunąć H08 o 4 dni.", "open"],
    ["demo:wysoka:finance", "finance", "warning", "[TEST] Ryzyko płynności", "W najbliższych 30 dniach występuje kumulacja zobowiązań testowych.", "open"],
    ["demo:wysoka:quality", "quality", "warning", "[TEST] Brak dowodu próby c.o.", "Wymagany wynik próby przed zakryciem instalacji.", "acknowledged"],
    ["demo:wysoka:coordination", "coordination", "warning", "[TEST] Kolizja kanału W-12", "Oczekuje na odpowiedź RFI-07.", "open"]
  ] as const;
  for (const [anomalyKey, category, severity, title, detail, status] of anomalySpecs) {
    const result = await ensureRow(db, "project_anomalies", { workspace_id: input.workspaceId, project_id: input.projectId, anomaly_key: anomalyKey }, {
      category, severity, title, detail, entity_type: "demo_seed", entity_id: input.projectId, status,
      acknowledged_by: status === "acknowledged" ? input.actorId : null,
      acknowledged_at: status === "acknowledged" ? "2026-08-18T07:00:00+02:00" : null
    });
    if (result.created) created += 1;
  }

  const correspondenceSpecs = [
    ["TEST-RFI-07", "RFI — kolizja kanału W-12", "outgoing", "rfi", "Projektant sanitarny", "open", "2026-08-19T12:00:00+02:00"],
    ["TEST-UZG-12", "Uzgodnienie podejść wodnych zaplecza", "incoming", "email", "Inwestor Wysoka — DEMO", "closed", null],
    ["TEST-ZM-01", "Akceptacja przesunięcia centrali NW-1", "incoming", "decision", "Projektant / Inwestor", "closed", null],
    ["TEST-DOST-04", "Potwierdzenie terminu dostawy kotła", "incoming", "email", "HVAC System Demo Sp. z o.o.", "open", "2026-08-21T12:00:00+02:00"],
    ["TEST-ODBIOR-01", "Zapowiedź odbioru kanalizacji podposadzkowej", "outgoing", "letter", "Inspektor nadzoru", "closed", null]
  ] as const;
  for (const [referenceNumber, subject, direction, correspondenceType, counterparty, status, dueAt] of correspondenceSpecs) {
    const result = await ensureRow(db, "project_correspondence", { workspace_id: input.workspaceId, project_id: input.projectId, reference_number: referenceNumber }, {
      direction, correspondence_type: correspondenceType, subject, counterparty, sent_at: "2026-08-17T08:30:00+02:00", due_at: dueAt,
      status, notes: "Korespondencja testowa Wysoka", created_by: input.actorId
    });
    if (result.created) created += 1;
  }

  const health = await ensureRow(db, "project_health_snapshots", { workspace_id: input.workspaceId, project_id: input.projectId, snapshot_date: "2026-08-18" }, {
    score: 74, status: "warning", payload: { demo: true, schedule: 71, finance: 82, quality: 68, documents: 91 }
  });
  if (health.created) created += 1;

  const evidenceSpecs = [
    ["[TEST] Zdjęcie manometru — wodociąg", "photo", "accepted", "TEST-01", "TEST-001"],
    ["[TEST] Wynik próby szczelności — wodociąg", "measurement", "accepted", "TEST-01", "TEST-001"],
    ["[TEST] Zdjęcia kanalizacji przed zasypaniem", "photo", "accepted", "TEST-02", "TEST-002"],
    ["[TEST] Wynik próby c.o.", "measurement", "missing", "TEST-03", "TEST-003"],
    ["[TEST] Pomiary wydajności wentylacji", "measurement", "missing", "TEST-04", "TEST-005"],
    ["[TEST] DTR centrali NW-1", "document", "missing", "TEST-04", "TEST-006"]
  ] as const;
  for (const [title, evidenceType, status, wbsCode, boqNumber] of evidenceSpecs) {
    const result = await ensureRow(db, "evidence_requirements", { workspace_id: input.workspaceId, project_id: input.projectId, title }, {
      wbs_node_id: wbs.get(wbsCode) ?? null, boq_item_id: boq.get(boqNumber) ?? null, evidence_type: evidenceType,
      required: true, status, fulfilled_by_type: status === "accepted" ? "demo_seed" : null,
      fulfilled_by_id: status === "accepted" ? input.projectId : null, due_at: "2026-10-30T12:00:00+01:00",
      accepted_by: status === "accepted" ? input.actorId : null, accepted_at: status === "accepted" ? "2026-08-17T12:00:00+02:00" : null
    });
    if (result.created) created += 1;
  }

  let aiRun = await findOne(db, "ai_runs", { project_id: input.projectId, provider: "gemini", model: "demo-seed-wysoka" });
  if (!aiRun) {
    const inserted = await db.from("ai_runs").insert({
      project_id: input.projectId, provider: "gemini", model: "demo-seed-wysoka", status: "succeeded",
      input: { task: "analiza inwestycji Wysoka", demo: true },
      output: { summary: "Wykryto ryzyka harmonogramowe, brakujące dowody i otwarte zobowiązania.", demo: true },
      created_by: input.actorId
    }).select("*").single();
    if (inserted.error || !inserted.data) throw new Error(`Seed AI run: ${inserted.error?.message ?? "brak danych"}`);
    aiRun = inserted.data as Row;
    created += 1;
  }
  const aiRunId = asId(aiRun);
  const findings = [
    ["[TEST] Krytyczna dostawa centrali NW-1", "risk", "high", "Dostawa wpływa na ścieżkę krytyczną H08."],
    ["[TEST] Brak dowodu próby c.o.", "evidence_gap", "medium", "Przed zakryciem instalacji należy uzupełnić wynik próby."],
    ["[TEST] Faktura izolacji po terminie", "finance", "medium", "FV/TEST/08/003 pozostaje nieopłacona."],
    ["[TEST] Kolizja kanału W-12", "coordination", "high", "RFI-07 wymaga decyzji projektanta." ]
  ] as const;
  for (const [title, findingType, severity, description] of findings) {
    const result = await ensureRow(db, "ai_findings", { project_id: input.projectId, ai_run_id: aiRunId, title }, {
      finding_type: findingType, severity, description
    });
    if (result.created) created += 1;
  }

  const knowledge = [
    ["lesson", "[TEST] Koordynacja tras wentylacji", "Rezerwować strefy kanałów przed zamknięciem projektu konstrukcji."],
    ["risk", "[TEST] Dostawy urządzeń długoterminowych", "Centrala i kocioł wymagają potwierdzenia terminów minimum 8 tygodni wcześniej."],
    ["standard", "[TEST] Próby przed zakryciem", "Każda próba musi mieć zdjęcia manometru, zakres instalacji i podpis kierownika."]
  ] as const;
  for (const [entryType, title, summary] of knowledge) {
    const result = await ensureRow(db, "knowledge_entries", { workspace_id: input.workspaceId, source_project_id: input.projectId, title }, {
      entry_type: entryType, summary, problem: "Dane testowe Wysoka", solution: summary,
      tags: ["wysoka", "demo", "sanitarne"], metrics: { confidence: 0.95 }, source_references: [], status: "approved",
      approved_by: input.actorId, approved_at: "2026-08-18T08:00:00+02:00"
    });
    if (result.created) created += 1;
  }

  return created;
}
