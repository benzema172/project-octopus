import { Suspense } from "react";
import { CompanyOperationalPage } from "@/components/company/company-operational-page";
import { FinanceControlTowerSection } from "@/components/company/finance-control-tower-section";
import { AccountingCenterSection } from "@/components/company/accounting-center-section";
import { FinanceEnterpriseFlowSection } from "@/components/company/finance-enterprise-flow-section";
import { UnifiedDocumentFlowSection } from "@/components/company/unified-document-flow-section";
import { getFinanceWorkspaceData } from "@/lib/data/company-operations";
import "../../../../finance-control-tower.css";
import "../../../../finance-control-tower-layout-fix.css";
import "../../../../finance-compact.css";
import "../../../../accounting-center.css";
import "../../../../unified-document-flow.css";

export const dynamic = "force-dynamic";

export default async function FinancePage({
  params,
  searchParams
}: {
  params: Promise<{ workspaceId: string }>;
  searchParams: Promise<{ page?: string; q?: string; tab?: string }>;
}) {
  const [{ workspaceId }, query] = await Promise.all([params, searchParams]);
  const showSourceLayer = query.tab === "documents";
  const showAccountingLayer = query.tab === "accounting";
  return (
    <>
      <Suspense fallback={<section className="fct-shell"><div className="fct-panel"><p className="empty-copy">Ładowanie Finance Control Tower…</p></div></section>}>
        <FinanceControlTowerSection
          workspaceId={workspaceId}
          initialTab={query.tab}
          accountingContent={showAccountingLayer ? <Suspense fallback={<section className="acc-shell"><div className="acc-panel"><p className="empty-copy">Ładowanie Księgowości…</p></div></section>}>
            <AccountingCenterSection workspaceId={workspaceId} />
          </Suspense> : null}
        />
      </Suspense>
      {showSourceLayer ? <div className="finance-source-layer">
        <Suspense fallback={<section className="udf-shell"><div className="udf-panel"><p className="empty-copy">Ładowanie wspólnego obiegu dokumentów…</p></div></section>}>
          <UnifiedDocumentFlowSection workspaceId={workspaceId} />
        </Suspense>
        <CompanyOperationalPage
          workspaceId={workspaceId}
          page={query.page}
          query={query.q}
          domain="finance"
          kind="finance"
          kicker="Finanse operacyjne"
          title="Dokumenty i rozrachunki"
          description="Warstwa źródłowa Finance Control Tower: faktury, płatności, zobowiązania, pozycje kosztowe i alokacje."
          loader={getFinanceWorkspaceData}
        />
        <Suspense fallback={<section className="ops-panel ops-panel--wide"><p className="empty-copy">Ładowanie spójnego obiegu finansowego…</p></section>}>
          <FinanceEnterpriseFlowSection workspaceId={workspaceId} />
        </Suspense>
      </div> : null}
    </>
  );
}
