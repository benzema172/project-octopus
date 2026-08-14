import { redirectToCurrentCompany } from "@/lib/navigation/company-redirect";

export default async function LegacyFinancePage() {
  return redirectToCurrentCompany("finances");
}
