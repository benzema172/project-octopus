import Link from "next/link";
import { AlertTriangle, ArrowRight, Bot, CheckCircle2, FileWarning, PackageSearch, ReceiptText, Sparkles } from "lucide-react";
import { getProjectTodayIntelligence130 } from "@/lib/data/project-intelligence-130";

const iconFor = (category: string) => {
  if (category === "cost") return ReceiptText;
  if (category === "materials") return PackageSearch;
  if (category === "documentation" || category === "processing") return FileWarning;
  if (category === "change_control") return AlertTriangle;
  return Bot;
};

export async function ProjectTodayIntelligence130({ projectId }: { projectId: string }) {
  let actions = [];
  try { actions = await getProjectTodayIntelligence130(projectId, 8); }
  catch (error) {
    console.error("Project Octopus: Project Intelligence 1.3.0 unavailable", { projectId, message: error instanceof Error ? error.message : String(error) });
    return null;
  }

  return (
    <section className="pi130-today" aria-labelledby="project-today-intelligence-title">
      <div className="pi130-today__heading"><span><Sparkles size={17} /></span><div><p className="co-kicker">Project Intelligence</p><h2 id="project-today-intelligence-title">Co powinienem zrobić dzisiaj?</h2></div><b>{actions.length ? `${actions.length} priorytetów` : "Brak blokad"}</b></div>
      {actions.length ? <div className="pi130-today__list">{actions.map((action) => { const Icon = iconFor(action.category); return <Link href={action.href} key={`${action.entityType}-${action.entityId}`} data-tone={action.priority === "critical" ? "danger" : action.priority === "high" ? "warning" : "default"}>
        <span><Icon size={15} /></span><div><strong>{action.title}</strong><small>{action.detail ?? "Otwórz moduł i zweryfikuj rekomendację OctopusAI."}</small></div><b>{action.priority === "critical" ? "Krytyczne" : action.priority === "high" ? "Wysoki" : "Do zrobienia"}</b><ArrowRight size={14} />
      </Link>; })}</div> : <div className="pi130-today__empty"><CheckCircle2 size={18} /><span><strong>Nie wykryłem pilnej blokady.</strong><small>Analiza obejmuje dokumenty, wyjątki AI, rewizje, BOQ, materiały, zadania i kompletność dokumentacji.</small></span></div>}
    </section>
  );
}
