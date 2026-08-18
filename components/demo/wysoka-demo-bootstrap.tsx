"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

const SESSION_KEY = "octopus:wysoka-demo-v1";

export function WysokaDemoBootstrap() {
  const router = useRouter();

  useEffect(() => {
    if (window.localStorage.getItem(SESSION_KEY) === "done" || window.sessionStorage.getItem(SESSION_KEY)) return;
    let cancelled = false;

    void fetch("/api/demo/wysoka-seed", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store"
    }).then(async (response) => {
      const payload = await response.json().catch(() => ({})) as { ok?: boolean; alreadySeeded?: boolean };
      if (cancelled) return;
      if (response.ok) window.localStorage.setItem(SESSION_KEY, "done");
      else if (response.status === 403 || response.status === 404) window.sessionStorage.setItem(SESSION_KEY, `http-${response.status}`);
      if (response.ok && payload.ok && !payload.alreadySeeded) router.refresh();
    }).catch(() => undefined);

    return () => { cancelled = true; };
  }, [router]);

  return null;
}
