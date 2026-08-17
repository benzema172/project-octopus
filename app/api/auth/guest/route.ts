import { NextResponse } from "next/server";
import {
  GUEST_PUBLIC_LOGIN,
  GUEST_PUBLIC_PASSWORD
} from "@/lib/demo/guest-constants";
import { ensureGuestDemoAccount } from "@/lib/demo/guest-server";

export const runtime = "nodejs";

type GuestBody = {
  login?: string;
  password?: string;
};

export async function POST(request: Request) {
  let body: GuestBody;
  try {
    body = await request.json() as GuestBody;
  } catch {
    return NextResponse.json({ error: "Nieprawidłowe dane logowania." }, { status: 400 });
  }

  const login = typeof body.login === "string" ? body.login.trim().toLocaleLowerCase("pl") : "";
  const password = typeof body.password === "string" ? body.password : "";

  if (login !== GUEST_PUBLIC_LOGIN || password !== GUEST_PUBLIC_PASSWORD) {
    return NextResponse.json({ error: "Nieprawidłowy login lub hasło gościa." }, { status: 401 });
  }

  try {
    const guest = await ensureGuestDemoAccount();
    return NextResponse.json({
      ok: true,
      email: guest.email,
      password: guest.password,
      workspaceId: guest.workspaceId,
      seededRecords: Object.values(guest.counts).reduce((sum, value) => sum + value, 0),
      warnings: guest.warnings
    });
  } catch (error) {
    console.error("Project Octopus: guest demo bootstrap failed", error);
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Nie udało się przygotować środowiska demonstracyjnego."
    }, { status: 500 });
  }
}
