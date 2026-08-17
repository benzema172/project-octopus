import { notFound } from "next/navigation";
import { CompanySearch } from "@/components/company/company-search";
import { requireCurrentUser } from "@/lib/auth";
import { domainAccessPolicyHasAnyScope, loadDomainAccessPolicy, type Domain } from "@/lib/authorization";
import { getWorkspaceForUser } from "@/lib/data/workspace";
import { DomainAccessDenied } from "@/components/access/domain-access-denied";

export const dynamic = "force-dynamic";

export default async function CompanySearchPage({ params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  const user = await requireCurrentUser();
  const workspace = await getWorkspaceForUser(user, workspaceId);
  if (!workspace) notFound();
  const policy = await loadDomainAccessPolicy({ workspaceId: workspace.id, userId: user.id });
  const domains: Domain[] = ["investments", "finance", "hr", "warehouse", "fleet", "reports", "templates"];
  if (!domains.some((domain) => domainAccessPolicyHasAnyScope(policy, { domain, level: "read" }))) return <DomainAccessDenied workspaceId={workspace.id} area="Wyszukiwarka" />;
  return <main className="co-page">
    <header className="co-page-heading"><div><p className="co-kicker">Wyszukiwarka firmy</p><h1>Jedno wyszukiwanie przez cały Octopus</h1><p>Znajdź inwestycję, dokument, fakturę, pracownika, materiał, pojazd albo pozycję kosztorysu bez przechodzenia po modułach.</p></div></header>
    <CompanySearch workspaceId={workspace.id} />
  </main>;
}
