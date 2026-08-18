import { CompanySelector } from "@/components/companies/company-selector";
import { requireCurrentUser } from "@/lib/auth";
import { isCompanyProfileSchemaReady, listCompanyWorkspacesForUser } from "@/lib/data/workspace";
import "../company-selector-refinement.css";

export const dynamic = "force-dynamic";

export default async function WorkspacePage() {
  const user = await requireCurrentUser();
  const [companies, schemaReady] = await Promise.all([
    listCompanyWorkspacesForUser(user),
    isCompanyProfileSchemaReady()
  ]);

  return (
    <CompanySelector
      companies={companies}
      schemaReady={schemaReady}
      userEmail={user.email ?? "Administrator Project Octopus"}
    />
  );
}
