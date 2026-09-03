import { CompanyOperationalPage } from "@/components/company/company-operational-page";
import { getWarehouseAi300Data } from "@/lib/data/warehouse-ai-300";
import { getWarehouseWorkspaceData, type CompanyPageOptions } from "@/lib/data/company-operations";

export const dynamic = "force-dynamic";

async function getWarehouse300Data(workspaceId: string, options: CompanyPageOptions) {
  const [base, ai] = await Promise.all([
    getWarehouseWorkspaceData(workspaceId, options),
    getWarehouseAi300Data(workspaceId)
  ]);
  return { ...base, ...ai };
}

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
    kicker="Magazyn"
    title="Magazyn, materiały i sprzęt"
    description="AI rozpoznaje towary i urządzenia, dopasowuje kartoteki, pilnuje cen i kieruje wyjątki do lekkiej Poczekalni. Rzeczywisty stan zmienia dopiero zatwierdzony ruch magazynowy."
    loader={getWarehouse300Data}
  />;
}
