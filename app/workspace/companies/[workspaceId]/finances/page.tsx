import { Suspense } from "react";
import { CompanyOperationalPage } from "@/components/company/company-operational-page";
import { FinanceEnterpriseFlowSection } from "@/components/company/finance-enterprise-flow-section";
import { getFinanceWorkspaceData } from "@/lib/data/company-operations";

export const dynamic = "force-dynamic";

export default async function FinancePage({
  params,
  searchParams
}: {
  params: Promise<{ workspaceId: string }>;
  searchParams: Promise<{ page?: string; q?: string }>;
}) {
  const [{ workspaceId }, query] = await Promise.all([params, searchParams]);
  return (
    <>
      <CompanyOperationalPage
        workspaceId={workspaceId}
        page={query.page}
        query={query.q}
        domain="finance"
        kind="finance"
        kicker="Finanse"
        title="Finanse przedsiębiorstwa"
        description="Faktury, rozrachunki, płatności i zobowiązania spięte z inwestycjami oraz cash flow firmy. Koszt zarządczy inwestycji jest liczony netto, a VAT i rozrachunek brutto pozostają osobnymi warstwami."
        loader={getFinanceWorkspaceData}
      />
      <Suspense fallback={<section className="ops-panel ops-panel--wide"><p className="empty-copy">Ładowanie spójnego obiegu finansowego…</p></section>}>
        <FinanceEnterpriseFlowSection workspaceId={workspaceId} />
      </Suspense>
    </>
  );
}
