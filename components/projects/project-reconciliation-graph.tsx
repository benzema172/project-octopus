"use client";

import { FormEvent, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Check, GitBranch, Link2, LoaderCircle, PackageCheck, PackagePlus, RefreshCcw, ShoppingCart, X } from "lucide-react";

type Row = Record<string, unknown>;
type ReconciliationData = { graph: Record<string, unknown>; links: Row[]; orders: Row[]; requests: Row[]; counterparties: Row[]; stockItems: Row[]; boqItems: Row[]; matches: Row[]; deviations: Row[]; prices: Row[] };
function obj(value: unknown) { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
const money = (value: unknown) => new Intl.NumberFormat("pl-PL", { style: "currency", currency: "PLN", maximumFractionDigits: 0 }).format(Number(value ?? 0));
const num = (value: unknown, digits = 1) => new Intl.NumberFormat("pl-PL", { maximumFractionDigits: digits }).format(Number(value ?? 0));

export function ProjectReconciliationGraph({ projectId, data, canManage, canOrder }: { projectId: string; data: ReconciliationData; canManage: boolean; canOrder: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const graph = data.graph;
  const boq = obj(graph.boq);
  const costs = obj(graph.costs);
  const commitments = obj(graph.commitments);
  const graphLinks = obj(graph.links);
  const match = obj(graph.procurementMatch);
  const graphDeviations = obj(graph.deviations);
  const approvedRequests = data.requests.filter((row) => String(row.status) === "approved");
  const reviewMatches = data.matches.filter((row) => row.status === "review");
  const openDeviations = data.deviations.filter((row) => row.status === "open");
  const proposedLinks = data.links.filter((row) => row.status === "proposed");
  const needsDecision = reviewMatches.length + openDeviations.length + proposedLinks.length;

  async function call(action: string, extra: Record<string, unknown> = {}) {
    setMessage(null);
    const response = await fetch("/api/projects/reconciliation", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId, action, ...extra }) });
    const payload = await response.json() as { error?: string; candidates?: number; orderId?: string };
    if (!response.ok) throw new Error(payload.error ?? "Operacja nie powiodła się.");
    setMessage(action === "auto_match" ? `Dopasowanie zakończone · ${payload.candidates ?? 0} kandydatów.` : action === "purchase_order_create" ? `Utworzono zamówienie ${payload.orderId ?? ""}.` : "Decyzja została zapisana.");
    startTransition(() => router.refresh());
  }

  async function createOrder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    try { await call("purchase_order_create", { payload: Object.fromEntries(new FormData(form).entries()) }); form.reset(); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Nie udało się utworzyć zamówienia."); }
  }

  return <section className="control360-panel reconciliation-graph control360-reconciliation">
    <header className="control360-panel__heading">
      <div><p className="co-kicker">Koszty i zgodność</p><h2>BOQ ↔ koszt ↔ zakup</h2></div>
      <div className="control360-heading-actions">
        {needsDecision > 0 ? <span className="control360-attention">{needsDecision} do decyzji</span> : <span className="control360-clear"><Check size={13} /> zgodne</span>}
        {canManage ? <button className="control360-icon-action" onClick={() => call("auto_match").catch((error) => setMessage(error.message))} disabled={pending}>{pending ? <LoaderCircle size={15} /> : <RefreshCcw size={15} />} Dopasuj</button> : null}
      </div>
    </header>

    {message ? <p className="command-message">{message}</p> : null}

    <div className="control360-metrics">
      <article><GitBranch /><span><small>BOQ</small><strong>{money(boq.plannedValue)}</strong></span></article>
      <article><Link2 /><span><small>Koszt rzeczywisty</small><strong>{money(costs.actualCost)}</strong></span></article>
      <article><ShoppingCart /><span><small>Zobowiązania</small><strong>{money(commitments.committedCost)}</strong></span></article>
      <article className={needsDecision > 0 ? "is-warning" : ""}><PackageCheck /><span><small>Do kontroli</small><strong>{needsDecision}</strong></span></article>
    </div>

    {needsDecision > 0 ? <details className="control360-details control360-details--attention" open>
      <summary>Elementy wymagające decyzji <span>{reviewMatches.length} match · {openDeviations.length} odstępstw · {proposedLinks.length} BOQ</span></summary>
      <div className="control360-review-stack">
        {reviewMatches.slice(0, 10).map((row) => { const warnings = Array.isArray(row.warnings) ? row.warnings.map(String) : []; return <div key={String(row.id)} className="control360-review-row"><AlertTriangle size={14} /><div><strong>3-way match: PO {num(row.ordered_quantity)} / PZ {num(row.received_quantity)} / FV {num(row.invoiced_quantity)}</strong><small>{warnings.join(" · ") || `Cena PO ${money(row.ordered_unit_price)} → FV ${money(row.invoiced_unit_price)}`}</small></div></div>; })}
        {openDeviations.slice(0, 10).map((row) => <div key={String(row.id)} className="control360-review-row"><AlertTriangle size={14} /><div><strong>{String(row.title)}</strong><small>{String(row.detail ?? row.deviation_type ?? "Odstępstwo procesu")}</small></div></div>)}
        {proposedLinks.slice(0, 10).map((row) => <div key={String(row.id)} className="control360-review-row"><GitBranch size={14} /><div><strong>Dopasowanie BOQ · {Math.round(Number(row.confidence ?? 0) * 100)}%</strong><small>{String(row.source_type)} → {String(row.target_type)}</small></div>{canManage ? <div className="control360-row-actions"><button onClick={() => call("approve_link", { linkId: row.id }).catch((error) => setMessage(error.message))}><Check size={13} /> Zatwierdź</button><button onClick={() => call("reject_link", { linkId: row.id }).catch((error) => setMessage(error.message))}><X size={13} /> Odrzuć</button></div> : null}</div>)}
      </div>
    </details> : <div className="control360-ok"><Check size={15} /> Brak otwartych niezgodności między BOQ, zakupami i kosztami</div>}

    <details className="control360-details">
      <summary>Zakupy i historia <span>{data.orders.length} zamówień · {data.prices.length} obserwacji cen</span></summary>
      <div className="control360-detail-columns">
        <div><h4>Aktywne zamówienia</h4>{data.orders.slice(0, 12).map((row) => <div key={String(row.id)} className="command-row"><div><strong>{String(row.order_number)}</strong><span>{money(row.total_amount)} · {String(row.status)}</span></div></div>)}{!data.orders.length ? <p className="empty-copy">Brak zamówień.</p> : null}</div>
        <div><h4>Ostatnie ceny</h4>{data.prices.slice(0, 12).map((row, index) => <div key={`${String(row.sourceId)}-${index}`} className="command-row"><div><strong>{String(row.stockName ?? "Materiał")}</strong><span>{money(row.unitPriceNet)} / {String(row.unit ?? "j.m.")} · {String(row.supplier ?? "dostawca nieznany")}</span></div></div>)}{!data.prices.length ? <p className="empty-copy">Brak historii cen.</p> : null}</div>
      </div>
    </details>

    {canOrder ? <details className="control360-details control360-details--advanced">
      <summary>Operacje zakupowe <span>narzędzia dodatkowe</span></summary>
      <form className="command-form reconciliation-order-form" onSubmit={createOrder}>
        <label>Zatwierdzony WM<select name="sourceRequestId" defaultValue=""><option value="">Zakup awaryjny bez WM</option>{approvedRequests.map((row) => <option key={String(row.id)} value={String(row.id)}>{String(row.title)}</option>)}</select></label>
        <label>Cel dostawy<select name="destinationMode" defaultValue="direct_project"><option value="direct_project">Bezpośrednio na inwestycję</option><option value="central_stock">Magazyn centralny</option></select></label>
        <label>Dostawca<select name="counterpartyId" defaultValue=""><option value="">Bez wskazanego dostawcy</option>{data.counterparties.map((row) => <option key={String(row.id)} value={String(row.id)}>{String(row.name)}</option>)}</select></label>
        <label>Numer zamówienia<input name="orderNumber" required placeholder="ZAM/2026/001" /></label>
        <label>Data zamówienia<input name="orderedAt" type="date" defaultValue={new Date().toISOString().slice(0, 10)} /></label>
        <label>Termin dostawy<input name="expectedAt" type="date" /></label>
        <label>Kartoteka<select name="stockItemId" defaultValue=""><option value="">Bez kartoteki</option>{data.stockItems.map((row) => <option key={String(row.id)} value={String(row.id)}>{String(row.sku ?? "—")} · {String(row.name)}</option>)}</select></label>
        <label>Pozycja BOQ<select name="boqItemId" defaultValue=""><option value="">Bez powiązania BOQ</option>{data.boqItems.map((row) => <option key={String(row.id)} value={String(row.id)}>{String(row.item_number ?? "BOQ")} · {String(row.description)}</option>)}</select></label>
        <label>Opis<input name="description" required /></label><label>Ilość<input name="quantity" inputMode="decimal" required /></label><label>Jednostka<input name="unit" /></label><label>Cena netto<input name="unitPrice" inputMode="decimal" /></label>
        <button disabled={pending}><PackagePlus size={15} /> Utwórz zamówienie</button>
      </form>
    </details> : null}

    <details className="control360-details control360-details--advanced">
      <summary>Dane techniczne <span>{String(match.matched ?? 0)} uzgodnionych · {String(graphDeviations.open ?? 0)} odstępstw · {String(graphLinks.approved ?? 0)} powiązań</span></summary>
      <div className="control360-technical-grid">
        <span>FV bezpośrednie <strong>{money(costs.invoiceNet)}</strong></span><span>RW magazyn <strong>{money(costs.inventoryIssuedCost)}</strong></span><span>Robocizna <strong>{money(costs.laborCost)}</strong></span><span>Rozpoznane zobowiązania <strong>{money(commitments.recognizedCost)}</strong></span>
      </div>
    </details>
  </section>;
}
