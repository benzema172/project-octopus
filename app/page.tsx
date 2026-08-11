import { redirect } from "next/navigation";
import { ProjectOctopusLogin } from "@/components/auth/project-octopus-login";
import { getCurrentUser } from "@/lib/auth";
import { getPublicSupabaseConfig } from "@/lib/env";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const user = await getCurrentUser();

  if (user) {
    redirect("/workspace");
  }

  return <ProjectOctopusLogin configReady={Boolean(getPublicSupabaseConfig())} />;
}
