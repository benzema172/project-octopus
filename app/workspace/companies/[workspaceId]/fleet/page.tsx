import { CompanyOperationalPage } from "@/components/company/company-operational-page";
import { getFleetCore300Data } from "@/lib/data/fleet-core-300";
import type { CompanyPageOptions } from "@/lib/data/company-operations";

export const dynamic = "force-dynamic";

async function getFleet300Data(workspaceId: string, options: CompanyPageOptions) {
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
    title="Flota, maszyny i transport"
    description="Cyfrowy paszport pojazdu, AI z Wrzutni, przebiegi i motogodziny, serwis, dokumenty, opony, szkody, uprawnienia, koszty TCO i wykorzystanie na inwestycjach."
    loader={getFleet300Data}
  />;
}
