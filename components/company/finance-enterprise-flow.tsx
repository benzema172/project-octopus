"use client";

import { useMemo, useState, useTransition, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowRightLeft, BadgeCheck, BookOpenCheck, Boxes, Check, ChevronDown, CircleDollarSign, FileInput, LoaderCircle, RefreshCw, Route, Send, TrendingDown, TrendingUp } from "lucide-react";

type Row = Record<string, unknown>;
type Props = {
  workspaceId: string;
  data: {
    inbox: Row[];
    accountingEntries: Row[];
    accountingLines: Row[];
    procurementMatches: Row[];
    deviations: Row[];
    priceObservations: Row[];
    projects: Row[];
    invoices: Row[];
    invoiceLines: Row[];
    stockItems: Row[];
    summary: { inboxOpen: number; accountingProposed: number; matchingReview: number; matchingOk: number; deviationsOpen: number };
  };
  canWrite: boolean;
  canApprove: boolean;
};

type Action = "accounting_approve" | "procurement_refresh" | "procurement_approve" | "invoice_line_allocate" | "document_orchestrate" | "deviation_close" | "business_inbox_upsert";

function money(value: unknown) {
  return new Intl.NumberFormat("pl-PL", { style: "currency", currency: "PLN", maximumFractionDigits: 2 }).format(Number(value ?? 0));
}
function number(value: unknown, digits = 2) {
  return new Intl.NumberFormat("pl-PL", { maximumFractionDigits: digits }).format(Number(value ?? 0));
}
function date(value: unknown) {
  if (!value) return "—";
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toLocaleDateString("pl-PL");
}
function statusClass(value: unknown) {
  const status = String(value ?? "");
  if (["processed", "matched", "approved", "closed"].includes(status)) return "status-chip status-chip--positive";
  if (["error", "rejected", "critical"].includes(status)) return "status-chip status-chip--negative";
  return "status-chip status-chip--warning";
}
function Panel({ title, eyebrow, meta, open = false, children }: { title: string; eyebrow: string; meta?: ReactNode; open?: boolean; children: ReactNode }) {
  return <details className="ops-panel ops-disclosure ops-panel--wide" open={open}><summary className="ops-panel__summary"><div><p className="eyebrow">{eyebrow}</p><h2>{title}</h2></div>{meta ? <span>{meta}</span> : null}<ChevronDown size={18} /></summary><div className="ops-panel__content">{children}</div></details>;
}

export function FinanceEnterpriseFlow({ workspaceId, data, canWrite, canApprove }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const projectNames = useMemo(() => new Map(data.projects.map((row) => [String(row.id), String(row.name)])), [data.projects]);
  const invoices = useMemo(() => new Map(data.invoices.map((row) => [String(row.id), row])), [data.invoices]);
  const invoiceLines = useMemo(() => new Map(data.invoiceLines.map((row) => [String(row.id), row])), [data.invoiceLines]);
  const linesByEntry = useMemo(() => {
    const map = new Map<string, Row[]>();
    for (const row of data.accountingLines) {
      const key = String(row.entry_id ?? "");
      map.set(key, [...(map.get(key) ?? []), row]);
    }
    return map;
  }, [data.accountingLines]);

  const run = (action: Action, payload: Record<string, unknown>, success: string) => {
    setMessage(null); setError(null);
    startTransition(async () => {
      const response = await fetch("/api/company/enterprise-flow", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId, action, payload })
      });
      const result = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) { setError(result.error ?? "Operacja nie powiodła się."); return; }
      setMessage(success); router.refresh();
    });
  };

  const submitAllocation = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    run("invoice_line_allocate", {
      invoiceLineId: form.get("invoiceLineId"), projectId: form.get("projectId"), amount: form.get("amount"), costCode: form.get("costCode")
    }, "Alokacja netto pozycji została zapisana i dekret przeliczony.");
  };

  const submitInbox = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    run("business_inbox_upsert", {
      sourceChannel: form.get("sourceChannel"), externalKey: form.get("externalKey"), documentType: form.get("documentType"), projectId: form.get("projectId")
    }, "Element został przyjęty do wspólnego Business Inbox.");
  };

  return <section className="co-page enterprise-flow" aria-label="Obieg kosztu firmy">
    <header className="enterprise-flow-overview">
      <div className="enterprise-flow-overview__title">
        <span>Finanse</span>
        <h1>Obieg kosztu</h1>
      </div>
      <ol className="enterprise-flow-steps" aria-label="Cztery etapy obiegu kosztu">
        <li><b>1</b><span><strong>Dokument</strong><small>Wrzutnia · KSeF · ERP</small></span></li>
        <li><b>2</b><span><strong>Kontrola</strong><small>AI · WM/PO/PZ/FV</small></span></li>
        <li><b>3</b><span><strong>Przypisanie</strong><small>inwestycja · firma</small></span></li>
        <li><b>4</b><span><strong>Rozliczenie</strong><small>NET/VAT · dekret</small></span></li>
      </ol>
      <div className="enterprise-flow-overview__status" aria-label="Status obiegu">
        <span><strong>{data.summary.matchingOk}</strong><small>zgodnych</small></span>
        {data.summary.deviationsOpen > 0 ? <span className="enterprise-flow-overview__warning"><strong>{data.summary.deviationsOpen}</strong><small>wyjątków</small></span> : null}
      </div>
    </header>

    <div className="enterprise-flow-counters" aria-label="Bieżące zadania w obiegu">
      <span><FileInput size={14}/><strong>{data.summary.inboxOpen}</strong> dokumentów do decyzji</span>
      <span><ArrowRightLeft size={14}/><strong>{data.summary.matchingReview}</strong> kontroli zakupów</span>
      <span><BookOpenCheck size={14}/><strong>{data.summary.accountingProposed}</strong> dekretów do zatwierdzenia</span>
      <span><AlertTriangle size={14}/><strong>{data.summary.deviationsOpen}</strong> odstępstw</span>
    </div>

    {message ? <p className="form-message form-message--success">{message}</p> : null}
    {error ? <p className="form-message form-message--error">{error}</p> : null}

    <Panel title="Dokumenty" eyebrow="1 · Wejście" meta={`${data.inbox.length} ostatnich`}>
      <p>Wrzutnia, KSeF, ERP i e-mail trafiają do jednego Inbox. Octopus odczytuje dokument i uruchamia dalszy obieg.</p>
      <div className="ops-simple-list">
        {data.inbox.slice(0, 20).map((row) => <div key={String(row.id)}><span>{String(row.source_channel ?? "upload").toUpperCase()}</span><strong>{String(row.document_type ?? "dokument")} · {projectNames.get(String(row.project_id)) ?? "ogólne"}</strong><div className="ops-list-row__detail"><span className={statusClass(row.status)}>{String(row.status)}</span> · {date(row.received_at)}{row.invoice_id ? ` · faktura ${String(invoices.get(String(row.invoice_id))?.invoice_number ?? row.invoice_id)}` : ""}</div>{canWrite && row.document_id && ["error", "review"].includes(String(row.status)) ? <button className="secondary-button" disabled={pending} onClick={() => run("document_orchestrate", { documentId: row.document_id }, "Obieg dokumentu został przeliczony ponownie.")}><RefreshCw size={14}/>Ponów obieg</button> : null}</div>)}
        {!data.inbox.length ? <p className="ops-simple-list__empty">Brak dokumentów biznesowych. Pierwsza zatwierdzona faktura lub wpis integracyjny pojawi się tutaj automatycznie.</p> : null}
      </div>
      {canWrite ? <form className="ops-form" onSubmit={submitInbox}><div className="ops-auto-form-grid"><label>Kanał<select name="sourceChannel" defaultValue="api"><option value="api">API</option><option value="ksef">KSeF</option><option value="subiekt">Subiekt</option><option value="comarch">Comarch</option><option value="symfonia">Symfonia</option><option value="enova">enova</option><option value="email">E-mail</option></select></label><label>Identyfikator źródła<input name="externalKey" required placeholder="np. ERP:FV/123/2026"/></label><label>Typ<input name="documentType" defaultValue="invoice"/></label><label>Inwestycja<select name="projectId" defaultValue=""><option value="">Ogólne / nierozpoznane</option>{data.projects.map((project) => <option key={String(project.id)} value={String(project.id)}>{String(project.name)}</option>)}</select></label></div><button className="secondary-button" disabled={pending}><Send size={15}/>Przyjmij do Inbox</button></form> : null}
    </Panel>

    <Panel title="Kontrola zakupu" eyebrow="2 · WM → PO → PZ → FV" meta={`${data.summary.matchingReview} do sprawdzenia`}>
      <div className="ops-simple-list">
        {data.procurementMatches.slice(0, 30).map((row) => {
          const line = invoiceLines.get(String(row.invoice_line_id));
          const invoice = line ? invoices.get(String(line.invoice_id)) : undefined;
          const warnings = Array.isArray(row.warnings) ? row.warnings.map(String) : [];
          return <div key={String(row.id)}><span>{String(invoice?.invoice_number ?? "Faktura")}</span><strong>{String(line?.description ?? `Pozycja ${row.invoice_line_id}`)}</strong><div className="ops-list-row__detail"><span className={statusClass(row.status)}>{String(row.status)}</span> · zamówiono {number(row.ordered_quantity)} · PZ {number(row.received_quantity)} · faktura {number(row.invoiced_quantity)} · cena PO {money(row.ordered_unit_price)} / FV {money(row.invoiced_unit_price)}{row.price_variance_percent != null ? ` · Δ ${number(row.price_variance_percent)}%` : ""}{warnings.length ? ` · ${warnings.join(" · ")}` : ""}</div><div className="ops-inline-action">{canWrite && invoice?.id ? <button className="secondary-button" disabled={pending} onClick={() => run("procurement_refresh", { invoiceId: invoice.id }, "Uzgodnienie zostało przeliczone.")}><RefreshCw size={14}/>Przelicz</button> : null}{canApprove && row.status === "review" ? <button className="approve-button" disabled={pending} onClick={() => run("procurement_approve", { matchId: row.id }, "Uzgodnienie zatwierdzone ręcznie z audytem.")}><Check size={14}/>Akceptuj wyjątek</button> : null}</div></div>;
        })}
        {!data.procurementMatches.length ? <p className="ops-simple-list__empty">Brak pozycji do uzgodnienia. Mechanizm uruchomi się po pierwszej fakturze materiałowej.</p> : null}
      </div>
    </Panel>

    <Panel title="Przypisanie kosztu" eyebrow="3 · Inwestycja / firma" meta="NETTO">
      <p>Przypisz pozycję netto do inwestycji i kodu kosztu. Jedna faktura może zasilać kilka inwestycji.</p>
      {canWrite && data.invoiceLines.length && data.projects.length ? <form className="ops-form" onSubmit={submitAllocation}><div className="ops-auto-form-grid"><label>Pozycja faktury<select name="invoiceLineId" required defaultValue=""><option value="">Wybierz pozycję</option>{data.invoiceLines.map((line) => <option key={String(line.id)} value={String(line.id)}>{String(line.description)} · netto {money(line.net_amount)}</option>)}</select></label><label>Inwestycja<select name="projectId" required defaultValue=""><option value="">Wybierz inwestycję</option>{data.projects.map((project) => <option key={String(project.id)} value={String(project.id)}>{String(project.name)}</option>)}</select></label><label>Kwota netto<input name="amount" inputMode="decimal" required placeholder="0,00"/></label><label>Kod kosztu<input name="costCode" placeholder="np. MAT-WOD-KAN"/></label></div><button className="primary-button" disabled={pending}><Route size={15}/>Zapisz alokację netto</button></form> : <p className="ops-simple-list__empty">Formularz pojawi się po odczytaniu pozycji faktury i utworzeniu inwestycji.</p>}
    </Panel>

    <Panel title="Księgowość" eyebrow="4 · Dekret i rozliczenie" meta={`${data.summary.accountingProposed} do zatwierdzenia`}>
      <p>Octopus rozdziela netto, VAT i rozrachunek brutto. Do eksportu przechodzi dopiero zatwierdzony, bilansujący się dekret.</p>
      <div className="ops-import-list">
        {data.accountingEntries.slice(0, 20).map((entry) => {
          const lines = linesByEntry.get(String(entry.id)) ?? [];
          return <details className="ops-import-row" key={String(entry.id)}><summary><span className="ops-import-row__icon"><CircleDollarSign size={17}/></span><div><strong>{String(entry.description)}</strong><small>{date(entry.entry_date)} · {projectNames.get(String(entry.project_id)) ?? "firma / wiele inwestycji"}</small></div><span>Wn {money(entry.total_debit)} = Ma {money(entry.total_credit)}</span><b className={statusClass(entry.status)}>{String(entry.status)}</b><ChevronDown size={16}/></summary><div className="ops-import-row__body"><div className="ops-simple-list">{lines.map((line) => { const account = Array.isArray(line.accounting_accounts) ? line.accounting_accounts[0] as Row | undefined : line.accounting_accounts as Row | undefined; return <div key={String(line.id)}><span>{String(line.side).toUpperCase()}</span><strong>{String(account?.code ?? "—")} · {String(account?.name ?? line.description ?? "Pozycja")}</strong><div className="ops-list-row__detail">{money(line.amount)} · {projectNames.get(String(line.project_id)) ?? "bez MPK inwestycji"}{line.cost_code ? ` · ${String(line.cost_code)}` : ""}</div></div>;})}</div>{canApprove && entry.status === "proposed" ? <button className="approve-button" disabled={pending} onClick={() => run("accounting_approve", { entryId: entry.id }, "Dekret został zatwierdzony.")}><BadgeCheck size={15}/>Zatwierdź dekret</button> : null}</div></details>;
        })}
        {!data.accountingEntries.length ? <p className="ops-simple-list__empty">Brak dekretów. Powstaną automatycznie wraz z fakturami.</p> : null}
      </div>
    </Panel>

    <Panel title="Historia cen" eyebrow="Analiza pomocnicza" meta={`${data.priceObservations.length} obserwacji`}>
      <div className="ops-simple-list">{data.priceObservations.slice(0, 40).map((row, index) => { const change = row.changePercent == null ? null : Number(row.changePercent); return <div key={`${String(row.sourceId)}-${index}`}><span>{date(row.date)}</span><strong>{String(row.stockName ?? "Materiał")} · {String(row.supplier ?? "dostawca nieznany")}</strong><div className="ops-list-row__detail">{money(row.unitPriceNet)} / {String(row.unit ?? "j.m.")} {change == null ? "" : <span className={change > 0 ? "status-chip status-chip--warning" : "status-chip status-chip--positive"}>{change > 0 ? <TrendingUp size={12}/> : <TrendingDown size={12}/>} {number(change)}%</span>}</div></div>;})}{!data.priceObservations.length ? <p className="ops-simple-list__empty">Historia cen zbuduje się automatycznie z faktur, zamówień i zatwierdzonych PZ.</p> : null}</div>
    </Panel>

    <Panel title="Odstępstwa" eyebrow="Wyjątki wymagające decyzji" meta={`${data.summary.deviationsOpen} otwartych`} open={data.summary.deviationsOpen > 0}>
      <div className="ops-import-list">{data.deviations.slice(0, 40).map((row) => <details className="ops-import-row" key={String(row.id)}><summary><span className="ops-import-row__icon"><AlertTriangle size={17}/></span><div><strong>{String(row.title)}</strong><small>{projectNames.get(String(row.project_id)) ?? "firma"} · {date(row.created_at)}</small></div><span>{String(row.deviation_type)}</span><b className={statusClass(row.status)}>{String(row.status)}</b><ChevronDown size={16}/></summary><div className="ops-import-row__body"><p>{String(row.detail ?? "Brak dodatkowego opisu.")}</p>{row.resolution_note ? <p><strong>Rozwiązanie:</strong> {String(row.resolution_note)}</p> : null}{canWrite && row.status === "open" ? <form className="ops-form" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); run("deviation_close", { deviationId: row.id, resolution: form.get("resolution") }, "Odstępstwo zostało zamknięte z uzasadnieniem."); }}><label>Uzasadnienie zamknięcia<input name="resolution" required placeholder="np. zakup awaryjny zatwierdzony przez kierownika"/></label><button className="approve-button" disabled={pending}><Check size={14}/>Zamknij odstępstwo</button></form> : null}</div></details>)}{!data.deviations.length ? <p className="ops-simple-list__empty">Brak odstępstw. Zakupy bez WM/PO/PZ oraz różnice cen i ilości pojawią się tutaj automatycznie.</p> : null}</div>
    </Panel>

    {pending ? <p className="form-message"><LoaderCircle className="spin" size={15}/> Aktualizuję obieg danych…</p> : null}
    <div className="co-category-strip enterprise-flow-rules"><span><Boxes size={14}/> koszt = netto</span><span>VAT osobno</span><span>rozrachunek = brutto</span><span>magazyn dopiero po PZ</span></div>
  </section>;
}
