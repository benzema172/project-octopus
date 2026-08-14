import { redirectToCurrentCompany } from "@/lib/navigation/company-redirect";

export default async function LegacyBrainPage() {
  return redirectToCurrentCompany("brain");
}
