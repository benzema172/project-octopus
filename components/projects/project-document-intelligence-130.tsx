import { AlertTriangle, ArrowRight, Bot, Boxes, CheckCircle2, FileClock, FileSearch, GitCompareArrows, Link2, PackageOpen, ShieldQuestion } from "lucide-react";
import Link from "next/link";
import { DocumentRetryButton130 } from "@/components/projects/document-retry-button-130";
import type { ChangeImpact130, DocumentPackageProgress130, DocumentProcessingItem130, Provenance130, RevisionControlItem130 } from "@/lib/data/project-intelligence-130";

type Props = {
  workspaceId: string;
  projectId: string;
  canWrite: boolean;
  data: {
    processing: DocumentProcessingItem130[];
    packages: DocumentPackageProgress130[];
    revisions: RevisionControlItem130[];
    impacts: ChangeImpact130[];
    provenance: Provenance130[];
  };
};

const STAGE: Record<string, string> = {
  uploaded: "Wysłany",
  extraction: "Ekstrakcja",
  extracted: "Treść gotowa",
  ai_analysis: "Analiza AI",
  rate_limited: "Czeka na limit Gemini",
  recognized: "Rozpoznany",
  assigned: "Przypisany",
  modules: "Zapisany do modułów",
  error: "Błąd"
};

const MODULE: Record<string, string> = {
  documentation: "Dokumentacja",
  boq: "BOQ",
  material_requests: "Wnioski materiałowe",
  warehouse: "Magazyn / WZ",
  schedule: "Harmonogram",
  protocols: "Protokoły",
  tasks: "Zadania",
  finance: "Finanse"
};

const percent = (value: number | null) => value == null ? "—" : `${Math.round(value * 100)}%`;
const fmt = (value: string | null | undefined) => value ? new Intl.DateTimeFormat("pl-PL", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(value)) : "—";
const jsonValue = (value: unknown) => {
  if (value == null) return "—";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  try { return JSON.stringify(value); } catch { return "—"; }
};

export function ProjectDocumentIntelligence130({ workspaceId, projectId, canWrite, data }: Props) {
  const complete = data.processing.filter((item) => item.stage === "modules").length;
  const waitingForGemini = data.processing.filter((item) => item.stage === "rate_limited").length;
  const attention = data.processing.filter((item) => item.needsReview).length;
  const failed = data.processing.filter((item) => item.stage === "error").length;
  const revisionCandidates = data.revisions.filter((item) => item.detectionStatus === "review" || item.openImpacts > 0);
  const openImpacts = data.impacts.filter((item) => !["approved", "rejected"].includes(item.status));
  const visibleProcessing = data.processing.slice(0, 18);

  return (
    <section className="pi130-card pi130-doc-center" id="document-intelligence-130" aria-labelledby="document-intelligence-title">
      <div className="pi130-heading">
        <span className="pi130-heading__icon"><Bot size={19} /></span>
        <div><p className="co-kicker">Document Intelligence 1.3.1</p><h2 id="document-intelligence-title">Centrum przetwarzania i kontroli dokumentów</h2><p>Jeden ślad od Wrzutni przez ekstrakcję i Gemini aż do modułów, rewizji i skutków zmian.</p></div>
        <Link href={`/workspace/projects/${projectId}/brain`} className="pi130-heading__link">Decyzje AI <ArrowRight size={14} /></Link>
      </div>

      <div className="pi130-kpis">
        <div><FileSearch size={17} /><span><small>Dokumenty w śladzie AI</small><strong>{data.processing.length}</strong></span></div>
        <div data-tone="positive"><CheckCircle2 size={17} /><span><small>Zapisane do modułów</small><strong>{complete}</strong></span></div>
        <div data-tone={waitingForGemini ? "warning" : attention ? "warning" : "positive"}><ShieldQuestion size={17} /><span><small>AI potrzebuje decyzji / czeka na Gemini</small><strong>{waitingForGemini + attention}</strong></span></div>
        <div data-tone={failed ? "danger" : "default"}><AlertTriangle size={17} /><span><small>Błędy przetwarzania</small><strong>{failed}</strong></span></div>
      </div>

      <div className="pi130-processing-table" role="table" aria-label="Status przetwarzania dokumentów">
        <div className="pi130-processing-table__head" role="row"><span>Dokument</span><span>Etap</span><span>Pewność</span><span>Co zrobiło AI</span><span>Akcja</span></div>
        {visibleProcessing.map((item) => <div className="pi130-processing-row" role="row" key={item.documentId} data-tone={item.stage === "error" ? "danger" : item.stage === "rate_limited" || item.needsReview ? "warning" : "default"}>
          <span><strong>{item.name}</strong><small>{item.revisionLabel ? `Rewizja ${item.revisionLabel} · ` : ""}{item.category ?? "bez kategorii"} · {fmt(item.updatedAt)}</small></span>
          <span className="pi130-stage"><b>{STAGE[item.stage] ?? item.stage}</b><i><em style={{ width: `${Math.max(2, item.progressPercent)}%` }} /></i><small>{item.progressPercent}%</small></span>
          <span><strong>{percent(item.confidence)}</strong>{item.stage === "rate_limited" ? <small className="pi130-warning">limit API — plik bezpieczny</small> : item.needsReview ? <small className="pi130-warning">wymaga decyzji</small> : <small>automatycznie</small>}</span>
          <span><small>{item.errorMessage ?? item.explanation}</small></span>
          <span>{item.retryAvailable && canWrite ? <DocumentRetryButton130 workspaceId={workspaceId} documentId={item.documentId} force={item.stage === "rate_limited"} /> : item.stage === "modules" ? <CheckCircle2 size={17} aria-label="Gotowe" /> : <FileClock size={17} aria-label="W toku" />}</span>
        </div>)}
        {!visibleProcessing.length ? <p className="pi130-empty">Brak dokumentów do pokazania. Wrzutnia automatycznie utworzy tu ślad przetwarzania.</p> : null}
      </div>

      <details className="pi130-details" open={data.packages.some((item) => item.errors > 0 || item.attention > 0)}>
        <summary><PackageOpen size={16} /> Paczki ZIP / foldery <span>{data.packages.length}</span></summary>
        <div className="pi130-package-grid">
          {data.packages.map((item) => <article key={item.packageId} data-tone={item.errors ? "danger" : item.attention ? "warning" : "default"}>
            <div><strong>Paczka {item.packageId.slice(0, 8)}</strong><small>{fmt(item.createdAt)} · {item.status}</small></div>
            <div className="pi130-package-progress"><i><em style={{ width: `${item.progressPercent}%` }} /></i><b>{item.progressPercent}%</b></div>
            <dl><div><dt>Pliki</dt><dd>{item.total}</dd></div><div><dt>Gotowe</dt><dd>{item.completed}</dd></div><div><dt>Uwaga</dt><dd>{item.attention}</dd></div><div><dt>Błędy</dt><dd>{item.errors}</dd></div><div><dt>W kolejce</dt><dd>{item.pending}</dd></div></dl>
          </article>)}
          {!data.packages.length ? <p className="pi130-empty">Brak paczek ZIP w tej inwestycji. Zwykłe pliki nadal są śledzone powyżej.</p> : null}
        </div>
      </details>

      <details className="pi130-details" open={revisionCandidates.length > 0}>
        <summary><GitCompareArrows size={16} /> Document Control i rewizje <span>{revisionCandidates.length}</span></summary>
        <div className="pi130-revision-list">
          {data.revisions.slice(0, 30).map((item) => <article key={item.documentId} data-tone={item.detectionStatus === "review" || item.openImpacts ? "warning" : "default"}>
            <span><strong>{item.name}</strong><small>{item.documentNumber ? `Nr ${item.documentNumber} · ` : ""}{item.previousRevisionLabel ? `${item.previousRevisionLabel} → ` : ""}{item.revisionLabel ?? "pierwsza wersja"}</small></span>
            <span><b>{item.detectionStatus === "linked" ? "Rewizja połączona" : item.detectionStatus === "review" ? "Kandydat rewizji" : "Aktualny dokument"}</b><small>{item.matchConfidence == null ? "" : `pewność dopasowania ${percent(item.matchConfidence)}`}</small></span>
            <span><b>{item.openImpacts}</b><small>otwartych wpływów</small></span>
          </article>)}
        </div>
      </details>

      <details className="pi130-details" open={openImpacts.some((item) => ["critical", "high"].includes(item.riskLevel))}>
        <summary><Boxes size={16} /> Analiza wpływu zmian <span>{openImpacts.length}</span></summary>
        <div className="pi130-impact-list">
          {openImpacts.slice(0, 40).map((item) => <article key={item.id} data-tone={["critical", "high"].includes(item.riskLevel) ? "danger" : "default"}>
            <div><strong>{item.summary}</strong><small>{item.changeKind ?? "zmiana"}{item.fieldPath ? ` · ${item.fieldPath}` : ""} · pewność {percent(item.confidence)}</small></div>
            <div className="pi130-change-values"><span><small>Było</small><b>{jsonValue(item.beforeValue)}</b></span><ArrowRight size={13} /><span><small>Jest</small><b>{jsonValue(item.afterValue)}</b></span></div>
            <div className="pi130-tags">{item.impactedModules.map((module) => <span key={module}>{MODULE[module] ?? module}</span>)}</div>
            <small>{item.financialImpact ? `Wpływ finansowy: ${new Intl.NumberFormat("pl-PL").format(item.financialImpact)} zł · ` : ""}{item.scheduleImpactDays ? `Termin: ${item.scheduleImpactDays > 0 ? "+" : ""}${item.scheduleImpactDays} dni` : ""}</small>
          </article>)}
          {!openImpacts.length ? <p className="pi130-empty">Brak otwartych skutków zmian.</p> : null}
        </div>
      </details>

      <details className="pi130-details">
        <summary><Link2 size={16} /> Proweniencja: dokument → dane → moduł <span>{data.provenance.length}</span></summary>
        <div className="pi130-provenance-list">
          {data.provenance.slice(0, 80).map((item, index) => <article key={`${item.entityType}-${item.entityId}-${index}`}>
            <span><strong>{item.entityType}</strong><small>{item.entityId.slice(0, 8)}</small></span>
            <ArrowRight size={13} />
            <span><strong>{item.documentName ?? "Dokument źródłowy"}</strong><small>{item.revisionLabel ? `rew. ${item.revisionLabel} · ` : ""}{item.pageLabel ? `str. ${item.pageLabel} · ` : ""}{item.sectionLabel ?? "źródło"}</small></span>
            {item.excerpt ? <q>{item.excerpt}</q> : null}
          </article>)}
          {!data.provenance.length ? <p className="pi130-empty">Nowe fakty, materiały i pozycje BOQ będą tu miały wskazanie dokumentu, rewizji, strony/arkusza i fragmentu źródła.</p> : null}
        </div>
      </details>
    </section>
  );
}
