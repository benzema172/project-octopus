import { redirectToCurrentCompany } from "@/lib/navigation/company-redirect";

export default async function LegacyHrPage() {
  return redirectToCurrentCompany("hr");
}
