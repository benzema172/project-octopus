import { CompanyOperationalPage } from "@/components/company/company-operational-page";
import type { CompanyPageOptions } from "@/lib/data/company-operations";
import { getFleetCore300Data } from "@/lib/data/fleet-core-300";

export const dynamic = "force-dynamic";

async function getFleetData(workspaceId: string, options: CompanyPageOptions) {
  return getFleetCore300Data(workspaceId, options);
}

export default async function FleetPage({ params, searchParams }: {
  params: Promise<{ workspaceId: string }>;
  searchParams: Promise<{ page?: string; q?: string }>;
}) {
  const [{ workspaceId }, query] = await Promise.all([params, searchParams]);
  return <CompanyOperationalPage
    workspaceId={workspaceId}
    page={query.page}
    query={query.q}
    domain="fleet"
    kind="fleet"
    kicker="Flota"
    title="Flota"
    loader={getFleetData}
  />;
}
