import { redirectToCurrentCompany } from "@/lib/navigation/company-redirect";

export default async function LegacyDocumentsPage() {
  return redirectToCurrentCompany("documents");
}
