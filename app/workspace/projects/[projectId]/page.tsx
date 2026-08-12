import Link from "next/link";
import { ArrowRight, Brain, ClipboardList, Database, FileText } from "lucide-react";
import { notFound } from "next/navigation";
import { requireCurrentUser } from "@/lib/auth";
import { listDocumentsForProject } from "@/lib/data/documents";
import { getProjectProfile, getProjectProfileCompletion } from "@/lib/data/project-profile";
import { getProjectForUser } from "@/lib/data/projects";
import { getAiRuntimeStatus } from "@/lib/env";

export const dynamic = "force-dynamic";

type ProjectPageProps = {
  params: Promise<{
    projectId: string;
  }>;
};

const ROADMAP = [
  {
    number: "01",
    title: "Karta i menu inwestycji",
    description: "Stałe dane, strony kontraktu, terminy i osoby funkcyjne.",
    status: "Wdrożone"
  },
  {
    number: "02",
    title: "Dokumentacja i wersje",
    description: "Pełny upload R2, kategorie, wersjonowanie i podgląd plików.",
    status: "Następne"
  },
  {
    number: "03",
    title: "Octopus Brain",
    description: "Odczyt dokumentów, OCR, fakty projektu i cytowanie źródeł.",
    status: "Plan"
  },
  {
    number: "04",
    title: "Wnioski i protokoły",
    description: "Szablony DOCX/PDF i automatyczne uzupełnianie z karty inwestycji.",
    status: "Plan"
  },
  {
    number: "05",
    title: "Kosztorys i kontrola",
    description: "Przedmiar, przeroby, harmonogram, rewizje i wykrywanie rozbieżności.",
    status: "Plan"
  }
];

export default async function ProjectPage({ params }: ProjectPageProps) {
  const { projectId } = await params;
  const user = await requireCurrentUser();
  const project = await getProjectForUser(user, projectId);

  if (!project) {
    notFound();
  }

  const [profile, documents] = await Promise.all([getProjectProfile(project), listDocumentsForProject(project.id)]);
  const completion = getProjectProfileCompletion(profile);
  const aiStatus = getAiRuntimeStatus();
  const base = `/workspace/projects/${project.id}`;

  return (
    <div className="project-tab-content">
      <section className="project-stat-strip" aria-label="Stan inwestycji">
        <div>
          <span>Kompletność danych</span>
          <strong>{completion}%</strong>
        </div>
        <div>
          <span>Dokumenty</span>
          <strong>{documents.length}</strong>
        </div>
        <div>
          <span>Inwestor</span>
          <strong>{profile.investorName || "Do uzupełnienia"}</strong>
        </div>
        <div>
          <span>AI</span>
          <strong>{aiStatus.ready ? "Gotowe" : "Oczekuje"}</strong>
        </div>
      </section>

      <section className="project-menu-grid" aria-label="Moduły inwestycji">
        <Link href={`${base}/data`} className="project-menu-item">
          <Database aria-hidden="true" />
          <div>
            <h2>Dane inwestycji</h2>
            <p>Stałe dane do wszystkich dokumentów.</p>
          </div>
          <ArrowRight aria-hidden="true" />
        </Link>
        <Link href={`${base}/documentation`} className="project-menu-item">
          <FileText aria-hidden="true" />
          <div>
            <h2>Dokumentacja</h2>
            <p>Pliki, wersje i źródła projektu.</p>
          </div>
          <ArrowRight aria-hidden="true" />
        </Link>
        <Link href={`${base}/outputs`} className="project-menu-item">
          <ClipboardList aria-hidden="true" />
          <div>
            <h2>Wnioski i protokoły</h2>
            <p>Dokumenty generowane z danych inwestycji.</p>
          </div>
          <ArrowRight aria-hidden="true" />
        </Link>
        <Link href={`${base}/brain`} className="project-menu-item">
          <Brain aria-hidden="true" />
          <div>
            <h2>Octopus Brain</h2>
            <p>Analiza i wiedza o inwestycji.</p>
          </div>
          <ArrowRight aria-hidden="true" />
        </Link>
      </section>

      <section className="implementation-roadmap">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Plan wdrożenia</p>
            <h2>Kolejne funkcjonalności</h2>
          </div>
        </div>
        <div className="roadmap-list">
          {ROADMAP.map((item) => (
            <article key={item.number} className="roadmap-row">
              <span className="roadmap-number">{item.number}</span>
              <div>
                <h3>{item.title}</h3>
                <p>{item.description}</p>
              </div>
              <span className={`roadmap-status roadmap-status--${item.status === "Wdrożone" ? "done" : item.status === "Następne" ? "next" : "planned"}`}>
                {item.status}
              </span>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
