import { redirectToCurrentCompany } from "@/lib/navigation/company-redirect";

export default async function LegacySettingsPage() {
  return redirectToCurrentCompany("settings");
}
