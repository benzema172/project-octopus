import "server-only";

import type { FinanceControlData } from "@/lib/types/finance-control";

function money(value: unknown) {
  return new Intl.NumberFormat("pl-PL", { style: "currency", currency: "PLN", maximumFractionDigits: 0 }).format(Number(value ?? 0));
}

function fallbackAnswer(data: FinanceControlData, question: string) {
  const summary = data.summary;
  const net13 = data.cashflow.reduce((sum, week) => sum + week.net, 0);
  const unknown = Number(summary.paymentStateUnknownGross ?? 0);
  const worst = [...data.projects].sort((a, b) => b.forecast_variance - a.forecast_variance)[0];
  const parts = [
    `Na podstawie danych w Project Octopus: potwierdzone zobowiązania wynoszą ${money(summary.payablesOpen)}, a należności ${money(summary.receivablesOpen)}.`,
    `Prognozowany bilans znanych przepływów na 13 tygodni to ${money(net13)}.`
  ];
  if (unknown > 0) parts.push(`Dodatkowo ${money(unknown)} faktur zakupowych ma niezweryfikowany stan płatności, więc tej kwoty nie traktuję jako potwierdzonego zobowiązania.`);
  if (worst && worst.forecast_variance > 0) parts.push(`Największe prognozowane przekroczenie budżetu dotyczy inwestycji „${worst.project_name}”: ${money(worst.forecast_variance)}.`);
  if (question.toLowerCase().includes("zapła") || question.toLowerCase().includes("plat")) {
    parts.push("Przed decyzją o płatności sprawdź saldo bankowe oraz nierozpoznane transakcje; Octopus nie zakłada dostępnego salda, jeśli nie zostało ono zaimportowane z banku.");
  }
  return { answer: parts.join(" "), sources: ["payment_truth", "cashflow_13w", "project_health"], mode: "deterministic" as const };
}

export async function answerFinanceCfoQuestion(data: FinanceControlData, question: string) {
  const cleanQuestion = question.trim().slice(0, 1000);
  if (!cleanQuestion) throw new Error("Wpisz pytanie do Octopus CFO.");
  const key = process.env.GEMINI_API_KEY;
  if (!key) return fallbackAnswer(data, cleanQuestion);

  const model = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";
  const context = {
    summary: data.summary,
    cashflow13w: data.cashflow,
    projectHealth: data.projects.slice(0, 30),
    actionCenter: data.actions.slice(0, 20),
    bank: {
      latestBalance: data.summary.bankBalance ?? null,
      transactions: data.summary.bankTransactions ?? 0,
      unmatched: data.summary.bankUnmatched ?? 0
    }
  };
  const prompt = `Jesteś Octopus CFO — asystentem finansowym firmy budowlano-instalacyjnej. Odpowiadasz WYŁĄCZNIE na podstawie przekazanego JSON. Nie wymyślaj salda, terminów, podatków ani płatności. Jeżeli stan płatności jest niezweryfikowany, powiedz to wprost. Rozróżniaj Actual, Committed, Forecast i Budget. Odpowiedź ma być krótka, po polsku, operacyjna i zawierać konkretne liczby. Na końcu podaj linię "Źródła: ..." z użytymi klasami danych spośród: payment_truth, cashflow_13w, project_health, action_center, bank_import.\n\nPYTANIE:\n${cleanQuestion}\n\nDANE:\n${JSON.stringify(context)}`;

  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt }] }], generationConfig: { temperature: 0.1, maxOutputTokens: 650 } }),
      signal: AbortSignal.timeout(18000)
    });
    if (!response.ok) return fallbackAnswer(data, cleanQuestion);
    const payload = await response.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
    const answer = payload.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("\n").trim();
    if (!answer) return fallbackAnswer(data, cleanQuestion);
    return { answer, sources: ["payment_truth", "cashflow_13w", "project_health", "action_center"], mode: "gemini" as const };
  } catch {
    return fallbackAnswer(data, cleanQuestion);
  }
}
