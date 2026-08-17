import "server-only";

import {
  GUEST_AUTH_EMAIL,
  GUEST_AUTH_PASSWORD
} from "@/lib/demo/guest-constants";
import { seedGuestDemoData } from "@/lib/demo/seed";
import { createServiceSupabaseClient } from "@/lib/supabase/service";

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

  const seeded = await seedGuestDemoData(guest.id);

  return {
    userId: guest.id,
    email: GUEST_AUTH_EMAIL,
    password: GUEST_AUTH_PASSWORD,
    ...seeded
  };
}
