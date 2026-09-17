import { NextResponse } from "next/server";
import { getRequestUser } from "@/lib/auth";
import { hasDomainAccess } from "@/lib/authorization";
import { getWorkspaceForUser } from "@/lib/data/workspace";
import {
  deleteMultiAiProviderSecret,
  getMultiAiProviderStatus,
  saveMultiAiProviderSecret,
  testMultiAiProvider,
  type MultiAiProvider
} from "@/lib/ai/provider-vault";

export const runtime = "nodejs";
export const maxDuration = 60;

type Body = {
  workspaceId?: string;
  provider?: MultiAiProvider;
  apiKey?: string;
  accountId?: string;
};

async function context(request: Request, workspaceId?: string) {
  const user = await getRequestUser(request);
  if (!user) return { error: NextResponse.json({ error: "Brak aktywnej sesji." }, { status: 401 }) } as const;
  if (!workspaceId) return { error: NextResponse.json({ error: "Brak firmy." }, { status: 400 }) } as const;
  const workspace = await getWorkspaceForUser(user, workspaceId);
  if (!workspace) return { error: NextResponse.json({ error: "Brak dostępu do firmy." }, { status: 403 }) } as const;
  const canAdmin = await hasDomainAccess({ workspaceId: workspace.id, userId: user.id, domain: "settings", level: "admin" });
  if (!canAdmin) return { error: NextResponse.json({ error: "Tylko administrator ustawień może zarządzać kluczami AI." }, { status: 403 }) } as const;
  return { user, workspace } as const;
}

function provider(value: unknown): MultiAiProvider | null {
  return value === "groq" || value === "cloudflare" ? value : null;
}

export async function GET(request: Request) {
  const workspaceId = new URL(request.url).searchParams.get("workspaceId") ?? undefined;
  const ctx = await context(request, workspaceId);
  if ("error" in ctx) return ctx.error;
  return NextResponse.json({ ok: true, status: await getMultiAiProviderStatus(ctx.workspace.id) }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  let body: Body;
  try { body = await request.json() as Body; }
  catch { return NextResponse.json({ error: "Nieprawidłowe dane." }, { status: 400 }); }
  const ctx = await context(request, body.workspaceId);
  if ("error" in ctx) return ctx.error;
  const selected = provider(body.provider);
  if (!selected) return NextResponse.json({ error: "Nieobsługiwany provider AI." }, { status: 400 });
  const secret = body.apiKey?.trim() ?? "";
  if (secret.length < 8) return NextResponse.json({ error: "Klucz API jest pusty lub zbyt krótki." }, { status: 400 });

  try {
    const test = await testMultiAiProvider({ provider: selected, secret, accountId: body.accountId });
    if (!test.ok) {
      return NextResponse.json({ error: `Provider odrzucił połączenie (HTTP ${test.status}). Sprawdź token i uprawnienia.`, test }, { status: 422 });
    }
    await saveMultiAiProviderSecret({ workspaceId: ctx.workspace.id, provider: selected, secret, accountId: body.accountId });
    const status = await getMultiAiProviderStatus(ctx.workspace.id);
    return NextResponse.json({ ok: true, provider: selected, test, status });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Nie udało się zapisać providera AI." }, { status: 422 });
  }
}

export async function DELETE(request: Request) {
  let body: Body;
  try { body = await request.json() as Body; }
  catch { return NextResponse.json({ error: "Nieprawidłowe dane." }, { status: 400 }); }
  const ctx = await context(request, body.workspaceId);
  if ("error" in ctx) return ctx.error;
  const selected = provider(body.provider);
  if (!selected) return NextResponse.json({ error: "Nieobsługiwany provider AI." }, { status: 400 });
  await deleteMultiAiProviderSecret(ctx.workspace.id, selected);
  return NextResponse.json({ ok: true, provider: selected, status: await getMultiAiProviderStatus(ctx.workspace.id) });
}
