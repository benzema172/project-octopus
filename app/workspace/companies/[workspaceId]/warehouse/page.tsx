import { CompanyOperationalPage } from "@/components/company/company-operational-page";
import { getWarehouseMarket400Data } from "@/lib/data/warehouse-market-400";

export const dynamic = "force-dynamic";

export default async function WarehousePage({ params, searchParams }: {
  params: Promise<{ workspaceId: string }>;
  searchParams: Promise<{ page?: string; q?: string }>;
}) {
  const [{ workspaceId }, query] = await Promise.all([params, searchParams]);
  return <CompanyOperationalPage
    workspaceId={workspaceId}
    page={query.page}
    query={query.q}
    domain="warehouse"
    kind="warehouse"
    kicker="Magazyn 4.0"
    title="Magazyn, materiały, sprzęt i WMS"
    loader={getWarehouseMarket400Data}
  />;
}
