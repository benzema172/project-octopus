import { CompanyOperationalPage } from "@/components/company/company-operational-page";
import { getFleetConnected400Data } from "@/lib/data/fleet-connected-400";
import type { CompanyPageOptions } from "@/lib/data/company-operations";

export const dynamic = "force-dynamic";

async function getFleet400Data(workspaceId: string, options: CompanyPageOptions) {
  return getFleetConnected400Data(workspaceId, options);
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
    title="Fleet 4.0 — Connected Intelligence"
    description="Uniwersalny system floty dla polskich firm: operacje, GPS i geofencing, OBD/CAN, Fleet Readiness, Mission Fit, predykcyjny serwis, AI, bezpieczeństwo, e-TOLL/tachograf/SENT, EV, TCO i integracje z Kadrami, Magazynem, Finansami oraz Inwestycjami."
    loader={getFleet400Data}
  />;
}
