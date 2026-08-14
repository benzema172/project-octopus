import "server-only";

import { redirect } from "next/navigation";
import { requireCurrentUser } from "@/lib/auth";
import { ensureWorkspaceForUser } from "@/lib/data/workspace";

export async function redirectToCurrentCompany(section: string): Promise<never> {
  const user = await requireCurrentUser();
  const workspace = await ensureWorkspaceForUser(user);

  redirect(`/workspace/companies/${workspace.id}/${section}`);
}
