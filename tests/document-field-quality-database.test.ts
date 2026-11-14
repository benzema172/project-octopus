import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

describe("field quality publication guard in PostgreSQL", () => {
  let db: PGlite;
  beforeAll(async () => {
    // WASM database startup is fixture setup, separate from the guard's 5s test
    // budget. Keep every publication/privilege assertion and the test timeout.
    db = new PGlite();
    await db.waitReady;
  }, 30_000);
  afterAll(async () => { await db?.close(); });
  it("blocks automation and bulk approval of flagged rows but permits individual source verification", async () => {
    await db.exec(`create schema private; create role anon; create role authenticated; create role service_role;
      create table public.brain_learning_events(document_id uuid);
      create table public.document_module_proposals(id integer primary key,status text,payload jsonb,review_note text);
      insert into public.document_module_proposals values(1,'proposed','{"fieldQuality":{"requiresReview":true}}',null);`);
    await db.exec(readFileSync("supabase/migrations/20261108210203_document_field_quality_publication_guard.sql", "utf8"));
    await expect(db.exec(`update public.document_module_proposals set status='publishing',review_note='Autopilot AI: propozycja zastosowana automatycznie.' where id=1`)).rejects.toThrow("Sprawdź pola");
    await expect(db.exec(`update public.document_module_proposals set status='published',review_note='Zbiorcza świadoma decyzja użytkownika' where id=1`)).rejects.toThrow("Sprawdź pola");
    await db.exec(`update public.document_module_proposals set status='publishing',review_note='Kontrola pól potwierdzona przez użytkownika: Sprawdzono źródło.' where id=1;
      update public.document_module_proposals set status='published' where id=1;`);
    expect((await db.query<{status:string}>(`select status from public.document_module_proposals where id=1`)).rows[0].status).toBe("published");
    await db.exec(`insert into public.document_module_proposals values(2,'proposed','{}',null);
      update public.document_module_proposals set status='publishing',review_note='Autopilot AI' where id=2;`);
    const grants = await db.query<{callable:boolean}>(`select has_function_privilege('anon','private.guard_document_field_quality_publication()','execute') as callable`);
    expect(grants.rows[0].callable).toBe(false);
  });
});
