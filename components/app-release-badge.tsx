import { APP_RELEASE, APP_RELEASE_LABEL } from "@/lib/app-release";

export function AppReleaseBadge({ sidebar = false }: { sidebar?: boolean } = {}) {
  const title = `${APP_RELEASE_LABEL} • commit ${APP_RELEASE.commit}`;

  return (
    <aside className={`app-release-badge${sidebar ? " app-release-badge--sidebar" : " app-release-badge--floating"}`} aria-label={APP_RELEASE_LABEL} title={title}>
      {!sidebar ? <span className="app-release-badge__product">Project Octopus</span> : null}
      <strong className="app-release-badge__version">v{APP_RELEASE.version}</strong>
      {!sidebar ? <span className="app-release-badge__separator" aria-hidden="true">•</span> : null}
      <span className="app-release-badge__date">wdrożono {APP_RELEASE.deployedAt}</span>
    </aside>
  );
}
