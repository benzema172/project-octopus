import { ClipboardCheck, FileSignature, FileText, PackageCheck } from "lucide-react";
import { notFound } from "next/navigation";
import { requireCurrentUser } from "@/lib/auth";
import { getProjectForUser } from "@/lib/data/projects";

export const dynamic = "force-dynamic";

type ProjectOutputsPageProps = {
  params: Promise<{ projectId: string }>;
};

const OUTPUT_TYPES = [
  { title: "Wniosek materiałowy", icon: PackageCheck },
  { title: "Protokół próby", icon: ClipboardCheck },
  { title: "Protokół odbioru / zanikowy", icon: FileSignature },
  { title: "RFI i pismo projektowe", icon: FileText }
];

export default async function ProjectOutputsPage({ params }: ProjectOutputsPageProps) {
  const { projectId } = await params;
  const user = await requireCurrentUser();
  const project = await getProjectForUser(user, projectId);

  if (!project) {
    notFound();
  }

  return (
    <div className="project-tab-content">
      <section className="section-band">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Generatory</p>
            <h2>Wnioski i protokoły</h2>
          </div>
          <span className="status-pill">Etap 4</span>
        </div>
        <div className="output-type-grid">
          {OUTPUT_TYPES.map(({ title, icon: Icon }) => (
            <div key={title} className="output-type-row">
              <Icon size={20} aria-hidden="true" />
              <strong>{title}</strong>
              <span>Planowane</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
