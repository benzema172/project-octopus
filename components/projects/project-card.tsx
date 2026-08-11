import Link from "next/link";
import { ArrowRight, FileText } from "lucide-react";
import type { ProjectSummary } from "@/lib/types";

type ProjectCardProps = {
  project: ProjectSummary;
};

export function ProjectCard({ project }: ProjectCardProps) {
  return (
    <article className="project-card">
      <div>
        <p className="eyebrow">{project.status}</p>
        <h2>{project.name}</h2>
        <p>{project.description || "Workspace inwestycji gotowy na dokumentację i analizę."}</p>
      </div>
      <dl>
        <div>
          <dt>Inwestor</dt>
          <dd>{project.investor_name || "Nie uzupełniono"}</dd>
        </div>
        <div>
          <dt>Lokalizacja</dt>
          <dd>{project.location || "Nie uzupełniono"}</dd>
        </div>
      </dl>
      <Link href={`/workspace/projects/${project.id}`} className="secondary-button">
        <FileText size={18} aria-hidden="true" />
        Otwórz
        <ArrowRight size={16} aria-hidden="true" />
      </Link>
    </article>
  );
}
