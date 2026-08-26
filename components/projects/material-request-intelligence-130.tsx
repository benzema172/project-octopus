import { Bot, CheckCircle2, ClipboardList, PackageCheck, Send, ShoppingCart, Truck } from "lucide-react";
import { MaterialGapAction130 } from "@/components/projects/material-gap-action-130";
import type { MaterialGap130, MaterialWorkflowItem130 } from "@/lib/data/project-intelligence-130";

const STAGE: Record<string, { label: string; order: number }> = {
  detected: { label: "Rozpoznany", order: 0 },
  draft: { label: "Szkic", order: 1 },
  sent: { label: "Wysłany", order: 2 },
  commented: { label: "Uwagi", order: 3 },
  approved: { label: "Zatwierdzony", order: 4 },
  ordered: { label: "Zamówiony", order: 5 },
  delivered: { label: "Dostarczony", order: 6 },
  closed: { label: "Zamknięty", order: 7 }
};

const pct = (value: number | null) => value == null ? "—" : `${Math.round(value * 100)}%`;

export function MaterialRequestIntelligence130({ projectId, workflow, gaps, canWrite }: { projectId: string; workflow: MaterialWorkflowItem130[]; gaps: MaterialGap130[]; canWrite: boolean }) {
  const approved = workflow.filter((item) => ["approved", "ordered", "delivered", "closed"].includes(item.effectiveStage)).length;
  const ordered = workflow.filter((item) => ["ordered", "delivered", "closed"].includes(item.effectiveStage)).length;
  const delivered = workflow.filter((item) => ["delivered", "closed"].includes(item.effectiveStage)).length;

  return (
    <section className="pi130-card pi130-materials" aria-labelledby="material-intelligence-title">
      <div className="pi130-heading">
        <span className="pi130-heading__icon"><ClipboardList size={19} /></span>
        <div><p className="co-kicker">Workflow materiałowy 1.3.0</p><h2 id="material-intelligence-title">Od rozpoznania materiału do dostawy</h2><p>Brain wykrywa brak wniosku, proponuje szkic, a Octopus śledzi zatwierdzenie, zamówienie i dostawę po śladzie zakupowym.</p></div>
      </div>

      <div className="pi130-kpis">
        <div data-tone={gaps.length ? "warning" : "positive"}><Bot size={17} /><span><small>Propozycje AI bez WM</small><strong>{gaps.length}</strong></span></div>
        <div><CheckCircle2 size={17} /><span><small>Zatwierdzone</small><strong>{approved}</strong></span></div>
        <div><ShoppingCart size={17} /><span><small>Zamówione</small><strong>{ordered}</strong></span></div>
        <div><Truck size={17} /><span><small>Dostarczone</small><strong>{delivered}</strong></span></div>
      </div>

      {gaps.length ? <div className="pi130-material-gaps"><div className="pi130-subheading"><Bot size={15} /><strong>AI proponuje utworzenie wniosku</strong><small>Nie publikuje go bez Twojej decyzji.</small></div>{gaps.slice(0, 12).map((gap) => <article key={gap.materialId}>
        <span><strong>{gap.name}</strong><small>{[gap.manufacturer, gap.model, gap.installation].filter(Boolean).join(" · ") || "materiał z dokumentacji"}</small></span>
        <span><b>{gap.plannedQuantity ? `${gap.plannedQuantity} ${gap.unit ?? ""}` : "ilość do weryfikacji"}</b><small>pewność AI {pct(gap.confidence)}</small></span>
        {canWrite ? <MaterialGapAction130 projectId={projectId} gap={gap} /> : <small>Brak uprawnienia do zapisu.</small>}
      </article>)}</div> : <div className="pi130-info pi130-info--positive"><PackageCheck size={14} /><span>Każdy rozpoznany materiał ma już odpowiadający wniosek albo został odrzucony.</span></div>}

      <details className="pi130-details" open>
        <summary><Send size={16} /> Aktualny workflow wniosków <span>{workflow.length}</span></summary>
        <div className="pi130-material-workflow">
          {workflow.slice(0, 80).map((item) => {
            const stage = STAGE[item.effectiveStage] ?? { label: item.effectiveStage, order: 1 };
            return <article key={item.materialRequestId}>
              <span><strong>{item.title}</strong><small>{[item.manufacturer, item.productName, item.model].filter(Boolean).join(" · ") || "wniosek materiałowy"}</small></span>
              <div className="pi130-workflow-steps" aria-label={`Etap: ${stage.label}`}>{Object.entries(STAGE).filter(([key]) => key !== "detected" && key !== "closed").map(([key, value]) => <i key={key} data-state={value.order < stage.order ? "done" : value.order === stage.order ? "current" : "future"} title={value.label}><em /></i>)}</div>
              <span><b>{stage.label}</b><small>{item.confidence == null ? item.requestOrigin ?? "" : `AI ${pct(item.confidence)}`}</small></span>
            </article>;
          })}
          {!workflow.length ? <p className="pi130-empty">Nie ma jeszcze wniosków materiałowych.</p> : null}
        </div>
      </details>
    </section>
  );
}
