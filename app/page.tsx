import { redirect } from "next/navigation";
import { ProjectOctopusLoginClient } from "@/components/auth/project-octopus-login-client";
import { getCurrentUser } from "@/lib/auth";
import { getPublicSupabaseConfig } from "@/lib/env";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const user = await getCurrentUser();

  if (user) {
    redirect("/workspace");
  }

  return <ProjectOctopusLoginClient configReady={Boolean(getPublicSupabaseConfig())} />;
}
