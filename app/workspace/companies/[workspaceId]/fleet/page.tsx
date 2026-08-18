import { CompanyOperationalPage } from "@/components/company/company-operational-page";
import { getFleetWorkspaceData } from "@/lib/data/company-operations";

export const dynamic="force-dynamic";
export default async function FleetPage({params,searchParams}:{params:Promise<{workspaceId:string}>;searchParams:Promise<{page?:string;q?:string}>}){const[{workspaceId},query]=await Promise.all([params,searchParams]);return <CompanyOperationalPage workspaceId={workspaceId} page={query.page} query={query.q} domain="fleet" kind="fleet" kicker="Flota" title="Flota i transport" description="Pojazdy i maszyny, paliwo, serwis, przebiegi, dokumenty, terminy i koszty realizacji." loader={getFleetWorkspaceData}/>;}
