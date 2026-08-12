import { Brain, FileText, UserRound } from "lucide-react";
import { notFound } from "next/navigation";
import { requireCurrentUser } from "@/lib/auth";
import { listDocumentsForProject } from "@/lib/data/documents";
import { getProjectProfile, getProjectProfileCompletion } from "@/lib/data/project-profile";
import { getProjectForUser } from "@/lib/data/projects";
import { getAiRuntimeStatus } from "@/lib/env";

export const dynamic = "force-dynamic";

type ProjectPageProps = { params: Promise<{ projectId: string }> };

export default async function ProjectPage({ params }: ProjectPageProps) {
  const { projectId } = await params;
  const user = await requireCurrentUser();
  const project = await getProjectForUser(user, projectId);

  if (!project) notFound();

  const profile = await getProjectProfile(project);
  let documentCount: number | null = null;

  try {
    documentCount = (await listDocumentsForProject(project.id)).length;
  } catch (error) {
    console.error("Project Octopus: documents dashboard fallback", {
      projectId: project.id,
      message: error instanceof Error ? error.message : String(error)
    });
  }

  const completion = getProjectProfileCompletion(profile);
  const aiStatus = getAiRuntimeStatus();

  return (
    <div className="project-tab-content pw-dashboard pw-dashboard--compact">
      <section className="pw-overview-panel">
        <div className="pw-overview-panel__heading">
          <div>
            <p className="co-kicker">Dashboard inwestycji</p>
            <h2>Stan realizacji w jednym miejscu</h2>
            <p>
              Nawigacja powyżej prowadzi bezpośrednio do wszystkich obszarów pracy. Dashboard pokazuje tylko bieżący stan inwestycji,
              bez powtarzania tych samych modułów w kolejnych kaflach.
            </p>
          </div>
          <span className={aiStatus.ready ? "pw-ai-state pw-ai-state--ready" : "pw-ai-state"}>
            <Brain size={15} aria-hidden="true" />
            {aiStatus.ready ? "Octopus Brain gotowy" : "Octopus Brain oczekuje"}
          </span>
        </div>

        <div className="pw-overview-lines" aria-label="Podsumowanie inwestycji">
          <div>
            <span>Kompletność danych</span>
            <strong>{completion}%</strong>
            <small>Karta inwestycji</small>
          </div>
          <div>
            <span>Dokumentacja</span>
            <strong>{documentCount === null ? "—" : documentCount}</strong>
            <small>{documentCount === null ? "Wymaga sprawdzenia" : "Plików źródłowych"}</small>
          </div>
          <div>
            <span>Inwestor</span>
            <strong>{profile.investorName || project.investor_name || "Do uzupełnienia"}</strong>
            <small><UserRound size={13} aria-hidden="true" /> Dane kontraktowe</small>
          </div>
          <div>
            <span>Źródła wiedzy</span>
            <strong>Dokumentacja + kosztorys</strong>
            <small><FileText size={13} aria-hidden="true" /> Jedna baza wiedzy Octopusa</small>
          </div>
        </div>
      </section>
    </div>
  );
}
