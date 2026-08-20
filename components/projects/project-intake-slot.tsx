"use client";

import dynamic from "next/dynamic";

const ProjectIntake = dynamic(
  () => import("@/components/projects/project-intake-pipeline").then((module) => module.ProjectIntake),
  { ssr: false, loading: () => <span className="pw-intake-placeholder" aria-hidden="true" /> }
);

export function ProjectIntakeSlot({ projectId }: { projectId: string }) {
  return <ProjectIntake projectId={projectId} />;
}
