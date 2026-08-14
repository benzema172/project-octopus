import { redirectToCurrentCompany } from "@/lib/navigation/company-redirect";

export default async function LegacyReportsPage() {
  return redirectToCurrentCompany("reports");
}
