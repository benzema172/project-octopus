import { AlertTriangle, ArrowRight, BookOpenCheck, GitBranch, History, Link2, Sparkles } from "lucide-react";
import type { BrainConflict130, BrainFactVersion130, BrainLatestFact130, Provenance130 } from "@/lib/data/project-intelligence-130";

const confidence = (value: number | null) => value == null ? "—" : `${Math.round(value * 100)}%`;
const displayFact = (fact: BrainLatestFact130) => fact.valueText ?? (fact.valueNumber == null ? "Dane strukturalne" : new Intl.NumberFormat("pl-PL", { maximumFractionDigits: 3 }).format(fact.valueNumber));
const snapshotValue = (snapshot: Record<string, unknown>) => {
  const value = snapshot.valueText ?? snapshot.valueNumber ?? snapshot.valueJson;
  if (value == null) return "—";
  if (typeof value === "string" || typeof value === "number") return String(value);
  try { return JSON.stringify(value); } catch { return "dane"; }
};

export function BrainIntelligence130({ latest, conflicts, history, provenance }: { latest: BrainLatestFact130[]; conflicts: BrainConflict130[]; history: BrainFactVersion130[]; provenance: Provenance130[] }) {
  const sourceByFact = new Map<string, Provenance130>();
  for (const source of provenance) if (!sourceByFact.has(source.entityId)) sourceByFact.set(source.entityId, source);
  const historyByFact = new Map<string, number>();
  for (const version of history) historyByFact.set(version.factId, Math.max(historyByFact.get(version.factId) ?? 0, version.versionNo));

  return (
    <section className="pi130-card pi130-brain" aria-labelledby="brain2-title">
      <div className="pi130-heading">
        <span className="pi130-heading__icon"><Sparkles size={19} /></span>
        <div><p className="co-kicker">Octopus Brain 2.0</p><h2 id="brain2-title">Fakty z wersją, źródłem i konfliktem</h2><p>Brain nie tylko pamięta wartość — pokazuje skąd ją zna, z której rewizji pochodzi i czy nowszy dokument mówi coś innego.</p></div>
      </div>

      <div className="pi130-kpis">
        <div><BookOpenCheck size={17} /><span><small>Aktualne fakty</small><strong>{latest.length}</strong></span></div>
        <div><Link2 size={17} /><span><small>Fakty ze źródłem</small><strong>{latest.filter((item) => sourceByFact.has(item.factId)).length}</strong></span></div>
        <div><History size={17} /><span><small>Wersje w historii</small><strong>{history.length}</strong></span></div>
        <div data-tone={conflicts.length ? "warning" : "positive"}><AlertTriangle size={17} /><span><small>Konflikty wiedzy</small><strong>{conflicts.length}</strong></span></div>
      </div>

      {conflicts.length ? <div className="pi130-brain-conflicts"><div className="pi130-subheading"><AlertTriangle size={15} /><strong>Konflikty wymagające rozstrzygnięcia</strong><small>Brain zachowuje obie wersje zamiast cicho nadpisywać dane.</small></div>{conflicts.slice(0, 12).map((conflict) => <article key={conflict.conflictKey}>
        <span><strong>{conflict.subject || conflict.factType}</strong><small>{conflict.factType} · {conflict.distinctValues} różne wartości</small></span>
        <span><b>{conflict.factCount}</b><small>rekordy źródłowe</small></span>
      </article>)}</div> : <div className="pi130-info pi130-info--positive"><BookOpenCheck size={14} /><span>Brak wykrytych sprzecznych wartości w aktualnej wiedzy inwestycji.</span></div>}

      <details className="pi130-details" open>
        <summary><BookOpenCheck size={16} /> Aktualna wiedza i źródła <span>{latest.length}</span></summary>
        <div className="pi130-brain-facts">
          {latest.slice(0, 100).map((fact) => { const source = sourceByFact.get(fact.factId); return <article key={fact.factId}>
            <span><small>{fact.factType}</small><strong>{fact.subject || fact.factType}</strong></span>
            <span className="pi130-brain-value"><b>{displayFact(fact)}</b><small>pewność {confidence(fact.confidence)} · historia v{historyByFact.get(fact.factId) ?? 1}</small></span>
            <span className="pi130-source">{source ? <><Link2 size={13} /><b>{source.documentName ?? "Dokument"}</b><small>{source.revisionLabel ? `rew. ${source.revisionLabel} · ` : ""}{source.pageLabel ? `str. ${source.pageLabel} · ` : ""}{source.sectionLabel ?? "źródło"}</small></> : <small>Brak znormalizowanego źródła — oznaczone do uzupełnienia.</small>}</span>
            {source?.excerpt ? <q>{source.excerpt}</q> : null}
          </article>; })}
        </div>
      </details>

      <details className="pi130-details">
        <summary><GitBranch size={16} /> Historia zmian faktów <span>{history.length}</span></summary>
        <div className="pi130-brain-history">
          {history.slice(0, 120).map((version) => <article key={version.id}>
            <span><strong>{version.conflictKey}</strong><small>wersja {version.versionNo}</small></span><ArrowRight size={13} /><b>{snapshotValue(version.valueSnapshot)}</b><small>{new Intl.DateTimeFormat("pl-PL", { dateStyle: "short", timeStyle: "short" }).format(new Date(version.changedAt))} · AI {confidence(version.confidence)}</small>
          </article>)}
        </div>
      </details>
    </section>
  );
}
