import { ensureDemoDocument, ensureRow, findOne, type Db, type SeedInput } from "@/lib/demo/wysoka-seed-shared";

export async function seedDocuments(db: Db, input: SeedInput) {
  const specs = [
    { name: "[TEST] Opis techniczny instalacji sanitarnych - Wysoka.txt", category: "technical", content: "INWESTYCJA: Wysoka\nZakres: instalacje wod-kan, c.o., gaz, wentylacja i klimatyzacja.\nWymagania: próby szczelności przed zakryciem, dokumentacja powykonawcza, DTR urządzeń.\nRewizja testowa: R2 z dnia 14.08.2026." },
    { name: "[TEST] Kosztorys instalacji - Wysoka.csv", category: "estimate", mimeType: "text/csv", content: "lp;opis;ilosc;jm;cena\n1;Rura PP-R 32;280;m;56\n2;Kanalizacja PVC 110;190;m;92\n3;Kanały SPIRO;310;m2;178\n4;Centrala NW-1;1;kpl;48500" },
    { name: "[TEST] Harmonogram wykonawczy - Wysoka.csv", category: "schedule", mimeType: "text/csv", content: "kod;zadanie;start;koniec;postep\nH04;Rurociagi co;2026-07-20;2026-08-21;68\nH05;Kanaly wentylacyjne;2026-08-03;2026-09-11;37\nH08;Centrala NW-1;2026-09-14;2026-09-25;0" },
    { name: "[TEST] Protokol proby szczelnosci wodociagu - Wysoka.txt", category: "protocol", content: "PROTOKÓŁ TESTOWY\nInstalacja: wodociągowa\nCiśnienie próbne: 10 bar\nCzas: 60 min\nWynik: pozytywny\nUWAGA: wartości demonstracyjne - nie stanowią rzeczywistego pomiaru." },
    { name: "[TEST] Wniosek materialowy WM-03 wentylacja - Wysoka.txt", category: "application", content: "WM-03\nMateriał: kanały SPIRO Ø250, przepustnice Ø250\nProducent testowy: Vent-Demo\nStatus: do weryfikacji\nDokument zawiera dane demonstracyjne." },
    { name: "[TEST] Umowa i dane kontraktowe - Wysoka.txt", category: "contract", content: "Kontrakt testowy WYS/2026/08\nWartość demonstracyjna: 690 000 PLN netto\nTermin końcowy: 30.11.2026\nInwestor: dane testowe." },
    { name: "[TEST] RFI-07 kolizja wentylacji - Wysoka.txt", category: "correspondence", content: "RFI-07\nTemat: kolizja kanału W-12 z podciągiem.\nPropozycja: przesunięcie trasy o 180 mm.\nStatus: oczekuje na potwierdzenie projektanta." },
    { name: "[TEST] Dokumentacja powykonawcza - lista brakow.txt", category: "technical", content: "Lista testowa braków closeout:\n- rysunki powykonawcze\n- DTR centrali NW-1\n- protokół regulacji\n- karta gwarancyjna kotła\n- szkolenie użytkownika" },
    { name: "[TEST] Faktura zakupowa FV-TEST-001 - Wysoka.txt", category: "invoice", content: "FAKTURA TESTOWA\nFV/TEST/08/001\nDostawca: HVAC System Demo Sp. z o.o.\nNetto: 50 000,00 PLN\nVAT: 11 500,00 PLN\nBrutto: 61 500,00 PLN", business: { documentType: "INVOICE", documentNumber: "FV/TEST/08/001", supplierName: "HVAC System Demo Sp. z o.o.", netAmount: 50000, grossAmount: 61500, lines: [{ description: "Centrala NW-1", quantity: 1, unit: "kpl.", netAmount: 50000 }] } },
    { name: "[TEST] PZ-TEST-001 dostawa rur - Wysoka.txt", category: "warehouse", content: "PZ TESTOWE PZ-TEST-001\nRura PP-R 32 PN20 - 300 m\nRura PVC-U 110 - 220 m\nDostawa przyjęta do magazynu budowy Wysoka.", business: { documentType: "PZ", documentNumber: "PZ-TEST-001", lines: [{ description: "Rura PP-R 32 PN20", quantity: 300, unit: "m" }, { description: "Rura PVC-U 110", quantity: 220, unit: "m" }] } },
    { name: "[TEST] WZ-TEST-004 wydanie na montaz - Wysoka.txt", category: "warehouse", content: "WZ TESTOWE WZ-TEST-004\nRura PP-R 32 PN20 - 120 m\nWydano na poziom 0 do montażu.", business: { documentType: "WZ", documentNumber: "WZ-TEST-004", lines: [{ description: "Rura PP-R 32 PN20", quantity: 120, unit: "m" }] } },
    { name: "[TEST] Przerob lipiec 2026 - Wysoka.csv", category: "estimate", mimeType: "text/csv", content: "pozycja;wykonano;odebrano;wartosc\nTEST-001;130;120;7280\nTEST-002;145;140;13340\nTEST-003;90;78;13050" }
  ];
  let created = 0;
  const ids = new Map<string, string>();
  for (const spec of specs) {
    const result = await ensureDemoDocument(db, input, spec);
    if (result.created) created += 1;
    ids.set(spec.name, result.documentId);
  }

  const rfiDocumentId = ids.get("[TEST] RFI-07 kolizja wentylacji - Wysoka.txt");
  if (rfiDocumentId) {
    const rfiDocument = await findOne(db, "documents", { id: rfiDocumentId, workspace_id: input.workspaceId }, "id,current_version_id");
    if (rfiDocument?.current_version_id) {
      for (const [impactType, targetType, summary, riskLevel] of [
        ["coordination_change", "schedule", "[TEST] RFI-07 może przesunąć montaż kanałów W-12 o 2 dni.", "high"],
        ["scope_change", "boq", "[TEST] Przesunięcie trasy zwiększa zakres kanału i zawiesi o około 6 m.", "medium"]
      ] as const) {
        const impact = await ensureRow(db, "document_change_impacts", {
          workspace_id: input.workspaceId, project_id: input.projectId, document_id: rfiDocumentId,
          to_version_id: String(rfiDocument.current_version_id), impact_type: impactType, target_type: targetType
        }, {
          target_id: null, summary, risk_level: riskLevel, evidence: [{ source: "RFI-07", demo: true }], status: "proposed"
        });
        if (impact.created) created += 1;
      }
    }
  }

  return { created, ids };
}
