import { asId, ensureRow, findOne, type Db, type Row, type SeedInput } from "@/lib/demo/wysoka-seed-shared";

export async function seedProjectFoundation(db: Db, input: SeedInput) {
  let created = 0;

  const { data: profileRows, error: profileError } = await db.from("project_facts")
    .select("id,value_json")
    .eq("project_id", input.projectId)
    .eq("fact_type", "project_profile")
    .order("updated_at", { ascending: false })
    .limit(1);
  if (profileError) throw new Error(`Seed profilu: ${profileError.message}`);
  const currentProfile = (profileRows?.[0] as { id?: string; value_json?: Row } | undefined) ?? null;
  const demoDefaults: Row = {
    shortName: "Wysoka", projectName: "Wysoka", status: "active", contractNumber: "WYS/2026/08",
    contractValue: "690000", investorName: "Inwestor Wysoka — DEMO", generalContractorName: "Generalny Wykonawca — DEMO",
    city: "Wysoka", description: "Dane testowe Project Octopus — istniejące dane użytkownika mają pierwszeństwo."
  };
  if (currentProfile?.id) {
    const mergedProfile = { ...demoDefaults, ...(currentProfile.value_json ?? {}) };
    const update = await db.from("project_facts").update({ value_json: mergedProfile, confidence: 1, status: "approved" }).eq("id", currentProfile.id);
    if (update.error) throw new Error(`Seed profilu: ${update.error.message}`);
  } else {
    const insert = await db.from("project_facts").insert({
      project_id: input.projectId, fact_type: "project_profile", value_text: "Wysoka", value_json: demoDefaults, confidence: 1, status: "approved"
    });
    if (insert.error) throw new Error(`Seed profilu: ${insert.error.message}`);
    created += 1;
  }

  const wbsSpecs = [
    ["TEST-01", "Instalacja wodociągowa", "wod-kan", "Budynek / poziom 0"],
    ["TEST-02", "Instalacja kanalizacji sanitarnej", "wod-kan", "Budynek / poziom 0"],
    ["TEST-03", "Instalacja centralnego ogrzewania", "c.o.", "Budynek / poziomy 0-1"],
    ["TEST-04", "Instalacja wentylacji mechanicznej", "wentylacja", "Dach i pomieszczenia"],
    ["TEST-05", "Instalacja gazowa", "gaz", "Kotłownia"],
    ["TEST-06", "Instalacja klimatyzacji", "klimatyzacja", "Pomieszczenia biurowe"]
  ] as const;
  const wbs = new Map<string, string>();
  for (const [code, name, installation, zone] of wbsSpecs) {
    const result = await ensureRow(db, "wbs_nodes", { workspace_id: input.workspaceId, project_id: input.projectId, code }, {
      name, branch: "sanitarna", installation, zone, sort_order: Number(code.slice(-2)), status: "active"
    });
    if (result.created) created += 1;
    wbs.set(code, asId(result.row));
  }

  const materialSpecs = [
    ["Rura PP-R 32 PN20", "wod-kan", "PP-R, PN20, SDR6"],
    ["Rura PVC-U 110", "kanalizacja", "SN8, kielichowa"],
    ["Rura stalowa czarna DN50", "c.o.", "spawana, PN16"],
    ["Rura miedziana 22x1", "c.o.", "Cu-DHP"],
    ["Kanał SPIRO Ø250", "wentylacja", "ocynk, klasa B"],
    ["Izolacja kauczukowa 19 mm", "klimatyzacja", "lambda <= 0,036 W/mK"],
    ["Zawór kulowy DN32", "wod-kan", "PN25"],
    ["Zawór równoważący DN25", "c.o.", "z króćcami pomiarowymi"],
    ["Przepustnica Ø250", "wentylacja", "regulacyjna"],
    ["Hydrant HW-25", "ppoż.", "wąż 30 m"],
    ["Otulina mineralna 40 mm", "wentylacja", "Alu"],
    ["Kształtki kanalizacyjne PVC", "kanalizacja", "SN8"]
  ] as const;
  const materials: string[] = [];
  for (const [name, installation, specification] of materialSpecs) {
    const result = await ensureRow(db, "materials", { project_id: input.projectId, name }, { installation, specification });
    if (result.created) created += 1;
    materials.push(asId(result.row));
  }

  const deviceSpecs = [
    ["Centrala wentylacyjna NW-1", "wentylacja", { airFlow: "5200 m3/h", heatRecovery: "82%", power: "5.5 kW" }],
    ["Kocioł kondensacyjny K1", "c.o.", { power: "80 kW", gas: "GZ50", efficiency: "109%" }],
    ["Pompa obiegowa P1", "c.o.", { flow: "8.2 m3/h", head: "7.5 m" }],
    ["Agregat chłodniczy KL-1", "klimatyzacja", { cooling: "24 kW", refrigerant: "R32" }],
    ["Zestaw hydroforowy ZH-1", "wod-kan", { flow: "5.0 l/s", pressure: "5 bar" }]
  ] as const;
  for (const [name, installation, parameters] of deviceSpecs) {
    const result = await ensureRow(db, "devices", { project_id: input.projectId, name }, { installation, parameters });
    if (result.created) created += 1;
  }

  let boqVersion = await findOne(db, "boq_versions", { workspace_id: input.workspaceId, project_id: input.projectId, name: "Kosztorys testowy — Wysoka" });
  if (!boqVersion) {
    const { data: versions, error } = await db.from("boq_versions").select("version_number").eq("project_id", input.projectId).order("version_number", { ascending: false }).limit(1);
    if (error) throw new Error(`Seed BOQ: ${error.message}`);
    const nextVersion = Number((versions?.[0] as { version_number?: number } | undefined)?.version_number ?? 0) + 1;
    const inserted = await db.from("boq_versions").insert({
      workspace_id: input.workspaceId, project_id: input.projectId, version_number: nextVersion,
      name: "Kosztorys testowy — Wysoka", status: "approved", currency: "PLN", net_value: 468000, gross_value: 575640,
      valid_from: "2026-07-01", approved_by: input.actorId, approved_at: "2026-07-01T08:00:00+02:00"
    }).select("*").single();
    if (inserted.error || !inserted.data) throw new Error(`Seed BOQ: ${inserted.error?.message ?? "brak danych"}`);
    boqVersion = inserted.data as Row;
    created += 1;
  }
  const boqVersionId = asId(boqVersion);

  const boqSpecs = [
    ["TEST-001", "Dostawa i montaż rurociągu PP-R 32", 280, "m", 56, "TEST-01", "MAT-WOD"],
    ["TEST-002", "Dostawa i montaż kanalizacji PVC-U 110", 190, "m", 92, "TEST-02", "MAT-KAN"],
    ["TEST-003", "Rurociąg stalowy DN50 wraz z armaturą", 210, "m", 145, "TEST-03", "MAT-CO"],
    ["TEST-004", "Grzejniki płytowe z zaworami", 42, "szt.", 980, "TEST-03", "URZ-CO"],
    ["TEST-005", "Kanały SPIRO Ø250 z kształtkami", 310, "m2", 178, "TEST-04", "MAT-WENT"],
    ["TEST-006", "Montaż centrali wentylacyjnej NW-1", 1, "kpl.", 48500, "TEST-04", "URZ-WENT"],
    ["TEST-007", "Instalacja gazowa DN25-DN50", 95, "m", 164, "TEST-05", "MAT-GAZ"],
    ["TEST-008", "Montaż kotła kondensacyjnego 80 kW", 1, "kpl.", 32500, "TEST-05", "URZ-CO"],
    ["TEST-009", "Instalacja chłodnicza miedziana", 120, "m", 132, "TEST-06", "MAT-KLIM"],
    ["TEST-010", "Montaż agregatu KL-1", 1, "kpl.", 27600, "TEST-06", "URZ-KLIM"],
    ["TEST-011", "Izolacje instalacji sanitarnych", 420, "m2", 88, "TEST-03", "IZO"],
    ["TEST-012", "Próby, regulacja i uruchomienie", 1, "kpl.", 18500, "TEST-04", "ODBIOR"]
  ] as const;
  const progressByBoq = new Map<string, [number, number]>([
    ["TEST-001", [130, 120]], ["TEST-002", [145, 140]], ["TEST-003", [90, 78]],
    ["TEST-004", [18, 16]], ["TEST-005", [86, 72]]
  ]);
  const boq = new Map<string, string>();
  for (const [itemNumber, description, quantity, unit, unitPrice, wbsCode, costCode] of boqSpecs) {
    const [executed, accepted] = progressByBoq.get(itemNumber) ?? [0, 0];
    const result = await ensureRow(db, "boq_items", { project_id: input.projectId, item_number: itemNumber }, {
      description, quantity, unit, unit_price: unitPrice, total_price: quantity * unitPrice,
      boq_version_id: boqVersionId, wbs_node_id: wbs.get(wbsCode) ?? null, cost_code: costCode,
      quantity_executed: executed, quantity_accepted: accepted
    });
    if (result.created) created += 1;
    boq.set(itemNumber, asId(result.row));
  }

  let baseline = await findOne(db, "schedule_baselines", { workspace_id: input.workspaceId, project_id: input.projectId, name: "Harmonogram testowy — Wysoka" });
  if (!baseline) {
    const { data: baselines, error } = await db.from("schedule_baselines").select("version_number").eq("project_id", input.projectId).order("version_number", { ascending: false }).limit(1);
    if (error) throw new Error(`Seed harmonogramu: ${error.message}`);
    const versionNumber = Number((baselines?.[0] as { version_number?: number } | undefined)?.version_number ?? 0) + 1;
    const inserted = await db.from("schedule_baselines").insert({
      workspace_id: input.workspaceId, project_id: input.projectId, version_number: versionNumber,
      name: "Harmonogram testowy — Wysoka", start_date: "2026-06-15", finish_date: "2026-11-30",
      status: "approved", approved_by: input.actorId, approved_at: "2026-06-10T10:00:00+02:00"
    }).select("*").single();
    if (inserted.error || !inserted.data) throw new Error(`Seed harmonogramu: ${inserted.error?.message ?? "brak danych"}`);
    baseline = inserted.data as Row;
    created += 1;
  }
  const baselineId = asId(baseline);

  const activities = [
    ["TEST-H01", "Trasy i przebicia instalacyjne", "2026-06-15", "2026-06-30", 100, 100, "TEST-01", true, "completed"],
    ["TEST-H02", "Kanalizacja podposadzkowa", "2026-06-22", "2026-07-10", 100, 100, "TEST-02", true, "completed"],
    ["TEST-H03", "Piony wod-kan", "2026-07-06", "2026-07-31", 100, 88, "TEST-01", false, "in_progress"],
    ["TEST-H04", "Rurociągi c.o. poziomy", "2026-07-20", "2026-08-21", 90, 68, "TEST-03", true, "in_progress"],
    ["TEST-H05", "Kanały wentylacyjne", "2026-08-03", "2026-09-11", 45, 37, "TEST-04", true, "in_progress"],
    ["TEST-H06", "Instalacja gazowa", "2026-08-24", "2026-09-11", 0, 0, "TEST-05", false, "planned"],
    ["TEST-H07", "Montaż urządzeń kotłowni", "2026-09-07", "2026-09-25", 0, 0, "TEST-05", true, "planned"],
    ["TEST-H08", "Montaż centrali NW-1", "2026-09-14", "2026-09-25", 0, 0, "TEST-04", true, "planned"],
    ["TEST-H09", "Klimatyzacja", "2026-09-21", "2026-10-09", 0, 0, "TEST-06", false, "planned"],
    ["TEST-H10", "Izolacje", "2026-09-28", "2026-10-23", 0, 0, "TEST-03", false, "planned"],
    ["TEST-H11", "Próby i regulacja", "2026-10-19", "2026-11-06", 0, 0, "TEST-04", true, "planned"],
    ["TEST-H12", "Odbiory i dokumentacja powykonawcza", "2026-11-09", "2026-11-30", 0, 0, "TEST-04", true, "planned"]
  ] as const;
  for (const [code, title, plannedStart, plannedFinish, plannedProgress, actualProgress, wbsCode, critical, status] of activities) {
    const result = await ensureRow(db, "schedule_activities", { workspace_id: input.workspaceId, project_id: input.projectId, code }, {
      schedule_baseline_id: baselineId, wbs_node_id: wbs.get(wbsCode) ?? null, title,
      planned_start: plannedStart, planned_finish: plannedFinish,
      actual_start: actualProgress > 0 ? plannedStart : null,
      planned_progress: plannedProgress, actual_progress: actualProgress, critical, status,
      constraint_note: "Dane testowe Wysoka", generated_source_key: `demo:wysoka:${code}`
    });
    if (result.created) created += 1;
  }

  const requirements = [
    ["[TEST] Akceptacja rur PP-R", "material_approval", "Wymagane zatwierdzenie producenta i deklaracji właściwości."],
    ["[TEST] Próba szczelności wodociągu", "protocol", "Próba przed zakryciem przewodów."],
    ["[TEST] Próba szczelności instalacji gazowej", "protocol", "Próba z wpisem manometru i czasu."],
    ["[TEST] Protokół regulacji wentylacji", "protocol", "Pomiary końcowe nawiew/wywiew."],
    ["[TEST] Dokumentacja DTR urządzeń", "closeout", "Komplet DTR centrali, kotła i pomp."],
    ["[TEST] Dokumentacja powykonawcza", "closeout", "Rysunki z naniesionymi zmianami." ]
  ] as const;
  for (const [title, requirementType, description] of requirements) {
    const result = await ensureRow(db, "project_requirements", { workspace_id: input.workspaceId, project_id: input.projectId, title }, {
      requirement_type: requirementType, description, status: "approved", confidence: 0.96
    });
    if (result.created) created += 1;
  }

  const protocolSpecs = [
    ["TEST-PR-01", "Próba szczelności instalacji wodociągowej", "pressure_test", "closed", "TEST-01"],
    ["TEST-PR-02", "Odbiór kanalizacji podposadzkowej", "hidden_works", "closed", "TEST-02"],
    ["TEST-PR-03", "Próba szczelności instalacji c.o.", "pressure_test", "draft", "TEST-03"],
    ["TEST-PR-04", "Protokół płukania instalacji c.o.", "flushing", "draft", "TEST-03"],
    ["TEST-PR-05", "Próba szczelności instalacji gazowej", "gas_test", "draft", "TEST-05"],
    ["TEST-PR-06", "Pomiary wydajności wentylacji", "airflow_measurement", "draft", "TEST-04"],
    ["TEST-PR-07", "Rozruch centrali wentylacyjnej", "commissioning", "draft", "TEST-04"],
    ["TEST-PR-08", "Odbiór końcowy instalacji sanitarnych", "final_acceptance", "draft", "TEST-04"]
  ] as const;
  for (const [code, title, protocolType, status, wbsCode] of protocolSpecs) {
    const requirement = await ensureRow(db, "protocol_requirements", { workspace_id: input.workspaceId, project_id: input.projectId, title }, {
      wbs_node_id: wbs.get(wbsCode) ?? null, protocol_type: protocolType,
      trigger_rule: { when: "work_stage_complete", demo: true },
      required_evidence: ["zdjęcia", "wyniki", "podpis kierownika"], status: "required"
    });
    if (requirement.created) created += 1;
    const protocol = await ensureRow(db, "protocols", { project_id: input.projectId, generated_source_key: `demo:wysoka:${code}` }, {
      protocol_type: protocolType, title, status,
      payload: { number: code, installation: wbsCode, demo: true, result: status === "closed" ? "pozytywny" : "do uzupełnienia" },
      created_by: input.actorId
    });
    if (protocol.created) created += 1;
  }

  const requests = [
    ["TEST-WM-01", "Wniosek materiałowy — rury PP-R", "approved", ["Rura PP-R 32 PN20", "Zawór kulowy DN32"]],
    ["TEST-WM-02", "Wniosek materiałowy — kanalizacja PVC", "approved", ["Rura PVC-U 110", "Kształtki kanalizacyjne PVC"]],
    ["TEST-WM-03", "Wniosek materiałowy — wentylacja", "review", ["Kanał SPIRO Ø250", "Przepustnica Ø250"]],
    ["TEST-WM-04", "Wniosek materiałowy — izolacje", "draft", ["Izolacja kauczukowa 19 mm", "Otulina mineralna 40 mm"]]
  ] as const;
  for (const [number, title, status, items] of requests) {
    const result = await ensureRow(db, "material_requests", { project_id: input.projectId, generated_source_key: `demo:wysoka:${number}` }, {
      title, status, payload: { number, items, manufacturer: "Dane testowe", demo: true }, created_by: input.actorId
    });
    if (result.created) created += 1;
  }

  return { created, wbs, boq, boqVersionId, materials };
}
