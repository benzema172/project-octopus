import Link from "next/link";
import {
  BarChart3,
  ChevronRight,
  CircleDollarSign,
  FilePenLine,
  FileText,
  Plus,
  ReceiptText,
  WalletCards
} from "lucide-react";
import { OperationsActionButton } from "@/components/projects/operations-action-button";
import { ProjectCompactShell } from "@/components/projects/project-compact-module-page";
import { ProjectOperationPanel } from "@/components/projects/project-operation-panel";
import type { ProjectFinanceData } from "@/lib/data/project-finance";

type Metric = {
  label: string;
  value: string;
  hint: string;
  tone?: "positive" | "warning" | "danger";
};

const STATUS_LABELS: Record<string, string> = {
  active: "Aktywny",
  approved: "Zatwierdzony",
  accepted: "Zaakceptowany",
  confirmed: "Potwierdzony",
  closed: "Zamknięty",
  draft: "Roboczy",
  identified: "Rozpoznana",
  issued: "Wystawiona",
  open: "Otwarte",
  overdue: "Po terminie",
  paid: "Opłacona",
  partially_paid: "Częściowo opłacona",
  received: "Otrzymana"
};

function money(value: number | null | undefined, currency = "PLN") {
  if (value == null || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("pl-PL", {
    style: "currency",
    currency,
    maximumFractionDigits: 0
  }).format(value);
}

function percentage(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${new Intl.NumberFormat("pl-PL", { maximumFractionDigits: 1 }).format(value)}%`;
}

function date(value: string | null | undefined) {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? value
    : new Intl.DateTimeFormat("pl-PL", { day: "2-digit", month: "2-digit", year: "numeric" }).format(parsed);
}

function status(value: string) {
  return STATUS_LABELS[value.toLowerCase()] ?? value;
}

function resultTone(value: number | null): Metric["tone"] {
  if (value == null) return undefined;
  if (value < 0) return "danger";
  return value > 0 ? "positive" : undefined;
}

function FinanceMetric({ metric }: { metric: Metric }) {
  return (
    <article className="pf-metric" data-tone={metric.tone ?? "default"}>
      <span>{metric.label}</span>
      <strong>{metric.value}</strong>
      <small>{metric.hint}</small>
    </article>
  );
}

function FinanceRows({ rows }: { rows: Array<{ label: string; value: string; hint?: string; tone?: Metric["tone"] }> }) {
  return (
    <dl className="pf-summary-rows">
      {rows.map((row) => (
        <div key={row.label} data-tone={row.tone ?? "default"}>
          <dt>{row.label}{row.hint ? <small>{row.hint}</small> : null}</dt>
          <dd>{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function FinanceSection({ icon: Icon, title, total, children }: {
  icon: typeof WalletCards;
  title: string;
  total: string;
  children: React.ReactNode;
}) {
  return (
    <details className="pf-section">
      <summary>
        <Icon size={17} aria-hidden="true" />
        <span>{title}</span>
        <strong>{total}</strong>
        <ChevronRight size={15} aria-hidden="true" />
      </summary>
      <div className="pf-section__body">{children}</div>
    </details>
  );
}

export function ProjectFinanceDashboard({ projectId, currency, canWrite, data }: {
  projectId: string;
  currency: string;
  canWrite: boolean;
  data: ProjectFinanceData;
}) {
  const { summary } = data;
  const metrics: Metric[] = [
    { label: "Kontrakt po zmianach", value: money(summary.adjustedContractValue, currency), hint: "umowa + zatwierdzone CO" },
    { label: "Kosztorys BOQ/WBS", value: money(summary.boqValue, currency), hint: "aktywne pozycje" },
    { label: "Przerób odebrany", value: money(summary.acceptedWorkValue, currency), hint: percentage(summary.acceptedProgressPercent) },
    { label: "Zafakturowano", value: money(summary.salesNet, currency), hint: "sprzedaż netto" },
    { label: "Wpłacono", value: money(summary.receivedPayments, currency), hint: "płatności brutto" },
    { label: "Koszty rzeczywiste", value: money(summary.actualCost, currency), hint: "zatwierdzone alokacje" },
    { label: "Zobowiązania otwarte", value: money(summary.openCommitments, currency), hint: "otwarte i zatwierdzone" },
    { label: "Wynik bieżący", value: money(summary.currentResult, currency), hint: "przerób – koszty", tone: resultTone(summary.currentResult) },
    { label: "Do zafakturowania", value: money(summary.remainingToInvoice, currency), hint: "kontrakt – sprzedaż netto", tone: summary.remainingToInvoice != null && summary.remainingToInvoice < 0 ? "danger" : undefined },
    { label: "Należności", value: money(summary.clientReceivables, currency), hint: "sprzedaż brutto – wpłaty", tone: summary.overdueInvoices ? "warning" : undefined },
    { label: "Wynik prognozowany", value: money(summary.forecastResult, currency), hint: "kontrakt – EAC", tone: resultTone(summary.forecastResult) },
    { label: "Marża prognozowana", value: percentage(summary.forecastMarginPercent), hint: "na końcu inwestycji", tone: resultTone(summary.forecastResult) }
  ];

  return (
    <ProjectCompactShell
      icon={WalletCards}
      kicker="Finanse"
      title="Finanse inwestycji"
      description="Umowa · BOQ/WBS · przerób · koszty · płatności · prognoza"
      aside={<div className="pf-hero-actions"><Link className="secondary-button" href={`/workspace/projects/${projectId}/documentation`}><FileText size={15} />Źródła</Link>{canWrite ? <OperationsActionButton projectId={projectId} action="create_forecast" label="Przelicz prognozę" /> : null}</div>}
    >
      <section className="pf-metrics" aria-label="Kluczowe wskaźniki finansowe inwestycji">
        {metrics.map((metric) => <FinanceMetric key={metric.label} metric={metric} />)}
      </section>

      <section className="pf-control-strip" aria-label="Kontrola wyniku i płynności">
        <div><span>Cashflow</span><strong data-tone={summary.cashflow < 0 ? "danger" : "positive"}>{money(summary.cashflow, currency)}</strong></div>
        <div><span>Plan kosztów</span><strong>{money(summary.plannedCost, currency)}</strong></div>
        <div><span>EAC</span><strong>{money(summary.estimateAtCompletion, currency)}</strong></div>
        <div><span>Do zapłaty dostawcom</span><strong>{money(summary.supplierPayables, currency)}</strong></div>
        <div><span>Po terminie</span><strong data-tone={summary.overdueInvoices ? "warning" : "default"}>{summary.overdueInvoices}</strong></div>
      </section>

      <section className="pf-sections" aria-label="Szczegóły finansowe">
        <FinanceSection icon={CircleDollarSign} title="Przychody" total={money(summary.adjustedContractValue, currency)}>
          <FinanceRows rows={[
            { label: "Umowa bazowa", value: money(summary.baseContractValue, currency) },
            { label: "Zmiany zatwierdzone", value: money(summary.approvedChangeValue, currency) },
            { label: "Kontrakt po zmianach", value: money(summary.adjustedContractValue, currency) },
            { label: "Zafakturowano", hint: "netto", value: money(summary.salesNet, currency) },
            { label: "Pozostało do fakturowania", value: money(summary.remainingToInvoice, currency) }
          ]} />
          {data.changeOrders.length ? <div className="pf-register"><h4>Ostatnie zmiany kontraktowe</h4>{data.changeOrders.slice(0, 5).map((change) => <div key={change.id}><span><strong>{change.number ?? "Zmiana"} · {change.title}</strong><small>{status(change.status)} · {change.daysChange >= 0 ? "+" : ""}{change.daysChange} dni</small></span><b>{change.valueChange >= 0 ? "+" : ""}{money(change.valueChange, currency)}</b></div>)}</div> : null}
        </FinanceSection>

        <FinanceSection icon={WalletCards} title="Koszty" total={money(summary.actualCost, currency)}>
          <FinanceRows rows={[
            { label: "Plan kosztów", value: money(summary.plannedCost, currency) },
            { label: "Koszty rzeczywiste", value: money(summary.actualCost, currency) },
            { label: "Zobowiązania otwarte", value: money(summary.openCommitments, currency) },
            { label: "Koszt do zakończenia", hint: "ETC", value: money(summary.estimateToComplete, currency) },
            { label: "Koszt końcowy", hint: "EAC", value: money(summary.estimateAtCompletion, currency) }
          ]} />
          {data.commitments.length ? <div className="pf-register"><h4>Najbliższe zobowiązania</h4>{data.commitments.slice(0, 5).map((commitment) => <div key={commitment.id}><span><strong>{commitment.description}</strong><small>{date(commitment.expectedDate)} · {status(commitment.status)}</small></span><b>{money(commitment.amount, currency)}</b></div>)}</div> : null}
        </FinanceSection>

        <FinanceSection icon={BarChart3} title="Przeroby" total={money(summary.acceptedWorkValue, currency)}>
          <FinanceRows rows={[
            { label: "Wartość BOQ/WBS", value: money(summary.boqValue, currency) },
            { label: "Wykonano", value: money(summary.executedWorkValue, currency) },
            { label: "Odebrano", value: money(summary.acceptedWorkValue, currency) },
            { label: "Zaawansowanie", value: percentage(summary.acceptedProgressPercent) },
            { label: "Wynik bieżący", hint: "odebrano – koszty", value: money(summary.currentResult, currency), tone: resultTone(summary.currentResult) },
            { label: "Marża bieżąca", value: percentage(summary.currentMarginPercent), tone: resultTone(summary.currentResult) }
          ]} />
        </FinanceSection>

        <FinanceSection icon={ReceiptText} title="Faktury i płatności" total={money(summary.cashflow, currency)}>
          <FinanceRows rows={[
            { label: "Sprzedaż", hint: "netto", value: money(summary.salesNet, currency) },
            { label: "Zakupy", hint: "netto", value: money(summary.purchaseNet, currency) },
            { label: "Wpłacono", hint: "brutto", value: money(summary.receivedPayments, currency) },
            { label: "Zapłacono", hint: "brutto", value: money(summary.outgoingPayments, currency) },
            { label: "Należności", value: money(summary.clientReceivables, currency) },
            { label: "Zobowiązania fakturowe", value: money(summary.supplierPayables, currency) },
            { label: "Cashflow", value: money(summary.cashflow, currency), tone: resultTone(summary.cashflow) }
          ]} />
          {data.invoices.length ? <div className="pf-register"><h4>Ostatnie faktury</h4>{data.invoices.slice(0, 6).map((invoice) => <div key={invoice.id}><span><strong>{invoice.invoiceNumber}</strong><small>{invoice.direction === "sale" ? "Sprzedaż" : "Zakup"} · termin {date(invoice.dueDate)} · {status(invoice.status)}</small></span><b>{money(invoice.grossAmount * invoice.allocationRatio, currency)}</b></div>)}</div> : null}
        </FinanceSection>

        <FinanceSection icon={BarChart3} title="Prognoza" total={money(summary.forecastResult, currency)}>
          <FinanceRows rows={[
            { label: "Koszt końcowy", hint: "EAC", value: money(summary.estimateAtCompletion, currency) },
            { label: "Wynik prognozowany", value: money(summary.forecastResult, currency), tone: resultTone(summary.forecastResult) },
            { label: "Marża prognozowana", value: percentage(summary.forecastMarginPercent), tone: resultTone(summary.forecastResult) },
            { label: "Forecast z dnia", value: date(summary.latestForecast?.forecastDate) },
            { label: "Prognozowany termin", value: date(summary.latestForecast?.forecastFinishDate) }
          ]} />
          {data.budgets.length ? <div className="pf-register"><h4>Wersje budżetu</h4>{data.budgets.slice(0, 5).map((budget) => <div key={budget.id}><span><strong>{budget.name} · v{budget.versionNumber}</strong><small>{status(budget.status)} · koszt {money(budget.totalCost, currency)}</small></span><b>{money(budget.totalRevenue, currency)}</b></div>)}</div> : null}
        </FinanceSection>
      </section>

      <details id="finance-actions" className="pf-actions">
        <summary><FilePenLine size={17} aria-hidden="true" /><span>Edycja i operacje</span><small>Budżet · zmiana kontraktowa</small><ChevronRight size={15} aria-hidden="true" /></summary>
        <div className="pf-actions__body">
          <details className="pw-submodule-tool">
            <summary><Plus size={16} aria-hidden="true" />Nowa wersja budżetu</summary>
            <ProjectOperationPanel projectId={projectId} mode="budget" />
          </details>
          <details className="pw-submodule-tool">
            <summary><Plus size={16} aria-hidden="true" />Nowa zmiana kontraktowa</summary>
            <ProjectOperationPanel projectId={projectId} mode="change_order" />
          </details>
        </div>
      </details>
    </ProjectCompactShell>
  );
}
