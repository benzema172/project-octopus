import { NextResponse } from "next/server";
import { getRequestUser } from "@/lib/auth";
import { hasDomainAccess, type Domain } from "@/lib/authorization";
import { getCompanyPowerToolsData, type CompanyPowerKind } from "@/lib/data/company-power-tools";
import { getWorkspaceForUser } from "@/lib/data/workspace";

export const runtime="nodejs";

const DOMAIN:Record<CompanyPowerKind,Domain>={finance:"finance",hr:"hr",warehouse:"warehouse",fleet:"fleet",reports:"reports"};
const KINDS=new Set<CompanyPowerKind>(["finance","hr","warehouse","fleet","reports"]);

export async function GET(request:Request){
  const user=await getRequestUser(request);
  if(!user)return NextResponse.json({error:"Brak aktywnej sesji."},{status:401});
  const url=new URL(request.url),workspaceId=url.searchParams.get("workspaceId")??"",rawKind=url.searchParams.get("kind")??"";
  if(!workspaceId||!KINDS.has(rawKind as CompanyPowerKind))return NextResponse.json({error:"Brakuje firmy lub modułu."},{status:400});
  const kind=rawKind as CompanyPowerKind;
  const workspace=await getWorkspaceForUser(user,workspaceId);
  if(!workspace)return NextResponse.json({error:"Brak dostępu do firmy."},{status:403});
  if(!await hasDomainAccess({workspaceId:workspace.id,userId:user.id,domain:DOMAIN[kind],level:"read"}))return NextResponse.json({error:"Brak uprawnienia do modułu."},{status:403});
  try{return NextResponse.json({data:await getCompanyPowerToolsData(workspace.id,kind)});}catch(error){console.error("Project Octopus: deferred Company Power Tools read failed",error);return NextResponse.json({error:error instanceof Error?error.message:"Nie udało się odczytać narzędzi operacyjnych."},{status:500});}
}
