import packageJson from "@/package.json";

function formatDeploymentDate(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "lokalnie";

  return new Intl.DateTimeFormat("pl-PL", {
    timeZone: "Europe/Warsaw",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  })
    .format(parsed)
    .replace(",", "");
}

const buildTimestamp = process.env.NEXT_PUBLIC_OCTOPUS_BUILD_TIMESTAMP || new Date().toISOString();
const buildCommit = (process.env.NEXT_PUBLIC_OCTOPUS_BUILD_COMMIT || "local").trim();
const buildShort = buildCommit === "local" ? "local" : buildCommit.slice(0, 7);

export const APP_RELEASE = {
  version: packageJson.version,
  build: buildShort,
  commit: buildCommit,
  deployedAt: formatDeploymentDate(buildTimestamp),
  displayVersion: buildShort === "local" ? packageJson.version : `${packageJson.version}+${buildShort}`
} as const;

export const APP_RELEASE_LABEL = `Project Octopus v${APP_RELEASE.displayVersion} • wdrożono ${APP_RELEASE.deployedAt}`;
