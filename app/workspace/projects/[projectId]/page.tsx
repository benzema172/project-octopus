import Link from "next/link";
import {
  ArrowRight,
  BarChart3,
  Brain,
  Calculator,
  CalendarDays,
  ClipboardCheck,
  Database,
  FileText,
  PackageCheck
} from "lucide-react";
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
  let documentsCount = 0;
  let documentsAvailable = true;

  try {
    const documents = await listDocumentsForProject(project.id);
    documentsCount = documents.length;
  } catch (error) {
    documentsAvailable = false;
    console.error("Project Octopus: documents dashboard fallback", {
      projectId: project.id,
      message: error instanceof Error ? error.message : String(error)
    });
  }

  const completion = getProjectProfileCompletion(profile);
  const aiStatus = getAiRuntimeStatus();
  const base = `/workspace/projects/${project.id}`;

  const sources = [
    {
      href: `${base}/documentation`,
      icon: FileText,
      title: "Dokumentacja źródłowa",
      value: documentsAvailable ? `${documentsCount} plików` : "Sprawdź dokumentację",
      text: "Projekty, opisy, STWiORB, umowy i rewizje — podstawowe źródło wiedzy inwestycji."
    },
    {
      href: `${base}/cost-estimate`,
      icon: Calculator,
      title: "Kosztorys i przedmiar",
      value: "Moduł gotowy",
      text: "Drugie źródło rdzeniowe: zakres kontraktu, pozycje, ilości i późniejsze powiązanie z przerobem."
    }
  ];

  const workflows = [
    { href: `${base}/requests`, icon: PackageCheck, title: "Wnioski materiałowe", text: "Materiały i urządzenia na podstawie projektu, kosztorysu i zatwierdzonych danych." },
    { href: `${base}/protocols`, icon: ClipboardCheck, title: "Protokoły", text: "Próby, roboty zanikowe, odbiory i dokumenty wykonawcze." },
    { href: `${base}/schedule`, icon: CalendarDays, title: "Harmonogram", text: "Zakresy robót, terminy, zależności i stan realizacji." },
    { href: `${base}/progress`, icon: BarChart3, title: "Przerób", text: "Postęp wykonania połączony docelowo z kosztorysem i wartością robót." }
  ];

  return (
    <div className="project-tab-content pw-dashboard">
      <section className="pw-status-strip" aria-label="Stan inwestycji">
        <div><span>Dane inwestycji</span><strong>{completion}%</strong><small>kompletności karty</small></div>
        <div><span>Dokumentacja</span><strong>{documentsAvailable ? documentsCount : "—"}</strong><small>{documentsAvailable ? "plików źródłowych" : "wymaga sprawdzenia"}</small></div>
        <div><span>Octopus Brain</span><strong>{aiStatus.ready ? "Gotowy" : "Oczekuje"}</strong><small>środowisko AI</small></div>
        <div><span>Model pracy</span><strong>Źródła → wiedza</strong><small>bez ponownego przepisywania</small></div>
      </section>

      <section className="pw-dashboard-grid pw-dashboard-grid--sources">
        <div className="pw-section-card pw-section-card--wide">
          <div className="pw-section-heading">
            <div><p className="co-kicker">Rdzeń inwestycji</p><h2>Źródła wiedzy Octopusa</h2></div>
            <Link href={`${base}/brain`} className="pw-text-link">Otwórz Brain AI <ArrowRight size={14} /></Link>
          </div>
          <p className="pw-section-lead">Dokumentacja + kosztorys budują jedną bazę wiedzy. Informacje wyciągnięte raz mają zasilać wszystkie kolejne moduły.</p>
          <div className="pw-source-grid">
            {sources.map(({ href, icon: Icon, title, value, text }) => (
              <Link key={href} href={href} className="pw-source-card">
                <span className="pw-card-icon"><Icon size={20} /></span>
                <div><strong>{title}</strong><b>{value}</b><p>{text}</p></div>
                <ArrowRight size={16} className="pw-card-arrow" />
              </Link>
            ))}
          </div>
        </div>

        <div className="pw-section-card pw-brain-card">
          <span className="pw-brain-icon"><Brain size={24} /></span>
          <p className="co-kicker">Octopus Brain</p>
          <h2>Wiedza inwestycji</h2>
          <p>Fakty, materiały, urządzenia, instalacje, wymagane próby, ryzyka i źródła informacji.</p>
          <Link href={`${base}/brain`}>Przejdź do analizy <ArrowRight size={15} /></Link>
        </div>
      </section>

      <section className="pw-section-card">
        <div className="pw-section-heading">
          <div><p className="co-kicker">Praca operacyjna</p><h2>Od wiedzy do dokumentów i realizacji</h2></div>
        </div>
        <div className="pw-workflow-grid">
          {workflows.map(({ href, icon: Icon, title, text }) => (
            <Link href={href} key={href} className="pw-workflow-card">
              <span className="pw-card-icon"><Icon size={19} /></span>
              <div><strong>{title}</strong><p>{text}</p></div>
              <ArrowRight size={15} className="pw-card-arrow" />
            </Link>
          ))}
        </div>
      </section>

      <section className="pw-section-card pw-principle-card">
        <div className="pw-principle-icon"><Database size={22} /></div>
        <div>
          <p className="co-kicker">Zasada Project Octopus</p>
          <h2>Jedna informacja — wiele zastosowań</h2>
          <p>Jeżeli system raz rozpozna materiał, urządzenie, parametr lub wymaganie z dokumentacji, ta sama zatwierdzona informacja ma być później dostępna w wniosku materiałowym, protokole, harmonogramie, przerobie i OctopusAI.</p>
        </div>
      </section>
    </div>
  );
}
