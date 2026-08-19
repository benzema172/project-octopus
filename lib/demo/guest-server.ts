import "server-only";

import {
  GUEST_AUTH_EMAIL,
  GUEST_AUTH_PASSWORD,
  GUEST_DEMO_DATASET_VERSION
} from "@/lib/demo/guest-constants";
import { DEMO_WORKSPACE_ID } from "@/lib/demo/blueprint";
import { seedGuestDemoData } from "@/lib/demo/seed";
import { createServiceSupabaseClient } from "@/lib/supabase/service";

function guestDatasetVersion(userMetadata: Record<string, unknown> | null | undefined) {
  return typeof userMetadata?.demo_dataset_version === "string"
    ? userMetadata.demo_dataset_version
    : null;
}

async function guestWorkspaceExists(userId: string) {
  const db = createServiceSupabaseClient();
  const { data, error } = await db
    .from("workspaces")
    .select("id")
    .eq("id", DEMO_WORKSPACE_ID)
    .eq("owner_id", userId)
    .maybeSingle<{ id: string }>();

  if (error) throw new Error(`Nie udało się sprawdzić firmy demonstracyjnej: ${error.message}`);
  return Boolean(data);
}

async function legacyGuestDatasetLooksComplete(userId: string) {
  const db = createServiceSupabaseClient();
  const workspaceReady = await guestWorkspaceExists(userId);
  if (!workspaceReady) return false;

  const [projects, templates, snapshots, ksef, movements, employees] = await Promise.all([
    db.from("projects").select("id", { count: "exact", head: true }).eq("workspace_id", DEMO_WORKSPACE_ID),
    db.from("templates").select("id", { count: "exact", head: true }).eq("workspace_id", DEMO_WORKSPACE_ID),
    db.from("report_snapshots").select("id", { count: "exact", head: true }).eq("workspace_id", DEMO_WORKSPACE_ID),
    db.from("ksef_connections").select("id", { count: "exact", head: true }).eq("workspace_id", DEMO_WORKSPACE_ID),
    db.from("stock_movements").select("id", { count: "exact", head: true }).eq("workspace_id", DEMO_WORKSPACE_ID),
    db.from("employees").select("id", { count: "exact", head: true }).eq("workspace_id", DEMO_WORKSPACE_ID)
  ]);

  for (const result of [projects, templates, snapshots, ksef, movements, employees]) {
    if (result.error) throw new Error(`Nie udało się sprawdzić kompletności danych demonstracyjnych: ${result.error.message}`);
  }

  return (
    (projects.count ?? 0) >= 10 &&
    (templates.count ?? 0) >= 3 &&
    (snapshots.count ?? 0) >= 1 &&
    (ksef.count ?? 0) >= 1 &&
    (movements.count ?? 0) >= 10 &&
    (employees.count ?? 0) >= 10
  );
}

async function markGuestDatasetVersion(userId: string, metadata: Record<string, unknown> | null | undefined) {
  const db = createServiceSupabaseClient();
  const { error } = await db.auth.admin.updateUserById(userId, {
    user_metadata: {
      ...(metadata ?? {}),
      display_name: "Gość Project Octopus",
      demo_account: true,
      demo_dataset_version: GUEST_DEMO_DATASET_VERSION
    }
  });
  if (error) throw new Error(`Nie udało się oznaczyć wersji danych demonstracyjnych: ${error.message}`);
}

export async function ensureGuestDemoAccount() {
  const db = createServiceSupabaseClient();
  const { data: usersResult, error: usersError } = await db.auth.admin.listUsers({ page: 1, perPage: 1000 });

  if (usersError) {
    throw new Error(`Nie udało się sprawdzić konta gościa: ${usersError.message}`);
  }

  let guest = usersResult.users.find((user) => user.email?.toLocaleLowerCase("pl") === GUEST_AUTH_EMAIL);

  if (!guest) {
    const { data, error } = await db.auth.admin.createUser({
      email: GUEST_AUTH_EMAIL,
      password: GUEST_AUTH_PASSWORD,
      email_confirm: true,
      user_metadata: {
        display_name: "Gość Project Octopus",
        demo_account: true
      }
    });

    if (error || !data.user) {
      throw new Error(`Nie udało się utworzyć konta gościa: ${error?.message ?? "brak użytkownika"}`);
    }
    guest = data.user;
  } else {
    const { data, error } = await db.auth.admin.updateUserById(guest.id, {
      password: GUEST_AUTH_PASSWORD,
      email_confirm: true,
      user_metadata: {
        ...guest.user_metadata,
        display_name: "Gość Project Octopus",
        demo_account: true
      }
    });
    if (error || !data.user) {
      throw new Error(`Nie udało się odświeżyć konta gościa: ${error?.message ?? "brak użytkownika"}`);
    }
    guest = data.user;
  }

  const existingVersion = guestDatasetVersion(guest.user_metadata);
  if (existingVersion === GUEST_DEMO_DATASET_VERSION && await guestWorkspaceExists(guest.id)) {
    return {
      userId: guest.id,
      email: GUEST_AUTH_EMAIL,
      password: GUEST_AUTH_PASSWORD,
      workspaceId: DEMO_WORKSPACE_ID,
      counts: {},
      warnings: []
    };
  }

  // Adopt a complete pre-versioning demo dataset once. Future version changes do
  // not use this shortcut, so bumping GUEST_DEMO_DATASET_VERSION still forces a
  // deliberate refresh.
  if (!existingVersion && await legacyGuestDatasetLooksComplete(guest.id)) {
    await markGuestDatasetVersion(guest.id, guest.user_metadata);
    return {
      userId: guest.id,
      email: GUEST_AUTH_EMAIL,
      password: GUEST_AUTH_PASSWORD,
      workspaceId: DEMO_WORKSPACE_ID,
      counts: {},
      warnings: []
    };
  }

  // The current workspace schema requires created_by. Older demo blueprints only
  // carried owner_id, so create/repair the deterministic demo workspace first.
  const { error: workspaceBootstrapError } = await db.from("workspaces").upsert({
    id: DEMO_WORKSPACE_ID,
    name: "Octopus Demo – Instalacje i Realizacja Sp. z o.o.",
    created_by: guest.id,
    owner_id: guest.id
  }, { onConflict: "id" });

  if (workspaceBootstrapError) {
    throw new Error(`Nie udało się przygotować firmy demonstracyjnej: ${workspaceBootstrapError.message}`);
  }

  const seeded = await seedGuestDemoData(guest.id);
  await markGuestDatasetVersion(guest.id, guest.user_metadata);

  return {
    userId: guest.id,
    email: GUEST_AUTH_EMAIL,
    password: GUEST_AUTH_PASSWORD,
    ...seeded
  };
}
