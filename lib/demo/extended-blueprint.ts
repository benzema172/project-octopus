import { demoId, type DemoBlueprint, type DemoRow } from "./blueprint";

const DAY = 86_400_000;

function refDate(referenceDate: Date) {
  const reference = new Date(referenceDate);
  reference.setUTCHours(12, 0, 0, 0);
  return reference;
}

function atDay(reference: Date, offset: number) {
  return new Date(reference.getTime() + offset * DAY).toISOString().slice(0, 10);
}

function atIso(reference: Date, offsetDays: number, offsetHours = 0) {
  return new Date(reference.getTime() + offsetDays * DAY + offsetHours * 3_600_000).toISOString();
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

type ExtraProjectSpec = {
  name: string;
  shortName: string;
  city: string;
  street: string;
  investor: string;
  investorTaxId: string;
  generalContractor: string;
  contractNumber: string;
  contractValue: number;
  plannedCost: number;
  status: "active" | "planned" | "paused" | "tender";
  progress: number;
  startOffset: number;
  finishOffset: number;
  scope: string;
  specialRisk: string;
};

const EXTRA_PROJECTS: ExtraProjectSpec[] = [
  {
    name: "Aquapark Wągrowiec – technologia basenowa, HVAC i instalacje sanitarne",
    shortName: "Aquapark Wągrowiec",
    city: "Wągrowiec",
    street: "ul. Kościuszki 92",
    investor: "Miejski Ośrodek Sportu i Rekreacji w Wągrowcu",
    investorTaxId: "7661972044",
    generalContractor: "AquaBuild Polska Sp. z o.o.",
    contractNumber: "AW/SAN/07/2026",
    contractValue: 12_600_000,
    plannedCost: 10_180_000,
    status: "active",
    progress: 0.56,
    startOffset: -170,
    finishOffset: 130,
    scope: "Technologia uzdatniania wody basenowej, wentylacja hal basenowych, ciepło technologiczne, wod-kan, odzysk ciepła i automatyka BMS.",
    specialRisk: "Koordynacja technologii basenowej z konstrukcją niecek i dostawą central basenowych."
  },
  {
    name: "Zakład farmaceutyczny Poznań – cleanroom HVAC i media technologiczne",
    shortName: "Pharma Cleanroom",
    city: "Poznań",
    street: "ul. Bałtycka 118",
    investor: "BioPharm Manufacturing Sp. z o.o.",
    investorTaxId: "7822941087",
    generalContractor: "CleanTech Construction S.A.",
    contractNumber: "PH/MEP/15/2026",
    contractValue: 15_250_000,
    plannedCost: 12_760_000,
    status: "active",
    progress: 0.37,
    startOffset: -95,
    finishOffset: 210,
    scope: "Wentylacja cleanroom ISO 7/8, woda lodowa, sprężone powietrze, próżnia, BMS, monitoring parametrów i kwalifikacja instalacji.",
    specialRisk: "Termin FAT central i walidacja pomieszczeń czystych przed rozruchem produkcji."
  },
  {
    name: "Szkoła Podstawowa nr 4 w Pile – termomodernizacja i wymiana instalacji",
    shortName: "SP4 Piła",
    city: "Piła",
    street: "ul. Mickiewicza 28",
    investor: "Gmina Piła",
    investorTaxId: "7642614167",
    generalContractor: "EcoRenova Sp. z o.o.",
    contractNumber: "SP4/TERM/09/2026",
    contractValue: 3_980_000,
    plannedCost: 3_190_000,
    status: "tender",
    progress: 0,
    startOffset: 35,
    finishOffset: 285,
    scope: "Wymiana instalacji c.o., wentylacja sal, modernizacja kotłowni, instalacja wod-kan i przygotowanie pod fotowoltaikę/BMS.",
    specialRisk: "Roboty etapowane przy czynnym obiekcie szkolnym i ograniczone okna prac głośnych."
  },
  {
    name: "Apartamentowiec Portowa Residence – komplet instalacji MEP",
    shortName: "Portowa Residence",
    city: "Poznań",
    street: "ul. Portowa 14",
    investor: "Portowa Residence Development Sp. z o.o.",
    investorTaxId: "7812046672",
    generalContractor: "UrbanCore S.A.",
    contractNumber: "PR/MEP/21/2026",
    contractValue: 11_420_000,
    plannedCost: 9_260_000,
    status: "active",
    progress: 0.12,
    startOffset: -30,
    finishOffset: 330,
    scope: "Instalacje wod-kan, c.o., węzeł cieplny, wentylacja mieszkań i garażu, hydranty, instalacje deszczowe i automatyka.",
    specialRisk: "Duża liczba pionów i powtarzalnych lokali wymaga rygorystycznej kontroli wersji rysunków."
  },
  {
    name: "Mleczarnia Wielkopolska – modernizacja kotłowni i odzysku ciepła",
    shortName: "Mleczarnia – energia",
    city: "Gniezno",
    street: "ul. Przemysłowa 44",
    investor: "Wielkopolska Dairy S.A.",
    investorTaxId: "7840018841",
    generalContractor: "ProcessEnergy Sp. z o.o.",
    contractNumber: "WD/ENER/06/2026",
    contractValue: 6_350_000,
    plannedCost: 5_180_000,
    status: "paused",
    progress: 0.44,
    startOffset: -125,
    finishOffset: 105,
    scope: "Modernizacja kotłowni parowej, odzysk ciepła ze sprężarek i instalacji chłodniczej, wymienniki, rurociągi technologiczne i automatyka.",
    specialRisk: "Wstrzymanie części robót po zmianie parametrów technologicznych przez inwestora."
  }
];

const WBS = [
  ["10", "Dokumentacja, BIM i koordynacja", "Koordynacja"],
  ["20", "Instalacje wodociągowe i kanalizacyjne", "Wod-Kan"],
  ["30", "Ciepło, chłód i instalacje technologiczne", "C.O./Chłód"],
  ["40", "Wentylacja i klimatyzacja", "Wentylacja"],
  ["50", "Automatyka, BMS i uruchomienia", "Automatyka"],
  ["60", "Próby, regulacja, odbiory i dokumentacja powykonawcza", "Odbiory"]
] as const;

const BOQ_TEMPLATE = [
  ["1.1", "Rurociąg instalacyjny wraz z kształtkami i mocowaniami", 1250, "m", 142],
  ["1.2", "Armatura odcinająca i regulacyjna", 145, "szt", 690],
  ["2.1", "Rurociąg stalowy / technologiczny wraz z izolacją", 980, "m", 238],
  ["2.2", "Pompy obiegowe i zestawy pompowe", 9, "kpl", 28400],
  ["3.1", "Kanały wentylacyjne z osprzętem", 3850, "m2", 214],
  ["3.2", "Centrale wentylacyjne z automatyką", 5, "kpl", 238000],
  ["4.1", "Szafy automatyki, sterowniki i okablowanie BMS", 8, "kpl", 46500],
  ["5.1", "Rozruch, pomiary, regulacja i dokumentacja odbiorowa", 1, "kpl", 185000]
] as const;

function addProjectDataset(dataset: DemoBlueprint, spec: ExtraProjectSpec, projectIndex: number, userId: string, reference: Date) {
  const index = projectIndex + 1;
  const projectId = demoId(2000, index);
  const factId = demoId(2001, index);
  const boqVersionId = demoId(2002, index);
  const baselineId = demoId(2003, index);
  const startDate = atDay(reference, spec.startOffset);
  const finishDate = atDay(reference, spec.finishOffset);
  const profileProgress = spec.status === "tender" ? 0 : spec.progress;
  const actualCost = roundMoney(spec.plannedCost * Math.min(1, profileProgress * 0.91));
  const committedCost = spec.status === "tender" ? 0 : roundMoney(spec.plannedCost * Math.max(0.06, 0.21 - profileProgress * 0.11));
  const etc = Math.max(0, spec.plannedCost - actualCost);

  dataset.projects.push({
    id: projectId,
    workspace_id: dataset.workspace.id,
    name: spec.name,
    description: spec.scope,
    investor_name: spec.investor,
    general_contractor: spec.generalContractor,
    location: spec.city,
    status: spec.status,
    created_by: userId
  });

  dataset.projectFacts.push({
    id: factId,
    project_id: projectId,
    fact_type: "project_profile",
    value_text: spec.shortName,
    value_json: {
      projectName: spec.name,
      shortName: spec.shortName,
      projectType: "Instalacje sanitarne / HVAC / MEP",
      status: spec.status,
      description: spec.scope,
      street: spec.street,
      postalCode: spec.city === "Poznań" ? "60-101" : spec.city === "Piła" ? "64-920" : spec.city === "Gniezno" ? "62-200" : "62-100",
      city: spec.city,
      municipality: spec.city,
      county: spec.city,
      voivodeship: "wielkopolskie",
      plotNumbers: `${420 + index}/${10 + index}`,
      buildingPermit: `WA.${340 + index}.2026`,
      contractNumber: spec.contractNumber,
      contractDate: atDay(reference, spec.startOffset - 30),
      startDate,
      completionDate: finishDate,
      warrantyEndDate: atDay(reference, spec.finishOffset + 1095),
      contractValue: String(spec.contractValue),
      currency: "PLN",
      fundingSource: index % 2 ? "Środki własne / kredyt inwestycyjny" : "Środki publiczne / własne",
      contractScope: spec.scope,
      investorName: spec.investor,
      investorAddress: `${spec.city}, ${spec.street}`,
      investorTaxId: spec.investorTaxId,
      investorRepresentative: ["Marta Zielińska", "Robert Maj", "Agnieszka Wrona", "Tomasz Bąk", "Joanna Ciesielska"][projectIndex],
      investorEmail: `inwestor.projekt${index}@demo-octopus.pl`,
      investorPhone: `+48 511 40${index} 60${index}`,
      generalContractorName: spec.generalContractor,
      generalContractorAddress: "Poznań, ul. Budowlanych 18",
      generalContractorTaxId: `783200${1200 + index}`,
      generalContractorRepresentative: ["Piotr Rataj", "Łukasz Malinowski", "Marek Kubiak", "Kamil Rak", "Wojciech Lis"][projectIndex],
      designerName: ["AquaProjekt", "CleanRoom Engineering", "EcoProjekt", "MEP Studio", "Process Engineering"][projectIndex] + " Sp. z o.o.",
      designerAddress: "Poznań, ul. Projektowa 18",
      contractEngineerName: ["Paweł Mróz", "Marcin Zając", "Ewa Jankowska", "Bartosz Wilk", "Jacek Pawlik"][projectIndex],
      supervisionInspectorName: ["Krzysztof Tomczak", "Marek Frąckowiak", "Anna Pawłowska", "Piotr Kaźmierczak", "Andrzej Nowicki"][projectIndex],
      supervisionInspectorBranch: "sanitarna",
      supervisionInspectorEmail: `inspektor${index}@demo-octopus.pl`,
      supervisionInspectorPhone: `+48 502 31${index} 42${index}`,
      siteManagerName: ["Tomasz Nawrocki", "Mariusz Sowa", "Damian Baran", "Krzysztof Kania", "Robert Musiał"][projectIndex],
      siteManagerEmail: `kierownik${index}@demo-octopus.pl`,
      siteManagerPhone: `+48 503 51${index} 72${index}`,
      sanitaryWorksManagerName: ["Michał Nowak", "Paweł Kowalski", "Tomasz Wiśniewski", "Michał Nowak", "Paweł Kowalski"][projectIndex],
      sanitaryWorksManagerEmail: `roboty.san${index}@demo-octopus.pl`,
      sanitaryWorksManagerPhone: `+48 504 61${index} 82${index}`,
      electricalWorksManagerName: ["Adam Przybylski", "Maciej Szymczak", "Konrad Krupa", "Jakub Wolski", "Rafał Górski"][projectIndex],
      notes: `${spec.specialRisk} Dane demonstracyjne odwzorowują realny przebieg kontraktu.`
    },
    confidence: 1,
    status: "approved",
    approved_by: userId,
    approved_at: atIso(reference, Math.min(-2, spec.startOffset + 10))
  });

  dataset.boqVersions.push({
    id: boqVersionId,
    workspace_id: dataset.workspace.id,
    project_id: projectId,
    version_number: 1,
    name: `Kosztorys kontraktowy – ${spec.shortName}`,
    status: spec.status === "tender" ? "draft" : "approved",
    currency: "PLN",
    net_value: spec.contractValue,
    gross_value: roundMoney(spec.contractValue * 1.23),
    valid_from: startDate,
    approved_by: spec.status === "tender" ? null : userId,
    approved_at: spec.status === "tender" ? null : atIso(reference, spec.startOffset + 7)
  });

  dataset.scheduleBaselines.push({
    id: baselineId,
    workspace_id: dataset.workspace.id,
    project_id: projectId,
    version_number: 1,
    name: `Harmonogram kontraktowy – ${spec.shortName}`,
    start_date: startDate,
    finish_date: finishDate,
    status: spec.status === "tender" ? "draft" : "approved",
    approved_by: spec.status === "tender" ? null : userId,
    approved_at: spec.status === "tender" ? null : atIso(reference, spec.startOffset + 5)
  });

  WBS.forEach(([code, name, installation], wbsIndex) => {
    const wbsId = demoId(2100 + projectIndex, wbsIndex + 1);
    const planStart = spec.startOffset + Math.round((spec.finishOffset - spec.startOffset) * (wbsIndex * 0.14));
    const planFinish = spec.startOffset + Math.round((spec.finishOffset - spec.startOffset) * (0.22 + wbsIndex * 0.14));
    const actualProgress = spec.status === "tender" ? 0 : Math.max(0, Math.min(1, spec.progress * 1.38 - wbsIndex * 0.15));
    dataset.wbsNodes.push({
      id: wbsId,
      workspace_id: dataset.workspace.id,
      project_id: projectId,
      code,
      name,
      branch: "sanitarna",
      installation,
      zone: wbsIndex <= 1 ? "Strefa A / kondygnacje" : wbsIndex <= 3 ? "Strefy techniczne" : "Cały obiekt",
      sort_order: (wbsIndex + 1) * 10,
      status: "active"
    });
    dataset.scheduleActivities.push({
      id: demoId(2900 + projectIndex, wbsIndex + 1),
      workspace_id: dataset.workspace.id,
      project_id: projectId,
      schedule_baseline_id: baselineId,
      wbs_node_id: wbsId,
      code: `H-${code}`,
      title: name,
      planned_start: atDay(reference, planStart),
      planned_finish: atDay(reference, planFinish),
      actual_start: actualProgress > 0 ? atDay(reference, planStart + 2) : null,
      actual_finish: actualProgress >= 1 ? atDay(reference, planFinish - 2) : null,
      planned_progress: Math.min(1, spec.progress + 0.07),
      actual_progress: actualProgress,
      critical: wbsIndex === 3 || wbsIndex === 4 || wbsIndex === 5,
      constraint_note: wbsIndex === 3 && spec.status === "paused" ? spec.specialRisk : wbsIndex === 4 && projectIndex === 1 ? "FAT szafy automatyki i integracja z systemem EMS inwestora." : null,
      status: actualProgress >= 1 ? "completed" : actualProgress > 0 ? "active" : "planned"
    });
  });

  BOQ_TEMPLATE.forEach(([itemNumber, description, baseQuantity, unit, unitPrice], itemIndex) => {
    const quantity = itemIndex === 5 ? Number(baseQuantity) + projectIndex : Number(baseQuantity) + projectIndex * (itemIndex < 4 ? 70 : 180);
    const wbsIndex = itemIndex <= 1 ? 1 : itemIndex <= 3 ? 2 : itemIndex <= 5 ? 3 : itemIndex === 6 ? 4 : 5;
    const itemId = demoId(2200 + projectIndex, itemIndex + 1);
    const executed = spec.status === "tender" ? 0 : roundMoney(quantity * Math.max(0, Math.min(1, spec.progress * (1.14 - itemIndex * 0.035))));
    const accepted = roundMoney(executed * (spec.status === "paused" ? 0.92 : 0.98));
    const adjustedUnitPrice = Number(unitPrice) + projectIndex * 9;
    dataset.boqItems.push({
      id: itemId,
      project_id: projectId,
      item_number: itemNumber,
      description,
      quantity,
      unit,
      unit_price: adjustedUnitPrice,
      total_price: roundMoney(quantity * adjustedUnitPrice),
      boq_version_id: boqVersionId,
      wbs_node_id: demoId(2100 + projectIndex, wbsIndex + 1),
      cost_code: `MEP-${index}-${itemNumber.replace(".", "")}`,
      quantity_executed: executed,
      quantity_accepted: Math.min(executed, accepted)
    });
  });

  const projectMaterials = [
    ["System rur i kształtek", "Wod-Kan", "PN10/PN20, zgodnie z projektem"],
    ["Armatura regulacyjna i odcinająca", "C.O./Chłód", "PN16, siłowniki 0-10V"],
    ["Izolacja techniczna", "C.O./Chłód", "kauczuk / wełna zgodnie ze strefą"],
    ["Kanały i kształtki wentylacyjne", "Wentylacja", "klasa szczelności B/C"]
  ];
  projectMaterials.forEach(([name, installation, specification], materialIndex) => dataset.materials.push({
    id: demoId(2300 + projectIndex, materialIndex + 1), project_id: projectId, name: `${name} – ${spec.shortName}`, installation, specification
  }));

  dataset.devices.push(
    { id: demoId(2400 + projectIndex, 1), project_id: projectId, name: `Centrala wentylacyjna AHU-${index}A`, installation: "Wentylacja", parameters: { airflow_m3h: 18000 + projectIndex * 4200, recovery: "rotor/płytowy", efficiency: 0.82, automation: "BMS" } },
    { id: demoId(2400 + projectIndex, 2), project_id: projectId, name: `Zestaw pompowy P-${index}`, installation: "C.O./Chłód", parameters: { flow_m3h: 28 + projectIndex * 4, head_kpa: 76, redundancy: "1+1" } },
    { id: demoId(2400 + projectIndex, 3), project_id: projectId, name: `Szafa automatyki BMS-${index}`, installation: "Automatyka", parameters: { protocols: ["BACnet", "Modbus TCP"], io_points: 180 + projectIndex * 45 } }
  );

  const requirementStatuses = spec.status === "tender" ? ["proposed", "proposed", "proposed"] : spec.progress > 0.5 ? ["approved", "approved", "proposed"] : ["approved", "proposed", "proposed"];
  [
    ["material_application", "Pakiet wniosków materiałowych – instalacje rurowe", "Zatwierdzić producentów, parametry i deklaracje właściwości."],
    ["coordination", "Koordynacja BIM tras i otworów", "Zamknąć kolizje przed produkcją prefabrykatów."],
    ["acceptance", "Plan prób, rozruchów i odbiorów", "Potwierdzić procedury, świadków i komplet wymaganych pomiarów."]
  ].forEach(([requirementType, title, description], requirementIndex) => dataset.projectRequirements.push({
    id: demoId(2500 + projectIndex, requirementIndex + 1),
    workspace_id: dataset.workspace.id,
    project_id: projectId,
    requirement_type: requirementType,
    title,
    description,
    source_locator: { source: "extended-demo", contract: spec.contractNumber },
    status: requirementStatuses[requirementIndex],
    confidence: 0.97
  }));

  [
    ["WM-01", "System rurowy i armatura", spec.progress > 0.1 ? "approved" : "draft"],
    ["WM-02", "Centrale wentylacyjne", spec.progress > 0.32 ? "approved" : "review"],
    ["WM-03", "Automatyka BMS", spec.progress > 0.55 ? "approved" : "review"]
  ].forEach(([number, title, status], requestIndex) => dataset.materialRequests.push({
    id: demoId(2600 + projectIndex, requestIndex + 1), project_id: projectId, title: `${number} – ${title}`, status, payload: { project: spec.shortName, manufacturer: ["Geberit / Wavin", "Systemair / VTS", "Siemens / Schneider"][requestIndex], revision: "R1", attachments: 4 + requestIndex }, created_by: userId
  }));

  const protocolTemplates = [
    ["pressure_test", "Próba ciśnieniowa instalacji rurowej", 2],
    ["flushing", "Płukanie i dezynfekcja instalacji", 2],
    ["air_balance", "Pomiary i regulacja wentylacji", 4],
    ["commissioning", "Rozruch automatyki i test scenariuszy", 5]
  ] as const;
  protocolTemplates.forEach(([protocolType, title, wbsIndex], protocolIndex) => {
    dataset.protocolRequirements.push({
      id: demoId(2700 + projectIndex, protocolIndex + 1), workspace_id: dataset.workspace.id, project_id: projectId,
      wbs_node_id: demoId(2100 + projectIndex, wbsIndex), protocol_type: protocolType, title,
      trigger_rule: { wbs: WBS[wbsIndex - 1][0], before_closeout: true }, required_evidence: ["wynik", "zdjęcia", "podpis", "lokalizacja"], status: "required"
    });
    dataset.protocols.push({
      id: demoId(2800 + projectIndex, protocolIndex + 1), project_id: projectId, protocol_type: protocolType, title: `${title} – ${spec.shortName}`,
      status: spec.status !== "tender" && spec.progress > 0.25 + protocolIndex * 0.16 ? "closed" : "draft",
      payload: { result: spec.progress > 0.25 + protocolIndex * 0.16 ? "pozytywny" : "oczekuje", participants: ["kierownik robót", "inspektor"], attachments: protocolIndex + 3 }, created_by: userId
    });
  });

  if (spec.status !== "tender") {
    const progressPeriodId = demoId(3000, index);
    dataset.progressPeriods.push({
      id: progressPeriodId, workspace_id: dataset.workspace.id, project_id: projectId, boq_version_id: boqVersionId,
      period_start: atDay(reference, -30), period_end: atDay(reference, 0), status: "open"
    });
    dataset.boqItems.filter((row) => row.project_id === projectId).forEach((item, itemIndex) => {
      const executed = Number(item.quantity_executed ?? 0);
      const accepted = Math.min(executed, Number(item.quantity_accepted ?? 0));
      const unitPrice = Number(item.unit_price ?? 0);
      dataset.progressEntries.push({
        id: demoId(3100 + projectIndex, itemIndex + 1), workspace_id: dataset.workspace.id, project_id: projectId,
        progress_period_id: progressPeriodId, boq_item_id: item.id, quantity_executed: executed, quantity_accepted: accepted,
        value_executed: roundMoney(executed * unitPrice), value_accepted: roundMoney(accepted * unitPrice), status: "accepted",
        evidence: [{ type: "photo", count: 3 + (itemIndex % 4) }, { type: "site_log", reference: `DEMO-${index}-${itemIndex + 1}` }]
      });
    });
  }

  dataset.changeOrders.push(
    { id: demoId(3200 + projectIndex, 1), workspace_id: dataset.workspace.id, project_id: projectId, number: `ZMI/${index}/01`, title: "Zmiana trasy instalacji po koordynacji", description: spec.specialRisk, status: spec.status === "tender" ? "draft" : projectIndex % 2 ? "submitted" : "approved", value_change: 38000 + projectIndex * 21000, days_change: projectIndex % 2 ? 4 : 0 },
    { id: demoId(3200 + projectIndex, 2), workspace_id: dataset.workspace.id, project_id: projectId, number: `ZMI/${index}/02`, title: "Dodatkowe wymaganie inwestora", description: "Zakres demonstracyjny pokazujący wpływ zmiany na koszt, harmonogram i dokumentację.", status: "draft", value_change: 52000 + projectIndex * 16000, days_change: 6 + projectIndex }
  );

  dataset.aiFindings.push(
    { id: demoId(3300 + projectIndex, 1), project_id: projectId, finding_type: "schedule_risk", severity: spec.status === "paused" ? "critical" : "warning", title: "Ryzyko terminu na ścieżce krytycznej", description: spec.specialRisk },
    { id: demoId(3300 + projectIndex, 2), project_id: projectId, finding_type: "coordination", severity: "info", title: "Sprawdź zgodność rewizji dokumentacji z BOQ", description: "AI wykryło zakres wymagający potwierdzenia przed kolejnym zamówieniem." }
  );

  [
    ["coordination", "Narada koordynacyjna branż", "Uzgodniono kolizje i kolejność robót na następne 2 tygodnie."],
    ["delivery", "Dostawa materiałów / urządzeń", "Zweryfikowano ilość, stan i dokumenty dostawy."],
    ["quality", "Kontrola jakości robót", "Sprawdzono mocowania, spadki, izolację i zgodność z dokumentacją."],
    ["issue", "Zdarzenie wymagające decyzji", spec.specialRisk]
  ].forEach(([eventType, title, description], eventIndex) => dataset.siteEvents.push({
    id: demoId(3400 + projectIndex, eventIndex + 1), workspace_id: dataset.workspace.id, project_id: projectId,
    wbs_node_id: demoId(2100 + projectIndex, Math.min(6, eventIndex + 2)), event_type: eventType, title, description,
    captured_at: atIso(reference, -14 + eventIndex * 3 + projectIndex), location_label: `${spec.city} – strefa ${String.fromCharCode(65 + eventIndex)}`,
    weather_snapshot: { temperature_c: 18 + eventIndex, condition: eventIndex === 3 ? "deszcz" : "zachmurzenie umiarkowane" }, attachments: [{ type: "photo", count: 2 + eventIndex }],
    ai_suggestion: eventIndex === 3 ? "Utwórz zadanie i oceń wpływ na termin/koszt." : "Brak działania krytycznego.", status: eventIndex === 3 ? "review" : "approved", captured_by: userId,
    approved_by: eventIndex === 3 ? null : userId, approved_at: eventIndex === 3 ? null : atIso(reference, -13 + eventIndex * 3 + projectIndex)
  }));

  [
    ["photo", "Zdjęcia przed zakryciem instalacji", 2],
    ["protocol", "Protokół próby ciśnieniowej", 2],
    ["measurement", "Raport regulacji wentylacji", 4],
    ["commissioning", "Raport rozruchu automatyki", 5]
  ].forEach(([evidenceType, title, wbsIndex], evidenceIndex) => dataset.evidenceRequirements.push({
    id: demoId(3500 + projectIndex, evidenceIndex + 1), workspace_id: dataset.workspace.id, project_id: projectId,
    wbs_node_id: demoId(2100 + projectIndex, Number(wbsIndex)), evidence_type: evidenceType, title, required: true,
    status: spec.status !== "tender" && spec.progress > 0.28 + evidenceIndex * 0.15 ? "complete" : "missing",
    due_at: atIso(reference, 12 + evidenceIndex * 18 + projectIndex), accepted_by: null, accepted_at: null
  }));

  const closeoutStatus = spec.status === "tender" ? "missing" : spec.progress > 0.82 ? "in_progress" : "missing";
  ["Dokumentacja powykonawcza", "Protokoły prób i odbiorów", "DTR i karty gwarancyjne", "Szkolenie obsługi", "Rozliczenie końcowe"].forEach((title, closeoutIndex) => dataset.closeoutRequirements.push({
    id: demoId(3600 + projectIndex, closeoutIndex + 1), workspace_id: dataset.workspace.id, project_id: projectId,
    category: closeoutIndex < 3 ? "documentation" : closeoutIndex === 3 ? "handover" : "finance", title, required: true,
    status: closeoutIndex === 0 && spec.progress > 0.9 ? "in_progress" : closeoutStatus, owner_id: userId, due_at: atIso(reference, spec.finishOffset - 20 + closeoutIndex * 4)
  }));

  dataset.budgets.push({
    id: demoId(3700, index), workspace_id: dataset.workspace.id, project_id: projectId, name: `Budżet bazowy – ${spec.shortName}`,
    version_number: 1, status: spec.status === "tender" ? "draft" : "active", currency: "PLN", total_revenue: spec.contractValue, total_cost: spec.plannedCost
  });
  dataset.forecastSnapshots.push({
    id: demoId(3701, index), workspace_id: dataset.workspace.id, project_id: projectId, forecast_date: atDay(reference, 0), status: "approved",
    forecast_finish_date: spec.status === "paused" ? atDay(reference, spec.finishOffset + 28) : finishDate, contract_value: spec.contractValue,
    actual_cost: actualCost, committed_cost: committedCost, estimate_to_complete: etc,
    estimate_at_completion: actualCost + etc, forecast_margin: spec.contractValue - (actualCost + etc),
    assumptions: ["Realistyczny scenariusz demonstracyjny", spec.specialRisk], source_snapshot: { demo: true, progress: spec.progress, status: spec.status }, created_by: userId
  });

  const docSpecs = [
    ["technical", `Projekt wykonawczy branży sanitarnej – ${spec.shortName}.pdf`, "ready", "approved"],
    ["estimate", `Kosztorys kontraktowy – ${spec.shortName}.xls`, "ready", "approved"],
    ["contract", `Umowa ${spec.contractNumber} i aneksy.pdf`, "ready", "approved"],
    ["schedule", `Harmonogram bazowy – ${spec.shortName}.xlsx`, "ready", "approved"],
    ["protocol", `Pakiet protokołów częściowych – ${spec.shortName}.doc`, projectIndex === 1 ? "review" : "ready", projectIndex === 1 ? "pending" : "approved"],
    ["invoice", `Faktura dostawcy – ${spec.shortName}.pdf`, projectIndex === 4 ? "error" : "ready", projectIndex === 4 ? "pending" : "approved"]
  ] as const;
  docSpecs.forEach(([category, name, aiStatus, reviewStatus], docIndex) => {
    const docId = demoId(3800 + projectIndex, docIndex + 1);
    dataset.documents.push({
      id: docId, workspace_id: dataset.workspace.id, project_id: projectId, name, category,
      ai_status: aiStatus, ai_confidence: aiStatus === "review" ? 0.81 : aiStatus === "error" ? 0.52 : 0.96,
      review_status: reviewStatus, effective_status: "current", created_by: userId,
      created_at: atIso(reference, -40 + docIndex * 5 + projectIndex), updated_at: atIso(reference, -4 + docIndex)
    });
    if (aiStatus === "review" || aiStatus === "error") dataset.documentIntakes.push({
      id: demoId(3900 + projectIndex, docIndex + 1), workspace_id: dataset.workspace.id, document_id: docId, proposed_project_id: projectId,
      channel: "company_upload", status: aiStatus === "error" ? "error" : "review", suggested_category: category,
      confidence: aiStatus === "error" ? 0.52 : 0.81, decision_note: aiStatus === "error" ? "Przykład błędu ekstrakcji do ponowienia." : "Sprawdź kategorię i przypisanie przed zatwierdzeniem.", created_by: userId, created_at: atIso(reference, -1, docIndex)
    });
  });
}

function addFinance(dataset: DemoBlueprint, userId: string, reference: Date) {
  const counterparties = [
    ["AquaTechnik Polska Sp. z o.o.", "7812034501", "supplier"],
    ["BMS Controls Wielkopolska Sp. z o.o.", "7831908812", "supplier"],
    ["CleanAir Systems S.A.", "5252877110", "supplier"],
    ["Stal-Inox Proces Sp. z o.o.", "7842501177", "subcontractor"],
    ["PrefaVent Sp. z o.o.", "7792518814", "supplier"],
    ["Automatyka Serwis 24", "7661887044", "subcontractor"],
    ["AquaBuild Polska Sp. z o.o.", "7832026688", "customer"],
    ["CleanTech Construction S.A.", "5252911477", "customer"],
    ["EcoRenova Sp. z o.o.", "7642689001", "customer"],
    ["UrbanCore S.A.", "7812062008", "customer"],
    ["ProcessEnergy Sp. z o.o.", "7842520019", "customer"]
  ];
  counterparties.forEach(([name, taxId, role], index) => dataset.counterparties.push({ id: demoId(4000, index + 1), workspace_id: dataset.workspace.id, name, tax_id: taxId, role, active: true }));

  for (let index = 0; index < 30; index += 1) {
    const projectIndex = index % EXTRA_PROJECTS.length;
    const projectId = demoId(2000, projectIndex + 1);
    const isSale = index % 5 === 0;
    const invoiceId = demoId(4100, index + 1);
    const counterpartyId = demoId(4000, isSale ? 7 + projectIndex : 1 + (index % 6));
    const net = isSale ? 235000 + index * 14500 : 44000 + index * 6800;
    const tax = roundMoney(net * 0.23);
    const gross = roundMoney(net + tax);
    const paid = index % 7 === 2 ? 0 : index % 4 === 1 ? roundMoney(gross * 0.45) : gross;
    dataset.invoices.push({
      id: invoiceId, workspace_id: dataset.workspace.id, counterparty_id: counterpartyId,
      invoice_number: `${isSale ? "FV-PRZ" : "FV-KOS"}/${String(index + 31).padStart(3, "0")}/2026`, direction: isSale ? "sale" : "purchase",
      issue_date: atDay(reference, -74 + index * 2), sale_date: atDay(reference, -75 + index * 2), due_date: atDay(reference, -44 + index * 2),
      currency: "PLN", net_amount: net, tax_amount: tax, gross_amount: gross, paid_amount: paid,
      status: paid >= gross ? "paid" : isSale ? "issued" : "received"
    });
    dataset.invoiceLines.push({
      id: demoId(4200, index + 1), workspace_id: dataset.workspace.id, invoice_id: invoiceId, line_number: 1,
      description: isSale ? `Przerób miesięczny – ${EXTRA_PROJECTS[projectIndex].shortName}` : ["Materiały instalacyjne", "Prefabrykacja wentylacji", "Automatyka BMS", "Urządzenia i pompy", "Podwykonawstwo montażowe", "Izolacje techniczne"][index % 6],
      quantity: isSale ? 1 : 4 + index % 11, unit: isSale ? "kpl" : "szt", unit_price: roundMoney(net / (isSale ? 1 : 4 + index % 11)), net_amount: net, tax_rate: 23, gross_amount: gross
    });
    dataset.financialAllocations.push({ id: demoId(4400, index + 1), workspace_id: dataset.workspace.id, project_id: projectId, source_type: "invoice", source_id: invoiceId, amount: net, status: "approved" });
    if (paid > 0) dataset.payments.push({ id: demoId(4300, index + 1), workspace_id: dataset.workspace.id, invoice_id: invoiceId, payment_date: atDay(reference, -25 + index), amount: paid, currency: "PLN", bank_reference: `EXT-DEMO-PAY-${String(index + 1).padStart(4, "0")}`, status: "confirmed" });
  }

  EXTRA_PROJECTS.forEach((spec, projectIndex) => {
    const projectId = demoId(2000, projectIndex + 1);
    dataset.commitments.push(
      { id: demoId(4500 + projectIndex, 1), workspace_id: dataset.workspace.id, project_id: projectId, counterparty_id: demoId(4000, 1 + projectIndex % 6), source_type: "purchase_order", description: `Zamówienie urządzeń – ${spec.shortName}`, amount: 182000 + projectIndex * 74000, expected_date: atDay(reference, 12 + projectIndex * 7), status: spec.status === "tender" ? "draft" : "open" },
      { id: demoId(4500 + projectIndex, 2), workspace_id: dataset.workspace.id, project_id: projectId, counterparty_id: demoId(4000, 4), source_type: "subcontract", description: "Podwykonawstwo specjalistyczne / prefabrykacja", amount: 96000 + projectIndex * 33000, expected_date: atDay(reference, 28 + projectIndex * 6), status: "approved" }
    );
  });
}

function addEmployees(dataset: DemoBlueprint, reference: Date) {
  const employees = [
    ["E013", "Radosław", "Kubiak", "Project Manager", 21200, 132],
    ["E014", "Mateusz", "Sikora", "Koordynator BIM MEP", 15600, 98],
    ["E015", "Przemysław", "Walczak", "Brygadzista HVAC", 13200, 83],
    ["E016", "Dawid", "Kozłowski", "Monter instalacji technologicznych", 11300, 71],
    ["E017", "Grzegorz", "Michalak", "Automatyk BMS", 14800, 93],
    ["E018", "Sebastian", "Krawczyk", "Spawacz TIG / monter", 12600, 79],
    ["E019", "Joanna", "Woźniak", "Specjalista BHP i jakości", 12100, 76],
    ["E020", "Marcin", "Szczepański", "Logistyk budów", 10300, 65]
  ] as const;

  employees.forEach(([employeeNumber, firstName, lastName, position, monthlyCost, hourlyCost], employeeIndex) => {
    const employeeId = demoId(5000, employeeIndex + 1);
    dataset.employees.push({
      id: employeeId, workspace_id: dataset.workspace.id, employee_number: employeeNumber, first_name: firstName, last_name: lastName,
      email: `${firstName.toLowerCase()}.${lastName.toLowerCase()}@octopus-demo.pl`, phone: `+48 691 ${310 + employeeIndex} ${510 + employeeIndex}`,
      status: "active", hired_at: atDay(reference, -470 + employeeIndex * 18)
    });
    dataset.employments.push({
      id: demoId(5001, employeeIndex + 1), workspace_id: dataset.workspace.id, employee_id: employeeId,
      employment_type: employeeIndex === 4 ? "b2b" : "employment_contract", position, valid_from: atDay(reference, -450 + employeeIndex * 18),
      full_time_equivalent: 1, monthly_cost: monthlyCost, hourly_cost: hourlyCost, currency: "PLN"
    });
    dataset.qualifications.push({
      id: demoId(5002, employeeIndex + 1), workspace_id: dataset.workspace.id, employee_id: employeeId,
      qualification_type: employeeIndex === 0 ? "Uprawnienia budowlane sanitarne" : employeeIndex === 4 ? "Automatyka BMS / SEP E" : employeeIndex === 5 ? "Spawacz TIG 141" : "BHP / prace instalacyjne",
      number: `EXT-UPR/${2022 + employeeIndex}/${220 + employeeIndex}`, issued_at: atDay(reference, -730 + employeeIndex * 20),
      valid_until: employeeIndex === 5 ? atDay(reference, 24) : employeeIndex === 6 ? atDay(reference, 9) : atDay(reference, 260 + employeeIndex * 18),
      status: "valid"
    });
    dataset.medicalExams.push({
      id: demoId(5003, employeeIndex + 1), workspace_id: dataset.workspace.id, employee_id: employeeId,
      exam_type: "Badania okresowe / zdolność do pracy", examined_at: atDay(reference, -250 + employeeIndex * 8),
      valid_until: employeeIndex === 3 ? atDay(reference, 17) : atDay(reference, 210 + employeeIndex * 12), status: "valid"
    });
    if (employeeIndex === 2 || employeeIndex === 7) dataset.leaveRequests.push({
      id: demoId(5004, employeeIndex + 1), workspace_id: dataset.workspace.id, employee_id: employeeId, leave_type: "annual",
      date_from: atDay(reference, 26 + employeeIndex), date_to: atDay(reference, 30 + employeeIndex), days: 5, status: "pending"
    });
    for (let day = 0; day < 10; day += 1) {
      dataset.timesheets.push({
        id: demoId(5100 + employeeIndex, day + 1), workspace_id: dataset.workspace.id, employee_id: employeeId,
        project_id: demoId(2000, ((employeeIndex + day) % EXTRA_PROJECTS.length) + 1), work_date: atDay(reference, -day - 1),
        hours: day === 5 ? 7 : 8, overtime_hours: day === 0 && employeeIndex % 3 === 0 ? 2 : 0,
        status: day === 0 && employeeIndex % 4 === 0 ? "submitted" : "approved"
      });
    }
  });

  EXTRA_PROJECTS.forEach((spec, projectIndex) => {
    for (let slot = 0; slot < 5; slot += 1) {
      const employeeIndex = (projectIndex + slot) % employees.length;
      dataset.assignments.push({
        id: demoId(5200 + projectIndex, slot + 1), workspace_id: dataset.workspace.id,
        employee_id: demoId(5000, employeeIndex + 1), project_id: demoId(2000, projectIndex + 1),
        role: slot === 0 ? "Project Manager" : slot === 1 ? "Koordynator / inżynier" : slot === 2 ? "Brygadzista" : "Wykonawca specjalistyczny",
        date_from: atDay(reference, spec.startOffset), date_to: atDay(reference, spec.finishOffset), allocation_percent: slot === 0 ? 55 : slot === 1 ? 70 : 100
      });
    }
  });
}

function addWarehouse(dataset: DemoBlueprint, userId: string, reference: Date) {
  const extraWarehouses = [
    { id: demoId(6000, 1), workspace_id: dataset.workspace.id, name: "Magazyn budowy – Poznań", location: "Poznań – zaplecze Portowa", warehouse_type: "project", active: true },
    { id: demoId(6000, 2), workspace_id: dataset.workspace.id, name: "Kontener narzędziowy – Pharma", location: "Poznań – budowa Pharma", warehouse_type: "project", active: true }
  ];
  dataset.warehouses.push(...extraWarehouses);

  const items = [
    ["INOX-DN50", "Rura nierdzewna DN50", "material", "m", 90, 88],
    ["INOX-DN80", "Rura nierdzewna DN80", "material", "m", 70, 126],
    ["VAV-250", "Regulator VAV fi250", "device", "szt", 6, 1680],
    ["KL-PPOZ-400", "Klapa ppoż. EI120 400x400", "device", "szt", 8, 2140],
    ["CZ-BMS-T", "Czujnik temperatury BMS", "device", "szt", 18, 310],
    ["CZ-BMS-DP", "Czujnik różnicy ciśnień", "device", "szt", 10, 890],
    ["POM-40-120", "Pompa obiegowa 40-120", "device", "szt", 3, 7200],
    ["IZO-WEL-50", "Wełna techniczna 50 mm z folią alu", "material", "m2", 180, 46],
    ["PREFA-KAN", "Prefabrykat kanału wentylacyjnego", "material", "m2", 300, 164],
    ["NAR-TIG", "Spawarka TIG inwertorowa", "tool", "szt", 1, 8900],
    ["NAR-KAMERA", "Kamera termowizyjna", "tool", "szt", 1, 9600],
    ["CHEM-DEZ", "Środek do dezynfekcji instalacji", "material", "l", 40, 31]
  ] as const;

  items.forEach(([sku, name, itemType, unit, minimumStock, unitCost], itemIndex) => {
    const itemId = demoId(6001, itemIndex + 1);
    dataset.stockItems.push({ id: itemId, workspace_id: dataset.workspace.id, sku, name, item_type: itemType, unit, minimum_stock: minimumStock, serial_tracking: itemType === "tool", active: true });
    const pzId = demoId(6100, itemIndex + 1);
    dataset.stockMovements.push({ id: pzId, workspace_id: dataset.workspace.id, project_id: null, warehouse_id: demoId(800, 1), movement_type: "PZ", document_number: `PZ/EXT/${String(itemIndex + 1).padStart(3, "0")}`, movement_date: atDay(reference, -38 + itemIndex), status: "approved", created_by: userId });
    dataset.stockMovementLines.push({ id: demoId(6200, itemIndex + 1), workspace_id: dataset.workspace.id, movement_id: pzId, stock_item_id: itemId, quantity: Number(minimumStock) * (itemIndex % 4 === 0 ? 0.85 : 2.8), unit_cost: unitCost, lot_number: `EXT-${202600 + itemIndex}` });
    const projectIndex = itemIndex % EXTRA_PROJECTS.length;
    dataset.reservations.push({
      id: demoId(6300, itemIndex + 1), workspace_id: dataset.workspace.id, project_id: demoId(2000, projectIndex + 1), warehouse_id: demoId(800, 1),
      stock_item_id: itemId, quantity: Math.max(1, Math.round(Number(minimumStock) * 0.75)), required_at: atDay(reference, 6 + itemIndex * 2),
      status: itemIndex % 4 === 0 ? "shortage" : "open"
    });
    dataset.materialChainEvents.push({
      id: demoId(6400, itemIndex + 1), workspace_id: dataset.workspace.id, project_id: demoId(2000, projectIndex + 1), stock_item_id: itemId,
      stage: itemIndex % 4 === 0 ? "shortage" : "reserved", source_type: "reservation", source_id: demoId(6300, itemIndex + 1),
      quantity: Math.max(1, Math.round(Number(minimumStock) * 0.75)), unit, amount: roundMoney(Math.max(1, Math.round(Number(minimumStock) * 0.75)) * Number(unitCost)),
      status: itemIndex % 4 === 0 ? "attention" : "confirmed", occurred_at: atIso(reference, -2 + itemIndex * 0.05), created_by: userId
    });
  });

  for (let index = 0; index < 8; index += 1) {
    const movementId = demoId(6500, index + 1);
    const targetWarehouse = index % 2 ? demoId(6000, 1) : demoId(6000, 2);
    dataset.stockMovements.push({ id: movementId, workspace_id: dataset.workspace.id, project_id: demoId(2000, (index % EXTRA_PROJECTS.length) + 1), warehouse_id: demoId(800, 1), target_warehouse_id: targetWarehouse, movement_type: "MM", document_number: `MM/EXT/${String(index + 1).padStart(3, "0")}`, movement_date: atDay(reference, -8 + index), status: "approved", created_by: userId });
    dataset.stockMovementLines.push({ id: demoId(6600, index + 1), workspace_id: dataset.workspace.id, movement_id: movementId, stock_item_id: demoId(6001, index + 1), quantity: 8 + index * 2, unit_cost: Number(items[index][5]), lot_number: null });
  }
}

function addFleet(dataset: DemoBlueprint, reference: Date) {
  const vehicles = [
    ["PWA 1MAS", "VF1MA0000R0700001", "van", "Renault", "Master", 2024, "leasing", 26780],
    ["PWA 6PRO", "YARVFAHK5R0800002", "van", "Toyota", "Proace", 2024, "leasing", 19440],
    ["PWA 5OCT", "TMBAR7NE9R0900003", "car", "Skoda", "Octavia", 2024, "leasing", 31460],
    ["PWA 2IVE", "ZCFC735B405000004", "truck", "Iveco", "Daily", 2023, "owned", 48620]
  ] as const;

  vehicles.forEach(([registration, vin, vehicleType, make, model, year, ownership, mileage], vehicleIndex) => {
    const vehicleId = demoId(7000, vehicleIndex + 1);
    const employeeId = demoId(5000, (vehicleIndex % 8) + 1);
    const projectId = demoId(2000, (vehicleIndex % EXTRA_PROJECTS.length) + 1);
    dataset.vehicles.push({ id: vehicleId, workspace_id: dataset.workspace.id, registration_number: registration, vin, vehicle_type: vehicleType, make, model, production_year: year, ownership_type: ownership, status: "active", current_mileage: mileage });
    for (let fuelIndex = 0; fuelIndex < 3; fuelIndex += 1) dataset.fuelEntries.push({
      id: demoId(7010 + vehicleIndex, fuelIndex + 1), workspace_id: dataset.workspace.id, vehicle_id: vehicleId, project_id: projectId,
      fueled_at: atIso(reference, -18 + fuelIndex * 7 + vehicleIndex), liters: 48 + vehicleIndex * 7 + fuelIndex * 3, gross_amount: 318 + vehicleIndex * 49 + fuelIndex * 22,
      mileage: Number(mileage) - 820 + fuelIndex * 310 + vehicleIndex * 20
    });
    for (let tripIndex = 0; tripIndex < 2; tripIndex += 1) dataset.trips.push({
      id: demoId(7020 + vehicleIndex, tripIndex + 1), workspace_id: dataset.workspace.id, vehicle_id: vehicleId, employee_id: employeeId, project_id: projectId,
      started_at: atIso(reference, -6 + tripIndex * 3 + vehicleIndex, -4), finished_at: atIso(reference, -6 + tripIndex * 3 + vehicleIndex, 3),
      start_location: "Wągrowiec", end_location: EXTRA_PROJECTS[vehicleIndex % EXTRA_PROJECTS.length].city, distance_km: 78 + vehicleIndex * 26 + tripIndex * 8,
      purpose: tripIndex === 0 ? "Dojazd brygady / nadzór budowy" : "Dostawa materiałów i odbiór dokumentów"
    });
    dataset.serviceOrders.push({
      id: demoId(7030, vehicleIndex + 1), workspace_id: dataset.workspace.id, vehicle_id: vehicleId,
      service_type: vehicleIndex === 3 ? "Przegląd zabudowy skrzyniowej i windy" : "Przegląd okresowy / olej / filtry",
      opened_at: atDay(reference, -78 + vehicleIndex * 11), closed_at: atDay(reference, -76 + vehicleIndex * 11),
      next_due_date: atDay(reference, 46 + vehicleIndex * 33), next_due_mileage: Number(mileage) + 14000, cost: 1180 + vehicleIndex * 520, status: "closed"
    });
    dataset.vehicleDocuments.push({
      id: demoId(7040, vehicleIndex + 1), workspace_id: dataset.workspace.id, vehicle_id: vehicleId, document_type: "OC / AC / badanie techniczne",
      number: `FLOTA-${String(vehicleIndex + 7).padStart(3, "0")}`, valid_from: atDay(reference, -310),
      valid_until: vehicleIndex === 1 ? atDay(reference, 19) : atDay(reference, 130 + vehicleIndex * 40), status: "valid"
    });
    if (vehicleIndex === 2) dataset.damageCases.push({ id: demoId(7050, 1), workspace_id: dataset.workspace.id, vehicle_id: vehicleId, occurred_at: atIso(reference, -9), description: "Odprysk szyby podczas przejazdu na budowę – zgłoszenie do ubezpieczyciela.", status: "reported", cost: 1350 });
    dataset.vehicleAllocations.push({
      id: demoId(7060, vehicleIndex + 1), workspace_id: dataset.workspace.id, vehicle_id: vehicleId, project_id: projectId, employee_id: employeeId,
      date_from: atDay(reference, -42 + vehicleIndex * 3), date_to: atDay(reference, 90 + vehicleIndex * 10), allocation_method: "time", allocation_percent: vehicleIndex === 2 ? 55 : 85
    });
  });
}

function addReportsAndAlerts(dataset: DemoBlueprint, userId: string, reference: Date) {
  EXTRA_PROJECTS.forEach((spec, projectIndex) => {
    const projectId = demoId(2000, projectIndex + 1);
    dataset.notifications.push({
      id: demoId(8000 + projectIndex, 1), workspace_id: dataset.workspace.id, project_id: projectId, user_id: userId,
      event_type: spec.status === "paused" ? "project.paused" : spec.status === "tender" ? "project.tender" : "project.health",
      title: `${spec.shortName} – ${spec.status === "paused" ? "wymagana decyzja dot. wznowienia" : spec.status === "tender" ? "przygotuj start po podpisaniu umowy" : "przegląd ryzyk tygodnia"}`,
      body: spec.specialRisk, severity: spec.status === "paused" ? "critical" : "warning", created_at: atIso(reference, -0.8 + projectIndex * 0.08)
    });
    dataset.reportDefinitions.push({
      id: demoId(8010, projectIndex + 1), workspace_id: dataset.workspace.id, project_id: projectId,
      name: `Raport tygodniowy – ${spec.shortName}`, report_type: "project_weekly",
      definition: { progress: true, schedule: true, finance: true, procurement: true, quality: true, risks: true }, schedule_rule: "weekly:friday", active: true, created_by: userId
    });
  });

  [
    ["commissioning", "Rozruch dużych instalacji", "Rozruch należy dzielić na precommissioning, testy funkcjonalne, regulację i odbiór z udziałem inwestora."],
    ["bim", "Koordynacja BIM przed prefabrykacją", "Produkcję prefabrykatów uruchamiaj dopiero po zamknięciu kolizji i zatwierdzeniu rewizji modelu."],
    ["quality", "Kontrola oznakowania instalacji", "Oznaczenia, kierunki przepływu i identyfikacja urządzeń powinny być kontrolowane przed dokumentacją powykonawczą."],
    ["finance", "Prognoza EAC przy zmianach zakresu", "Zmiany niezatwierdzone przez inwestora powinny być widoczne oddzielnie od bazowego budżetu i marży."],
    ["warehouse", "Dostawy just-in-time", "Duże urządzenia nie powinny zajmować placu budowy przed przygotowaniem fundamentów, transportu pionowego i strefy montażu."]
  ].forEach(([entryType, title, solution], index) => dataset.knowledgeEntries.push({
    id: demoId(8020, index + 1), workspace_id: dataset.workspace.id, source_project_id: demoId(2000, (index % EXTRA_PROJECTS.length) + 1),
    entry_type: entryType, title, summary: solution, solution, tags: [entryType, "real-build-demo", "octopus"], metrics: { confidence: 0.96 }, source_references: [], status: "approved", approved_by: userId, approved_at: atIso(reference, -6 + index)
  }));
}

export function extendDemoDataset(dataset: DemoBlueprint, userId: string, referenceDate = new Date()) {
  const reference = refDate(referenceDate);
  EXTRA_PROJECTS.forEach((spec, projectIndex) => addProjectDataset(dataset, spec, projectIndex, userId, reference));
  addFinance(dataset, userId, reference);
  addEmployees(dataset, reference);
  addWarehouse(dataset, userId, reference);
  addFleet(dataset, reference);
  addReportsAndAlerts(dataset, userId, reference);
  return dataset;
}

export const EXTENDED_DEMO_EXPECTATIONS = {
  projects: 13,
  employees: 20,
  vehicles: 10,
  warehouses: 5,
  invoices: 50,
  documents: 60,
  boqItems: 88,
  scheduleActivities: 70
} as const;
