import { APP_RELEASE, APP_RELEASE_LABEL } from "@/lib/app-release";

export function AppReleaseBadge() {
  const title = `${APP_RELEASE_LABEL} • commit ${APP_RELEASE.commit}`;

  return (
    <aside className="app-release-badge" aria-label={APP_RELEASE_LABEL} title={title}>
      <span className="app-release-badge__product">Project Octopus</span>
      <strong className="app-release-badge__version">v{APP_RELEASE.displayVersion}</strong>
      <span className="app-release-badge__separator" aria-hidden="true">•</span>
      <span className="app-release-badge__date">wdrożono {APP_RELEASE.deployedAt}</span>
    </aside>
  );
}
