import { notFound } from "next/navigation";
import { CompanyOperationsLazy } from "@/components/company/company-operations-lazy";
import { CompanyPowerToolsDeferred } from "@/components/company/company-power-tools-deferred";
import { DomainAccessDenied } from "@/components/access/domain-access-denied";
import { requireCurrentUser } from "@/lib/auth";
import { hasDomainAccess, type Domain } from "@/lib/authorization";
import type { CompanyPageOptions } from "@/lib/data/company-operations";
import { getWorkspaceForUser } from "@/lib/data/workspace";
import type { Data } from "@/components/company/operations/module-shell";

type Kind = "finance" | "warehouse" | "fleet";
type Loader = (workspaceId: string, options: CompanyPageOptions) => Promise<Data>;

type Props = {
  workspaceId: string;
  page?: string;
  query?: string;
  domain: Domain;
  kind: Kind;
  kicker: string;
  title: string;
  description: string;
  loader: Loader;
};

export async function CompanyOperationalPage({ workspaceId, page, query, domain, kind, kicker, title, description, loader }: Props) {
  const user = await requireCurrentUser();
  const workspace = await getWorkspaceForUser(user, workspaceId);
  if (!workspace) notFound();

  const canRead = await hasDomainAccess({ workspaceId: workspace.id, userId: user.id, domain, level: "read" });
  if (!canRead) return <DomainAccessDenied workspaceId={workspace.id} area={kicker} />;

  const referenceDate = new Date().toISOString().slice(0, 10);
  const [data, canWrite, canApprove] = await Promise.all([
    loader(workspace.id, { page: Number(page ?? 1), query, referenceDate }),
    hasDomainAccess({ workspaceId: workspace.id, userId: user.id, domain, level: "write" }),
    hasDomainAccess({ workspaceId: workspace.id, userId: user.id, domain, level: "approve" })
  ]);

  const pathname = `/workspace/companies/${workspace.id}/${kind === "finance" ? "finances" : kind}`;
  const showLegacyPowerTools = kind !== "warehouse";

  return (
    <main className="co-page">
      <header className="co-page-heading">
        <div>
          <p className="co-kicker">{kicker}</p>
          <h1>{title}</h1>
          <p>{description}</p>
        </div>
      </header>
      <CompanyOperationsLazy
        workspaceId={workspace.id}
        kind={kind}
        data={data}
        canWrite={canWrite}
        canApprove={canApprove}
        pathname={pathname}
        query={query ?? ""}
      />
      {showLegacyPowerTools ? (
        <CompanyPowerToolsDeferred
          workspaceId={workspace.id}
          kind={kind}
          canWrite={canWrite}
          referenceDate={referenceDate}
        />
      ) : null}
    </main>
  );
}
