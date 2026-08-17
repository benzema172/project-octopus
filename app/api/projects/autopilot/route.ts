import { NextResponse } from "next/server";
import { getRequestUser } from "@/lib/auth";
import { hasDomainAccess } from "@/lib/authorization";
import { getProjectForUser } from "@/lib/data/projects";
import { runInvestmentAutopilot } from "@/lib/investments/run-autopilot";

export const runtime = "nodejs";
export const maxDuration = 120;

type AutopilotBody = { projectId?: string; action?: "run" };

export async function POST(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: "Brak aktywnej sesji." }, { status: 401 });
  let body: AutopilotBody;
  try { body = await request.json() as AutopilotBody; } catch { return NextResponse.json({ error: "Nieprawidłowe dane Autopilota." }, { status: 400 }); }
  if (!body.projectId || body.action !== "run") return NextResponse.json({ error: "Brakuje inwestycji lub operacji Autopilota." }, { status: 400 });
  const project = await getProjectForUser(user, body.projectId);
  if (!project) return NextResponse.json({ error: "Brak dostępu do inwestycji." }, { status: 403 });
  if (!await hasDomainAccess({ workspaceId: project.workspace_id, userId: user.id, domain: "investments", level: "write", projectId: project.id })) return NextResponse.json({ error: "Autopilot wymaga uprawnienia do edycji inwestycji." }, { status: 403 });
  try {
    const summary = await runInvestmentAutopilot({ workspaceId: project.workspace_id, projectId: project.id, userId: user.id });
    return NextResponse.json({ ok: true, ...summary });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Nie udało się uruchomić Autopilota." }, { status: 500 });
  }
}
