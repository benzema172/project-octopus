"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, LockKeyhole, Mail, Waves } from "lucide-react";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";

type ProjectOctopusLoginProps = {
  configReady: boolean;
};

type Tile = {
  key: string;
  active: boolean;
  core: boolean;
  tentacle: boolean;
  x: number;
  y: number;
};

const GRID_COLUMNS = 50;
const GRID_ROWS = 40;
const TENTACLE_ENDS = [
  [10, 31],
  [15, 34],
  [20, 35],
  [24, 33],
  [28, 35],
  [33, 34],
  [39, 31],
  [16, 27],
  [35, 27]
];

function distanceToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;

  if (lengthSquared === 0) {
    return Math.hypot(px - ax, py - ay);
  }

  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSquared));
  const cx = ax + t * dx;
  const cy = ay + t * dy;

  return Math.hypot(px - cx, py - cy);
}

function isOctopusTile(x: number, y: number) {
  const head = Math.pow((x - 25) / 10.5, 2) + Math.pow((y - 15) / 8.5, 2) <= 1;
  const crown = Math.pow((x - 25) / 7.5, 2) + Math.pow((y - 10) / 4.5, 2) <= 1;
  const lowerBody = Math.pow((x - 25) / 13, 2) + Math.pow((y - 23) / 5.2, 2) <= 1;
  const eyes = (Math.abs(x - 21) <= 1 && Math.abs(y - 15) <= 1) || (Math.abs(x - 29) <= 1 && Math.abs(y - 15) <= 1);
  const tentacle = TENTACLE_ENDS.some(([endX, endY], index) => {
    const startX = 15 + index * 2.5 + (index > 6 ? (index === 7 ? -7 : 3) : 0);
    const startY = index > 6 ? 22 : 25;
    return distanceToSegment(x, y, startX, startY, endX, endY) <= 1.55;
  });

  return {
    active: (head || crown || lowerBody || tentacle) && !eyes,
    core: (head || crown || lowerBody) && !eyes,
    tentacle
  };
}

function useOctopusTiles() {
  return useMemo<Tile[]>(() => {
    const tiles: Tile[] = [];

    for (let y = 0; y < GRID_ROWS; y += 1) {
      for (let x = 0; x < GRID_COLUMNS; x += 1) {
        const octopus = isOctopusTile(x, y);
        const tentacleEnd = TENTACLE_ENDS.some(([endX, endY]) => Math.abs(endX - x) <= 1 && Math.abs(endY - y) <= 1);

        tiles.push({
          key: `${x}-${y}`,
          active: octopus.active,
          core: octopus.core,
          tentacle: tentacleEnd,
          x,
          y
        });
      }
    }

    return tiles;
  }, []);
}

export function ProjectOctopusLogin({ configReady }: ProjectOctopusLoginProps) {
  const router = useRouter();
  const tiles = useOctopusTiles();
  const [formVisible, setFormVisible] = useState(false);
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pull, setPull] = useState<{ startX: number; startY: number; x: number; y: number } | null>(null);

  function revealFromPull(clientX: number, clientY: number) {
    if (!pull) {
      return;
    }

    const distance = Math.hypot(clientX - pull.startX, clientY - pull.startY);
    setPull({ ...pull, x: clientX - pull.startX, y: clientY - pull.startY });

    if (distance > 34) {
      setFormVisible(true);
    }
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!configReady) {
      setMessage("Brakuje publicznej konfiguracji Supabase.");
      return;
    }

    setBusy(true);
    setMessage(null);

    try {
      const supabase = createBrowserSupabaseClient();
      const result =
        mode === "login"
          ? await supabase.auth.signInWithPassword({ email, password })
          : await supabase.auth.signUp({ email, password });

      if (result.error) {
        setMessage(result.error.message);
        return;
      }

      router.replace("/workspace");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Nie udało się połączyć z Supabase.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main
      className="login-screen"
      onPointerMove={(event) => revealFromPull(event.clientX, event.clientY)}
      onPointerUp={() => setPull(null)}
      onPointerCancel={() => setPull(null)}
    >
      <section className="login-stage" aria-label="Project Octopus">
        <div className="login-title">
          <span className="brand-kicker">PureInvest</span>
          <h1>Project Octopus</h1>
        </div>

        <div className="octopus-board">
          <div className="tile-grid" style={{ gridTemplateColumns: `repeat(${GRID_COLUMNS}, 1fr)` }}>
            {tiles.map((tile) => {
              const className = [
                  "tile",
                  tile.active ? "tile--octopus" : "",
                  tile.core ? "tile--core" : "",
                  tile.tentacle ? "tile--tentacle" : ""
                ].join(" ");
              const style = {
                "--wave-delay": `${(tile.x * 28 + tile.y * 42) % 1900}ms`,
                "--pull-x": tile.tentacle && pull ? `${Math.max(-18, Math.min(18, pull.x / 4))}px` : "0px",
                "--pull-y": tile.tentacle && pull ? `${Math.max(-18, Math.min(18, pull.y / 4))}px` : "0px"
              } as React.CSSProperties;

              if (tile.tentacle) {
                return (
                  <button
                    type="button"
                    key={tile.key}
                    className={className}
                    aria-label="Macka Octopusa"
                    onPointerDown={(event) => {
                      event.currentTarget.setPointerCapture(event.pointerId);
                      setPull({ startX: event.clientX, startY: event.clientY, x: 0, y: 0 });
                    }}
                    style={style}
                  />
                );
              }

              return <span key={tile.key} className={className} aria-hidden="true" style={style} />;
            })}
          </div>
        </div>

        <form className={`login-panel ${formVisible ? "login-panel--visible" : ""}`} onSubmit={handleSubmit}>
          <div className="login-tabs" role="tablist" aria-label="Tryb logowania">
            <button type="button" className={mode === "login" ? "is-active" : ""} onClick={() => setMode("login")}>
              Logowanie
            </button>
            <button type="button" className={mode === "signup" ? "is-active" : ""} onClick={() => setMode("signup")}>
              Rejestracja
            </button>
          </div>

          <label className="field">
            <Mail size={18} aria-hidden="true" />
            <input
              type="email"
              name="email"
              placeholder="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </label>

          <label className="field">
            <LockKeyhole size={18} aria-hidden="true" />
            <input
              type={showPassword ? "text" : "password"}
              name="password"
              placeholder="hasło"
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              minLength={6}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
            <button type="button" className="icon-button" onClick={() => setShowPassword((value) => !value)} aria-label="Pokaż hasło">
              {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </label>

          <button className="primary-button" type="submit" disabled={busy || !configReady}>
            <Waves size={18} aria-hidden="true" />
            {busy ? "Łączenie" : mode === "login" ? "Wejdź do workspace" : "Utwórz konto"}
          </button>

          {message ? <p className="form-message">{message}</p> : null}
          {!configReady ? <p className="form-message">Deployment wymaga publicznych zmiennych Supabase.</p> : null}
        </form>
      </section>
    </main>
  );
}
