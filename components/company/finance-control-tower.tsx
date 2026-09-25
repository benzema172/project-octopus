"use client";

import { useMemo, useState, useTransition, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowRight,
  Banknote,
  Bot,
  Building2,
  CheckCircle2,
  CircleDollarSign,
  FileCheck2,
  Landmark,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
  TrendingUp,
  Upload,
  WalletCards
} from "lucide-react";
import { ModuleDropzoneLink } from "@/components/documents/module-dropzone-link";
import type { FinanceCashflowWeek, FinanceControlData, FinanceScenario } from "@/lib/types/finance-control";

type Tab = "cockpit" | "cashflow" | "projects" | "settlements" | "documents" | "accounting" | "control" | "reports";
type Props = { workspaceId: string; data: FinanceControlData; canWrite: boolean; canApprove: boolean; initialTab?: string; accountingContent?: ReactNode };

const tabs: Array<[Tab, string]> = [
  ["cockpit", "Pulpit"],
  ["cashflow", "Cash flow"],
  ["projects", "Inwestycje"],
  ["settlements", "Rozrachunki"],
  ["documents", "Dokumenty"],
  ["accounting", "Księgowość"],
  ["control", "Kontrola kosztów"],
  ["reports", "Raporty"]
];

function money(value: unknown) {
  const amount = Number(value ?? 0);
  return new Intl.NumberFormat("pl-PL", { style: "currency", currency: "PLN", maximumFractionDigits: 0 }).format(Number.isFinite(amount) ? amount : 0);
}
function percent(value: unknown) {
  const amount = Number(value);
  return Number.isFinite(amount) ? `${amount.toFixed(1)}%` : "—";
}
function date(value: unknown) {
  if (!value) return "—";
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toLocaleDateString("pl-PL");
}
function severityLabel(value: string) {
  if (value === "critical") return "Krytyczne";
  if (value === "high") return "Wysokie";
  if (value === "low") return "Niskie";
  return "Średnie";
}
function paymentStateLabel(status: string) {
  if (status === "matched") return "Uzgodniona";
  if (status === "suggested") return "Sugestia";
  if (status === "ignored") return "Pominięta";
  return "Nieuzgodniona";
}

function CashflowChart({ weeks }: { weeks: FinanceCashflowWeek[] }) {
  const max = Math.max(1, ...weeks.flatMap((week) => [week.inflow, week.outflow, week.unknown_outflow]));
  return <div className="fct-chart" aria-label="Prognoza cash flow na 13 tygodni">
    <div className="fct-chart__legend"><span className="is-inflow">Wpływy</span><span className="is-outflow">Znane wypływy</span><span className="is-unknown">Niezweryfikowane</span></div>
    <div className="fct-chart__grid">
      {weeks.map((week) => <div className="fct-chart__week" key={week.week_index} title={`${date(week.week_start)} · wpływy ${money(week.inflow)} · wypływy ${money(week.outflow)} · niezweryfikowane ${money(week.unknown_outflow)}`}>
        <div className="fct-chart__bars">
          <span className="is-inflow" style={{ height: `${Math.max(2, week.inflow / max * 100)}%` }} />
          <span className="is-outflow" style={{ height: `${Math.max(2, week.outflow / max * 100)}%` }} />
          <span className="is-unknown" style={{ height: `${Math.max(2, week.unknown_outflow / max * 100)}%` }} />
        </div>
        <small>{new Date(`${week.week_start}T12:00:00`).toLocaleDateString("pl-PL", { day: "2-digit", month: "2-digit" })}</small>
      </div>)}
    </div>
  </div>;
}

function scenarioResult(weeks: FinanceCashflowWeek[], scenario: FinanceScenario | { assumptions: Record<string, unknown> }) {
  const assumptions = scenario.assumptions ?? {};
  const inflowFactor = Number(assumptions.inflowFactor ?? 1);
  const outflowFactor = Number(assumptions.outflowFactor ?? 1);
  const includeUnknown = Boolean(assumptions.includeUnknown ?? false);
  return weeks.reduce((sum, week) => sum + week.inflow * inflowFactor - week.outflow * outflowFactor - (includeUnknown ? week.unknown_outflow : 0), 0);
}

function normalizedTab(value?: string): Tab {
  return tabs.some(([id]) => id === value) ? value as Tab : "cockpit";
}

export function FinanceControlTower({ workspaceId, data, canWrite, canApprove, initialTab, accountingContent }: Props) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<Tab>(() => normalizedTab(initialTab));

  const selectTab = (nextTab: Tab) => {
    setActiveTab(nextTab);

    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    const serverLayer = url.searchParams.get("tab");

    if (nextTab === "documents" || nextTab === "accounting") {
      if (serverLayer !== nextTab) {
        url.searchParams.set("tab", nextTab);
        router.replace(`${url.pathname}${url.search}`, { scroll: false });
      }
      return;
    }

    if (serverLayer === "documents" || serverLayer === "accounting") {
      url.searchParams.delete("tab");
      router.replace(`${url.pathname}${url.search}`, { scroll: false });
    }
  };
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cfoAnswer, setCfoAnswer] = useState<string | null>(null);
  const [cfoMode, setCfoMode] = useState<string | null>(null);

  const net13 = useMemo(() => data.cashflow.reduce((sum, week) => sum + week.net, 0), [data.cashflow]);
  const unknown13 = useMemo(() => data.cashflow.reduce((sum, week) => sum + week.unknown_outflow, 0), [data.cashflow]);
  const riskyProjects = useMemo(() => data.projects.filter((project) => project.forecast_variance > 0).sort((a, b) => b.forecast_variance - a.forecast_variance), [data.projects]);
  const builtInScenarios = [
    { name: "Bazowy", type: "base", assumptions: { inflowFactor: 1, outflowFactor: 1, includeUnknown: false } },
    { name: "Optymistyczny", type: "optimistic", assumptions: { inflowFactor: 1.05, outflowFactor: 0.98, includeUnknown: false } },
    { name: "Stress", type: "stress", assumptions: { inflowFactor: 0.8, outflowFactor: 1.12, includeUnknown: true } }
  ];

  const run = async (action: string, payload: Record<string, unknown>, success: string) => {
    setMessage(null); setError(null);
    const response = await fetch("/api/company/finance-control", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspaceId, action, payload })
    });
    const result = await response.json().catch(() => ({})) as { error?: string; answer?: string; mode?: string; result?: Record<string, unknown> };
    if (!response.ok) throw new Error(result.error ?? "Operacja nie powiodła się.");
    if (result.answer) { setCfoAnswer(result.answer); setCfoMode(result.mode ?? null); }
    setMessage(success);
    return result;
  };

  const refreshAfter = (work: () => Promise<unknown>) => {
    startTransition(async () => {
      try { await work(); router.refresh(); }
      catch (caught) { setError(caught instanceof Error ? caught.message : "Operacja nie powiodła się."); }
    });
  };

  const importBank = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const input = event.currentTarget.elements.namedItem("bankFile") as HTMLInputElement | null;
    const file = input?.files?.[0];
    if (!file) { setError("Wybierz plik CSV lub MT940."); return; }
    refreshAfter(async () => run("bank_import", { fileName: file.name, content: await file.text() }, "Import bankowy zakończony. Octopus przeliczył propozycje dopasowań."));
  };

  const addCashflow = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    refreshAfter(() => run("cashflow_item_add", {
      flowType: form.get("flowType"), label: form.get("label"), expectedDate: form.get("expectedDate"),
      amount: form.get("amount"), probability: Number(form.get("probability") ?? 100) / 100
    }, "Pozycja została dodana do prognozy cash flow."));
  };

  const saveScenario = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    refreshAfter(() => run("scenario_save", {
      name: form.get("name"), scenarioType: "custom", horizonWeeks: 13,
      assumptions: {
        inflowFactor: Number(form.get("inflowFactor") ?? 100) / 100,
        outflowFactor: Number(form.get("outflowFactor") ?? 100) / 100,
        includeUnknown: form.get("includeUnknown") === "on"
      }
    }, "Scenariusz Financial Twin został zapisany."));
  };

  const askCfo = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    startTransition(async () => {
      try { await run("cfo_ask", { question: form.get("question") }, "Octopus CFO przeanalizował aktualne dane."); }
      catch (caught) { setError(caught instanceof Error ? caught.message : "Nie udało się uzyskać odpowiedzi CFO."); }
    });
  };

  return <section className="fct-shell" aria-label="Finance Control Tower">
    <header className="fct-hero">
      <div>
        <span className="fct-eyebrow"><ShieldCheck size={15}/> Finance Control Tower 2.0</span>
        <h1>Centrum finansowe firmy</h1>
        <p>Płynność, rentowność inwestycji, rozrachunki i ryzyka w jednej warstwie zarządczej. Dokument źródłowy pozostaje prawdą księgową — Control Tower tylko ją porządkuje, prognozuje i wskazuje decyzje.</p>
      </div>
      <div className="fct-hero__status">
        <span><strong>{data.actions.length}</strong><small>do decyzji</small></span>
        <span><strong>{data.summary.bankUnmatched ?? 0}</strong><small>bank do uzgodnienia</small></span>
        <span className={Number(data.summary.paymentStateUnknownCount ?? 0) ? "is-warning" : ""}><strong>{data.summary.paymentStateUnknownCount ?? 0}</strong><small>niezweryfikowanych FV</small></span>
      </div>
    </header>

    <div className="fct-tabs-row">
      <nav className="fct-tabs" aria-label="Sekcje finansów">
        {tabs.map(([id, label]) => <button key={id} type="button" className={activeTab === id ? "is-active" : ""} onClick={() => selectTab(id)}>{label}</button>)}
      </nav>
      {canWrite ? <ModuleDropzoneLink workspaceId={workspaceId} sourceModule="finance" variant="primary" /> : null}
    </div>

    {message ? <p className="fct-message is-success">{message}</p> : null}
    {error ? <p className="fct-message is-error">{error}</p> : null}

    {activeTab === "accounting" ? accountingContent ?? null : null}

    {activeTab === "cockpit" ? <>
      <div className="fct-kpis">
        <article><span><Landmark size={16}/> Saldo bankowe</span><strong>{data.summary.bankBalance == null ? "Brak importu" : money(data.summary.bankBalance)}</strong><small>{data.summary.bankBalance == null ? "Zaimportuj wyciąg z saldem" : "Ostatnie znane saldo"}</small></article>
        <article><span><WalletCards size={16}/> Potwierdzone zobowiązania</span><strong>{money(data.summary.payablesOpen)}</strong><small>{money(data.summary.due14Gross)} do 14 dni</small></article>
        <article className={Number(data.summary.paymentStateUnknownGross ?? 0) ? "is-warning" : ""}><span><AlertTriangle size={16}/> Stan płatności nieznany</span><strong>{money(data.summary.paymentStateUnknownGross)}</strong><small>{data.summary.paymentStateUnknownCount ?? 0} dokumentów do uzgodnienia</small></article>
        <article><span><TrendingUp size={16}/> Należności</span><strong>{money(data.summary.receivablesOpen)}</strong><small>Potwierdzony stan rozrachunku</small></article>
        <article><span><CircleDollarSign size={16}/> Bilans 13 tygodni</span><strong>{money(net13)}</strong><small>Bez niezweryfikowanych płatności</small></article>
        <article className={riskyProjects.length ? "is-warning" : ""}><span><Building2 size={16}/> Ryzyko inwestycji</span><strong>{riskyProjects.length}</strong><small>prognozowanych przekroczeń budżetu</small></article>
      </div>

      <div className="fct-grid fct-grid--wide-left">
        <article className="fct-panel">
          <div className="fct-panel__heading"><div><span>13 tygodni</span><h2>Prognoza płynności</h2></div><button type="button" className="fct-link" onClick={() => setActiveTab("cashflow")}>Szczegóły <ArrowRight size={14}/></button></div>
          <CashflowChart weeks={data.cashflow}/>
          {unknown13 > 0 ? <p className="fct-note"><AlertTriangle size={14}/> Poza znanym cash flow pozostaje {money(unknown13)} niezweryfikowanych faktur zakupowych.</p> : null}
        </article>
        <article className="fct-panel">
          <div className="fct-panel__heading"><div><span>Priorytety</span><h2>Do decyzji</h2></div></div>
          <div className="fct-actions">
            {data.actions.slice(0, 6).map((action, index) => <button type="button" key={`${action.kind}-${index}`} className={`fct-action is-${action.severity}`} onClick={() => setActiveTab(action.kind === "payment_truth" || action.kind === "overdue" ? "settlements" : action.kind === "procurement" || action.kind === "allocation" ? "control" : "cockpit")}>
              <span>{severityLabel(action.severity)} · {money(action.impactAmount)}</span><strong>{action.title}</strong><small>{action.description}</small>
            </button>)}
            {!data.actions.length ? <div className="fct-empty"><CheckCircle2 size={22}/><strong>Brak pilnych decyzji finansowych</strong><span>Octopus nie wykrywa obecnie wyjątków wymagających reakcji.</span></div> : null}
          </div>
        </article>
      </div>

      <article className="fct-panel">
        <div className="fct-panel__heading"><div><span>Actual · Committed · Forecast</span><h2>Zdrowie finansowe inwestycji</h2></div><button type="button" className="fct-link" onClick={() => setActiveTab("projects")}>Wszystkie inwestycje <ArrowRight size={14}/></button></div>
        <div className="fct-table-wrap"><table className="fct-table"><thead><tr><th>Inwestycja</th><th>Budżet</th><th>Actual</th><th>Committed</th><th>Forecast</th><th>Marża</th><th>Odchylenie</th></tr></thead><tbody>
          {data.projects.slice(0, 8).map((project) => <tr key={project.project_id}><td><strong>{project.project_name}</strong><small>{project.project_status}</small></td><td>{money(project.budget_cost)}</td><td>{money(project.actual_cost)}</td><td>{money(project.committed_cost)}</td><td>{money(project.forecast_cost)}</td><td>{percent(project.margin_percent)}</td><td className={project.forecast_variance > 0 ? "is-negative" : "is-positive"}>{project.forecast_variance > 0 ? "+" : ""}{money(project.forecast_variance)}</td></tr>)}
          {!data.projects.length ? <tr><td colSpan={7}>Brak inwestycji z danymi finansowymi.</td></tr> : null}
        </tbody></table></div>
      </article>
    </> : null}

    {activeTab === "cashflow" ? <div className="fct-grid fct-grid--wide-left">
      <article className="fct-panel"><div className="fct-panel__heading"><div><span>13 tygodni</span><h2>Cash flow firmy</h2></div></div><CashflowChart weeks={data.cashflow}/><div className="fct-table-wrap"><table className="fct-table"><thead><tr><th>Tydzień</th><th>Wpływy</th><th>Znane wypływy</th><th>Niezweryfikowane</th><th>Netto</th></tr></thead><tbody>{data.cashflow.map((week) => <tr key={week.week_index}><td>{date(week.week_start)}</td><td>{money(week.inflow)}</td><td>{money(week.outflow)}</td><td>{money(week.unknown_outflow)}</td><td className={week.net < 0 ? "is-negative" : "is-positive"}>{money(week.net)}</td></tr>)}</tbody></table></div></article>
      <article className="fct-panel"><div className="fct-panel__heading"><div><span>Prognoza</span><h2>Dodaj przyszły przepływ</h2></div></div>{canWrite ? <form className="fct-form" onSubmit={addCashflow}><label>Rodzaj<select name="flowType" defaultValue="outflow"><option value="outflow">Wydatek</option><option value="inflow">Wpływ</option></select></label><label>Opis<input name="label" required placeholder="np. podatek, leasing, transza"/></label><label>Data<input type="date" name="expectedDate" required/></label><label>Kwota<input type="number" name="amount" step="0.01" min="0.01" required/></label><label>Prawdopodobieństwo<select name="probability" defaultValue="100"><option value="100">100%</option><option value="80">80%</option><option value="50">50%</option></select></label><button className="primary-button" disabled={pending}>{pending ? <LoaderCircle className="spin" size={15}/> : null}Dodaj do prognozy</button></form> : <p>Masz dostęp tylko do odczytu.</p>}</article>
    </div> : null}

    {activeTab === "projects" ? <article className="fct-panel"><div className="fct-panel__heading"><div><span>Rentowność</span><h2>Actual / Committed / Forecast at Completion</h2></div></div><p className="fct-intro">Actual to koszt już przypisany. Committed obejmuje aktywne zobowiązania i zamówienia. Forecast pokazuje przewidywany koszt końcowy i pozwala wykryć przekroczenie zanim przyjdzie ostatnia faktura.</p><div className="fct-table-wrap"><table className="fct-table"><thead><tr><th>Inwestycja</th><th>Przychód</th><th>Budżet</th><th>Actual</th><th>Committed</th><th>Forecast</th><th>Marża</th><th>Δ budżetu</th></tr></thead><tbody>{data.projects.map((project) => <tr key={project.project_id}><td><strong>{project.project_name}</strong><small>{project.project_status}</small></td><td>{money(project.revenue_value)}</td><td>{money(project.budget_cost)}</td><td>{money(project.actual_cost)}</td><td>{money(project.committed_cost)}</td><td>{money(project.forecast_cost)}</td><td>{money(project.margin_amount)} <small>{percent(project.margin_percent)}</small></td><td className={project.forecast_variance > 0 ? "is-negative" : "is-positive"}>{project.forecast_variance > 0 ? "+" : ""}{money(project.forecast_variance)}</td></tr>)}</tbody></table></div></article> : null}

    {activeTab === "settlements" ? <div className="fct-grid fct-grid--wide-left">
      <article className="fct-panel"><div className="fct-panel__heading"><div><span>Payment truth</span><h2>Rozrachunki i bank</h2></div></div><div className="fct-payment-states"><span><b>✓</b><strong>Zapłacona</strong><small>potwierdzona płatność</small></span><span><b>½</b><strong>Częściowo</strong><small>pozostało saldo</small></span><span><b>!</b><strong>Niezapłacona</strong><small>stan potwierdzony</small></span><span className="is-warning"><b>?</b><strong>Niezweryfikowana</strong><small>{money(data.summary.paymentStateUnknownGross)}</small></span></div>
        <h3>Ostatnie transakcje bankowe</h3><div className="fct-table-wrap"><table className="fct-table"><thead><tr><th>Data</th><th>Kontrahent / opis</th><th>Kwota</th><th>Saldo</th><th>Status</th></tr></thead><tbody>{data.bankTransactions.slice(0, 30).map((tx) => <tr key={tx.id}><td>{date(tx.booked_at)}</td><td><strong>{tx.counterparty_name ?? "—"}</strong><small>{tx.title ?? ""}</small></td><td className={tx.amount < 0 ? "is-negative" : "is-positive"}>{money(tx.amount)}</td><td>{tx.balance_after == null ? "—" : money(tx.balance_after)}</td><td>{paymentStateLabel(tx.status)}</td></tr>)}{!data.bankTransactions.length ? <tr><td colSpan={5}>Brak importu bankowego.</td></tr> : null}</tbody></table></div>
      </article>
      <article className="fct-panel"><div className="fct-panel__heading"><div><span>Reconciliation Center</span><h2>Import CSV / MT940</h2></div></div>{canWrite ? <form className="fct-upload" onSubmit={importBank}><Upload size={24}/><p>Wyciąg pozostaje warstwą uzgodnieniową. Import nie księguje płatności automatycznie.</p><input name="bankFile" type="file" accept=".csv,.txt,.sta,.mt940,text/csv,text/plain"/><button className="primary-button" disabled={pending}>{pending ? <LoaderCircle className="spin" size={15}/> : <Banknote size={15}/>}Importuj i dopasuj</button></form> : <p>Brak uprawnienia do importu.</p>}
        <h3>Proponowane dopasowania</h3><div className="fct-match-list">{data.paymentMatches.map((match) => <div key={match.id}><div><span>{Math.round(match.match_score * 100)}% pewności</span><strong>{match.invoice_number} · {money(match.transaction_amount)}</strong><small>{match.reasons.join(" · ") || match.transaction_title}</small></div>{canApprove ? <button type="button" className="approve-button" disabled={pending} onClick={() => refreshAfter(() => run("bank_match_approve", { matchId: match.id }, "Płatność została uzgodniona i rozrachunek przeliczony."))}>Zatwierdź</button> : null}</div>)}{!data.paymentMatches.length ? <p className="fct-empty-copy">Brak oczekujących dopasowań.</p> : null}</div>
      </article>
    </div> : null}

    {activeTab === "documents" ? <div className="fct-grid">
      <article className="fct-panel"><div className="fct-panel__heading"><div><span>KSeF</span><h2>Oficjalny kanał faktur</h2></div><span className={`fct-badge ${data.ksef.configured ? "is-ok" : "is-warning"}`}>{data.ksef.configured ? "Adapter skonfigurowany" : "Adapter oczekuje konfiguracji"}</span></div><div className="fct-doc-stats"><span><strong>{data.ksef.inboxCount}</strong><small>dokumentów KSeF w Inbox</small></span><span><strong>{data.ksef.processedCount}</strong><small>przetworzonych</small></span><span><strong>{date(data.ksef.lastSeenAt)}</strong><small>ostatni dokument</small></span></div><p>KSeF trafia do tego samego Business Inbox co Wrzutnia, ERP i e-mail. Dalej dokument przechodzi: klasyfikację → pozycje → inwestycję/BOQ → kontrolę zakupu → rozrachunek.</p>{canWrite ? <button type="button" className="primary-button" disabled={pending || !data.ksef.configured} onClick={() => refreshAfter(() => run("ksef_sync", {}, data.ksef.configured ? "Synchronizacja KSeF została zlecona." : "Adapter KSeF wymaga konfiguracji."))}><RefreshCw size={15}/>Synchronizuj KSeF</button> : null}{!data.ksef.configured ? <p className="fct-note"><AlertTriangle size={14}/> Kod integracyjny jest gotowy, ale środowisko nie ma jeszcze `KSEF_SYNC_WEBHOOK_URL`. Octopus nie udaje aktywnej synchronizacji bez adaptera.</p> : null}</article>
      <article className="fct-panel"><div className="fct-panel__heading"><div><span>Obieg</span><h2>Jedna prawda dokumentowa</h2></div></div><ol className="fct-pipeline"><li><b>1</b><span><strong>Źródło</strong><small>KSeF · Wrzutnia · ERP · e-mail</small></span></li><li><b>2</b><span><strong>AI / walidacja</strong><small>typ · kontrahent · pozycje</small></span></li><li><b>3</b><span><strong>Kontrola</strong><small>BOQ · PO · PZ · FV</small></span></li><li><b>4</b><span><strong>Finanse</strong><small>alokacja · payment truth · dekret</small></span></li></ol></article>
    </div> : null}

    {activeTab === "control" ? <article className="fct-panel"><div className="fct-panel__heading"><div><span>Money Graph</span><h2>Skąd powstał koszt i gdzie trafił</h2></div></div><p className="fct-intro">Każdy wiersz pokazuje łańcuch dowodowy kosztu. Brak ogniwa nie znika — jest jawnie oznaczony i może trafić do centrum decyzji.</p><div className="fct-money-graph">{data.moneyGraph.map((item) => <div className="fct-money-row" key={item.id}><div className="fct-money-row__title"><span>{item.status} · {item.confidence}%</span><strong>{item.description}</strong><small>{item.invoiceNumber} · {item.projectName}</small></div><div className="fct-money-row__nodes">{[["BOQ",item.boq],["PO",item.purchaseOrder],["PZ",item.receipt],["FV",item.invoice],["Płatność",item.payment],["Inwestycja",item.allocation]].map(([label, ok], index) => <span key={String(label)} className={ok ? "is-ok" : "is-missing"}>{ok ? <CheckCircle2 size={14}/> : <AlertTriangle size={14}/>} {label}{index < 5 ? <ArrowRight size={12}/> : null}</span>)}</div></div>)}{!data.moneyGraph.length ? <div className="fct-empty"><FileCheck2 size={22}/><strong>Brak pełnych łańcuchów zakupowych</strong><span>Pojawią się automatycznie po odczytaniu pozycji faktur i powiązaniu ich z PO/PZ/BOQ.</span></div> : null}</div></article> : null}

    {activeTab === "reports" ? <div className="fct-grid fct-grid--wide-left">
      <article className="fct-panel"><div className="fct-panel__heading"><div><span>Financial Twin</span><h2>Scenariusze płynności</h2></div></div><div className="fct-scenarios">{builtInScenarios.map((scenario) => <div key={scenario.type}><span>{scenario.name}</span><strong>{money(scenarioResult(data.cashflow, scenario))}</strong><small>bilans 13 tygodni{scenario.type === "stress" ? " z nierozpoznanymi wypływami" : ""}</small></div>)}{data.scenarios.map((scenario) => <div key={scenario.id}><span>{scenario.name}</span><strong>{money(scenarioResult(data.cashflow, scenario))}</strong><small>zapisany scenariusz · {scenario.scenario_type}</small></div>)}</div>{canWrite ? <form className="fct-form fct-form--inline" onSubmit={saveScenario}><label>Nazwa<input name="name" required placeholder="np. Opóźnienie klienta"/></label><label>Wpływy %<input name="inflowFactor" type="number" defaultValue="100" min="0" max="200"/></label><label>Wydatki %<input name="outflowFactor" type="number" defaultValue="100" min="0" max="300"/></label><label className="fct-checkbox"><input type="checkbox" name="includeUnknown"/>Uwzględnij niezweryfikowane faktury</label><button className="secondary-button" disabled={pending}>Zapisz scenariusz</button></form> : null}</article>
      <article className="fct-panel"><div className="fct-panel__heading"><div><span>AI grounded in data</span><h2>Octopus CFO</h2></div><Bot size={22}/></div><p>Asystent korzysta wyłącznie z aktualnego payment truth, cash flow, rentowności inwestycji i centrum decyzji. Gdy Gemini jest niedostępny, przechodzi w deterministyczny tryb bez wymyślania danych.</p><form className="fct-cfo" onSubmit={askCfo}><textarea name="question" rows={4} required placeholder="Np. Czy możemy dziś zapłacić 70 000 zł i co to zrobi z płynnością?"/><button className="primary-button" disabled={pending}>{pending ? <LoaderCircle className="spin" size={15}/> : <Bot size={15}/>}Analizuj</button></form>{cfoAnswer ? <div className="fct-cfo-answer"><span>{cfoMode === "gemini" ? "Gemini + dane Octopus" : "Tryb deterministyczny"}</span><p>{cfoAnswer}</p></div> : null}</article>
    </div> : null}
  </section>;
}
