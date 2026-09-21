import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

describe("Root Error Boundaries Core 8", () => {
  it("provides a root route error boundary with recovery actions", () => {
    const file = source("app/error.tsx");
    expect(file).toContain('"use client"');
    expect(file).toContain('data-error-boundary="root"');
    expect(file).toContain("onClick={reset}");
    expect(file).toContain("error.digest");
    expect(file).toContain('href="/"');
  });

  it("provides a global error boundary that can replace RootLayout safely", () => {
    const file = source("app/global-error.tsx");
    expect(file).toContain('"use client"');
    expect(file).toContain("<html lang=\"pl\">");
    expect(file).toContain("<body");
    expect(file).toContain('data-error-boundary="global"');
    expect(file).toContain("onClick={reset}");
    expect(file).toContain("root layout runtime error");
  });

  it("provides a branded root 404 instead of the framework fallback", () => {
    const file = source("app/not-found.tsx");
    expect(file).toContain("404 · Project Octopus");
    expect(file).toContain("Nie znaleziono tego widoku");
    expect(file).toContain('href="/"');
  });
});
