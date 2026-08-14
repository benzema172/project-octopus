import { redirectToCurrentCompany } from "@/lib/navigation/company-redirect";

export default async function LegacyFleetPage() {
  return redirectToCurrentCompany("fleet");
}
