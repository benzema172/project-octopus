import { NextResponse } from "next/server";
import { getRequestUser } from "@/lib/auth";
import { getAiRuntimeStatus } from "@/lib/env";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const user = await getRequestUser(request);

  if (!user) {
    return NextResponse.json({ error: "Brak aktywnej sesji." }, { status: 401 });
  }

  return NextResponse.json(getAiRuntimeStatus());
}
