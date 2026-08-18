import { NextResponse } from "next/server";
import { getRequestUser } from "@/lib/auth";
import { listProjectsForUser } from "@/lib/data/projects";
import { getProjectProfile } from "@/lib/data/project-profile";
import { getWorkspaceRoleForUser } from "@/lib/data/workspace";
import { seedWysokaTestData } from "@/lib/demo/wysoka-test-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function normalize(value: string) {
  return value.trim().toLocaleLowerCase("pl").replace(/[\"'„”]/g, "").trim();
}

export async function POST(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: "Brak aktywnej sesji." }, { status: 401 });

  const projects = await listProjectsForUser(user);
  let wysoka = projects.find((project) => normalize(project.name) === "wysoka");
  if (!wysoka) {
    for (const project of projects) {
      const profile = await getProjectProfile(project);
      if (normalize(profile.shortName) === "wysoka" || normalize(profile.projectName) === "wysoka") {
        wysoka = project;
        break;
      }
    }
  }
  if (!wysoka) return NextResponse.json({ error: "Nie znaleziono istniejącej inwestycji Wysoka." }, { status: 404 });

  const role = await getWorkspaceRoleForUser(user, wysoka.workspace_id);
  if (!role || !["owner", "admin"].includes(role)) {
    return NextResponse.json({ error: "Tylko właściciel lub administrator może zainicjować dane testowe." }, { status: 403 });
  }

  try {
    const result = await seedWysokaTestData({ workspaceId: wysoka.workspace_id, projectId: wysoka.id, actorId: user.id });
    return NextResponse.json({ ok: true, ...result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Wysoka demo seed failed", error);
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Nie udało się utworzyć danych testowych Wysoka."
    }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
