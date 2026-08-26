import { AlertTriangle, ArrowRight, Boxes, CheckCircle2, Link2, ReceiptText, Warehouse } from "lucide-react";
import type { BoqRealityItem130, Provenance130 } from "@/lib/data/project-intelligence-130";

const qty = (value: number, unit: string | null) => `${new Intl.NumberFormat("pl-PL", { maximumFractionDigits: 2 }).format(value)}${unit ? ` ${unit}` : ""}`;
const money = (value: number) => `${new Intl.NumberFormat("pl-PL", { maximumFractionDigits: 0 }).format(value)} zł`;

export function BoqRealityPanel130({ items, provenance }: { items: BoqRealityItem130[]; provenance: Provenance130[] }) {
  const overruns = items.filter((item) => item.status === "overrun");
  const active = [...items].sort((a, b) => (b.status === "overrun" ? 1 : 0) - (a.status === "overrun" ? 1 : 0)).slice(0, 120);
  const budgetValue = items.reduce((sum, item) => sum + item.budgetValue, 0);
  const orderedAmount = items.reduce((sum, item) => sum + item.orderedAmount, 0);
  const invoicedAmount = items.reduce((sum, item) => sum + item.invoicedAmount, 0);
  const sourceByItem = new Map<string, Provenance130>();
  for (const source of provenance) if (!sourceByItem.has(source.entityId)) sourceByItem.set(source.entityId, source);

  return (
    <section className="pi130-card pi130-boq" aria-labelledby="boq-reality-title">
      <div className="pi130-heading">
        <span className="pi130-heading__icon"><Boxes size={19} /></span>
        <div><p className="co-kicker">BOQ ↔ rzeczywistość</p><h2 id="boq-reality-title">Ilości od budżetu do faktury</h2><p>Jedna pozycja pokazuje plan, zakup, wydanie, montaż, odbiór, fakturę i pozostałą ilość.</p></div>
      </div>
      <div className="pi130-kpis">
        <div><Boxes size={17} /><span><small>Wartość BOQ</small><strong>{money(budgetValue)}</strong></span></div>
        <div><Warehouse size={17} /><span><small>Zamówiono</small><strong>{money(orderedAmount)}</strong></span></div>
        <div><ReceiptText size={17} /><span><small>Zafakturowano</small><strong>{money(invoicedAmount)}</strong></span></div>
        <div data-tone={overruns.length ? "danger" : "positive"}>{overruns.length ? <AlertTriangle size={17} /> : <CheckCircle2 size={17} />}<span><small>Przekroczenia ilości</small><strong>{overruns.length}</strong></span></div>
      </div>

      <div className="pi130-boq-table" role="table" aria-label="BOQ kontra rzeczywistość">
        <div className="pi130-boq-table__head" role="row"><span>Pozycja</span><span>Budżet</span><span>Zakup</span><span>Wydano</span><span>Zamontowano</span><span>Odebrano</span><span>Faktura</span><span>Pozostało</span></div>
        {active.map((item) => {
          const source = sourceByItem.get(item.boqItemId);
          return <div className="pi130-boq-row" role="row" key={item.boqItemId} data-tone={item.status === "overrun" ? "danger" : item.status === "near_complete" ? "positive" : "default"}>
            <span><strong>{item.itemNumber ? `${item.itemNumber} · ` : ""}{item.description}</strong>{source ? <small><Link2 size={11} /> {source.documentName ?? "źródło"}{source.revisionLabel ? ` · rew. ${source.revisionLabel}` : ""}{source.pageLabel ? ` · str. ${source.pageLabel}` : ""}</small> : <small>brak przypiętego źródła</small>}</span>
            <span>{qty(item.budget, item.unit)}</span><span>{qty(item.purchased, item.unit)}</span><span>{qty(item.issued, item.unit)}</span><span>{qty(item.installed, item.unit)}</span><span>{qty(item.accepted, item.unit)}</span><span>{qty(item.invoiced, item.unit)}</span>
            <span><b>{qty(item.remaining, item.unit)}</b>{item.overrun > 0 ? <small className="pi130-warning">+{qty(item.overrun, item.unit)} ponad BOQ</small> : null}</span>
          </div>;
        })}
      </div>
      {items.length > active.length ? <p className="pi130-footnote">Widok pokazuje pierwsze {active.length} pozycji, z przekroczeniami na początku. Pełny BOQ pozostaje w Change Control.</p> : null}
      <div className="pi130-info"><ArrowRight size={14} /><span>Przekroczenie jest wykrywane automatycznie, gdy zakup, wydanie, montaż albo ilość zafakturowana przekroczy aktywną ilość BOQ.</span></div>
    </section>
  );
}
