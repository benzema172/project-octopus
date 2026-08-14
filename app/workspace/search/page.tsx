import { redirectToCurrentCompany } from "@/lib/navigation/company-redirect";

export default async function LegacySearchPage() {
  return redirectToCurrentCompany("search");
}
