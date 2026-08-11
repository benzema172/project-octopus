"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, LockKeyhole, UserRound } from "lucide-react";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";

type ProjectOctopusLoginProps = {
  configReady: boolean;
};

type LogoPoint = {
  key: string;
  x: number;
  y: number;
  className: string;
  core: boolean;
  tentacleId: string | null;
  color: string;
  glow: string;
  delay: string;
  duration: string;
};

type TentacleHandle = {
  id: string;
  x: number;
  y: number;
};

type ActiveDrag = {
  pointerId: number;
  tentacleId: string;
  startX: number;
  startY: number;
  triggered: boolean;
};

const COLS = 50;
const ROWS = 40;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function colorAt(x: number) {
  const t = clamp(x / (COLS - 1), 0, 1);
  const stops = [
    { t: 0, c: [255, 45, 134] },
    { t: 0.42, c: [138, 43, 226] },
    { t: 0.72, c: [30, 91, 255] },
    { t: 1, c: [0, 230, 209] }
  ];
  let a = stops[0];
  let b = stops[stops.length - 1];

  for (let index = 0; index < stops.length - 1; index += 1) {
    if (t >= stops[index].t && t <= stops[index + 1].t) {
      a = stops[index];
      b = stops[index + 1];
      break;
    }
  }

  const local = (t - a.t) / (b.t - a.t || 1);
  const mix = (left: number, right: number) => Math.round(left + (right - left) * local);
  const red = mix(a.c[0], b.c[0]);
  const green = mix(a.c[1], b.c[1]);
  const blue = mix(a.c[2], b.c[2]);

  return {
    solid: `rgb(${red}, ${green}, ${blue})`,
    glow: `rgba(${red}, ${green}, ${blue}, .42)`
  };
}

function buildLogo() {
  const centerX = Math.floor(COLS / 2);
  const centerY = Math.floor(ROWS / 2);
  const logoMap = new Map<string, { x: number; y: number; className: string }>();
  const tentacleDefs: TentacleHandle[] = [];

  function key(x: number, y: number) {
    return `${x},${y}`;
  }

  function addPoint(x: number, y: number, className = "") {
    const roundedX = Math.round(x);
    const roundedY = Math.round(y);

    if (roundedX < 0 || roundedX >= COLS || roundedY < 0 || roundedY >= ROWS) {
      return;
    }

    const pointKey = key(roundedX, roundedY);
    const existing = logoMap.get(pointKey);

    if (!existing) {
      logoMap.set(pointKey, { x: roundedX, y: roundedY, className });
      return;
    }

    if (className && !existing.className.includes(className)) {
      existing.className = `${existing.className} ${className}`.trim();
    }
  }

  function line(x1: number, y1: number, x2: number, y2: number, className = "") {
    let currentX = Math.round(x1);
    let currentY = Math.round(y1);
    const endX = Math.round(x2);
    const endY = Math.round(y2);
    const dx = Math.abs(endX - currentX);
    const sx = currentX < endX ? 1 : -1;
    const dy = -Math.abs(endY - currentY);
    const sy = currentY < endY ? 1 : -1;
    let error = dx + dy;

    while (true) {
      addPoint(currentX, currentY, className);

      if (currentX === endX && currentY === endY) {
        break;
      }

      const doubledError = 2 * error;

      if (doubledError >= dy) {
        error += dy;
        currentX += sx;
      }

      if (doubledError <= dx) {
        error += dx;
        currentY += sy;
      }
    }
  }

  function poly(points: Array<[number, number]>, className = "") {
    for (let index = 0; index < points.length - 1; index += 1) {
      line(points[index][0], points[index][1], points[index + 1][0], points[index + 1][1], className);
    }
  }

  function ring(cx: number, cy: number, radius: number, className = "") {
    const steps = Math.max(24, Math.round(2 * Math.PI * radius * 2.2));

    for (let index = 0; index < steps; index += 1) {
      const angle = (index / steps) * Math.PI * 2;
      addPoint(Math.round(cx + Math.cos(angle) * radius), Math.round(cy + Math.sin(angle) * radius), className);
    }
  }

  const tentacleClass = (id: string) => `arm tentacle tentacle-${id}`;

  ring(centerX, centerY, 7, "core");
  ring(centerX, centerY, 4, "core");
  ring(centerX, centerY, 1, "core");
  addPoint(centerX, centerY, "core");
  line(centerX, centerY + 5, centerX, centerY + 9, "core");

  poly(
    [
      [centerX - 4, centerY - 6],
      [centerX - 5, centerY - 7],
      [centerX - 6, centerY - 8],
      [centerX - 7, centerY - 8]
    ],
    tentacleClass("upper-left")
  );
  poly(
    [
      [centerX + 4, centerY - 6],
      [centerX + 5, centerY - 7],
      [centerX + 6, centerY - 8],
      [centerX + 7, centerY - 8]
    ],
    tentacleClass("upper-right")
  );

  poly(
    [
      [centerX, centerY - 7],
      [centerX, centerY - 10],
      [centerX, centerY - 12]
    ],
    tentacleClass("top")
  );
  ring(centerX, centerY - 14, 2, tentacleClass("top"));
  tentacleDefs.push({ id: "top", x: centerX, y: centerY - 14 });

  poly(
    [
      [centerX - 7, centerY - 5],
      [centerX - 10, centerY - 7],
      [centerX - 12, centerY - 9]
    ],
    tentacleClass("upper-left")
  );
  ring(centerX - 14, centerY - 11, 2, tentacleClass("upper-left"));
  tentacleDefs.push({ id: "upper-left", x: centerX - 14, y: centerY - 11 });

  poly(
    [
      [centerX + 7, centerY - 5],
      [centerX + 10, centerY - 7],
      [centerX + 12, centerY - 9]
    ],
    tentacleClass("upper-right")
  );
  ring(centerX + 14, centerY - 11, 2, tentacleClass("upper-right"));
  tentacleDefs.push({ id: "upper-right", x: centerX + 14, y: centerY - 11 });

  poly(
    [
      [centerX - 8, centerY],
      [centerX - 12, centerY],
      [centerX - 16, centerY]
    ],
    tentacleClass("middle-left")
  );
  ring(centerX - 18, centerY, 2, tentacleClass("middle-left"));
  tentacleDefs.push({ id: "middle-left", x: centerX - 18, y: centerY });

  poly(
    [
      [centerX + 8, centerY],
      [centerX + 12, centerY],
      [centerX + 16, centerY]
    ],
    tentacleClass("middle-right")
  );
  ring(centerX + 18, centerY, 2, tentacleClass("middle-right"));
  tentacleDefs.push({ id: "middle-right", x: centerX + 18, y: centerY });

  poly(
    [
      [centerX - 6, centerY + 5],
      [centerX - 9, centerY + 7],
      [centerX - 11, centerY + 9]
    ],
    tentacleClass("lower-left")
  );
  ring(centerX - 13, centerY + 11, 2, tentacleClass("lower-left"));
  tentacleDefs.push({ id: "lower-left", x: centerX - 13, y: centerY + 11 });

  poly(
    [
      [centerX + 6, centerY + 5],
      [centerX + 9, centerY + 7],
      [centerX + 11, centerY + 9]
    ],
    tentacleClass("lower-right")
  );
  ring(centerX + 13, centerY + 11, 2, tentacleClass("lower-right"));
  tentacleDefs.push({ id: "lower-right", x: centerX + 13, y: centerY + 11 });

  poly(
    [
      [centerX - 2, centerY + 6],
      [centerX - 2, centerY + 8],
      [centerX - 3, centerY + 10]
    ],
    tentacleClass("bottom-left")
  );
  ring(centerX - 3, centerY + 12, 2, tentacleClass("bottom-left"));
  tentacleDefs.push({ id: "bottom-left", x: centerX - 3, y: centerY + 12 });

  poly(
    [
      [centerX + 2, centerY + 6],
      [centerX + 2, centerY + 8],
      [centerX + 3, centerY + 10]
    ],
    tentacleClass("bottom-right")
  );
  ring(centerX + 3, centerY + 12, 2, tentacleClass("bottom-right"));
  tentacleDefs.push({ id: "bottom-right", x: centerX + 3, y: centerY + 12 });

  poly(
    [
      [centerX - 1, centerY + 5],
      [centerX - 3, centerY + 7],
      [centerX - 5, centerY + 9]
    ],
    "core"
  );
  poly(
    [
      [centerX + 1, centerY + 5],
      [centerX + 3, centerY + 7],
      [centerX + 5, centerY + 9]
    ],
    "core"
  );

  const sourcePoints = Array.from(logoMap.values());
  const minX = Math.min(...sourcePoints.map((point) => point.x));
  const maxX = Math.max(...sourcePoints.map((point) => point.x));
  const minY = Math.min(...sourcePoints.map((point) => point.y));
  const maxY = Math.max(...sourcePoints.map((point) => point.y));
  const targetCenterX = (COLS - 1) / 2;
  const targetCenterY = (ROWS - 1) / 2;
  const offsetX = Math.round(targetCenterX - (minX + maxX) / 2);
  const offsetY = Math.round(targetCenterY - (minY + maxY) / 2);

  const sortedPoints = sourcePoints
    .map((point) => ({
      ...point,
      x: point.x + offsetX,
      y: point.y + offsetY
    }))
    .filter((point) => point.x >= 1 && point.x <= COLS - 2 && point.y >= 1 && point.y <= ROWS - 2)
    .sort((a, b) => {
      const distanceA = Math.abs(a.x - targetCenterX) + Math.abs(a.y - targetCenterY);
      const distanceB = Math.abs(b.x - targetCenterX) + Math.abs(b.y - targetCenterY);
      return distanceA - distanceB;
    });

  const points = sortedPoints.map<LogoPoint>((point) => {
    const tentacleMatch = point.className.match(/tentacle-([a-z-]+)/);
    const tentacleId = tentacleMatch?.[1] ?? null;
    const color = colorAt(point.x);
    const distance = Math.hypot(point.x - targetCenterX, point.y - targetCenterY);

    return {
      key: `${point.x}-${point.y}`,
      x: point.x,
      y: point.y,
      className: point.className,
      core: point.className.includes("core"),
      tentacleId,
      color: color.solid,
      glow: color.glow,
      delay: `${(-((point.x * 0.085 + point.y * 0.12 + distance * 0.045))).toFixed(2)}s`,
      duration: `${(4.2 + ((point.x + point.y) % 7) * 0.17).toFixed(2)}s`
    };
  });

  const handles = tentacleDefs.map((handle) => ({
    id: handle.id,
    x: handle.x + offsetX,
    y: handle.y + offsetY
  }));

  return { points, handles };
}

function createGridCells() {
  return Array.from({ length: COLS * ROWS }, (_, index) => {
    const x = index % COLS;
    const y = Math.floor(index / COLS);
    const seed = (x * 37 + y * 17) % 100;

    return {
      key: `${x}-${y}`,
      spark: seed < 11,
      delay: `${(-(((x * 23 + y * 41) % 800) / 100)).toFixed(2)}s`,
      duration: `${(6.2 + (((x * 19 + y * 13) % 36) / 10)).toFixed(2)}s`
    };
  });
}

export function ProjectOctopusLogin({ configReady }: ProjectOctopusLoginProps) {
  const router = useRouter();
  const loginInputRef = useRef<HTMLInputElement>(null);
  const activeDrag = useRef<ActiveDrag | null>(null);
  const hideTimer = useRef<number | null>(null);
  const focusTimer = useRef<number | null>(null);
  const gridCells = useMemo(() => createGridCells(), []);
  const logo = useMemo(() => buildLogo(), []);
  const [loginMounted, setLoginMounted] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);
  const [drag, setDrag] = useState<{ tentacleId: string; x: number; y: number } | null>(null);
  const [paused, setPaused] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function openLogin() {
    if (loginOpen) {
      return;
    }

    if (hideTimer.current) {
      clearTimeout(hideTimer.current);
    }

    setLoginMounted(true);
    window.requestAnimationFrame(() => setLoginOpen(true));

    focusTimer.current = window.setTimeout(() => {
      loginInputRef.current?.focus();
    }, 680);
  }

  function endDrag(pointerId?: number) {
    const current = activeDrag.current;

    if (!current || (pointerId !== undefined && pointerId !== current.pointerId)) {
      return;
    }

    activeDrag.current = null;
    setDrag(null);
  }

  function beginDrag(event: React.PointerEvent<HTMLButtonElement>, tentacleId: string) {
    if (loginOpen) {
      return;
    }

    activeDrag.current = {
      pointerId: event.pointerId,
      tentacleId,
      startX: event.clientX,
      startY: event.clientY,
      triggered: false
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  }

  function moveDrag(event: React.PointerEvent<HTMLButtonElement>) {
    const current = activeDrag.current;

    if (!current || event.pointerId !== current.pointerId) {
      return;
    }

    const rawX = event.clientX - current.startX;
    const rawY = event.clientY - current.startY;
    const distance = Math.hypot(rawX, rawY);
    const limited = Math.min(distance, 58);
    const ratio = distance > 0 ? limited / distance : 0;
    const moveX = rawX * ratio;
    const moveY = rawY * ratio;

    setDrag({
      tentacleId: current.tentacleId,
      x: moveX,
      y: moveY
    });

    if (distance >= 34 && !current.triggered) {
      current.triggered = true;
      openLogin();
      activeDrag.current = null;
      window.setTimeout(() => setDrag(null), 20);
    }
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedEmail = email.trim();

    if (!normalizedEmail || !password) {
      setInvalid(true);
      window.setTimeout(() => setInvalid(false), 380);
      (normalizedEmail ? undefined : loginInputRef.current)?.focus();
      return;
    }

    if (!configReady) {
      setMessage("Brakuje publicznej konfiguracji Supabase.");
      return;
    }

    setBusy(true);
    setMessage(null);

    try {
      const supabase = createBrowserSupabaseClient();
      const result = await supabase.auth.signInWithPassword({
        email: normalizedEmail,
        password
      });

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

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (focusTimer.current) {
          clearTimeout(focusTimer.current);
        }

        setLoginOpen(false);
        hideTimer.current = window.setTimeout(() => {
          setLoginMounted(false);
        }, 300);
      }
    };
    const handleVisibilityChange = () => {
      setPaused(document.hidden);
    };

    window.addEventListener("keydown", handleKeyDown);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("visibilitychange", handleVisibilityChange);

      if (hideTimer.current) {
        clearTimeout(hideTimer.current);
      }

      if (focusTimer.current) {
        clearTimeout(focusTimer.current);
      }
    };
  }, []);

  return (
    <main className={`octopus-login ${loginOpen ? "octopus-login--open" : ""}`}>
      <h1 className="v27-brand">
        <small>Project</small>
        <strong>Octopus</strong>
      </h1>

      <div className="v27-board-shell">
        <section className={`v27-board ${paused ? "paused" : ""}`} aria-label="Animowane logo Project Octopus na siatce z małych kwadratów">
          <div className="v27-circuit" aria-hidden="true">
            <svg viewBox="0 0 100 100" preserveAspectRatio="none">
              <path d="M6 24H18L24 30" fill="none" stroke="rgba(90,170,255,.14)" strokeWidth=".25" />
              <path d="M94 24H82L76 30" fill="none" stroke="rgba(90,170,255,.14)" strokeWidth=".25" />
              <path d="M6 76H18L24 70" fill="none" stroke="rgba(90,170,255,.14)" strokeWidth=".25" />
              <path d="M94 76H82L76 70" fill="none" stroke="rgba(90,170,255,.14)" strokeWidth=".25" />
            </svg>
          </div>

          <div className="v27-grid-layer" aria-hidden="true">
            {gridCells.map((cell) => (
              <span
                key={cell.key}
                className={cell.spark ? "v27-grid-cell spark" : "v27-grid-cell"}
                style={
                  {
                    "--delay": cell.delay,
                    "--dur": cell.duration
                  } as React.CSSProperties
                }
              />
            ))}
          </div>

          <div className="v27-logo-layer" aria-hidden="true">
            {logo.points.map((point) => {
              const isDragged = point.tentacleId && drag?.tentacleId === point.tentacleId;

              return (
                <span
                  key={point.key}
                  className={[
                    "v27-logo-cell",
                    "on",
                    point.core ? "core" : "",
                    point.tentacleId ? "v27-logo-cell--tentacle" : "",
                    isDragged ? "is-dragging is-grabbed" : ""
                  ].join(" ")}
                  style={
                    {
                      gridColumn: point.x + 1,
                      gridRow: point.y + 1,
                      backgroundColor: point.color,
                      "--glow": point.glow,
                      "--lamp-delay": point.delay,
                      "--lamp-duration": point.duration,
                      translate: isDragged ? `${drag.x.toFixed(1)}px ${drag.y.toFixed(1)}px` : "0px 0px"
                    } as React.CSSProperties
                  }
                />
              );
            })}
          </div>

          <div className="v27-grid-shimmer" aria-hidden="true" />

          <div className="v27-interaction-layer" aria-label="Interaktywne macki ośmiornicy">
            {logo.handles.map((handle) => (
              <button
                key={handle.id}
                type="button"
                className="v27-tentacle-handle"
                aria-label={`Pociągnij mackę ${handle.id.replaceAll("-", " ")}, aby otworzyć logowanie`}
                onPointerDown={(event) => beginDrag(event, handle.id)}
                onPointerMove={moveDrag}
                onPointerUp={(event) => endDrag(event.pointerId)}
                onPointerCancel={(event) => endDrag(event.pointerId)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    openLogin();
                  }
                }}
                style={{
                  left: `${((handle.x + 0.5) / COLS) * 100}%`,
                  top: `${((handle.y + 0.5) / ROWS) * 100}%`
                }}
              />
            ))}
          </div>
        </section>
      </div>

      {loginMounted ? (
        <div className={`v27-login-wrap ${loginOpen ? "revealing" : "hiding"}`} aria-hidden={!loginOpen}>
          <form className={`v27-login-panel ${invalid ? "invalid" : ""}`} onSubmit={handleSubmit} noValidate>
            <div className="v27-panel-head">Witaj ponownie</div>

            <label className="v27-field">
              <UserRound aria-hidden="true" />
              <input
                ref={loginInputRef}
                type="email"
                autoComplete="username"
                placeholder="Login"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </label>

            <label className="v27-field">
              <LockKeyhole aria-hidden="true" />
              <input
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                placeholder="Hasło"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
              <button
                className="v27-toggle-password"
                type="button"
                aria-label={showPassword ? "Ukryj hasło" : "Pokaż hasło"}
                onClick={() => setShowPassword((value) => !value)}
              >
                {showPassword ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
              </button>
            </label>

            <button className="v27-login-button" type="submit" disabled={busy || !configReady}>
              {busy ? "Logowanie..." : "Zaloguj się"}
            </button>

            {message ? <p className="v27-form-message">{message}</p> : null}
            {!configReady ? <p className="v27-form-message">Deployment wymaga publicznych zmiennych Supabase.</p> : null}
          </form>
        </div>
      ) : null}

      <footer className="v27-footer">
        <small>System rozwijany</small>
        <span className="brand-line">
          by{" "}
          <a href="https://pure-invest.pl/" target="_blank" rel="noopener noreferrer">
            PureInvest
          </a>
        </span>
        <span className="author">Wiktor Purczyński</span>
      </footer>
    </main>
  );
}
