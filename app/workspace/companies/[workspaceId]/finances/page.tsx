import { CompanyOperationalPage } from "@/components/company/company-operational-page";
import { getFinanceWorkspaceData } from "@/lib/data/company-operations";

export const dynamic="force-dynamic";
export default async function FinancePage({params,searchParams}:{params:Promise<{workspaceId:string}>;searchParams:Promise<{page?:string;q?:string}>}){const[{workspaceId},query]=await Promise.all([params,searchParams]);return <CompanyOperationalPage workspaceId={workspaceId} page={query.page} query={query.q} domain="finance" kind="finance" kicker="Finanse" title="Finanse przedsiębiorstwa" description="Faktury, rozrachunki, płatności i zobowiązania spięte z inwestycjami oraz cash flow firmy." loader={getFinanceWorkspaceData}/>;}
