import { CompanyOperationalPage } from "@/components/company/company-operational-page";
import { getHrWorkspaceData } from "@/lib/data/company-operations";

export const dynamic="force-dynamic";
export default async function HrPage({params,searchParams}:{params:Promise<{workspaceId:string}>;searchParams:Promise<{page?:string;q?:string}>}){const[{workspaceId},query]=await Promise.all([params,searchParams]);return <CompanyOperationalPage workspaceId={workspaceId} page={query.page} query={query.q} domain="hr" kind="hr" kicker="Kadry" title="Kadry i zasoby ludzkie" description="Kartoteka pracowników, warunki zatrudnienia, koszty, czas pracy, urlopy i uprawnienia." loader={getHrWorkspaceData}/>;}
