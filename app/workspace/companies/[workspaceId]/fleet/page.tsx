import { CompanyOperationalPage } from "@/components/company/company-operational-page";
import { getFleetWorkspaceData, type CompanyPageOptions } from "@/lib/data/company-operations";

export const dynamic = "force-dynamic";

async function getFleetData(workspaceId: string, options: CompanyPageOptions) {
  return getFleetWorkspaceData(workspaceId, options);
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
    description="Pojazdy, eksploatacja, serwis, dokumenty, wyposażenie, szkody, koszty i wykorzystanie floty w jednym widoku operacyjnym."
    loader={getFleetData}
  />;
}
