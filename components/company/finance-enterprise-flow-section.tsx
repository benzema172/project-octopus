import { DomainAccessDenied } from "@/components/access/domain-access-denied";
import { FinanceEnterpriseFlow } from "@/components/company/finance-enterprise-flow";
import { requireCurrentUser } from "@/lib/auth";
import { hasDomainAccess } from "@/lib/authorization";
import { getCompanyEnterpriseFlow } from "@/lib/data/enterprise-flow";
import { getWorkspaceForUser } from "@/lib/data/workspace";

function formatDate(value: unknown) {
  if (!value) return "—";
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toLocaleDateString("pl-PL");
}

export async function FinanceEnterpriseFlowSection({ workspaceId }: { workspaceId: string }) {
  const user = await requireCurrentUser();
  const workspace = await getWorkspaceForUser(user, workspaceId);
  if (!workspace) return null;
  const [canRead, canWrite, canApprove] = await Promise.all([
    hasDomainAccess({ workspaceId: workspace.id, userId: user.id, domain: "finance", level: "read" }),
    hasDomainAccess({ workspaceId: workspace.id, userId: user.id, domain: "finance", level: "write" }),
    hasDomainAccess({ workspaceId: workspace.id, userId: user.id, domain: "finance", level: "approve" })
  ]);
  if (!canRead) return <DomainAccessDenied workspaceId={workspace.id} area="Finanse — obieg przedsiębiorstwa" />;
  const data = await getCompanyEnterpriseFlow(workspace.id);
  const approvedEntries = data.accountingEntries.filter((entry) => entry.status === "approved").slice(0, 12);

  return <>
    <FinanceEnterpriseFlow workspaceId={workspace.id} data={data} canWrite={canWrite} canApprove={canApprove} />
    {canWrite && approvedEntries.length > 0 ? <section className="ops-panel ops-panel--wide" aria-label="Eksport zatwierdzonych dekretów">
      <div className="section-heading"><div><p className="eyebrow">Eksport księgowy</p><h2>Zatwierdzone dekrety gotowe do przekazania</h2><p>Każdy plik korzysta z wersjonowanego kontraktu <code>octopus-accounting-export-v1</code> i zawiera Wn/Ma, VAT, kontrahenta oraz MPK inwestycji.</p></div></div>
      <div className="ops-simple-list">
        {approvedEntries.map((entry) => <div key={String(entry.id)}>
          <span>{formatDate(entry.entry_date)}</span>
          <strong>{String(entry.description ?? "Dekret księgowy")}</strong>
          <div className="ops-list-row__detail">Wn {String(entry.total_debit ?? 0)} = Ma {String(entry.total_credit ?? 0)}{entry.exported_at ? ` · ostatni eksport ${formatDate(entry.exported_at)}` : " · jeszcze nie eksportowano"}</div>
          <a className="secondary-button" href={`/api/company/accounting-export?workspaceId=${encodeURIComponent(workspace.id)}&entryId=${encodeURIComponent(String(entry.id))}`}>Eksportuj JSON</a>
        </div>)}
      </div>
    </section> : null}
  </>;
}
