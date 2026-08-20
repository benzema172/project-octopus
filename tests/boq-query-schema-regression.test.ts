import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("lib/data/module-knowledge.ts", "utf8");

describe("BOQ knowledge query schema", () => {
  it("does not order boq_items by a non-existent updated_at column", () => {
    const boqQuery = source.slice(source.indexOf("export async function getBoqKnowledge"), source.indexOf("export async function getMaterialKnowledge"));
    expect(boqQuery).not.toContain('.order("updated_at"');
    expect(boqQuery).toContain('.order("item_number", { ascending: true, nullsFirst: false })');
  });

  it("selects only BOQ columns present in the production schema", () => {
    expect(source).toContain('.select("id,item_number,description,quantity,unit,unit_price,total_price")');
  });
});
