export type DemoRow = Record<string, unknown>;

export const GUEST_PUBLIC_LOGIN = "gosc";
export const GUEST_PUBLIC_PASSWORD = "gosc";
export const GUEST_AUTH_EMAIL = "gosc@demo.project-octopus.local";
export const GUEST_AUTH_PASSWORD = "Octopus-demo-gosc-2026!";

const DAY = 86_400_000;

export function demoId(group: number, index: number) {
  const groupHex = Math.max(0, group).toString(16).padStart(6, "0").slice(-6);
  const indexHex = Math.max(0, index).toString(16).padStart(12, "0").slice(-12);
  return `de${groupHex}-0000-4000-8000-${indexHex}`;
}

export const DEMO_WORKSPACE_ID = demoId(1, 1);

function atDay(reference: Date, offset: number) {
  return new Date(reference.getTime() + offset * DAY).toISOString().slice(0, 10);
}

function atIso(reference: Date, offsetDays: number, offsetHours = 0) {
  return new Date(reference.getTime() + offsetDays * DAY + offsetHours * 3_600_000).toISOString();
}

function moneyPart(value: number, ratio: number) {
  return Math.round(value * ratio * 100) / 100;
}

type ProjectSpec = {
  name: string;
  shortName: string;
  city: string;
  investor: string;
  investorTaxId: string;
  generalContractor: string;
  contractNumber: string;
  contractValue: number;
  plannedCost: number;
  status: string;
  progress: number;
  startOffset: number;
  finishOffset: number;
  scope: string;
};

const PROJECT_SPECS: ProjectSpec[] = [
  {
    name: "Rozbudowa Żłobka Miejskiego w Obornikach – instalacje sanitarne",
    shortName: "Żłobek Oborniki",
    city: "Oborniki",
    investor: "Gmina Oborniki",
    investorTaxId: "6060008120",
    generalContractor: "DemoBud General Sp. z o.o.",
    contractNumber: "SAN/12/2026",
    contractValue: 3_250_000,
    plannedCost: 2_570_000,
    status: "active",
    progress: 0.62,
    startOffset: -145,
    finishOffset: 105,
    scope: "Instalacje wod-kan, c.o., gaz, wentylacja mechaniczna i uruchomienia."
  },
  {
    name: "Hala produkcyjna Wrzosowa – HVAC i instalacje technologiczne",
    shortName: "Hala Wrzosowa",
    city: "Września",
    investor: "Wrzosowa Industry Sp. z o.o.",
    investorTaxId: "7891782001",
    generalContractor: "Konstruktor Polska S.A.",
    contractNumber: "HVAC/04/2026",
    contractValue: 5_850_000,
    plannedCost: 4_710_000,
    status: "active",
    progress: 0.79,
    startOffset: -220,
    finishOffset: 35,
    scope: "Wentylacja przemysłowa, klimatyzacja, sprężone powietrze i instalacje grzewcze."
  },
  {
    name: "Modernizacja HVAC biurowca przy ul. Kościuszki",
    shortName: "Biurowiec Kościuszki",
    city: "Wągrowiec",
    investor: "Nova Office Sp. z o.o.",
    investorTaxId: "7661990012",
    generalContractor: "PureBuild Sp. z o.o.",
    contractNumber: "MOD/08/2026",
    contractValue: 1_480_000,
    plannedCost: 1_090_000,
    status: "active",
    progress: 0.48,
    startOffset: -92,
    finishOffset: 72,
    scope: "Wymiana central wentylacyjnych, automatyka, klimatyzacja VRF i regulacja instalacji."
  },
  {
    name: "Osiedle Zielone Tarasy – etap II",
    shortName: "Zielone Tarasy II",
    city: "Poznań",
    investor: "Tarasy Development Sp. z o.o.",
    investorTaxId: "7831840202",
    generalContractor: "Domex Development S.A.",
    contractNumber: "ZT2/SAN/2026",
    contractValue: 8_400_000,
    plannedCost: 6_930_000,
    status: "active",
    progress: 0.18,
    startOffset: -48,
    finishOffset: 260,
    scope: "Komplet instalacji sanitarnych dla 4 budynków mieszkalnych i garażu podziemnego."
  },
  {
    name: "Centrum logistyczne Gniezno – instalacje sanitarne i ppoż.",
    shortName: "Logistyka Gniezno",
    city: "Gniezno",
    investor: "North Logistics Park Sp. z o.o.",
    investorTaxId: "7842521122",
    generalContractor: "Prime Construction S.A.",
    contractNumber: "LOG/19/2025",
    contractValue: 4_620_000,
    plannedCost: 4_090_000,
    status: "active",
    progress: 0.94,
    startOffset: -310,
    finishOffset: -15,
    scope: "Instalacje wod-kan, hydrantowa, tryskaczowa, ogrzewanie hali i wentylacja."
  },
  {
    name: "Przedszkole modułowe w Pile",
    shortName: "Przedszkole Piła",
    city: "Piła",
    investor: "Miasto Piła",
    investorTaxId: "7642614167",
    generalContractor: "Moduł-System Sp. z o.o.",
    contractNumber: "PM/03/2025",
    contractValue: 1_950_000,
    plannedCost: 1_510_000,
    status: "completed",
    progress: 1,
    startOffset: -420,
    finishOffset: -120,
    scope: "Instalacje sanitarne, wentylacja, pompa ciepła i biały montaż."
  },
  {
    name: "Hotel Nad Jeziorem – rozbudowa strefy SPA",
    shortName: "Hotel SPA",
    city: "Chodzież",
    investor: "Lake Resort Sp. z o.o.",
    investorTaxId: "6070099942",
    generalContractor: "InterBuild Sp. z o.o.",
    contractNumber: "SPA/11/2026",
    contractValue: 4_200_000,
    plannedCost: 3_480_000,
    status: "planned",
    progress: 0,
    startOffset: 20,
    finishOffset: 280,
    scope: "Technologia basenowa, wentylacja, ciepło technologiczne, wod-kan i automatyka."
  },
  {
    name: "Szpital Powiatowy – modernizacja instalacji medycznych i wentylacji",
    shortName: "Szpital – etap I",
    city: "Poznań",
    investor: "Szpital Powiatowy Sp. z o.o.",
    investorTaxId: "7812017788",
    generalContractor: "MedBuild S.A.",
    contractNumber: "MED/SAN/06/2026",
    contractValue: 9_800_000,
    plannedCost: 8_050_000,
    status: "active",
    progress: 0.31,
    startOffset: -65,
    finishOffset: 190,
    scope: "Wentylacja higieniczna, woda lodowa, gazy medyczne i instalacje sanitarne."
  }
];

export type DemoBlueprint = ReturnType<typeof buildDemoBlueprint>;

export function buildDemoBlueprint(userId: string, referenceDate = new Date()) {
  const reference = new Date(referenceDate);
  reference.setUTCHours(12, 0, 0, 0);
  const workspaceId = DEMO_WORKSPACE_ID;

  const workspace: DemoRow = {
    id: workspaceId,
    name: "Octopus Demo – Instalacje i Realizacja Sp. z o.o.",
    owner_id: userId,
    tax_id: "7662007788",
    regon: "302999111",
    street: "ul. Przemysłowa 18",
    postal_code: "62-100",
    city: "Wągrowiec",
    email: "demo@project-octopus.local",
    phone: "+48 600 700 800",
    contact_person: "Gość demonstracyjny",
    industry: "Instalacje sanitarne, HVAC, realizacja inwestycji",
    notes: "Środowisko demonstracyjne. Wszystkie rekordy są przykładowe i służą do testowania Project Octopus."
  };

  const workspaceMembers: DemoRow[] = [{ workspace_id: workspaceId, user_id: userId, role: "owner" }];
  const projects: DemoRow[] = [];
  const projectFacts: DemoRow[] = [];
  const materials: DemoRow[] = [];
  const devices: DemoRow[] = [];
  const boqVersions: DemoRow[] = [];
  const wbsNodes: DemoRow[] = [];
  const boqItems: DemoRow[] = [];
  const projectRequirements: DemoRow[] = [];
  const materialRequests: DemoRow[] = [];
  const protocolRequirements: DemoRow[] = [];
  const protocols: DemoRow[] = [];
  const scheduleBaselines: DemoRow[] = [];
  const scheduleActivities: DemoRow[] = [];
  const progressPeriods: DemoRow[] = [];
  const progressEntries: DemoRow[] = [];
  const changeOrders: DemoRow[] = [];
  const aiFindings: DemoRow[] = [];
  const siteEvents: DemoRow[] = [];
  const evidenceRequirements: DemoRow[] = [];
  const closeoutRequirements: DemoRow[] = [];
  const documentChangeImpacts: DemoRow[] = [];
  const budgets: DemoRow[] = [];
  const forecastSnapshots: DemoRow[] = [];

  PROJECT_SPECS.forEach((spec, projectIndex) => {
    const n = projectIndex + 1;
    const projectId = demoId(10, n);
    const startDate = atDay(reference, spec.startOffset);
    const finishDate = atDay(reference, spec.finishOffset);
    const actualCost = moneyPart(spec.plannedCost, Math.min(1, spec.progress * 0.92));
    const committedCost = spec.status === "completed" ? 0 : moneyPart(spec.plannedCost, Math.max(0.04, 0.18 - spec.progress * 0.08));
    const estimateToComplete = Math.max(0, spec.plannedCost - actualCost);
    const estimateAtCompletion = actualCost + estimateToComplete;

    projects.push({
      id: projectId,
      workspace_id: workspaceId,
      name: spec.name,
      description: spec.scope,
      investor_name: spec.investor,
      general_contractor: spec.generalContractor,
      location: spec.city,
      status: spec.status,
      created_by: userId
    });

    projectFacts.push({
      id: demoId(11, n),
      project_id: projectId,
      fact_type: "project_profile",
      value_text: spec.shortName,
      value_json: {
        projectName: spec.name,
        status: spec.status,
        shortName: spec.shortName,
        projectType: "Instalacje sanitarne / HVAC",
        description: spec.scope,
        street: projectIndex % 2 === 0 ? "ul. Inwestycyjna 12" : "ul. Budowlana 7",
        postalCode: projectIndex % 3 === 0 ? "62-100" : "60-101",
        city: spec.city,
        municipality: spec.city,
        county: spec.city,
        voivodeship: "wielkopolskie",
        plotNumbers: `${100 + n}/${2 + n}`,
        buildingPermit: `AB.${120 + n}.2026`,
        contractNumber: spec.contractNumber,
        contractDate: atDay(reference, spec.startOffset - 28),
        startDate,
        completionDate: finishDate,
        warrantyEndDate: atDay(reference, spec.finishOffset + 1095),
        contractValue: String(spec.contractValue),
        currency: "PLN",
        fundingSource: projectIndex % 2 === 0 ? "Środki własne inwestora" : "Finansowanie bankowe / środki własne",
        contractScope: spec.scope,
        investorName: spec.investor,
        investorAddress: `${spec.city}, ul. Inwestora ${n}`,
        investorTaxId: spec.investorTaxId,
        investorRepresentative: `Anna Inwestor ${n}`,
        investorEmail: `inwestor${n}@example.pl`,
        investorPhone: `+48 510 20${n} 30${n}`,
        generalContractorName: spec.generalContractor,
        generalContractorAddress: "Poznań, ul. Generalna 10",
        generalContractorTaxId: `78318${1000 + n}`,
        generalContractorRepresentative: `Marek Kontrakt ${n}`,
        designerName: `Projekt Sanitarny ${n} Sp. z o.o.`,
        designerAddress: "Poznań, ul. Projektowa 4",
        contractEngineerName: `Piotr Inżynier ${n}`,
        supervisionInspectorName: `Jan Inspektor ${n}`,
        supervisionInspectorBranch: "sanitarna",
        supervisionInspectorEmail: `inspektor${n}@example.pl`,
        supervisionInspectorPhone: `+48 501 40${n} 50${n}`,
        siteManagerName: `Krzysztof Kierownik ${n}`,
        siteManagerEmail: `kierownik${n}@example.pl`,
        siteManagerPhone: `+48 502 60${n} 70${n}`,
        sanitaryWorksManagerName: `Tomasz Sanitarny ${n}`,
        sanitaryWorksManagerEmail: `sanitarny${n}@example.pl`,
        sanitaryWorksManagerPhone: `+48 503 80${n} 90${n}`,
        electricalWorksManagerName: `Adam Elektryk ${n}`,
        electricalWorksManagerEmail: `elektryk${n}@example.pl`,
        electricalWorksManagerPhone: `+48 504 10${n} 20${n}`,
        notes: projectIndex === 4 ? "Termin kontraktowy przekroczony – trwają odbiory i uzgodnienie roszczenia terminowego." : "Dane demonstracyjne do testów przepływów Project Octopus."
      },
      confidence: 1,
      status: "approved",
      approved_by: userId,
      approved_at: atIso(reference, -20 + n)
    });

    const boqVersionId = demoId(12, n);
    boqVersions.push({
      id: boqVersionId,
      workspace_id: workspaceId,
      project_id: projectId,
      version_number: 1,
      name: `Kosztorys bazowy – ${spec.shortName}`,
      status: "approved",
      currency: "PLN",
      net_value: moneyPart(spec.contractValue, 0.91),
      gross_value: moneyPart(spec.contractValue, 1.1193),
      valid_from: startDate,
      approved_by: userId,
      approved_at: atIso(reference, spec.startOffset + 12)
    });

    const scheduleBaselineId = demoId(13, n);
    scheduleBaselines.push({
      id: scheduleBaselineId,
      workspace_id: workspaceId,
      project_id: projectId,
      version_number: 1,
      name: `Harmonogram bazowy – ${spec.shortName}`,
      start_date: startDate,
      finish_date: finishDate,
      status: "approved",
      approved_by: userId,
      approved_at: atIso(reference, spec.startOffset + 7)
    });

    const wbsNames = [
      ["10", "Przygotowanie i dokumentacja", "Dokumentacja"],
      ["20", "Instalacje wodociągowe i kanalizacyjne", "Wod-Kan"],
      ["30", "Instalacje grzewcze i chłodnicze", "C.O./Chłód"],
      ["40", "Wentylacja i klimatyzacja", "Wentylacja"],
      ["50", "Próby, regulacja i odbiory", "Odbiory"]
    ];

    wbsNames.forEach(([code, name, installation], wbsIndex) => {
      const wbsId = demoId(14 + n, wbsIndex + 1);
      wbsNodes.push({
        id: wbsId,
        workspace_id: workspaceId,
        project_id: projectId,
        code,
        name,
        branch: "sanitarna",
        installation,
        zone: wbsIndex < 2 ? "Budynek A" : "Cały obiekt",
        sort_order: (wbsIndex + 1) * 10,
        status: "active"
      });

      const plannedStartOffset = spec.startOffset + Math.round((spec.finishOffset - spec.startOffset) * (wbsIndex * 0.16));
      const plannedFinishOffset = spec.startOffset + Math.round((spec.finishOffset - spec.startOffset) * (0.22 + wbsIndex * 0.16));
      const phaseProgress = Math.max(0, Math.min(1, spec.progress * 1.35 - wbsIndex * 0.16));
      scheduleActivities.push({
        id: demoId(30 + n, wbsIndex + 1),
        workspace_id: workspaceId,
        project_id: projectId,
        schedule_baseline_id: scheduleBaselineId,
        wbs_node_id: wbsId,
        code: `H-${code}`,
        title: name,
        planned_start: atDay(reference, plannedStartOffset),
        planned_finish: atDay(reference, plannedFinishOffset),
        actual_start: phaseProgress > 0 ? atDay(reference, plannedStartOffset + 2) : null,
        actual_finish: phaseProgress >= 1 ? atDay(reference, plannedFinishOffset - 3) : null,
        planned_progress: Math.min(1, spec.progress + 0.06),
        actual_progress: phaseProgress,
        critical: wbsIndex === 3 || wbsIndex === 4,
        constraint_note: wbsIndex === 3 && projectIndex === 1 ? "Oczekiwanie na dostawę centrali AHU-2." : null,
        status: phaseProgress >= 1 ? "completed" : phaseProgress > 0 ? "active" : "planned"
      });
    });

    const itemBlueprint = [
      ["1.1", "Rurociąg PP-R PN20 wraz z kształtkami", 820 + n * 25, "m", 74],
      ["1.2", "Rurociąg kanalizacji niskoszumowej", 460 + n * 12, "m", 118],
      ["2.1", "Rurociąg stalowy instalacji grzewczej", 620 + n * 18, "m", 132],
      ["2.2", "Izolacja kauczukowa przewodów", 730 + n * 21, "m", 58],
      ["3.1", "Kanały wentylacyjne z blachy ocynkowanej", 1850 + n * 45, "m2", 176],
      ["3.2", "Centrala wentylacyjna z automatyką", 2 + (n % 3), "kpl", 128000]
    ] as const;

    itemBlueprint.forEach(([itemNumber, description, quantity, unit, unitPrice], itemIndex) => {
      const wbsSlot = itemIndex === 0 || itemIndex === 1 ? 1 : itemIndex === 2 || itemIndex === 3 ? 2 : 3;
      const wbsId = demoId(14 + n, wbsSlot + 1);
      const itemId = demoId(50 + n, itemIndex + 1);
      const executed = spec.status === "planned" ? 0 : Math.round(Number(quantity) * Math.min(1, spec.progress * (1.12 - itemIndex * 0.035)) * 100) / 100;
      const accepted = spec.status === "completed" ? Number(quantity) : Math.round(executed * (projectIndex === 4 ? 0.96 : 0.98) * 100) / 100;
      boqItems.push({
        id: itemId,
        project_id: projectId,
        item_number: itemNumber,
        description,
        quantity,
        unit,
        unit_price: unitPrice,
        total_price: Number(quantity) * Number(unitPrice),
        boq_version_id: boqVersionId,
        wbs_node_id: wbsId,
        cost_code: `SAN-${itemNumber.replace(".", "")}`,
        quantity_executed: executed,
        quantity_accepted: accepted
      });
    });

    materials.push(
      { id: demoId(70 + n, 1), project_id: projectId, name: "Rury PP-R PN20", installation: "Wod-Kan", specification: "SDR6 / PN20" },
      { id: demoId(70 + n, 2), project_id: projectId, name: "Izolacja kauczukowa 25 mm", installation: "C.O./Chłód", specification: "lambda ≤ 0,036 W/mK" },
      { id: demoId(70 + n, 3), project_id: projectId, name: "Kanały wentylacyjne ocynkowane", installation: "Wentylacja", specification: "klasa szczelności B" }
    );
    devices.push(
      { id: demoId(80 + n, 1), project_id: projectId, name: `Centrala wentylacyjna AHU-${n}`, installation: "Wentylacja", parameters: { airflow_m3h: 12500 + n * 600, heat_recovery: "rotor", efficiency: 0.81 } },
      { id: demoId(80 + n, 2), project_id: projectId, name: `Pompa obiegowa P-${n}`, installation: "C.O.", parameters: { flow_m3h: 18 + n, head_kpa: 62, control: "VFD" } }
    );

    projectRequirements.push(
      { id: demoId(90 + n, 1), workspace_id: workspaceId, project_id: projectId, requirement_type: "material_application", title: "Wniosek materiałowy – rury i kształtki", description: "Zatwierdzenie producenta przed zamówieniem.", source_locator: { source: "demo" }, status: spec.progress > 0.25 ? "approved" : "proposed", confidence: 0.98 },
      { id: demoId(90 + n, 2), workspace_id: workspaceId, project_id: projectId, requirement_type: "coordination", title: "Koordynacja tras instalacyjnych", description: "Potwierdzić kolizje nad sufitem i szachty.", source_locator: { source: "demo" }, status: spec.progress > 0.5 ? "approved" : "proposed", confidence: 0.94 },
      { id: demoId(90 + n, 3), workspace_id: workspaceId, project_id: projectId, requirement_type: "acceptance", title: "Plan prób i odbiorów", description: "Uzgodnić kolejność prób szczelności i regulacji.", source_locator: { source: "demo" }, status: spec.status === "completed" ? "approved" : "proposed", confidence: 0.96 }
    );

    materialRequests.push(
      { id: demoId(100 + n, 1), project_id: projectId, title: "Wniosek materiałowy WM-01 – system rurowy", status: spec.progress > 0.2 ? "approved" : "draft", payload: { manufacturer: "DemoPipe", system: "PP-R PN20", quantity: "wg BOQ", installation: "wod-kan" }, created_by: userId },
      { id: demoId(100 + n, 2), project_id: projectId, title: "Wniosek materiałowy WM-02 – izolacja", status: spec.progress > 0.45 ? "approved" : "review", payload: { manufacturer: "DemoInsul", thickness: "25 mm", installation: "c.o./chłód" }, created_by: userId }
    );

    protocolRequirements.push(
      { id: demoId(110 + n, 1), workspace_id: workspaceId, project_id: projectId, protocol_type: "pressure_test", title: "Próba szczelności instalacji wodociągowej", trigger_rule: { wbs: "20" }, required_evidence: ["manometr", "zdjęcia"], status: "required" },
      { id: demoId(110 + n, 2), workspace_id: workspaceId, project_id: projectId, protocol_type: "pressure_test", title: "Próba ciśnieniowa instalacji grzewczej", trigger_rule: { wbs: "30" }, required_evidence: ["manometr", "protokół"], status: "required" },
      { id: demoId(110 + n, 3), workspace_id: workspaceId, project_id: projectId, protocol_type: "air_balance", title: "Pomiary i regulacja instalacji wentylacji", trigger_rule: { wbs: "40" }, required_evidence: ["pomiary", "raport"], status: "required" }
    );

    protocols.push(
      { id: demoId(120 + n, 1), project_id: projectId, protocol_type: "pressure_test", title: "Próba szczelności – piony wodociągowe", status: spec.progress > 0.42 ? "closed" : "draft", payload: { pressure_bar: 10, duration_min: 60, result: spec.progress > 0.42 ? "pozytywny" : "do wykonania" }, created_by: userId },
      { id: demoId(120 + n, 2), project_id: projectId, protocol_type: "hidden_works", title: "Odbiór robót zanikowych – poziomy kanalizacji", status: spec.progress > 0.58 ? "closed" : "draft", payload: { result: spec.progress > 0.58 ? "odebrano" : "oczekuje", photos: 6 }, created_by: userId }
    );

    projectRequirements.push();

    const progressPeriodId = demoId(130, n);
    if (spec.status !== "planned") {
      progressPeriods.push({
        id: progressPeriodId,
        workspace_id: workspaceId,
        project_id: projectId,
        boq_version_id: boqVersionId,
        period_start: atDay(reference, -30),
        period_end: atDay(reference, 0),
        status: spec.status === "completed" ? "accepted" : "open"
      });
      boqItems.filter((row) => row.project_id === projectId).slice(0, 4).forEach((item, itemIndex) => {
        const quantityExecuted = Number(item.quantity_executed ?? 0);
        const quantityAccepted = Number(item.quantity_accepted ?? 0);
        const unitPrice = Number(item.unit_price ?? 0);
        progressEntries.push({
          id: demoId(140 + n, itemIndex + 1),
          workspace_id: workspaceId,
          project_id: projectId,
          progress_period_id: progressPeriodId,
          boq_item_id: item.id,
          quantity_executed: quantityExecuted,
          quantity_accepted: quantityAccepted,
          value_executed: moneyPart(quantityExecuted * unitPrice, 1),
          value_accepted: moneyPart(quantityAccepted * unitPrice, 1),
          status: spec.status === "completed" ? "accepted" : "accepted",
          evidence: [{ type: "demo", label: "Zdjęcia i protokół roboczy" }]
        });
      });
    }

    if (projectIndex === 1 || projectIndex === 4 || projectIndex === 7) {
      changeOrders.push({
        id: demoId(150, n),
        workspace_id: workspaceId,
        project_id: projectId,
        number: `ZZ-${n}/2026`,
        title: projectIndex === 4 ? "Roszczenie terminowe – opóźnione przekazanie frontu" : "Zmiana zakresu instalacji i tras",
        description: "Zmiana przykładowa do testowania wpływu na koszt i termin.",
        status: projectIndex === 4 ? "identified" : "approved",
        value_change: projectIndex === 4 ? 185000 : 92000 + n * 6000,
        days_change: projectIndex === 4 ? 21 : 7
      });
    }

    aiFindings.push(
      { id: demoId(160 + n, 1), project_id: projectId, finding_type: "risk", severity: projectIndex === 4 ? "critical" : "warning", title: projectIndex === 4 ? "Termin kontraktowy przekroczony" : "Ryzyko kolizji harmonogramu dostaw", description: projectIndex === 4 ? "Odbiory trwają po terminie umownym. Zweryfikuj roszczenie i ścieżkę krytyczną." : "Dostawa części materiałów jest blisko planowanej daty montażu." },
      { id: demoId(160 + n, 2), project_id: projectId, finding_type: "quality", severity: "info", title: "Kontrola kompletności dokumentacji", description: "Octopus wykrył materiały i protokoły wymagające powiązania ze źródłem." }
    );

    if (spec.status !== "planned") {
      siteEvents.push(
        { id: demoId(170 + n, 1), workspace_id: workspaceId, project_id: projectId, event_type: "daily_log", title: "Odprawa i koordynacja robót sanitarnych", description: "Uzgodniono front robót, dostawy i kolejność prób.", captured_at: atIso(reference, -2, -3), location_label: "Zaplecze budowy", weather_snapshot: { temp_c: 22, conditions: "bez opadów" }, attachments: [], ai_suggestion: { action: "monitor" }, status: "approved", captured_by: userId, approved_by: userId, approved_at: atIso(reference, -2, -2) },
        { id: demoId(170 + n, 2), workspace_id: workspaceId, project_id: projectId, event_type: "issue", title: "Kolizja instalacji nad korytarzem", description: "Do uzgodnienia z branżą elektryczną i konstrukcyjną.", captured_at: atIso(reference, -1, -4), location_label: "Budynek A / poziom +1", attachments: [], ai_suggestion: { action: "create_task", priority: "high" }, status: projectIndex % 2 === 0 ? "draft" : "approved", captured_by: userId }
      );
    }

    const evidenceStatus = spec.progress > 0.7 ? "accepted" : spec.progress > 0.3 ? "submitted" : "missing";
    evidenceRequirements.push(
      { id: demoId(180 + n, 1), workspace_id: workspaceId, project_id: projectId, evidence_type: "photo", title: "Zdjęcia robót zanikowych", required: true, status: evidenceStatus, fulfilled_by_type: evidenceStatus === "missing" ? null : "site_event", fulfilled_by_id: evidenceStatus === "missing" ? null : demoId(170 + n, 1), due_at: atIso(reference, 14) },
      { id: demoId(180 + n, 2), workspace_id: workspaceId, project_id: projectId, evidence_type: "protocol", title: "Protokół próby szczelności", required: true, status: spec.progress > 0.55 ? "accepted" : "missing", due_at: atIso(reference, 28) },
      { id: demoId(180 + n, 3), workspace_id: workspaceId, project_id: projectId, evidence_type: "certificate", title: "Deklaracje i atesty materiałowe", required: true, status: spec.progress > 0.4 ? "submitted" : "missing", due_at: atIso(reference, 21) }
    );

    const closeoutItems = [
      ["Dokumentacja", "Dokumentacja powykonawcza"],
      ["Materiały", "Zatwierdzone wnioski i atesty"],
      ["Jakość", "Protokoły prób i pomiarów"],
      ["Odbiory", "Rejestr usterek i potwierdzenie usunięcia"],
      ["Gwarancje", "Gwarancje, DTR i instrukcje"]
    ];
    closeoutItems.forEach(([category, title], closeIndex) => {
      const threshold = 0.68 + closeIndex * 0.065;
      closeoutRequirements.push({
        id: demoId(190 + n, closeIndex + 1),
        workspace_id: workspaceId,
        project_id: projectId,
        category,
        title,
        required: true,
        status: spec.status === "completed" || spec.progress >= threshold ? "complete" : spec.progress >= threshold - 0.15 ? "in_progress" : "missing",
        owner_id: userId,
        due_at: atIso(reference, spec.finishOffset - 10 + closeIndex * 2)
      });
    });

    if (projectIndex === 0 || projectIndex === 1 || projectIndex === 4) {
      const documentId = demoId(300, projectIndex + 1);
      documentChangeImpacts.push({
        id: demoId(200, n),
        workspace_id: workspaceId,
        project_id: projectId,
        document_id: documentId,
        to_version_id: demoId(301, projectIndex + 1),
        impact_type: "scope_change",
        target_type: "wbs",
        summary: "Rewizja dokumentacji zmienia trasę instalacji i zakres materiałowy.",
        risk_level: projectIndex === 4 ? "high" : "medium",
        evidence: [{ source: "demo" }],
        status: "proposed"
      });
    }

    budgets.push({
      id: demoId(210, n),
      workspace_id: workspaceId,
      project_id: projectId,
      name: "Budżet bazowy",
      version_number: 1,
      status: "active",
      currency: "PLN",
      total_revenue: spec.contractValue,
      total_cost: spec.plannedCost
    });

    forecastSnapshots.push({
      id: demoId(220, n),
      workspace_id: workspaceId,
      project_id: projectId,
      forecast_date: atDay(reference, 0),
      status: "approved",
      forecast_finish_date: finishDate,
      contract_value: spec.contractValue,
      actual_cost: actualCost,
      committed_cost: committedCost,
      estimate_to_complete: estimateToComplete,
      estimate_at_completion: estimateAtCompletion,
      forecast_margin: spec.contractValue - estimateAtCompletion,
      assumptions: ["Dane demonstracyjne", "EAC oparty o plan kosztu i bieżący postęp"],
      source_snapshot: { demo: true, progress: spec.progress },
      created_by: userId
    });
  });

  const documents: DemoRow[] = PROJECT_SPECS.flatMap((spec, projectIndex) => {
    const projectId = demoId(10, projectIndex + 1);
    const categories = ["technical", "invoice", "contract", "protocol"];
    return categories.map((category, categoryIndex) => ({
      id: demoId(300 + projectIndex, categoryIndex + 1),
      workspace_id: workspaceId,
      project_id: projectId,
      name: categoryIndex === 0 ? `Projekt wykonawczy IS – ${spec.shortName}.pdf` : categoryIndex === 1 ? `Faktura kosztowa – ${spec.shortName} – ${categoryIndex + 1}.pdf` : categoryIndex === 2 ? `Umowa i aneksy – ${spec.shortName}.pdf` : `Protokoły częściowe – ${spec.shortName}.pdf`,
      category,
      ai_status: categoryIndex === 1 && projectIndex === 1 ? "review" : categoryIndex === 3 && projectIndex === 4 ? "error" : "ready",
      ai_confidence: categoryIndex === 1 ? 0.86 : 0.97,
      review_status: categoryIndex === 1 && projectIndex === 1 ? "pending" : "approved",
      effective_status: "current",
      created_by: userId,
      created_at: atIso(reference, -45 + projectIndex * 2 + categoryIndex),
      updated_at: atIso(reference, -4 + categoryIndex)
    }));
  });

  documents.push(
    { id: demoId(399, 1), workspace_id: workspaceId, project_id: null, name: "Polityka zakupowa firmy – DEMO.pdf", category: "template", ai_status: "ready", ai_confidence: 0.99, review_status: "approved", effective_status: "current", created_by: userId },
    { id: demoId(399, 2), workspace_id: workspaceId, project_id: null, name: "Wzór protokołu próby szczelności – DEMO.docx", category: "template", ai_status: "ready", ai_confidence: 0.98, review_status: "approved", effective_status: "current", created_by: userId }
  );

  const documentIntakes: DemoRow[] = documents
    .filter((document) => document.ai_status === "review" || document.ai_status === "error")
    .map((document, index) => ({
      id: demoId(400, index + 1),
      workspace_id: workspaceId,
      document_id: document.id,
      proposed_project_id: document.project_id,
      channel: "company_upload",
      status: document.ai_status === "error" ? "error" : "review",
      suggested_category: document.category,
      confidence: document.ai_confidence,
      decision_note: "Przykładowy element wymagający decyzji użytkownika.",
      created_by: userId,
      created_at: atIso(reference, -1, -index)
    }));

  const counterparties: DemoRow[] = [
    ["Hydro-System Sp. z o.o.", "7792481101", "supplier"],
    ["Went-Projekt S.A.", "7831812299", "supplier"],
    ["KlimaTech Polska Sp. z o.o.", "5213900021", "supplier"],
    ["Instal-Mat Hurt Sp. z o.o.", "9721267444", "supplier"],
    ["Serwis Pomp Wielkopolska", "7661770033", "subcontractor"],
    ["Izolacje Techniczne Pro", "7811988870", "subcontractor"],
    ["DemoBud General Sp. z o.o.", "7812011001", "customer"],
    ["Konstruktor Polska S.A.", "7831844402", "customer"],
    ["Domex Development S.A.", "7792467770", "customer"],
    ["MedBuild S.A.", "5252789080", "customer"]
  ].map(([name, taxId, role], index) => ({ id: demoId(500, index + 1), workspace_id: workspaceId, name, tax_id: taxId, role, active: true }));

  const invoices: DemoRow[] = [];
  const invoiceLines: DemoRow[] = [];
  const payments: DemoRow[] = [];
  const financialAllocations: DemoRow[] = [];
  const commitments: DemoRow[] = [];

  for (let index = 0; index < 20; index += 1) {
    const isSale = index % 4 === 0;
    const projectIndex = index % PROJECT_SPECS.length;
    const projectId = demoId(10, projectIndex + 1);
    const counterpartyId = demoId(500, isSale ? 7 + (index % 4) : 1 + (index % 6));
    const invoiceId = demoId(510, index + 1);
    const net = isSale ? 165000 + index * 19000 : 28500 + index * 7400;
    const tax = moneyPart(net, 0.23);
    const gross = net + tax;
    const paid = index % 5 === 1 ? 0 : index % 3 === 0 ? moneyPart(gross, 0.5) : gross;
    invoices.push({
      id: invoiceId,
      workspace_id: workspaceId,
      counterparty_id: counterpartyId,
      invoice_number: `${isSale ? "FV-S" : "FV-Z"}/${String(index + 1).padStart(3, "0")}/2026`,
      direction: isSale ? "sale" : "purchase",
      issue_date: atDay(reference, -60 + index * 3),
      sale_date: atDay(reference, -61 + index * 3),
      due_date: atDay(reference, -32 + index * 3),
      currency: "PLN",
      net_amount: net,
      tax_amount: tax,
      gross_amount: gross,
      paid_amount: paid,
      status: paid >= gross ? "paid" : isSale ? "issued" : "received"
    });
    invoiceLines.push({
      id: demoId(520, index + 1),
      workspace_id: workspaceId,
      invoice_id: invoiceId,
      line_number: 1,
      description: isSale ? `Przerób robót – ${PROJECT_SPECS[projectIndex].shortName}` : ["Materiały instalacyjne", "Kanały i kształtki wentylacyjne", "Armatura i zawory", "Usługa podwykonawcza"][index % 4],
      quantity: isSale ? 1 : 5 + (index % 9),
      unit: isSale ? "kpl" : "szt",
      unit_price: net / (isSale ? 1 : 5 + (index % 9)),
      net_amount: net,
      tax_rate: 23,
      gross_amount: gross
    });
    financialAllocations.push({
      id: demoId(530, index + 1),
      workspace_id: workspaceId,
      project_id: projectId,
      source_type: "invoice",
      source_id: invoiceId,
      amount: net,
      status: "approved"
    });
    if (paid > 0) {
      payments.push({
        id: demoId(540, index + 1),
        workspace_id: workspaceId,
        invoice_id: invoiceId,
        payment_date: atDay(reference, -25 + index * 2),
        amount: paid,
        currency: "PLN",
        bank_reference: `DEMO-PAY-${String(index + 1).padStart(4, "0")}`,
        status: "confirmed"
      });
    }
  }

  PROJECT_SPECS.forEach((spec, index) => {
    if (spec.status === "completed") return;
    commitments.push(
      { id: demoId(550 + index, 1), workspace_id: workspaceId, project_id: demoId(10, index + 1), counterparty_id: demoId(500, 1 + (index % 6)), source_type: "purchase_order", description: "Dostawa materiałów instalacyjnych – następny etap", amount: 42000 + index * 7800, expected_date: atDay(reference, 7 + index * 2), status: "open" },
      { id: demoId(550 + index, 2), workspace_id: workspaceId, project_id: demoId(10, index + 1), counterparty_id: demoId(500, 5), source_type: "subcontract", description: "Podwykonawstwo i uruchomienia", amount: 28000 + index * 5100, expected_date: atDay(reference, 18 + index * 3), status: index % 3 === 0 ? "approved" : "open" }
    );
  });

  const employeeSpecs = [
    ["E001", "Michał", "Nowak", "Kierownik robót sanitarnych", 18800, 118],
    ["E002", "Paweł", "Kowalski", "Inżynier budowy", 14200, 89],
    ["E003", "Tomasz", "Wiśniewski", "Brygadzista instalacji", 12800, 80],
    ["E004", "Kamil", "Zieliński", "Monter instalacji", 10200, 64],
    ["E005", "Adam", "Lewandowski", "Monter instalacji", 10100, 63],
    ["E006", "Karol", "Wójcik", "Monter wentylacji", 10400, 65],
    ["E007", "Jakub", "Kamiński", "Serwisant HVAC", 11800, 74],
    ["E008", "Łukasz", "Dąbrowski", "Magazynier", 8900, 56],
    ["E009", "Monika", "Kaczmarek", "Specjalista ds. zakupów", 11200, 70],
    ["E010", "Anna", "Mazur", "Koordynator dokumentacji", 10900, 68],
    ["E011", "Piotr", "Król", "Kierowca / logistyk", 9400, 59],
    ["E012", "Natalia", "Pawlak", "Kontroler finansowy", 13600, 85]
  ] as const;
  const employees: DemoRow[] = [];
  const employments: DemoRow[] = [];
  const qualifications: DemoRow[] = [];
  const medicalExams: DemoRow[] = [];
  const leaveRequests: DemoRow[] = [];
  const timesheets: DemoRow[] = [];
  const assignments: DemoRow[] = [];

  employeeSpecs.forEach(([employeeNumber, firstName, lastName, position, monthlyCost, hourlyCost], index) => {
    const employeeId = demoId(600, index + 1);
    employees.push({ id: employeeId, workspace_id: workspaceId, employee_number: employeeNumber, first_name: firstName, last_name: lastName, email: `${firstName.toLowerCase()}.${lastName.toLowerCase()}@octopus-demo.pl`, phone: `+48 690 ${String(100 + index).slice(-3)} ${String(200 + index).slice(-3)}`, status: "active", hired_at: atDay(reference, -650 + index * 21) });
    employments.push({ id: demoId(610, index + 1), workspace_id: workspaceId, employee_id: employeeId, employment_type: index < 8 ? "employment_contract" : "b2b", position, valid_from: atDay(reference, -520 + index * 12), full_time_equivalent: 1, monthly_cost: monthlyCost, hourly_cost: hourlyCost, currency: "PLN" });
    qualifications.push({ id: demoId(620, index + 1), workspace_id: workspaceId, employee_id: employeeId, qualification_type: index < 3 ? "Uprawnienia budowlane sanitarne" : index < 8 ? "Szkolenie BHP / prace instalacyjne" : "Szkolenie stanowiskowe", number: `UPR/${2020 + index}/${100 + index}`, issued_at: atDay(reference, -900 + index * 25), valid_until: index === 4 ? atDay(reference, 18) : index === 6 ? atDay(reference, -4) : atDay(reference, 240 + index * 11), status: index === 6 ? "expired" : "valid" });
    medicalExams.push({ id: demoId(630, index + 1), workspace_id: workspaceId, employee_id: employeeId, exam_type: "Badania okresowe", examined_at: atDay(reference, -260 + index * 7), valid_until: index === 2 ? atDay(reference, 12) : atDay(reference, 180 + index * 9), status: "valid" });
    if (index === 1 || index === 8) leaveRequests.push({ id: demoId(640, index + 1), workspace_id: workspaceId, employee_id: employeeId, leave_type: "annual", date_from: atDay(reference, 20 + index), date_to: atDay(reference, 24 + index), days: 5, status: "pending" });

    for (let dayIndex = 0; dayIndex < 5; dayIndex += 1) {
      const projectIndex = (index + dayIndex) % 6;
      timesheets.push({ id: demoId(650 + index, dayIndex + 1), workspace_id: workspaceId, employee_id: employeeId, project_id: demoId(10, projectIndex + 1), work_date: atDay(reference, -dayIndex - 1), hours: 8, overtime_hours: dayIndex === 0 && index % 4 === 0 ? 1.5 : 0, status: dayIndex === 0 && index % 3 === 0 ? "submitted" : "approved", approved_by: dayIndex === 0 && index % 3 === 0 ? null : userId });
    }
  });

  PROJECT_SPECS.slice(0, 6).forEach((spec, projectIndex) => {
    for (let assignmentIndex = 0; assignmentIndex < 4; assignmentIndex += 1) {
      const employeeIndex = (projectIndex * 2 + assignmentIndex) % employeeSpecs.length;
      assignments.push({ id: demoId(700 + projectIndex, assignmentIndex + 1), workspace_id: workspaceId, employee_id: demoId(600, employeeIndex + 1), project_id: demoId(10, projectIndex + 1), role: assignmentIndex === 0 ? "Kierownik / koordynator" : assignmentIndex === 1 ? "Inżynier / brygadzista" : "Wykonawca", date_from: atDay(reference, spec.startOffset), date_to: atDay(reference, spec.finishOffset), allocation_percent: assignmentIndex === 0 ? 60 : 100, status: "approved" });
    }
  });

  const warehouses: DemoRow[] = [
    { id: demoId(800, 1), workspace_id: workspaceId, name: "Magazyn centralny", location: "Wągrowiec – ul. Przemysłowa 18", warehouse_type: "central", active: true },
    { id: demoId(800, 2), workspace_id: workspaceId, name: "Magazyn budowy – Oborniki", location: "Oborniki – plac budowy", warehouse_type: "project", active: true },
    { id: demoId(800, 3), workspace_id: workspaceId, name: "Magazyn mobilny / BUS 1", location: "Flota", warehouse_type: "vehicle", active: true }
  ];
  const itemSpecs = [
    ["RUR-PPR-25", "Rura PP-R 25 PN20", "material", "m", 150],
    ["RUR-PPR-32", "Rura PP-R 32 PN20", "material", "m", 120],
    ["KAN-110", "Rura kanalizacyjna 110 niskoszumowa", "material", "m", 80],
    ["IZO-25", "Izolacja kauczukowa 25 mm", "material", "m", 100],
    ["ZAW-DN25", "Zawór kulowy DN25", "material", "szt", 20],
    ["ZAW-DN50", "Zawór regulacyjny DN50", "material", "szt", 8],
    ["KAN-WENT", "Kanał wentylacyjny – arkusz / element", "material", "m2", 200],
    ["PRZ-250", "Przepustnica okrągła fi250", "material", "szt", 12],
    ["ANEM-01", "Anemostat nawiewny", "material", "szt", 24],
    ["POM-25", "Pompa obiegowa 25-80", "device", "szt", 2],
    ["MAN-WIKA", "Manometr sprężynowy WIKA", "tool", "szt", 2],
    ["TESTO417", "Anemometr Testo 417", "tool", "szt", 1],
    ["ZGRZ-63", "Zgrzewarka PP-R do 63 mm", "tool", "szt", 2],
    ["DRAB-3M", "Drabina aluminiowa 3 m", "tool", "szt", 3],
    ["FIL-VENT", "Filtr do centrali wentylacyjnej", "material", "kpl", 6],
    ["GLIKOL", "Glikol propylenowy", "material", "l", 120]
  ] as const;
  const stockItems: DemoRow[] = itemSpecs.map(([sku, name, itemType, unit, minimumStock], index) => ({ id: demoId(810, index + 1), workspace_id: workspaceId, sku, name, item_type: itemType, unit, minimum_stock: minimumStock, serial_tracking: itemType === "tool", active: true }));
  const stockMovements: DemoRow[] = [];
  const stockMovementLines: DemoRow[] = [];
  const reservations: DemoRow[] = [];
  const materialChainEvents: DemoRow[] = [];

  itemSpecs.forEach(([, name, , unit], index) => {
    const movementId = demoId(820, index + 1);
    const quantity = index < 9 ? 240 + index * 35 : 6 + index;
    stockMovements.push({ id: movementId, workspace_id: workspaceId, project_id: null, warehouse_id: demoId(800, 1), target_warehouse_id: null, movement_type: "PZ", document_number: `PZ/DEMO/${String(index + 1).padStart(3, "0")}`, movement_date: atDay(reference, -42 + index), status: "approved", created_by: userId });
    stockMovementLines.push({ id: demoId(830, index + 1), workspace_id: workspaceId, movement_id: movementId, stock_item_id: demoId(810, index + 1), quantity, unit_cost: 18 + index * 12.5, lot_number: `LOT-${1000 + index}` });
    if (index < 10) {
      const projectIndex = index % 5;
      reservations.push({ id: demoId(840, index + 1), workspace_id: workspaceId, project_id: demoId(10, projectIndex + 1), warehouse_id: demoId(800, 1), stock_item_id: demoId(810, index + 1), quantity: Math.max(2, Math.round(quantity * 0.16)), required_at: atDay(reference, 4 + index * 2), status: index % 4 === 0 ? "shortage" : "open" });
      materialChainEvents.push({ id: demoId(850, index + 1), workspace_id: workspaceId, project_id: demoId(10, projectIndex + 1), stock_item_id: demoId(810, index + 1), stage: "reserved", source_type: "reservation", source_id: demoId(840, index + 1), quantity: Math.max(2, Math.round(quantity * 0.16)), unit, amount: Math.round(quantity * 0.16) * (18 + index * 12.5), status: "confirmed", occurred_at: atIso(reference, -3 + index * 0.1), created_by: userId, note: name });
    }
  });

  for (let index = 0; index < 7; index += 1) {
    const projectId = demoId(10, (index % 5) + 1);
    const movementId = demoId(860, index + 1);
    stockMovements.push({ id: movementId, workspace_id: workspaceId, project_id: projectId, warehouse_id: demoId(800, 1), target_warehouse_id: null, movement_type: "WZ", document_number: `WZ/DEMO/${String(index + 1).padStart(3, "0")}`, movement_date: atDay(reference, -10 + index), status: "approved", created_by: userId });
    stockMovementLines.push({ id: demoId(870, index + 1), workspace_id: workspaceId, movement_id: movementId, stock_item_id: demoId(810, index + 1), quantity: 24 + index * 3, unit_cost: 18 + index * 12.5, lot_number: null });
  }

  const vehicleSpecs = [
    ["PWA 4OCT", "WVWZZZ7HZPH001001", "van", "Volkswagen", "Transporter", 2023, "owned", 68420],
    ["PWA 8BUS", "WF0XXXTTGXNU02002", "van", "Ford", "Transit", 2022, "leasing", 92110],
    ["PWA 7PRO", "WDB9076331P030003", "van", "Mercedes-Benz", "Sprinter", 2024, "leasing", 38200],
    ["PWA 3SUV", "TMBJJ7NU1P040004", "car", "Skoda", "Karoq", 2023, "leasing", 57540],
    ["PWA 2PKP", "WFO6XXGCC6R050005", "pickup", "Ford", "Ranger", 2024, "owned", 31880],
    ["PWA 9SER", "VF7VBBHXMR060006", "van", "Citroen", "Jumper", 2021, "owned", 128300]
  ] as const;
  const vehicles: DemoRow[] = [];
  const fuelEntries: DemoRow[] = [];
  const trips: DemoRow[] = [];
  const serviceOrders: DemoRow[] = [];
  const vehicleDocuments: DemoRow[] = [];
  const damageCases: DemoRow[] = [];
  const vehicleAllocations: DemoRow[] = [];

  vehicleSpecs.forEach(([registration, vin, vehicleType, make, model, year, ownership, mileage], index) => {
    const vehicleId = demoId(900, index + 1);
    vehicles.push({ id: vehicleId, workspace_id: workspaceId, registration_number: registration, vin, vehicle_type: vehicleType, make, model, production_year: year, ownership_type: ownership, status: "active", current_mileage: mileage });
    fuelEntries.push({ id: demoId(910, index + 1), workspace_id: workspaceId, vehicle_id: vehicleId, project_id: demoId(10, (index % 5) + 1), fueled_at: atIso(reference, -6 + index), liters: 48 + index * 4.5, gross_amount: 318 + index * 31, mileage: mileage - 180 + index * 15, station: "DemoFuel" });
    trips.push({ id: demoId(920, index + 1), workspace_id: workspaceId, vehicle_id: vehicleId, employee_id: demoId(600, (index % employeeSpecs.length) + 1), project_id: demoId(10, (index % 5) + 1), started_at: atIso(reference, -3 + index * 0.2, -4), finished_at: atIso(reference, -3 + index * 0.2, 2), start_location: "Wągrowiec", end_location: PROJECT_SPECS[index % 5].city, distance_km: 62 + index * 18, purpose: "Dojazd na budowę / dostawa materiału" });
    serviceOrders.push({ id: demoId(930, index + 1), workspace_id: workspaceId, vehicle_id: vehicleId, service_type: index === 5 ? "Naprawa układu hamulcowego" : "Przegląd okresowy", opened_at: atDay(reference, -90 + index * 8), closed_at: index === 5 ? null : atDay(reference, -88 + index * 8), next_due_date: atDay(reference, 30 + index * 34), next_due_mileage: mileage + 12000, cost: 980 + index * 360, status: index === 5 ? "open" : "closed" });
    vehicleDocuments.push({ id: demoId(940, index + 1), workspace_id: workspaceId, vehicle_id: vehicleId, document_type: "OC / przegląd", number: `DOC-${registration.replaceAll(" ", "")}`, valid_from: atDay(reference, -300), valid_until: index === 2 ? atDay(reference, 22) : atDay(reference, 120 + index * 20), status: "valid" });
    if (index === 1) damageCases.push({ id: demoId(950, 1), workspace_id: workspaceId, vehicle_id: vehicleId, occurred_at: atIso(reference, -18), description: "Uszkodzenie lusterka na parkingu budowy.", status: "in_repair", cost: 1650 });
    vehicleAllocations.push({ id: demoId(960, index + 1), workspace_id: workspaceId, vehicle_id: vehicleId, project_id: demoId(10, (index % 5) + 1), employee_id: demoId(600, (index % employeeSpecs.length) + 1), allocated_from: atDay(reference, -45 + index), allocated_to: atDay(reference, 75 + index * 5), allocation_type: "project", allocation_percent: 80 });
  });

  const knowledgeEntries: DemoRow[] = [
    ["lesson", "Próby szczelności – kolejność i dowody", "Najmniej poprawek występuje, gdy próby są zamykane przed zabudową wraz ze zdjęciami manometru.", "WBS, protokół i zdjęcia powinny być spięte jednym zdarzeniem odbiorowym."],
    ["procurement", "Dostawy central wentylacyjnych", "Centrale o dużych gabarytach wymagają sprawdzenia trasy transportowej przed zamówieniem.", "Dodawać punkt kontrolny 6 tygodni przed dostawą oraz zatwierdzenie wymiarów sekcji."],
    ["finance", "Kontrola podwójnych faktur", "Powtarzające się numery i kwoty powinny być blokowane przed dekretacją.", "Porównuj NIP, numer, datę, brutto i skrót dokumentu."],
    ["quality", "Odbiór robót zanikowych", "Brak zdjęć i lokalizacji utrudnia rozliczenie sporów.", "Każdy protokół robót zanikowych łącz ze zdjęciami i lokalizacją WBS."],
    ["schedule", "Bufor na regulację wentylacji", "Regulacja bywa spychana na końcówkę kontraktu.", "Rezerwuj minimum 7–10 dni na pomiary, poprawki i ponowne pomiary."],
    ["warehouse", "Rezerwacje materiałowe", "Stan magazynu nie jest równy stanowi dostępnemu.", "Przy planowaniu dostaw odejmuj rezerwacje aktywnych inwestycji."],
    ["fleet", "Koszt dojazdów na odległe budowy", "Długie trasy samochodów serwisowych kumulują koszt paliwa i czasu.", "Łącz przejazdy z inwestycją i pracownikiem, a następnie alokuj koszt."],
    ["safety", "Uprawnienia przed przypisaniem brygady", "Pracownik z wygasłym badaniem lub uprawnieniem nie powinien trafić do krytycznego zadania.", "Octopus powinien blokować lub ostrzegać przy planowaniu obsady."]
  ].map(([entryType, title, summary, solution], index) => ({ id: demoId(1000, index + 1), workspace_id: workspaceId, source_project_id: index < 6 ? demoId(10, (index % 6) + 1) : null, entry_type: entryType, title, summary, solution, tags: [entryType, "demo", "best-practice"], metrics: { confidence: 0.9 + index * 0.01 }, source_references: [], status: index === 7 ? "proposed" : "approved", approved_by: index === 7 ? null : userId, approved_at: index === 7 ? null : atIso(reference, -12 + index) }));

  const notifications: DemoRow[] = [
    { id: demoId(1010, 1), workspace_id: workspaceId, project_id: demoId(10, 5), user_id: userId, event_type: "schedule.delay", title: "Logistyka Gniezno – termin kontraktowy przekroczony", body: "Sprawdź ścieżkę krytyczną, roszczenie i listę zamknięcia.", severity: "critical", created_at: atIso(reference, -1) },
    { id: demoId(1010, 2), workspace_id: workspaceId, project_id: demoId(10, 2), user_id: userId, event_type: "supply.risk", title: "Dostawa centrali AHU-2 blisko terminu montażu", body: "Potwierdź awizację i gotowość transportową.", severity: "warning", created_at: atIso(reference, -0.5) },
    { id: demoId(1010, 3), workspace_id: workspaceId, project_id: null, user_id: userId, event_type: "hr.expiry", title: "Uprawnienia pracownika wygasły", body: "Sprawdź kartę pracownika i przypisania do inwestycji.", severity: "warning", created_at: atIso(reference, -2) },
    { id: demoId(1010, 4), workspace_id: workspaceId, project_id: demoId(10, 1), user_id: userId, event_type: "ai.review", title: "AI ma dokument wymagający decyzji", body: "Zweryfikuj kategorię i przypisanie dokumentu.", severity: "info", created_at: atIso(reference, -0.2) }
  ];

  const reportDefinitions: DemoRow[] = [
    { id: demoId(1020, 1), workspace_id: workspaceId, project_id: null, name: "Raport zarządczy firmy – tygodniowy", report_type: "management", definition: { finance: true, projects: true, resources: true, ai: true }, schedule_rule: "weekly:monday", active: true, created_by: userId },
    { id: demoId(1020, 2), workspace_id: workspaceId, project_id: demoId(10, 1), name: "Raport postępu – Żłobek Oborniki", report_type: "project_progress", definition: { progress: true, schedule: true, finance: true }, schedule_rule: "weekly:friday", active: true, created_by: userId },
    { id: demoId(1020, 3), workspace_id: workspaceId, project_id: null, name: "Raport zasobów i terminów", report_type: "resources", definition: { hr: true, fleet: true, warehouse: true }, schedule_rule: "monthly:1", active: true, created_by: userId }
  ];

  const reportRuns: DemoRow[] = [
    { id: demoId(1030, 1), workspace_id: workspaceId, report_definition_id: demoId(1020, 1), project_id: null, period_start: atDay(reference, -7), period_end: atDay(reference, -1), status: "completed", started_at: atIso(reference, -1, -2), finished_at: atIso(reference, -1, -1) },
    { id: demoId(1030, 2), workspace_id: workspaceId, report_definition_id: demoId(1020, 2), project_id: demoId(10, 1), period_start: atDay(reference, -14), period_end: atDay(reference, -7), status: "completed", started_at: atIso(reference, -7, -2), finished_at: atIso(reference, -7, -1) }
  ];

  const reportSnapshots: DemoRow[] = [
    { id: demoId(1040, 1), workspace_id: workspaceId, report_run_id: demoId(1030, 1), project_id: null, kpi_definitions: { demo: true }, data_snapshot: { portfolio: { projects: PROJECT_SPECS.length, active: PROJECT_SPECS.filter((item) => item.status === "active").length }, finance: { sales_gross: invoices.filter((item) => item.direction === "sale").reduce((sum, item) => sum + Number(item.gross_amount), 0), purchases_gross: invoices.filter((item) => item.direction === "purchase").reduce((sum, item) => sum + Number(item.gross_amount), 0) }, resources: { employees: employees.length, vehicles: vehicles.length, stock_items: stockItems.length } }, narrative: { title: "Raport zarządczy DEMO", summary: "Portfel inwestycji jest w większości aktywny. Główne ryzyko: termin Logistyka Gniezno i dostawa AHU dla Hali Wrzosowa." }, source_references: ["projects", "invoices", "employees", "vehicles"], closed_at: atIso(reference, -1) },
    { id: demoId(1040, 2), workspace_id: workspaceId, report_run_id: demoId(1030, 2), project_id: demoId(10, 1), kpi_definitions: { demo: true }, data_snapshot: { progress: 0.62, schedule: { days_to_finish: 105 }, finance: { contract_value: 3_250_000, forecast_margin: 680_000 } }, narrative: { title: "Żłobek Oborniki – raport postępu", summary: "Roboty przebiegają zgodnie z planem. Do kontroli pozostają dostawy i kompletność protokołów." }, source_references: ["boq_items", "schedule_activities", "forecast_snapshots"], closed_at: atIso(reference, -7) }
  ];

  const integrationConnections: DemoRow[] = [
    { id: demoId(1050, 1), workspace_id: workspaceId, integration_type: "r2", display_name: "Cloudflare R2 – dokumenty", status: "active", configuration: { scope: "company", demo: true }, last_sync_at: atIso(reference, -0.1), created_by: userId },
    { id: demoId(1050, 2), workspace_id: workspaceId, integration_type: "gemini", display_name: "OctopusAI / Gemini", status: "active", configuration: { scope: "company", demo: true }, last_sync_at: atIso(reference, -0.05), created_by: userId },
    { id: demoId(1050, 3), workspace_id: workspaceId, integration_type: "ksef", display_name: "KSeF – środowisko testowe", status: "configured", configuration: { scope: "company", environment: "test", demo: true }, last_sync_at: atIso(reference, -2), created_by: userId }
  ];

  const notificationRules: DemoRow[] = [
    { id: demoId(1060, 1), workspace_id: workspaceId, project_id: null, event_type: "hr.expiry", channels: ["in_app"], recipients: [], lead_time_days: 30, active: true },
    { id: demoId(1060, 2), workspace_id: workspaceId, project_id: null, event_type: "fleet.expiry", channels: ["in_app"], recipients: [], lead_time_days: 30, active: true },
    { id: demoId(1060, 3), workspace_id: workspaceId, project_id: null, event_type: "ai.review", channels: ["in_app"], recipients: [], lead_time_days: 0, active: true },
    { id: demoId(1060, 4), workspace_id: workspaceId, project_id: demoId(10, 5), event_type: "project.deadline", channels: ["in_app"], recipients: [], lead_time_days: 14, active: true }
  ];

  const ksefConnections: DemoRow[] = [{ id: demoId(1070, 1), workspace_id: workspaceId, environment: "test", status: "demo", nip: String(workspace.tax_id), inbound_enabled: true, sales_enabled: false, last_successful_sync_at: atIso(reference, -2), configured_by: userId }];

  return {
    workspace,
    workspaceMembers,
    projects,
    projectFacts,
    documents,
    documentIntakes,
    materials,
    devices,
    boqVersions,
    wbsNodes,
    boqItems,
    projectRequirements,
    materialRequests,
    protocolRequirements,
    protocols,
    scheduleBaselines,
    scheduleActivities,
    progressPeriods,
    progressEntries,
    changeOrders,
    aiFindings,
    siteEvents,
    evidenceRequirements,
    closeoutRequirements,
    documentChangeImpacts,
    budgets,
    forecastSnapshots,
    counterparties,
    invoices,
    invoiceLines,
    payments,
    commitments,
    financialAllocations,
    employees,
    employments,
    qualifications,
    medicalExams,
    leaveRequests,
    timesheets,
    assignments,
    warehouses,
    stockItems,
    stockMovements,
    stockMovementLines,
    reservations,
    materialChainEvents,
    vehicles,
    fuelEntries,
    trips,
    serviceOrders,
    vehicleDocuments,
    damageCases,
    vehicleAllocations,
    knowledgeEntries,
    notifications,
    reportDefinitions,
    reportRuns,
    reportSnapshots,
    integrationConnections,
    notificationRules,
    ksefConnections
  };
}

export function validateDemoBlueprint(blueprint: DemoBlueprint) {
  const errors: string[] = [];
  const projectIds = new Set(blueprint.projects.map((row) => String(row.id)));
  const employeeIds = new Set(blueprint.employees.map((row) => String(row.id)));
  const vehicleIds = new Set(blueprint.vehicles.map((row) => String(row.id)));
  const itemIds = new Set(blueprint.stockItems.map((row) => String(row.id)));
  const warehouseIds = new Set(blueprint.warehouses.map((row) => String(row.id)));
  const boqIds = new Set(blueprint.boqItems.map((row) => String(row.id)));
  const invoiceIds = new Set(blueprint.invoices.map((row) => String(row.id)));

  if (blueprint.projects.length < 6) errors.push("Za mało inwestycji demonstracyjnych.");
  if (blueprint.employees.length < 10) errors.push("Za mało pracowników demonstracyjnych.");
  if (blueprint.stockItems.length < 12) errors.push("Za mało kartotek magazynowych.");
  if (blueprint.vehicles.length < 5) errors.push("Za mało pojazdów demonstracyjnych.");

  for (const fact of blueprint.projectFacts) if (!projectIds.has(String(fact.project_id))) errors.push(`Fakt bez inwestycji: ${fact.id}`);
  for (const row of blueprint.assignments) {
    if (!projectIds.has(String(row.project_id))) errors.push(`Przypisanie bez inwestycji: ${row.id}`);
    if (!employeeIds.has(String(row.employee_id))) errors.push(`Przypisanie bez pracownika: ${row.id}`);
  }
  for (const row of blueprint.vehicleAllocations) {
    if (!projectIds.has(String(row.project_id))) errors.push(`Alokacja floty bez inwestycji: ${row.id}`);
    if (!vehicleIds.has(String(row.vehicle_id))) errors.push(`Alokacja floty bez pojazdu: ${row.id}`);
  }
  for (const row of blueprint.reservations) {
    if (!projectIds.has(String(row.project_id))) errors.push(`Rezerwacja bez inwestycji: ${row.id}`);
    if (!warehouseIds.has(String(row.warehouse_id))) errors.push(`Rezerwacja bez magazynu: ${row.id}`);
    if (!itemIds.has(String(row.stock_item_id))) errors.push(`Rezerwacja bez kartoteki: ${row.id}`);
    if (Number(row.quantity ?? 0) <= 0) errors.push(`Nieprawidłowa ilość rezerwacji: ${row.id}`);
  }
  for (const row of blueprint.progressEntries) {
    if (!boqIds.has(String(row.boq_item_id))) errors.push(`Przerób bez BOQ: ${row.id}`);
    if (Number(row.quantity_accepted ?? 0) > Number(row.quantity_executed ?? 0)) errors.push(`Odbiór większy od wykonania: ${row.id}`);
  }
  for (const item of blueprint.boqItems) {
    if (Number(item.quantity_executed ?? 0) > Number(item.quantity ?? 0) + 0.001) errors.push(`Wykonanie przekracza BOQ: ${item.id}`);
    if (Number(item.quantity_accepted ?? 0) > Number(item.quantity_executed ?? 0) + 0.001) errors.push(`Odbiór przekracza wykonanie BOQ: ${item.id}`);
  }
  for (const row of blueprint.financialAllocations) if (!invoiceIds.has(String(row.source_id))) errors.push(`Alokacja bez faktury: ${row.id}`);
  for (const row of blueprint.invoices) {
    if (Number(row.gross_amount ?? 0) < Number(row.paid_amount ?? 0)) errors.push(`Nadpłata ponad brutto: ${row.id}`);
    if (Number(row.gross_amount ?? 0) < 0) errors.push(`Ujemna faktura: ${row.id}`);
  }
  for (const row of blueprint.scheduleActivities) {
    const start = String(row.planned_start ?? "");
    const finish = String(row.planned_finish ?? "");
    if (start && finish && start > finish) errors.push(`Harmonogram odwrócony: ${row.id}`);
  }

  const allIds = Object.values(blueprint)
    .filter((value): value is DemoRow[] => Array.isArray(value))
    .flatMap((rows) => rows.map((row) => typeof row.id === "string" ? row.id : null).filter(Boolean));
  const uniqueIds = new Set(allIds);
  if (uniqueIds.size !== allIds.length) errors.push("Identyfikatory demonstracyjne nie są unikalne między tabelami.");

  return errors;
}
