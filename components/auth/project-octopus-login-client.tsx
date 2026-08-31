"use client";

import dynamic from "next/dynamic";

type ProjectOctopusLoginClientProps = {
  configReady: boolean;
};

const ProjectOctopusLogin = dynamic(
  () => import("@/components/auth/project-octopus-login").then((module) => module.ProjectOctopusLogin),
  {
    ssr: false,
    loading: () => (
      <main className="octopus-login" aria-busy="true">
        <h1 className="v27-brand">
          <small>Project</small>
          <strong>Octopus</strong>
        </h1>
        <p className="v27-login-hint">Uruchamianie panelu logowania…</p>
        <div className="v27-board-shell" aria-hidden="true">
          <section className="v27-board">
            <div className="v27-grid-layer" />
            <div className="v27-grid-shimmer" />
          </section>
        </div>
      </main>
    )
  }
);

export function ProjectOctopusLoginClient({ configReady }: ProjectOctopusLoginClientProps) {
  return <ProjectOctopusLogin configReady={configReady} />;
}
